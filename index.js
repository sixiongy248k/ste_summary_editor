/**
 * @module index
 * @description Entry point for the Summary Editor SillyTavern extension.
 *
 * This file is intentionally thin — it only:
 * 1. Registers the extension with SillyTavern
 * 2. Loads the Tailwind CDN for styling
 * 3. Loads HTML templates and injects the modal shell into the DOM
 * 4. Wires up all event handlers by delegating to feature modules
 * 5. Restores persisted state from localStorage
 * 6. Manages the 4-tab workflow (Ingest → Review → Edit → Export)
 *
 * All feature logic lives in the `src/` folder as separate modules.
 */

// ─── Core modules ───
import { EXT_NAME, STORAGE_KEY, TABLE_COLS, TEMPLATES } from './src/core/constants.js';
import { state, persistState, snapshotState, restoreSnapshot } from './src/core/state.js';
import { debounce, makeDraggable, escHtml, escAttr, spawnPanel, registerPanel } from './src/core/utils.js';
import { loadTemplate, fillTemplate, preloadAllTemplates } from './src/core/template-loader.js';

// ─── Feature modules ───
import { handleFileInput, removeFile } from './src/ingest/ingestion.js';
import { detectGaps } from './src/ingest/gap-detection.js';
import {
    initTable, renderTable, getTotalPages,
    renderStatsBar, renderWarningBanner, renderSelectionBar,
    closeEditPopover, setContentCellClickHandler, updateUndoButton, openSuppEditor,
} from './src/table/table.js';
import {
    initActs, updateActButtonState, createActFromSelection,
    renderActPanel, toggleMinimap, buildMinimapOverlay,
    updateFilterDropdown, updateBulkActDropdown, updateBulkActSwatch, updateTabBadges,
    closeAllPopovers, showActColorDialog, showEntrySelector,
    buildTimelineDiagram, setTimelineRenderer,
} from './src/arcs/arcs.js';
import { buildLocationBubbles } from './src/arcs/location-bubbles.js';
import {
    handleExport, updateLivePreview,
    renderFullPreview, copyToClipboard, updateScopeCounts,
    updateActScopeDropdown, downloadBySource, downloadAsZip, triggerDestructiveExport,
} from './src/export/export.js';
import { handleDatabankInject } from './src/export/databank.js';
import { rewordForRAG } from './src/integration/rag-reword.js';
import { injectMagicWandOption } from './src/integration/magic-wand.js';
import { bindKeyboardShortcuts, openKeyboardShortcutsPanel } from './src/core/keyboard.js';
import { bindTooltipEvents, hideTooltip } from './src/table/tooltip.js';
import { showMoveDialog, showSwapDialog } from './src/table/reorder.js';
import { showTagBrowser } from './src/table/tags.js';
import { toggleEntitySidebar, setEntityFilterCallback } from './src/table/entity-sidebar.js';
import { toggleFilesPanel, refreshFilesPanel } from './src/ingest/files-panel.js';
import { autoDetectTimelineFiles, hasTimelineFiles, openTimelinePanel, runTimelineAnalysis } from './src/analysis/timeline-analysis.js';
import { openTimelineEditor, closeTimelineEditor } from './src/analysis/timeline-editor.js';
import {
    runConflictCheck, clearConflicts, renderApiStatus, showAnalysisLog,
    showFeedbackDetail, openStoryContextPanel,
} from './src/conflict/conflict-detection.js';
import { openAnalyticsPanel } from './src/analysis/entry-analytics.js';
import { openConflictReview, setConflictReviewEditorCallback } from './src/conflict/conflict-review.js';
import { addRangeLinks, removeRangeLinks, clearAllLinks, renderCausalPanel, toggleCausalPopover } from './src/editor/causality.js';
import { openContentEditor, closeContentEditor } from './src/editor/content-editor.js';
import { openBulkRefine, closeBulkRefine } from './src/editor/bulk-refine.js';
import { openSplitDialog, closeSplitDialog } from './src/editor/split-entry.js';
import { closeIngestSplit, swapIngestSplit, openIngestPreview, closeIngestPreview, refreshIngestPreviewIfOpen } from './src/ingest/ingest-split.js';
import { isCharacterBlocked, bindBlacklistEvents, refreshBlockedState } from './src/integration/blacklist.js';
import {
    registerPrompt, getPrompt, seedDefaultPrompts, loadPromptDefaults,
    openEditPromptPopup, openSystemPromptHub,
} from './src/core/system-prompts.js';

registerPrompt('gap-suggest', 'Gap Suggest');

// ─── Tailwind CDN & Libraries ───
import { configureTailwind } from './lib/tailwind-config.js';
import { closeColorPicker, isColorPickerOpen } from './src/arcs/color-picker.js';
import { seAlert, seConfirm } from './src/core/dialogs.js';

// ─────────────────────────────────────────────
//  Panel template cache (populated during init)
// ─────────────────────────────────────────────

let _tplUtilsPanel      = '';
let _tplFindReplace     = '';
let _tplBulkFill        = '';
let _tplGapSuggest      = '';
let _tplNewEntryPrompt  = '';
let _tplFileItem        = '';

// ─────────────────────────────────────────────
//  Undo helpers
// ─────────────────────────────────────────────

/**
 * Set the current undoable action and refresh the undo button.
 * @param {string} description - Human-readable action label.
 * @param {Function} undoFn - Function to call when undoing.
 */
function pushUndo(description, undoFn) {
    state.lastAction = { description, undo: undoFn };
    updateUndoButton();
}

/**
 * Full UI refresh after an undo that may touch entries, acts, gaps, files.
 */
function fullRefreshAfterUndo() {
    detectGaps();
    renderIngestSummary();
    renderTable();
    renderSelectionBar();
    renderActPanel();
    updateFilterDropdown();
    updateBulkActDropdown();
    updateTabBadges();
    buildMinimapOverlay();
    renderCausalPanel();
    persistState();
}

// ─────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────

/**
 * Lazily load Mermaid.js from CDN on first call (for future bubble chart feature).
 * Subsequent calls resolve immediately if already loaded.
 * @returns {Promise<void>}
 */
export function ensureMermaidLoaded() {
    return new Promise((resolve) => {
        if (typeof mermaid !== 'undefined') { resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
        script.onload = () => {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'dark',
                themeVariables: {
                    primaryColor: '#3e3d32',
                    primaryTextColor: '#f8f8f2',
                    primaryBorderColor: '#75715e',
                    lineColor: '#75715e',
                    secondaryColor: '#272822',
                    tertiaryColor: '#1e1f1a',
                    fontFamily: '"Fira Code", Consolas, monospace',
                    fontSize: '12px',
                },
                flowchart: { curve: 'basis', padding: 12 },
            });
            resolve();
        };
        script.onerror = () => {
            console.warn('[Summary Editor] Mermaid.js failed to load');
            resolve();
        };
        document.head.appendChild(script);
    });
}

/**
 * Load iro.js color picker library from the bundled file.
 */
function loadIroJS() {
    return new Promise((resolve) => {
        if (typeof iro !== 'undefined') { resolve(); return; }

        const script = document.createElement('script');
        script.src = `/scripts/extensions/third-party/${EXT_NAME}/lib/iro.min.js`;
        script.onload = resolve;
        script.onerror = () => {
            console.warn('[Summary Editor] iro.js failed to load, color picker unavailable');
            resolve();
        };
        document.head.appendChild(script);
    });
}

/**
 * Load the Tailwind Play CDN script into the page.
 */
function loadTailwindCDN() {
    return new Promise((resolve) => {
        if (document.querySelector('script[src*="tailwindcss"]')) {
            configureTailwind();
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.tailwindcss.com';
        script.onload = () => {
            configureTailwind();
            resolve();
        };
        script.onerror = () => {
            console.warn('[Summary Editor] Tailwind CDN failed to load, falling back to CSS only');
            resolve();
        };
        document.head.appendChild(script);
    });
}

/**
 * Main initialization — runs when jQuery is ready.
 */
jQuery(async () => {
    // Inject table column widths from constants as CSS custom properties
    const root = document.documentElement;
    for (const [col, val] of Object.entries(TABLE_COLS)) {
        root.style.setProperty(`--se-col-${col}`, val);
    }

    // Load the settings panel HTML into ST's extensions sidebar
    const settingsHtml = await $.get(`/scripts/extensions/third-party/${EXT_NAME}/settings.html`);
    $('#extensions_settings2').append(settingsHtml);

    // Load Tailwind, iro.js, and all HTML templates in parallel
    await Promise.all([
        loadTailwindCDN(),
        loadIroJS(),
        preloadAllTemplates(),
    ]);

    // Cache panel templates (preloadAllTemplates already fetched them)
    [_tplUtilsPanel, _tplFindReplace, _tplBulkFill, _tplGapSuggest, _tplNewEntryPrompt, _tplFileItem] =
        await Promise.all([
            loadTemplate(TEMPLATES.UTILS_PANEL),
            loadTemplate(TEMPLATES.FIND_REPLACE_PANEL),
            loadTemplate(TEMPLATES.BULK_FILL_PANEL),
            loadTemplate(TEMPLATES.GAP_SUGGEST_PANEL),
            loadTemplate(TEMPLATES.NEW_ENTRY_PROMPT),
            loadTemplate(TEMPLATES.FILE_ITEM),
        ]);

    // Initialize template-dependent modules
    await Promise.all([
        initTable(),
        initActs(),
    ]);

    // Inject the main modal shell and export panel into the DOM
    await injectModalShell();

    // Clear any stale persisted state — each page refresh starts fresh
    // (state only persists within a session via in-memory state object)
    localStorage.removeItem(STORAGE_KEY);
    // Load prompt defaults from configs/prompts/*.txt, then seed into state
    await loadPromptDefaults();
    seedDefaultPrompts();
    detectGaps();
    updateFilterDropdown();
    updateBulkActDropdown();
    updateTabBadges();

    // Register content cell click handler (fires inside row handler before renderTable)
    setContentCellClickHandler((num) => openContentEditor(num));
    setConflictReviewEditorCallback((num) => openContentEditor(num));

    // Bind all event handlers
    bindSettingsEvents();
    bindModalEvents();
    bindKeyboardShortcuts(closeEditor, {
        openContentEditor: (num) => openContentEditor(num),
        deleteEntry: async (num) => {
            if (!state.entries.has(num)) return;
            if (!await seConfirm(`Delete entry #${num}?`, { danger: true })) return;
            snapshotState();
            state.entries.delete(num);
            state.selected.delete(num);
            state.modified.delete(num);
            delete state.conflicts[num];
            for (const act of state.acts.values()) act.entryNums.delete(num);
            detectGaps();
            persistState();
            renderTable();
            renderSelectionBar();
            pushUndo('Delete Entry', restoreSnapshot);
        },
    });
    bindTooltipEvents();

    // Inject into ST's magic wand dropdown (hidden for blacklisted characters)
    injectMagicWandOption(openEditor, isCharacterBlocked);

    // Wipe state when switching characters — editor is stateless between characters
    listenForCharacterSwap();

    // Auto-inject callback for export.js (avoids circular import)
    globalThis.SummaryEditorAutoInject = () => handleDatabankInject();

    // Expose for debugging in browser console
    globalThis.SummaryEditor = { state, openEditor };
});

// ─────────────────────────────────────────────
//  Modal Shell Injection
// ─────────────────────────────────────────────

/**
 * Load the modal and export panel HTML templates, then inject them into the DOM.
 */
async function injectModalShell() {
    if ($('#se-modal-overlay').length) return;

    const modalHtml = await loadTemplate('modal');
    $('body').append(modalHtml);

    // Load the export panel into its container
    const exportHtml = await loadTemplate('export-panel');
    $('#se-export-panel').html(exportHtml);
}

// ─────────────────────────────────────────────
//  Tab Switching
// ─────────────────────────────────────────────

/**
 * Switch to a specific workflow tab.
 *
 * @param {number} idx - Tab index (0=Ingest, 1=Review, 2=Edit, 3=Export).
 */
function switchTab(idx) {
    state.activeTab = idx;

    // Update tab states
    $('.se-tab').each(function (i) {
        $(this).removeClass('active done');
        if (i < idx) $(this).addClass('done');
        if (i === idx) $(this).addClass('active');
    });

    // Show/hide panels
    $('.se-tab-panel').each(function (i) {
        $(this).toggleClass('active', i === idx);
    });

    // Close floating elements
    closeEditPopover();
    closeAllPopovers();

    // Refresh tab-specific content
    if (idx === 1) {
        renderStatsBar();
        renderWarningBanner();
        renderSelectionBar();
        renderTable();
        renderApiStatus();
    }
    if (idx === 2) {
        renderActPanel();
    }
    if (idx === 3) {
        updateLivePreview();
        renderFullPreview();
        updateScopeCounts();
        updateActScopeDropdown();
        initExportDestination();
    }

    // Update footer nav buttons
    $('#se-footer-back').toggle(idx > 0);
    $('#se-footer-next').toggle(idx < 3);
}

// ─────────────────────────────────────────────
//  Open / Close
// ─────────────────────────────────────────────

/**
 * Open the Summary Editor modal overlay.
 * Blocked characters are prevented from opening.
 */
function openEditor() {
    if (isCharacterBlocked()) return;
    $('#se-modal-overlay').addClass('active');
    renderApiStatus();
    updateTabBadges();

    // If entries loaded, go to Review tab; otherwise stay on Ingest
    if (state.entries.size > 0 && state.activeTab === 0) {
        switchTab(1);
    } else {
        switchTab(state.activeTab);
    }
}

/**
 * Close the Summary Editor modal overlay.
 */
function closeEditor() {
    $('#se-modal-overlay').removeClass('active');
    hideTooltip();
    closeEditPopover();
    closeAllPopovers();
    closeContentEditor();
    closeBulkRefine();
    closeTimelineEditor();
    closeSplitDialog();
    persistState();
}

// ─────────────────────────────────────────────
//  Event Binding
// ─────────────────────────────────────────────

/**
 * Bind the "Open Summary Editor" button and blacklist UI in the ST settings panel.
 */
function bindSettingsEvents() {
    $('#se_open_btn').on('click', () => openEditor());
    bindBlacklistEvents();
}

/**
 * Bind all event handlers inside the modal.
 */
function bindModalEvents() {
    bindCoreEvents();
    bindIngestEvents();
    bindReviewEvents();
    bindCausalPanelEvents();
    bindActsEvents();
    bindExportEvents();
    bindGlobalClickHandlers();
}

/**
 * Core modal events: close, tabs, undo.
 */
function bindCoreEvents() {
    $('#se-btn-close').on('click', closeEditor);
    $('#se-btn-shortcuts').on('click', openKeyboardShortcutsPanel);
    $('#se-modal-overlay').on('click', (e) => {
        if (e.target.id === 'se-modal-overlay') closeEditor();
    });

    const TAB_NAMES = ['Ingest', 'Review', 'Edit', 'Export'];

    $('.se-tab').on('click', function () {
        const idx = Number.parseInt($(this).data('tab'), 10);
        const prev = state.activeTab;
        if (idx === prev) return;
        switchTab(idx);
        pushUndo(`Go back to ${TAB_NAMES[prev]} tab`, () => { switchTab(prev); updateUndoButton(); });
    });

    $('#se-btn-undo').on('click', () => {
        if (state.lastAction) {
            state.lastAction.undo();
            state.lastAction = null;
            updateUndoButton();
        }
    });

    // Footer navigation — undoable tab changes
    $('#se-footer-back').on('click', () => {
        if (state.activeTab > 0) {
            const prev = state.activeTab;
            switchTab(prev - 1);
            pushUndo(`Go back to ${TAB_NAMES[prev]} tab`, () => { switchTab(prev); updateUndoButton(); });
        }
    });
    $('#se-footer-next').on('click', () => {
        if (state.activeTab < 3) {
            const prev = state.activeTab;
            switchTab(prev + 1);
            pushUndo(`Go back to ${TAB_NAMES[prev]} tab`, () => { switchTab(prev); updateUndoButton(); });
        }
    });
}

/**
 * Ingest tab events: file drop, browse, clear, continue.
 */
function bindIngestEvents() {
    $('#se-file-drop').on('click', (e) => {
        // If user clicked the "browse folder" link, trigger folder input instead
        if ($(e.target).is('#se-folder-browse') || $(e.target).closest('#se-folder-browse').length) return;
        $('#se-file-input').trigger('click');
    });
    $('#se-folder-browse').on('click', (e) => {
        e.stopPropagation();
        $('#se-folder-input').trigger('click');
    });
    async function _handleAnyFileInput(e) {
        const snap = snapshotState();
        await handleFileInput(e);
        // Shared post-load refresh
        const loadedCount = state.entries.size - snap.entries.size;
        const fileCount = state.files.length - snap.files.length;
        if (fileCount > 0) {
            const label = `Load ${fileCount} file${fileCount !== 1 ? 's' : ''} (${loadedCount} entries)`;
            pushUndo(label, () => {
                restoreSnapshot(snap);
                fullRefreshAfterUndo();
            });
        }
        autoDetectTimelineFiles();
        detectGaps();
        updateFilterDropdown();
        updateBulkActDropdown();
        updateTabBadges();
        renderIngestSummary();
        if (state.files.length > 0) $('#se-file-drawer').addClass('open');
    }

    $('#se-folder-input').on('change', async (e) => {
        await _handleAnyFileInput(e);
        $('#se-folder-input').val('');
    });

    $('#se-file-input').on('change', async (e) => {
        const snap = snapshotState();
        await handleFileInput(e);
        const loadedCount = state.entries.size - snap.entries.size;
        const fileCount = state.files.length - snap.files.length;
        if (fileCount > 0) {
            const label = `Load ${fileCount} file${fileCount !== 1 ? 's' : ''} (${loadedCount} entries)`;
            pushUndo(label, () => {
                restoreSnapshot(snap);
                fullRefreshAfterUndo();
            });
        }
        autoDetectTimelineFiles();
        detectGaps();
        updateFilterDropdown();
        updateBulkActDropdown();
        updateTabBadges();
        renderIngestSummary();
        if (state.files.length > 0) $('#se-file-drawer').addClass('open');
    });

    const $dropZone = $('#se-file-drop');
    $dropZone.on('dragover', (e) => {
        e.preventDefault();
        $dropZone.addClass('dragover');
    });
    $dropZone.on('dragleave', () => $dropZone.removeClass('dragover'));
    $dropZone.on('drop', (e) => {
        e.preventDefault();
        $dropZone.removeClass('dragover');
        const files = e.originalEvent.dataTransfer.files;
        if (files.length) {
            $('#se-file-input')[0].files = files;
            $('#se-file-input').trigger('change');
        }
    });

    $('#se-btn-clear-all').on('click', handleClearAll);
    $('#se-btn-clear-all-header').on('click', handleClearAll);
    $('#se-btn-continue-review').on('click', () => switchTab(1));

    // File drawer toggle
    $('#se-btn-show-files').on('click', () => $('#se-file-drawer').toggleClass('open'));
    $('#se-file-drawer-close').on('click', () => $('#se-file-drawer').removeClass('open'));

    // Clicking the "Ingested Files" header title opens the assignment panel
    $(document).on('click', '.se-file-drawer-header', function (e) {
        if ($(e.target).closest('.se-close-circle').length) return; // let × close the drawer
        toggleFilesPanel();
    });

    // Click problematic file → open or swap ingest split panel
    $(document).on('click', '.se-file-item.problematic', function () {
        const fileName = $(this).data('file');
        if (!fileName || !state.fileRawContent.has(fileName)) return;
        swapIngestSplit(fileName, (_resolvedFile) => {
            renderIngestSummary();
            renderTable();
            updateTabBadges();
        });
    });

    // Ingest info tooltip — JS hover so it stays open over the panel and supports scroll
    (function () {
        let _hideTimer = null;
        function showIngestTooltip() {
            clearTimeout(_hideTimer);
            $('#se-ingest-tooltip').addClass('se-ingest-tooltip--visible');
        }
        function scheduleHideIngestTooltip() {
            _hideTimer = setTimeout(() => {
                $('#se-ingest-tooltip').removeClass('se-ingest-tooltip--visible');
            }, 2000);
        }
        $(document).on('mouseenter', '#se-ingest-info, #se-ingest-tooltip', showIngestTooltip);
        $(document).on('mouseleave', '#se-ingest-info, #se-ingest-tooltip', scheduleHideIngestTooltip);
    })();

    // Timeline analysis toolbar button
    $('#se-btn-timeline').on('click', () => {
        if (hasTimelineFiles()) {
            openTimelineEditor();
        }
    });

    // Remove file button — stop propagation so panel handlers don't fire
    $(document).on('click', '.se-file-remove', function (e) {
        e.stopPropagation();
        const fileName = $(this).closest('.se-file-item').data('file');
        if (!fileName) return;
        removeFile(fileName);
        closeIngestSplit();
        closeIngestPreview();
        detectGaps();
        persistState();
        renderIngestSummary();
        renderTable();
        renderSelectionBar();
        updateTabBadges();
    });

    // Click OK file → open read-only preview panel
    $(document).on('click', '.se-file-item:not(.problematic):not(.invalid):not(.supp-candidate):not(.supp-assigned)', function () {
        const fileName = $(this).data('file');
        if (!fileName) return;
        openIngestPreview(fileName);
    });

    // Click invalid file → open preview panel with rejection reason
    $(document).on('click', '.se-file-item.invalid', function () {
        const fileName = $(this).data('file');
        if (!fileName) return;
        const file = state.files.find(f => f.name === fileName);
        openIngestPreview(fileName, file?.rejectReason || 'Unrecognized file');
    });

    // Click supplementary candidate or assigned — show file content in right panel
    $(document).on('click', '.se-file-item.supp-candidate, .se-file-item.supp-assigned', function () {
        const fileName = $(this).data('file');
        if (!fileName) return;
        const file = state.files.find(f => f.name === fileName);
        openIngestPreview(fileName, file?.rejectReason || '');
    });
}

/**
 * Listen for character/chat changes in ST and wipe the editor state.
 * The Summary Editor is stateless between characters — switching characters
 * clears everything so users start fresh.
 */
function listenForCharacterSwap() {
    try {
        const context = SillyTavern.getContext();
        if (context?.eventSource && context?.event_types?.CHAT_CHANGED) {
            context.eventSource.on(context.event_types.CHAT_CHANGED, () => {
                resetEditorState();
                refreshBlockedState();
            });
        }
    } catch (err) {
        console.warn('[Summary Editor] Could not listen for character swap:', err);
    }
}

/**
 * Reset all editor state to a clean slate (no confirmation).
 */
function resetEditorState() {
    state.entries.clear();
    state.acts.clear();
    state.gaps = [];
    state.files = [];
    state.selected.clear();
    state.conflicts = {};
    state.nextActId = 1;
    state.actColorIdx = 0;
    state.sourceFileNames = [];
    state.lastAction = null;
    state.activeTab = 0;
    updateTabBadges();
    renderIngestSummary();
    renderTable();
    renderSelectionBar();
    updateFilterDropdown();
    updateBulkActDropdown();
    persistState();

    // Close the editor if it's open
    $('#se-modal-overlay').removeClass('active');
}

/**
 * Clear all state and UI (with confirmation). Undoable.
 */
async function handleClearAll() {
    if (state.entries.size === 0) return;
    if (!await seConfirm('Clear all entries, acts, and metadata?', { danger: true })) return;

    const snap = snapshotState();
    const entryCount = state.entries.size;

    state.entries.clear();
    state.acts.clear();
    state.gaps = [];
    state.files = [];
    state.selected.clear();
    state.conflicts = {};
    state.nextActId = 1;
    state.actColorIdx = 0;
    state.sourceFileNames = [];
    state.fileRawContent.clear();
    closeIngestSplit();

    pushUndo(`Cleared all (${entryCount} entries)`, () => {
        restoreSnapshot(snap);
        fullRefreshAfterUndo();
    });

    updateTabBadges();
    renderIngestSummary();
    renderTable();
    renderSelectionBar();
    updateFilterDropdown();
    updateBulkActDropdown();
    persistState();
}

/**
 * Review tab events: search, sort, filter, selection, pagination, conflicts.
 */
function bindReviewEvents() {
    $('#se-search').on('input', debounce(() => {
        state.searchQuery = $('#se-search').val().trim().toLowerCase();
        state.currentPage = 1;
        renderTable();
    }, 200));

    $('#se-sort').on('change', () => {
        state.sortBy = $('#se-sort').val();
        state.sortDir = 'asc';
        state.currentPage = 1;
        renderTable();
        updateSortIndicators();
    });

    $(document).on('click', '.se-sortable', function () {
        const sortKey = $(this).data('sort');
        if (state.sortBy === sortKey) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            state.sortBy = sortKey;
            state.sortDir = 'asc';
        }
        state.currentPage = 1;
        $('#se-sort').val(sortKey);
        renderTable();
        updateSortIndicators();
    });

    $('#se-filter').on('change', () => {
        state.filterAct = $('#se-filter').val();
        state.currentPage = 1;
        renderTable();
    });

    $('#se-show-full').on('change', function () {
        $('#se-table').toggleClass('se-show-full-content', this.checked);
    });

    $('#se-select-all').on('change', function () {
        // Select/deselect ALL entries across all pages
        if (this.checked) {
            for (const num of state.entries.keys()) state.selected.add(num);
        } else {
            state.selected.clear();
        }
        renderTable();
        renderSelectionBar();
        updateActButtonState();
    });

    document.addEventListener('se:selection-changed', () => {
        updateActButtonState();
        renderSelectionBar();
    });

    document.addEventListener('se:supplementary-changed', () => {
        updateFilterDropdown();
        renderIngestSummary();
        renderTable();
        refreshIngestPreviewIfOpen();
    });

    $('#se-btn-create-act').on('click', createActFromSelection);
    $('#se-btn-move-entry').on('click', showMoveDialog);
    $('#se-btn-swap-entries').on('click', showSwapDialog);
    $('#se-btn-new-entry').on('click', insertNewEntry);
    $('#se-btn-simple-merge').on('click', doSimpleMerge);
    $('#se-btn-split-entry').on('click', () => {
        const nums = [...state.selected];
        if (nums.length === 1) openSplitDialog(nums[0]);
    });
    $('#se-btn-bulk-fill').on('click', openBulkFill);
    $('#se-bulk-act-assign').on('change', () => { handleBulkActAssign(); updateBulkActSwatch(); });

    // ── Utils panel (draggable floating panel) ──────────────────
    let _utilsPanel = null;
    function openUtilsPanel() {
        if (_utilsPanel) { _utilsPanel.remove(); _utilsPanel = null; return; }
        const overlay = document.getElementById('se-modal-overlay');
        if (!overlay) return;
        _utilsPanel = document.createElement('div');
        _utilsPanel.id = 'se-utils-panel';
        _utilsPanel.className = 'se-utils-panel';
        _utilsPanel.innerHTML = _tplUtilsPanel;
        overlay.appendChild(_utilsPanel);
        const btn = document.getElementById('se-btn-utils');
        const rect = btn ? btn.getBoundingClientRect() : { left: 100, bottom: 80 };
        const overlayRect = overlay.getBoundingClientRect();
        _utilsPanel.style.left = Math.max(8, rect.left - overlayRect.left) + 'px';
        _utilsPanel.style.top  = Math.max(8, rect.bottom - overlayRect.top + 6) + 'px';
        makeDraggable(_utilsPanel, _utilsPanel.querySelector('.se-utils-header'));
        registerPanel(_utilsPanel);
        _utilsPanel.querySelector('.se-utils-close').addEventListener('click', () => {
            _utilsPanel?.remove(); _utilsPanel = null;
        });
        _utilsPanel.querySelector('#se-btn-find-replace').addEventListener('click', openFindReplace);
        _utilsPanel.querySelector('#se-btn-entity-panel').addEventListener('click', () => { _utilsPanel?.remove(); _utilsPanel = null; toggleEntitySidebar(); });
        _utilsPanel.querySelector('#se-btn-tag-browser').addEventListener('click', () => showTagBrowser(renderTable));
        _utilsPanel.querySelector('#se-btn-bulk-refine').addEventListener('click', () => { _utilsPanel?.remove(); _utilsPanel = null; openBulkRefine(); });
    }
    $('#se-btn-utils').on('click', openUtilsPanel);

    setEntityFilterCallback((term) => {
        state.searchQuery = term.toLowerCase();
        $('#se-search').val(term);
        renderTable();
    });
    $('#se-conflict-btn').on('click', runConflictCheck);
    $('#se-conflict-clear').on('click', () => {
        const snapConflicts = { ...state.conflicts };
        clearConflicts();
        pushUndo('Clear conflict highlights', () => {
            state.conflicts = snapConflicts;
            renderTable();
            $('#se-conflict-clear').show();
            updateUndoButton();
        });
    });
    $('#se-conflict-log-btn').on('click', showAnalysisLog);


    // Feedback chip click → open detail dialog
    $(document).on('click', '.se-fb-chip[data-feedback-num]', function () {
        const num = Number.parseInt($(this).data('feedback-num'), 10);
        showFeedbackDetail(num);
    });

    // Quick-fix button → open content editor directly
    $(document).on('click', '.se-quickfix-btn[data-quickfix-num]', function (e) {
        e.stopPropagation();
        const num = Number.parseInt($(this).data('quickfix-num'), 10);
        openContentEditor(num);
    });

    // Edit Prompt popup — any element with data-edit-prompt="key"
    $(document).on('click', '[data-edit-prompt]', function (e) {
        e.stopPropagation();
        openEditPromptPopup($(this).data('edit-prompt'));
    });

    // System Prompt hub
    $('#se-btn-manage-prompts').on('click', openSystemPromptHub);

    // Gap suggest button → AI-draft content for missing entry
    $(document).on('click', '.se-gap-suggest-btn', function (e) {
        e.stopPropagation();
        const num = Number.parseInt($(this).data('gap-num'), 10);
        if (!Number.isNaN(num)) openGapSuggest(num);
    });

    // Stats bar: click any act segment → open act color customization dialog
    $(document).on('click', '.se-stats-seg-act', () => {
        showActColorDialog();
    });

    // Close color picker on click outside
    $(document).on('click', (e) => {
        if (!isColorPickerOpen()) return;
        const $t = $(e.target);
        if ($t.closest('#se-iro-picker').length) return;
        if ($t.closest('.se-act-badge').length) return;
        closeColorPicker();
    });

    $('#se-dismiss-warnings').on('click', () => $('#se-warning-banner').hide());

    $('#se-page-first').on('click', () => {
        if (state.currentPage !== 1) { state.currentPage = 1; renderTable(); }
    });
    $('#se-page-prev').on('click', () => {
        if (state.currentPage > 1) { state.currentPage--; renderTable(); }
    });
    $('#se-page-next').on('click', () => {
        if (state.currentPage < getTotalPages()) { state.currentPage++; renderTable(); }
    });
}

/**
 * Handle bulk act assignment from the selection bar dropdown.
 */
function handleBulkActAssign() {
    const val = $(this).val();
    if (!val) return;

    if (val === 'new') {
        createActFromSelection();
    } else {
        reassignSelectedEntriesToAct(Number.parseInt(val, 10));
    }
    $(this).val('');
}

/**
 * Move all currently selected entries into the given act.
 *
 * @param {number} actId - Target act ID.
 */
async function reassignSelectedEntriesToAct(actId) {
    const nums = [...state.selected];
    if (nums.length === 0) return;
    const snap = snapshotState();

    // Warn if any selected entries are already assigned to an act
    const alreadyAssigned = nums.filter(n => {
        const e = state.entries.get(n);
        return e && e.actId && e.actId !== actId;
    });
    if (alreadyAssigned.length > 0) {
        const actNames = [...new Set(alreadyAssigned.map(n => {
            const e = state.entries.get(n);
            const a = state.acts.get(e.actId);
            return a ? a.name : `Act #${e.actId}`;
        }))];
        const ok = await seConfirm(
            `${alreadyAssigned.length} selected entr${alreadyAssigned.length === 1 ? 'y is' : 'ies are'} already assigned to: ${actNames.join(', ')}.\n\nReassign to the new act?`
        );
        if (!ok) return;
    }

    for (const num of nums) {
        const entry = state.entries.get(num);
        if (!entry) continue;
        removeEntryFromCurrentAct(entry);
        entry.actId = actId;
        const act = state.acts.get(actId);
        if (act) act.entryNums.add(num);
    }

    const actName = state.acts.get(actId)?.name ?? `Act #${actId}`;
    pushUndo(`Assign ${nums.length} entr${nums.length === 1 ? 'y' : 'ies'} to "${actName}"`, () => {
        restoreSnapshot(snap);
        fullRefreshAfterUndo();
    });
    state.selected.clear();
    renderSelectionBar();
    renderTable();
    renderStatsBar();
    updateTabBadges();
    persistState();
}

/**
 * Remove an entry from its current act (if any).
 *
 * @param {object} entry - The entry object.
 */
function removeEntryFromCurrentAct(entry) {
    if (!entry.actId) return;
    const oldAct = state.acts.get(entry.actId);
    if (oldAct) oldAct.entryNums.delete(entry.num);
}

/**
 * Insert a blank entry immediately after the selected entry.
 * All entries with a number > the selected row are shifted up by 1.
 * Requires exactly 1 entry selected.
 */
function insertNewEntry() {
    if (state.selected.size !== 1) return;
    const afterNum = [...state.selected][0];
    const snap = snapshotState();

    // Shift all entries above afterNum up by 1 (descending to avoid collisions)
    const toShift = [...state.entries.keys()].filter(n => n > afterNum).sort((a, b) => b - a);
    for (const n of toShift) {
        const entry = state.entries.get(n);
        const newNum = n + 1;
        entry.num = newNum;
        state.entries.delete(n);
        state.entries.set(newNum, entry);
        // Update act entryNums
        for (const act of state.acts.values()) {
            if (act.entryNums.has(n)) { act.entryNums.delete(n); act.entryNums.add(newNum); }
        }
        // Update causality keys and values
        shiftCausalityNum(n, newNum);
    }

    // Insert blank entry at afterNum + 1
    const newNum = afterNum + 1;
    const afterEntry = state.entries.get(afterNum);
    state.entries.set(newNum, {
        num: newNum,
        content: '',
        date: '',
        time: '',
        location: '',
        notes: '',
        actId: afterEntry?.actId || null,
        source: afterEntry?.source || '',
    });
    if (afterEntry?.actId) {
        state.acts.get(afterEntry.actId)?.entryNums.add(newNum);
    }

    // Re-sort entries map by key
    state.entries = new Map([...state.entries.entries()].sort(([a], [b]) => a - b));

    state.selected.clear();
    pushUndo(`New entry #${newNum} after #${afterNum}`, () => {
        restoreSnapshot(snap);
        fullRefreshAfterUndo();
    });
    persistState();
    renderTable();
    renderActPanel();
    updateTabBadges();
    renderSelectionBar();

    // Show floating content prompt for the new entry
    showNewEntryPrompt(newNum);
}

/**
 * Show a draggable floating panel prompting the user to fill in new entry content.
 * Submitting saves the content; dismissing leaves it blank.
 * @param {number} num - The new entry number.
 */
function showNewEntryPrompt(num) {
    $('#se-new-entry-prompt').remove();

    const $panel = $('<div id="se-new-entry-prompt" class="se-new-entry-prompt">')
        .html(fillTemplate(_tplNewEntryPrompt, { num }))
        .appendTo('#se-modal-overlay');

    const overlayEl2 = document.getElementById('se-modal-overlay');
    spawnPanel($panel[0], overlayEl2, '#se-nep-header', 360, 200);

    // Focus textarea
    setTimeout(() => $('#se-nep-content').focus(), 50);

    // Save handler
    function saveContent() {
        const content = $('#se-nep-content').val().trim();
        if (content) {
            const entry = state.entries.get(num);
            if (entry) {
                entry.content = content;
                persistState();
                renderTable();
                updateTabBadges();
            }
        }
        $panel.remove();
    }

    $('#se-nep-save').on('click', saveContent);
    $('#se-nep-skip, #se-nep-close').on('click', () => $panel.remove());
    $('#se-nep-content').on('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveContent();
        if (e.key === 'Escape') $panel.remove();
    });

}

/**
 * Shift a single entry number in the causality map (keys and values).
 * @param {number} oldNum
 * @param {number} newNum
 */
function shiftCausalityNum(oldNum, newNum) {
    if (state.causality[oldNum]) {
        state.causality[newNum] = state.causality[oldNum].map(c => (c >= newNum ? c + 1 : c));
        delete state.causality[oldNum];
    }
    for (const k of Object.keys(state.causality)) {
        state.causality[k] = state.causality[k].map(c => (c === oldNum ? newNum : c));
    }
}

/**
 * Causal Links panel events: show/hide range form, link, remove, clear.
 */
function bindCausalPanelEvents() {
    // Toolbar button — toggle floating popover
    // Stop propagation only when clicking the button itself, not the info icon
    $(document).on('click', '#se-causal-btn', (e) => {
        if ($(e.target).closest('#se-causal-info-icon').length) return;
        e.stopPropagation();
        toggleCausalPopover();
    });

    // Info icon hover — show/hide fixed tooltip
    $(document).on('mouseenter', '#se-causal-info-icon', function () {
        const $tt = $('#se-causal-info-tooltip');
        const rect = this.getBoundingClientRect();
        $tt.css({ top: rect.bottom + 8, left: rect.left }).show();
    });
    $(document).on('mouseleave', '#se-causal-info-icon', () => {
        $('#se-causal-info-tooltip').hide();
    });

    // Close button inside popover
    $(document).on('click', '.se-causal-pop-close', () => {
        $('#se-causal-popover').remove();
    });

    // Show range form
    $(document).on('click', '#se-causal-range-btn', () => {
        const $form = $('#se-causal-range-form');
        $form.removeData('edit-from edit-to');
        $('#se-causal-range-ok').text('Link');
        $form.show();
        $('#se-causal-range-from').focus();
    });

    // Edit an existing chain — pre-fill form
    $(document).on('click', '.se-causal-chain-edit', function (e) {
        e.stopPropagation();
        const from = Number.parseInt($(this).data('from'), 10);
        const to = Number.parseInt($(this).data('to'), 10);
        const $form = $('#se-causal-range-form');
        $form.data('edit-from', from).data('edit-to', to);
        $('#se-causal-range-from').val(from);
        $('#se-causal-range-to').val(to);
        $('#se-causal-range-ok').text('Update');
        $form.show();
        $('#se-causal-range-from').focus();
    });

    $(document).on('click', '#se-causal-range-cancel', () => {
        const $form = $('#se-causal-range-form');
        $form.hide().removeData('edit-from edit-to');
        $('#se-causal-range-from, #se-causal-range-to').val('').removeClass('se-input-error');
        $('#se-causal-range-ok').text('Link');
    });

    $(document).on('click', '#se-causal-range-ok', doLinkRange);
    $(document).on('keydown', '#se-causal-range-from, #se-causal-range-to', (e) => {
        if (e.key === 'Enter') doLinkRange();
    });

    // Remove range
    $(document).on('click', '.se-causal-chain-rm-range', function (e) {
        e.stopPropagation();
        const from = Number.parseInt($(this).data('from'), 10);
        const to = Number.parseInt($(this).data('to'), 10);
        const snapCausal = structuredClone(state.causality);
        removeRangeLinks(from, to);
        pushUndo(`Remove link chain #${from}→#${to}`, () => {
            state.causality = snapCausal;
            persistState();
            renderCausalPanel();
            updateUndoButton();
        });
        renderCausalPanel();
    });

    // Clear all
    $(document).on('click', '#se-causal-clear-all', async () => {
        if (!await seConfirm('Remove all causal links?', { danger: true })) return;
        const snapCausal = structuredClone(state.causality);
        clearAllLinks();
        pushUndo('Clear all causal links', () => {
            state.causality = snapCausal;
            persistState();
            renderCausalPanel();
            updateUndoButton();
        });
        renderCausalPanel();
    });

    // Merge linked range into one entry
    $(document).on('click', '.se-causal-chain-merge', function (e) {
        e.stopPropagation();
        const from = Number.parseInt($(this).data('from'), 10);
        const to = Number.parseInt($(this).data('to'), 10);
        doMergeRange(from, to);
    });
}

/**
 * Merge all selected entries into one combined entry.
 * Keeps the lowest entry number, assigns earliest act (or null).
 * Deleted entries are removed from state — no renumbering.
 */
async function doSimpleMerge() {
    const nums = [...state.selected].sort((a, b) => a - b);
    if (nums.length < 2) return;

    const confirmed = await seConfirm(
        `Merge ${nums.length} selected entries (#${nums[0]}–#${nums.at(-1)}) into entry #${nums[0]}?`
    );
    if (!confirmed) return;
    const snap = snapshotState();

    const entries = nums.map(n => state.entries.get(n)).filter(Boolean);
    const targetActId = resolveEarliestAct(entries);
    const mergedContent = entries.map(e => e.content).join('\n\n');

    // Build merged entry at lowest num
    const keeper = nums[0];
    const baseEntry = state.entries.get(keeper);
    state.entries.set(keeper, {
        num: keeper,
        content: mergedContent,
        date: entries.find(e => e.date)?.date ?? '',
        time: entries.find(e => e.time)?.time ?? '',
        location: entries.find(e => e.location)?.location ?? '',
        notes: '',
        actId: targetActId,
        source: baseEntry?.source ?? '',
    });

    // Remove all other selected entries
    for (const n of nums.slice(1)) {
        state.entries.delete(n);
        delete state.causality[n];
        for (const k of Object.keys(state.causality)) {
            state.causality[k] = state.causality[k].filter(c => c !== n);
            if (state.causality[k].length === 0) delete state.causality[k];
        }
        for (const act of state.acts.values()) act.entryNums.delete(n);
        state.modified.delete(n);
    }

    // Update act for keeper
    for (const act of state.acts.values()) act.entryNums.delete(keeper);
    if (targetActId) state.acts.get(targetActId)?.entryNums.add(keeper);

    state.selected.clear();
    pushUndo(`Merge entries #${nums[0]}–#${nums.at(-1)} into #${nums[0]}`, () => {
        restoreSnapshot(snap);
        fullRefreshAfterUndo();
    });
    detectGaps();
    persistState();
    renderTable();
    renderActPanel();
    buildMinimapOverlay();
    renderCausalPanel();
    updateTabBadges();
}

/**
 * Merge all entries in a linked range into a single entry.
 * Irreversible — prompts for confirmation first.
 * @param {number} from
 * @param {number} to
 */
async function doMergeRange(from, to) {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const toMerge = collectMergeEntries(lo, hi);
    if (toMerge.length < 2) return;

    const confirmed = await seConfirm(
        `Merge entries #${lo}–#${hi} (${toMerge.length} entries) into one?\n\n` +
        `⚠ This is irreversible — merged rows will be permanently removed.`,
        { danger: true }
    );
    if (!confirmed) return;

    const targetActId = resolveEarliestAct(toMerge);
    const mergedEntry = buildMergedEntry(lo, toMerge, targetActId);

    removeMergedFromState(lo, hi);
    const newEntries = renumberAbove(hi, hi - lo);

    if (targetActId) state.acts.get(targetActId)?.entryNums.add(lo);
    state.entries = new Map([[lo, mergedEntry], ...newEntries]);

    persistState();
    renderTable();
    renderActPanel();
    buildMinimapOverlay();
    renderCausalPanel();
    updateTabBadges();
}

function collectMergeEntries(lo, hi) {
    const result = [];
    for (let n = lo; n <= hi; n++) {
        const entry = state.entries.get(n);
        if (entry) result.push(entry);
    }
    return result;
}

function resolveEarliestAct(entries) {
    const actOrder = [...state.acts.keys()];
    let targetActId = null;
    let earliestIdx = Infinity;
    for (const entry of entries) {
        const idx = actOrder.indexOf(entry.actId);
        if (idx !== -1 && idx < earliestIdx) {
            earliestIdx = idx;
            targetActId = entry.actId;
        }
    }
    return targetActId;
}

function buildMergedEntry(num, entries, actId) {
    return {
        num,
        content: entries.map(e => e.content).join(' '),
        date: entries.find(e => e.date)?.date ?? '',
        time: entries.find(e => e.time)?.time ?? '',
        location: entries.find(e => e.location)?.location ?? '',
        notes: '',
        actId,
        source: entries[0].source,
    };
}

function removeMergedFromState(lo, hi) {
    for (let n = lo; n <= hi; n++) {
        state.entries.delete(n);
        delete state.causality[n];
        for (const k of Object.keys(state.causality)) {
            state.causality[k] = state.causality[k].filter(c => c !== n);
            if (state.causality[k].length === 0) delete state.causality[k];
        }
        for (const act of state.acts.values()) act.entryNums.delete(n);
    }
}

function renumberAbove(hi, shift) {
    const newEntries = new Map(
        [...state.entries.entries()].filter(([n]) => n > hi)
    );
    for (const [n, entry] of [...newEntries].sort(([a], [b]) => a - b)) {
        const newNum = n - shift;
        entry.num = newNum;
        newEntries.delete(n);
        newEntries.set(newNum, entry);
        updateActNumsOnRenumber(n, newNum);
        updateCausalityOnRenumber(n, newNum, hi, shift);
    }
    return newEntries;
}

function updateActNumsOnRenumber(oldNum, newNum) {
    for (const act of state.acts.values()) {
        if (act.entryNums.has(oldNum)) {
            act.entryNums.delete(oldNum);
            act.entryNums.add(newNum);
        }
    }
}

function updateCausalityOnRenumber(oldNum, newNum, hi, shift) {
    if (state.causality[oldNum]) {
        state.causality[newNum] = state.causality[oldNum].map(c => (c > hi ? c - shift : c));
        delete state.causality[oldNum];
    } else {
        for (const k of Object.keys(state.causality)) {
            state.causality[k] = state.causality[k].map(c => (c === oldNum ? newNum : c));
        }
    }
}

function doLinkRange() {
    const from = Number.parseInt($('#se-causal-range-from').val(), 10);
    const to = Number.parseInt($('#se-causal-range-to').val(), 10);
    const valid = !Number.isNaN(from) && !Number.isNaN(to) && from !== to
        && state.entries.has(from) && state.entries.has(to);

    if (!valid) {
        $('#se-causal-range-from, #se-causal-range-to').addClass('se-input-error');
        setTimeout(() => $('#se-causal-range-from, #se-causal-range-to').removeClass('se-input-error'), 700);
        return;
    }

    const snapCausal = structuredClone(state.causality);

    // If editing an existing range, remove the old chain first
    const $form = $('#se-causal-range-form');
    const editFrom = $form.data('edit-from');
    const editTo = $form.data('edit-to');
    if (editFrom !== undefined && editTo !== undefined) {
        removeRangeLinks(editFrom, editTo);
    }

    addRangeLinks(from, to);
    pushUndo(`Link chain #${from}→#${to}`, () => {
        state.causality = snapCausal;
        persistState();
        renderCausalPanel();
        updateUndoButton();
    });
    $form.hide().removeData('edit-from edit-to');
    $('#se-causal-range-from, #se-causal-range-to').val('');
    $('#se-causal-range-ok').text('Link');
    renderCausalPanel();
}

/**
 * Acts tab events: new act, minimap toggle.
 */
function bindActsEvents() {
    $('#se-btn-new-act').on('click', () => {
        showEntrySelector();
    });
    $('#se-btn-minimap').on('click', toggleMinimap);
    $('#se-btn-minimap-close').on('click', toggleMinimap);
    $('#se-btn-story-context').on('click', openStoryContextPanel);
    $('#se-btn-entry-analytics').on('click', openAnalyticsPanel);
    $('#se-btn-conflict-review').on('click', openConflictReview);

    // ── View toggle: Timeline ↔ Location Bubbles ───────────────
    let currentTlView = 'timeline';
    function switchTlView(view) {
        if (view === currentTlView) return;
        currentTlView = view;
        $('#se-tl-view-timeline, #se-tl-view-bubbles').removeClass('active');
        $(`#se-tl-view-${view}`).addClass('active');
        $('#se-timeline-label').text(view === 'bubbles' ? 'Locations' : 'Timeline');
        const $canvas = $('#se-timeline-canvas');
        if (view === 'bubbles') {
            buildLocationBubbles($canvas);
            setTimelineRenderer(() => buildLocationBubbles($('#se-timeline-canvas')));
        } else {
            buildTimelineDiagram();
            setTimelineRenderer(null);
        }
    }
    $(document).on('click', '#se-tl-view-timeline', () => switchTlView('timeline'));
    $(document).on('click', '#se-tl-view-bubbles',  () => switchTlView('bubbles'));

    // Timeline zoom controls
    let tlZoom = 1;
    function applyZoom() {
        $('#se-timeline-canvas').css('transform', `scale(${tlZoom})`);
    }
    $('#se-tl-zoom-in').on('click', () => { tlZoom = Math.min(tlZoom + 0.2, 4); applyZoom(); });
    $('#se-tl-zoom-out').on('click', () => { tlZoom = Math.max(tlZoom - 0.2, 0.3); applyZoom(); });
    $('#se-tl-reset').on('click', () => { tlZoom = 1; applyZoom(); });

    // Mouse wheel zoom on timeline viewport
    $(document).on('wheel', '#se-timeline-viewport', (e) => {
        e.preventDefault();
        const delta = e.originalEvent.deltaY > 0 ? -0.1 : 0.1;
        tlZoom = Math.min(Math.max(tlZoom + delta, 0.3), 4);
        applyZoom();
    });

    // Drag-to-pan on timeline viewport
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let scrollStartX = 0;
    let scrollStartY = 0;

    $(document).on('pointerdown', '#se-timeline-viewport', (e) => {
        // Only pan on left mouse button, ignore clicks on controls
        if (e.button !== 0 || $(e.target).closest('button, a, .se-timeline-toolbar').length) return;
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        const vp = e.currentTarget;
        scrollStartX = vp.scrollLeft;
        scrollStartY = vp.scrollTop;
        vp.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    $(document).on('pointermove', '#se-timeline-viewport', (e) => {
        if (!isPanning) return;
        const vp = e.currentTarget;
        vp.scrollLeft = scrollStartX - (e.clientX - panStartX);
        vp.scrollTop = scrollStartY - (e.clientY - panStartY);
    });

    $(document).on('pointerup pointercancel', '#se-timeline-viewport', () => {
        isPanning = false;
    });

    // Expand / collapse timeline to full viewport
    function toggleTimelineExpand() {
        const $bottom = $('#se-minimap-bottom');
        const isExpanded = $bottom.hasClass('se-tl-expanded');
        $bottom.toggleClass('se-tl-expanded');
        $('#se-tl-expand').toggle(isExpanded);   // hide expand btn when expanded
        $('#se-tl-exit').toggle(!isExpanded);     // show exit btn when expanded
    }
    $('#se-tl-expand').on('click', toggleTimelineExpand);
    $('#se-tl-exit').on('click', toggleTimelineExpand);
}

/**
 * Set the export destination dropdown to "Source Folder" (default) if a folder
 * path is already known, otherwise fall back to "Download".
 * Called each time the Export tab becomes active.
 */
function initExportDestination() {
    const $dest = $('#se-export-dest');
    const $wrap = $('#se-folder-path-wrap');
    if (state.lastIngestFolder) {
        $dest.val('source-folder');
        $('#se-folder-path').val(state.lastIngestFolder);
        $('#se-folder-path-hint').text('Re-export back to the source folder (editable)');
        $wrap.show();
    } else {
        $dest.val('download');
        $wrap.hide();
    }
}

/**
 * Export tab events: download, databank, clipboard, format, scope, RAG.
 */
function bindExportEvents() {
    $('#se-btn-do-export').on('click', () => handleExport(rewordForRAG));
    $('#se-btn-export-by-source').on('click', downloadBySource);
    $('#se-btn-export-zip').on('click', downloadAsZip);
    $('#se-btn-destructive-export').on('click', triggerDestructiveExport);
    $('#se-btn-databank-inject').on('click', handleDatabankInject);

    $('#se-btn-copy-clipboard').on('click', copyToClipboard);

    // Format button group — update hidden input and previews
    $(document).on('click', '.se-format-btn', function () {
        $('.se-format-btn').removeClass('active');
        $(this).addClass('active');
        const fmt = $(this).data('format');
        $('#se-export-format').val(fmt);
        updateLivePreview();
        renderFullPreview();
    });

    // Inject toolbar — each button toggles on/off independently
    $(document).on('click', '.se-preview-fmt-btn', function () {
        $(this).toggleClass('active');
        renderFullPreview();
    });

    // Destination dropdown — show/hide folder path input
    $(document).on('change', '#se-export-dest', function () {
        const dest = $(this).val();
        const $wrap = $('#se-folder-path-wrap');
        if (dest === 'new-folder') {
            $wrap.show();
            $('#se-folder-path-hint').text('Files will be saved to this folder via ST file API');
        } else if (dest === 'source-folder') {
            $wrap.show();
            $('#se-folder-path').val(state.lastIngestFolder);
            $('#se-folder-path-hint').text('Re-export back to the source folder (editable)');
        } else {
            $wrap.hide();
        }
    });

    // Persist folder path when user types it
    $(document).on('input', '#se-folder-path', function () {
        state.lastIngestFolder = $(this).val().trim();
        persistState();
    });

    $(document).on('change', '#se-export-rag', function () {
        $('#se-export-rag-confirm-wrap').toggle(this.checked);
        if (!this.checked) $('#se-export-rag-confirm').prop('checked', false);
    });

    $(document).on('click', '.se-scope-btn', function () {
        $('.se-scope-btn').removeClass('active');
        $(this).addClass('active');
        renderFullPreview();
    });

    // Act scope dropdown change → update preview
    $(document).on('change', '#se-scope-act-select', () => {
        renderFullPreview();
    });
}

/**
 * Global click handler to close floating popovers when clicking outside.
 */
function bindGlobalClickHandlers() {
    $(document).on('click', (e) => {
        if (!$(e.target).closest('.se-edit-popover, .se-cell-display').length) {
            closeEditPopover();
        }
        if (!$(e.target).closest('.se-color-picker-popover, [data-color-picker]').length) {
            $('.se-color-picker-popover').removeClass('open');
        }
        if (!$(e.target).closest('.se-cell-popover, .se-gap-popover, .se-minimap-cell').length) {
            closeAllPopovers();
        }
        if (!$(e.target).closest('#se-causal-popover, #se-causal-btn, #se-utils-panel').length) {
            $('#se-causal-popover').remove();
        }
    });
}

// ─────────────────────────────────────────────
//  Ingest Summary
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  Find & Replace
// ─────────────────────────────────────────────

function openFindReplace() {
    if (document.getElementById('se-find-replace')) {
        document.getElementById('se-find-replace').remove();
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'se-find-replace';
    panel.className = 'se-find-replace';
    panel.innerHTML = _tplFindReplace;

    const overlayEl = document.getElementById('se-modal-overlay');
    overlayEl.appendChild(panel);

    spawnPanel(panel, overlayEl, '.se-fr-header', 320, 180);

    const searchInput = panel.querySelector('#se-fr-search');
    const replaceInput = panel.querySelector('#se-fr-replace');
    const caseCheck = panel.querySelector('#se-fr-case');
    const countEl = panel.querySelector('#se-fr-count');

    function countMatches() {
        const query = searchInput.value;
        if (!query) { countEl.textContent = ''; return; }
        const caseSensitive = caseCheck.checked;
        let total = 0;
        for (const [, entry] of state.entries) {
            if (caseSensitive) {
                total += entry.content.split(query).length - 1;
            } else {
                total += entry.content.toLowerCase().split(query.toLowerCase()).length - 1;
            }
        }
        countEl.textContent = `${total} match${total === 1 ? '' : 'es'}`;
    }

    searchInput.addEventListener('input', countMatches);
    caseCheck.addEventListener('change', countMatches);

    panel.querySelector('#se-fr-replace-all').addEventListener('click', () => {
        const query = searchInput.value;
        if (!query) return;
        const replacement = replaceInput.value;
        const caseSensitive = caseCheck.checked;

        snapshotState();
        let totalReplaced = 0;
        for (const [num, entry] of state.entries) {
            let updated;
            if (caseSensitive) {
                updated = entry.content.replaceAll(query, replacement);
            } else {
                updated = entry.content.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replacement);
            }
            if (updated !== entry.content) {
                entry.content = updated;
                state.modified.add(num);
                totalReplaced++;
            }
        }
        if (totalReplaced > 0) {
            persistState();
            renderTable();
            pushUndo('Find & Replace', restoreSnapshot);
        }
        countEl.textContent = `Replaced in ${totalReplaced} entr${totalReplaced === 1 ? 'y' : 'ies'}`;
    });

    panel.querySelector('.se-fr-close').addEventListener('click', () => panel.remove());
    searchInput.focus();
}

// ─────────────────────────────────────────────
//  Bulk Metadata Fill
// ─────────────────────────────────────────────

function openBulkFill() {
    if (document.getElementById('se-bulk-fill')) {
        document.getElementById('se-bulk-fill').remove();
        return;
    }
    if (state.selected.size === 0) return;

    const panel = document.createElement('div');
    panel.id = 'se-bulk-fill';
    panel.className = 'se-find-replace'; // reuse same card style
    panel.innerHTML = fillTemplate(_tplBulkFill, { count: state.selected.size });

    const bfOverlay = document.getElementById('se-modal-overlay');
    bfOverlay.appendChild(panel);
    spawnPanel(panel, bfOverlay, '.se-fr-header', 310, 200);

    panel.querySelector('.se-fr-close').addEventListener('click', () => panel.remove());
    panel.querySelector('#se-bf-apply').addEventListener('click', () => {
        const date = panel.querySelector('#se-bf-date').value.trim();
        const time = panel.querySelector('#se-bf-time').value.trim();
        const location = panel.querySelector('#se-bf-location').value.trim();
        if (!date && !time && !location) return;

        snapshotState();
        for (const num of state.selected) {
            const entry = state.entries.get(num);
            if (!entry) continue;
            if (date) entry.date = date;
            if (time) entry.time = time;
            if (location) entry.location = location;
        }
        persistState();
        renderTable();
        pushUndo('Bulk Fill', restoreSnapshot);
        panel.remove();
    });

    panel.querySelector('#se-bf-date').focus();
}

// ─────────────────────────────────────────────
//  Smart Gap Suggest
// ─────────────────────────────────────────────

/**
 * Open a floating panel that calls the LLM to suggest content for a missing
 * gap entry, using ±5 surrounding entries as context.
 *
 * @param {number} num - The gap entry number to suggest content for.
 */
async function openGapSuggest(num) {
    const panelId = 'se-gap-suggest-panel';
    document.getElementById(panelId)?.remove();

    // Build context from ±5 surrounding entries
    const sorted = [...state.entries.values()].sort((a, b) => a.num - b.num);
    const nearby = sorted.filter(e => Math.abs(e.num - num) <= 5);

    if (nearby.length === 0) {
        await seAlert('No surrounding entries found — add some entries first.');
        return;
    }

    const contextText = nearby.map(e => `#${e.num}: ${e.content}`).join('\n');
    const prompt = getPrompt('gap-suggest')
        .replace('{{context}}', contextText)
        .replace('{{num}}', String(num));

    const panel = document.createElement('div');
    panel.id = panelId;
    panel.className = 'se-find-replace';
    panel.style.width = '320px';
    panel.innerHTML = fillTemplate(_tplGapSuggest, { panelId, num });

    const gapOverlay = document.getElementById('se-modal-overlay');
    gapOverlay.appendChild(panel);
    spawnPanel(panel, gapOverlay, `#${panelId}-hdr`, 320, 200);
    document.getElementById(`${panelId}-close`).addEventListener('click', () => panel.remove());

    try {
        const context = SillyTavern.getContext();
        const result = await context.generateQuietPrompt?.({ quietPrompt: prompt });
        const suggestion = (result || '').trim();

        document.getElementById(`${panelId}-loading`).style.display = 'none';
        const $text = document.getElementById(`${panelId}-text`);
        $text.value = suggestion || '(No response from model)';
        $text.style.display = '';
        document.getElementById(`${panelId}-actions`).style.display = '';

        document.getElementById(`${panelId}-use`).addEventListener('click', () => {
            const content = $text.value.trim();
            if (!content) return;
            const snapshot = snapshotState();
            state.entries.set(num, {
                num, content, date: '', time: '', location: '',
                notes: '', actId: null, source: 'manual',
            });
            state.gaps = state.gaps.filter(g => g !== num);
            detectGaps();
            persistState();
            renderTable();
            renderSelectionBar();
            updateTabBadges();
            pushUndo(`Add suggested entry #${num}`, () => {
                restoreSnapshot(snapshot);
                detectGaps();
                renderTable();
                renderSelectionBar();
                updateTabBadges();
                persistState();
            });
            panel.remove();
        });
    } catch (err) {
        const $load = document.getElementById(`${panelId}-loading`);
        if ($load) $load.textContent = 'Error: ' + (err?.message || 'Request failed');
    }
}

/**
 * Highlight the active sort column header with direction arrow.
 */
function updateSortIndicators() {
    $('.se-sortable').removeClass('se-sort-active se-sort-asc se-sort-desc');
    const $active = $(`.se-sortable[data-sort="${state.sortBy}"]`);
    $active.addClass('se-sort-active');
    $active.addClass(state.sortDir === 'asc' ? 'se-sort-asc' : 'se-sort-desc');
}

/**
 * Render the file list (in drawer) and summary bar on the Ingest tab.
 */
function renderIngestSummary() {
    const $list = $('#se-file-list');
    const $text = $('#se-ingest-summary .se-ingest-summary-text');
    const $filesBtn = $('#se-btn-show-files');
    $list.empty();

    for (const file of state.files) {
        let cls  = '';
        let icon = '&#10003;';
        if (file.problematic) {
            cls  = ' problematic';
            icon = '&#63;'; // ?
        } else if (file.isSupplementaryCandidate) {
            const isAssigned = state.supplementaryFiles.has(file.name) && !!state.supplementaryFiles.get(file.name)?.category;
            cls  = isAssigned ? ' supp-assigned' : ' supp-candidate';
            icon = isAssigned ? '&#10003;' : '&#9432;';
        } else if (!file.valid) {
            cls  = ' invalid';
            icon = '&#9432;'; // ℹ info circle
        }
        const $row = $(fillTemplate(_tplFileItem, {
            cls,
            icon,
            nameAttr: escAttr(file.name),
            name:     escHtml(file.name),
            count:    file.entryCount,
        }));
        $list.append($row);
    }

    // Enable/disable timeline button based on marked files
    $('#se-btn-timeline').prop('disabled', !hasTimelineFiles());

    // Keep files assignment panel in sync
    refreshFilesPanel();

    // File count pill in drawer header
    const totalFiles = state.files.length;
    const $count = $('#se-file-drawer-count');
    if (totalFiles > 0) {
        $count.text(totalFiles).show();
    } else {
        $count.text('').hide();
    }

    if (state.entries.size > 0) {
        const validFiles = state.files.filter(f => f.valid).length;
        const dupCount = state.files.reduce((sum, f) => sum + (f.duplicates || 0), 0);
        let html = `<strong>${state.entries.size} entries</strong> from ${validFiles} file${validFiles === 1 ? '' : 's'}`;
        if (dupCount > 0) html += ` &middot; <span class="se-warn">${dupCount} dupes</span>`;
        if (state.gaps.length > 0) html += ` &middot; <span class="se-warn">${state.gaps.length} gaps</span>`;
        $text.html(html);
        $filesBtn.show();
    } else {
        $text.html('');
        $filesBtn.hide();
        $('#se-file-drawer').removeClass('open');
    }
}
