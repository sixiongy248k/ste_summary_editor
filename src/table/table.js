/**
 * @module table
 * @description Renders and manages the main timeline table (Review tab).
 *
 * ## Responsibilities
 * - Filtering entries by search query, act assignment, and gaps
 * - Sorting entries by number or act grouping
 * - Paginating the result set
 * - Rendering entry rows using HTML templates
 * - Click-to-edit floating popover for date/time/location/notes
 * - Stats bar (proportional act segments)
 * - Selection bar with count display
 * - Warning banner for detected gaps
 * - Conflict highlight support in content text
 */

import { ROWS_PER_PAGE, TEMPLATES, MONTH_NAMES } from '../core/constants.js';
import { state, persistState } from '../core/state.js';
import { escHtml, escAttr, spawnPanel } from '../core/utils.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';
import { attachAutocomplete } from './tags.js';
import { moveEntries } from './reorder.js';

/** @type {string|null} Cached entry row template HTML. */
let entryRowTemplate = null;

/** @type {string|null} Cached gap row template HTML. */
let gapRowTemplate = null;

/** @type {string|null} Cached date picker template HTML. */
let datepickerTmpl = null;

/** @type {string|null} Cached time picker template HTML. */
let timepickerTmpl = null;

/** @type {HTMLElement|null} Currently active edit popover element. */
let activeEditPopover = null;

/** @type {number|null} Last checked entry number (for shift+click range). */
let lastCheckedNum = null;

/** @type {Set<string>} Act IDs that are collapsed in act-sorted view. */
const collapsedActs = new Set();

/** @type {Function|null} Called with entry num when content cell is clicked. */
let contentCellClickHandler = null;

/**
 * Register a handler to call when a content cell is clicked.
 * Called before renderTable re-renders, so the handler receives a valid num.
 * @param {Function} fn - Receives the entry number (number).
 */
export function setContentCellClickHandler(fn) {
    contentCellClickHandler = fn;
}

/**
 * Initialize the table module by loading required templates.
 * Must be called once before any rendering.
 */
export async function initTable() {
    [entryRowTemplate, gapRowTemplate, datepickerTmpl, timepickerTmpl] = await Promise.all([
        loadTemplate('entry-row'),
        loadTemplate('gap-row'),
        loadTemplate(TEMPLATES.DATEPICKER),
        loadTemplate(TEMPLATES.TIMEPICKER),
    ]);

}

/**
 * Get the full list of entries (including gaps) after applying
 * the current search query, act filter, and sort order.
 *
 * @returns {Array<object>} Filtered/sorted entries, each with an `isGap` boolean.
 */
export function getFilteredEntries() {
    const allNums = new Set([...state.entries.keys(), ...state.gaps]);
    let entries = [...allNums].sort((a, b) => a - b).map(num => {
        if (state.entries.has(num)) {
            return { ...state.entries.get(num), isGap: false };
        }
        return { num, content: '', isGap: true };
    });

    // Apply search filter across all columns
    if (state.searchQuery) {
        const q = state.searchQuery;
        if (q === 'checked') {
            entries = entries.filter(e => e.isGap || state.selected.has(e.num));
        } else if (q === 'unchecked') {
            entries = entries.filter(e => e.isGap || !state.selected.has(e.num));
        } else {
            entries = entries.filter(e => {
                if (e.isGap) return false;
                // Match against num, content, act name, date, time, location
                if (String(e.num).includes(q)) return true;
                if (e.content.toLowerCase().includes(q)) return true;
                if (e.date && e.date.toLowerCase().includes(q)) return true;
                if (e.time && e.time.toLowerCase().includes(q)) return true;
                if (e.location && e.location.toLowerCase().includes(q)) return true;
                if (e.actId) {
                    const actName = state.acts.get(e.actId)?.name || '';
                    if (actName.toLowerCase().includes(q)) return true;
                }
                return false;
            });
        }
    }

    // Apply filter dropdown
    if (state.filterAct === 'unassigned') {
        entries = entries.filter(e => e.isGap || !e.actId);
    } else if (state.filterAct === 'gaps') {
        entries = entries.filter(e => e.isGap);
    } else if (state.filterAct === 'checked') {
        entries = entries.filter(e => !e.isGap && state.selected.has(e.num));
    } else if (state.filterAct === 'unchecked') {
        entries = entries.filter(e => !e.isGap && !state.selected.has(e.num));
    } else if (typeof state.filterAct === 'string' && state.filterAct.startsWith('supp:')) {
        // Supplementary filter: hide all main entries — supp rows render separately below
        entries = [];
    } else if (state.filterAct === 'summary:all') {
        // Summary-only filter: show all regular entries, hide supp rows (no-op here — supp skipped below)
    } else if (state.filterAct !== 'all') {
        const actId = Number.parseInt(state.filterAct, 10);
        entries = entries.filter(e => e.isGap || e.actId === actId);
    }

    // Apply sort with direction
    const dir = state.sortDir === 'desc' ? -1 : 1;

    if (state.sortBy === 'num') {
        entries.sort((a, b) => (a.num - b.num) * dir);
    } else if (state.sortBy === 'act') {
        entries.sort((a, b) => {
            const aAct = a.actId ? (state.acts.get(a.actId)?.name || '') : '';
            const bAct = b.actId ? (state.acts.get(b.actId)?.name || '') : '';
            if (aAct === bAct) return (a.num - b.num) * dir;
            if (!aAct) return 1;
            if (!bAct) return -1;
            return aAct.localeCompare(bAct) * dir;
        });
    } else if (['content', 'date', 'time', 'location', 'notes'].includes(state.sortBy)) {
        const field = state.sortBy;
        entries.sort((a, b) => {
            const aVal = (a[field] || '').toLowerCase();
            const bVal = (b[field] || '').toLowerCase();
            if (aVal === bVal) return (a.num - b.num) * dir;
            if (!aVal) return 1;
            if (!bVal) return -1;
            return aVal.localeCompare(bVal) * dir;
        });
    }

    // Push problematic entries to the bottom (after all normal + gap rows)
    entries.sort((a, b) => (a.problematic ? 1 : 0) - (b.problematic ? 1 : 0));

    return entries;
}

/**
 * Calculate total number of pages based on current filters.
 *
 * @returns {number} Total pages (minimum 1).
 */
export function getTotalPages() {
    return Math.max(1, Math.ceil(getFilteredEntries().length / ROWS_PER_PAGE));
}

/**
 * Render the timeline table with current state.
 * Rebuilds the entire table body — called after any state change.
 */
export function renderTable() {
    const entries = getFilteredEntries();
    const totalPages = Math.max(1, Math.ceil(entries.length / ROWS_PER_PAGE));

    if (state.currentPage > totalPages) state.currentPage = totalPages;

    const start = (state.currentPage - 1) * ROWS_PER_PAGE;
    const pageEntries = entries.slice(start, start + ROWS_PER_PAGE);

    const $wrap = $('#se-table-wrap');
    const scrollTop = $wrap.scrollTop();

    const $body = $('#se-table-body');
    $body.empty();

    // Toggle feedback column header
    const hasFeedback = Object.keys(state.conflicts).length > 0;
    $('#se-th-feedback').toggle(hasFeedback);
    const colSpan = hasFeedback ? 9 : 8;

    // Show empty state or table — keep table visible if supplementary files are assigned
    const hasSupp = [...state.supplementaryFiles.values()].some(f => !!f.category);
    if (entries.length === 0 && state.entries.size === 0 && !hasSupp) {
        $('#se-empty-state').show();
        $('#se-table').hide();
        $('#se-pagination').hide();
    } else {
        $('#se-empty-state').hide();
        $('#se-table').show();
        $('#se-pagination').show();

        if (entries.length === 0) {
            $body.append(
                `<tr><td colspan="${colSpan}" style="text-align:center;color:#75715e;padding:30px;">` +
                'No entries match the current filter.</td></tr>'
            );
        }
    }

    let lastActId = null;
    for (const entry of pageEntries) {
        // Insert act group header when sorted by act
        if (state.sortBy === 'act' && !entry.isGap) {
            const actId = entry.actId || '__unassigned__';
            if (actId !== lastActId) {
                lastActId = actId;
                const act = actId !== '__unassigned__' ? state.acts.get(actId) : null;
                const name = act ? escHtml(act.name) : 'Unassigned';
                const bg = act ? act.color.bg : '#555';
                const fg = act ? act.color.fg : '#ccc';
                const isCollapsed = collapsedActs.has(actId);
                const chevron = isCollapsed ? '&#9654;' : '&#9660;';
                $body.append(
                    `<tr class="se-act-group-header" data-act-group="${escAttr(actId)}">` +
                    `<td colspan="${colSpan}" style="cursor:pointer;">` +
                    `<span class="se-act-group-chevron">${chevron}</span>` +
                    `<span class="se-act-badge" style="background:${bg};color:${fg};font-size:0.82em;">${name}</span>` +
                    '</td></tr>',
                );
            }
            if (collapsedActs.has(entry.actId || '__unassigned__')) continue;
        }

        if (entry.isGap) {
            $body.append(buildGapRow(entry.num));
        } else {
            $body.append(buildEntryRow(entry));
        }
    }

    bindCheckboxEvents($body);
    bindRowClickEvents($body);
    bindEditableCells($body);
    bindDragReorder($body);

    // Supplementary rows on last page only; Summary Files subheader on first page only
    const isLastPage  = state.currentPage >= totalPages;
    const isFirstPage = state.currentPage <= 1;
    _renderSupplementaryRows($body, colSpan, isLastPage, isFirstPage && hasSupp && entries.length > 0);

    updatePaginationControls(totalPages);
    updateEntryCount();
    syncSelectAllCheckbox($body);
    updateUndoButton();

    $wrap.scrollTop(scrollTop);
}

/**
 * Render supplementary file rows at the bottom of the table.
 * These appear when filterAct is 'all' or matches a supp:* category.
 * Rows use the same column structure as regular entry rows.
 * @param {jQuery} $body
 * @param {number} colSpan
 */
function _renderSupplementaryRows($body, colSpan, isLastPage = true, showSummaryHeader = false) {
    const filterVal = state.filterAct;
    const isAll  = filterVal === 'all';
    const isSuppFilter = typeof filterVal === 'string' && filterVal.startsWith('supp:');
    // summary:all shows only entry rows — no supp section (but still allow summary header)
    const isSummaryFilter = filterVal === 'summary:all';

    if (!isAll && !isSuppFilter && !isSummaryFilter) return;

    // Summary-only filter: prepend header on first page if applicable, then skip supp rows
    if (isSummaryFilter) {
        if (showSummaryHeader) {
            $body.prepend(
                `<tr class="se-supp-separator se-summary-header"><td colspan="${colSpan}">` +
                `<span class="se-supp-separator-label">&#128221; Summary Files</span></td></tr>`
            );
        }
        return;
    }

    const filterCat = isSuppFilter ? filterVal.slice(5) : null;

    const suppList = [...state.supplementaryFiles.values()].filter(f => {
        if (!f.category) return false;
        if (filterCat && filterCat !== 'all') return f.category === filterCat;
        return true;
    });

    if (suppList.length === 0) return;

    // "Summary Files" subheader: prepend to page 1 entry rows (independent of last-page check)
    if (showSummaryHeader) {
        $body.prepend(
            `<tr class="se-supp-separator se-summary-header"><td colspan="${colSpan}">` +
            `<span class="se-supp-separator-label">&#128221; Summary Files</span></td></tr>`
        );
    }

    // Supplementary rows only on the last page (supp-only filter bypasses pagination)
    if (!isSuppFilter && !isLastPage) return;

    // When filtered to supp-only, clear the "no entries match" placeholder
    if (isSuppFilter) $body.find('tr').remove();

    $body.append(
        `<tr class="se-supp-separator"><td colspan="${colSpan}">` +
        `<span class="se-supp-separator-label">&#128196; Supplementary Files</span></td></tr>`
    );

    const hasFeedback = colSpan === 9;
    for (const supp of suppList) {
        $body.append(_buildSuppRow(supp, hasFeedback));
    }

    $body.find('.se-supp-content-cell').on('click', function (e) {
        e.stopPropagation();
        openSuppEditor($(this).data('suppFile'));
    });

    _bindSuppEditableCells($body);
}

/** Build a single supplementary file row using the same column layout as entry rows. */
function _buildSuppRow(supp, hasFeedback) {
    const content  = supp.editedContent || supp.content || '';
    const preview  = content.slice(0, 200);
    const trimmed  = content.length > 200;
    const catLabel = _suppCategoryLabel(supp.category);
    const isEdited = supp.editedContent && supp.editedContent !== supp.content;
    const modCls   = isEdited ? ' se-content-modified' : '';

    const date     = supp.date     || '';
    const time     = supp.time     || '';
    const location = supp.location || '';
    const notes    = supp.notes    || '';

    return `
    <tr class="se-supp-row" data-supp-file="${escAttr(supp.name)}">
        <td class="se-col-check"><input type="checkbox" disabled /></td>
        <td class="se-col-num se-supp-num" title="${escAttr(supp.name)}">&#128196;</td>
        <td class="se-col-act">
            <span class="se-supp-cat-badge">${escHtml(catLabel)}</span>
        </td>
        <td class="se-col-content se-supp-content-cell${modCls}" data-supp-file="${escAttr(supp.name)}" title="Click to edit">
            <span class="se-content-text">${escHtml(preview)}${trimmed ? '…' : ''}</span>
        </td>
        <td class="se-editable-cell se-supp-editable" data-supp-file="${escAttr(supp.name)}" data-field="date">
            <span class="se-cell-display ${date ? '' : 'se-cell-empty'}">${escHtml(date) || 'Date'}</span>
        </td>
        <td class="se-editable-cell se-supp-editable" data-supp-file="${escAttr(supp.name)}" data-field="time">
            <span class="se-cell-display ${time ? '' : 'se-cell-empty'}">${escHtml(time) || 'Time'}</span>
        </td>
        <td class="se-editable-cell se-supp-editable" data-supp-file="${escAttr(supp.name)}" data-field="location">
            <span class="se-cell-display ${location ? '' : 'se-cell-empty'}">${escHtml(location) || 'Location'}</span>
        </td>
        <td class="se-editable-cell se-supp-editable" data-supp-file="${escAttr(supp.name)}" data-field="notes">
            <span class="se-cell-display ${notes ? '' : 'se-cell-empty'}" title="Author notes only">${escHtml(notes) || 'Notes'}</span>
        </td>
        ${hasFeedback ? '<td></td>' : ''}
    </tr>`;
}

/**
 * Bind editable cell popovers for supplementary file rows.
 * Reads/writes date, time, location, notes on the supp record.
 */
function _bindSuppEditableCells($body) {
    $body.find('.se-supp-editable .se-cell-display').on('click', function (e) {
        e.stopPropagation();
        closeEditPopover();

        const $td      = $(this).closest('.se-supp-editable');
        const fileName = $td.data('suppFile');
        const field    = $td.data('field');
        const supp     = state.supplementaryFiles.get(fileName);
        if (!supp) return;

        const currentValue = supp[field] || '';
        const label  = field.charAt(0).toUpperCase() + field.slice(1);
        const isDate = field === 'date';
        const isTime = field === 'time';
        const isNotes = field === 'notes';

        let fieldInput;
        if (isDate)       fieldInput = buildDatePickerHtml(currentValue);
        else if (isTime)  fieldInput = buildTimePickerHtml(currentValue);
        else if (isNotes) fieldInput = `<textarea placeholder="${label}" rows="4">${escHtml(currentValue)}</textarea>`;
        else              fieldInput = `<input type="text" value="${escAttr(currentValue)}" placeholder="${label}" />`;

        const showOk = !isDate;
        const pop = document.createElement('div');
        pop.className = 'se-edit-popover' + (isDate ? ' se-edit-popover-wide' : '') + (isNotes ? ' se-edit-popover-notes' : '');
        pop.innerHTML =
            `<div class="se-edit-popover-label">${label} <span style="color:#75715e;font-size:0.85em;">(no export effect)</span></div>` +
            fieldInput +
            '<div class="se-edit-popover-actions">' +
            (isDate ? '<button class="se-btn se-btn-sm se-ep-clear">Clear</button><span style="flex:1;"></span>' : '') +
            '<button class="se-btn se-btn-sm se-ep-cancel">Cancel</button>' +
            (showOk ? '<button class="se-btn se-btn-primary se-btn-sm se-ep-ok">OK</button>' : '') +
            '</div>';

        const rect = $td[0].getBoundingClientRect();
        const popWidth = isDate ? 260 : 240;
        let left = rect.left;
        let top  = rect.bottom + 6;
        if (left + popWidth > window.innerWidth) left = window.innerWidth - popWidth - 10;
        if (left < 4) left = 4;
        pop.style.left = left + 'px';
        pop.style.top  = top + 'px';
        document.body.appendChild(pop);
        activeEditPopover = pop;

        const $display = $(this);
        const doSave = (overrideVal) => {
            let newVal;
            if (typeof overrideVal === 'string') newVal = overrideVal;
            else if (isTime) newVal = readTimePicker(pop);
            else {
                const input = pop.querySelector('input, textarea');
                newVal = input ? input.value.trim() : '';
            }
            supp[field] = newVal;
            $display.text(newVal || label);
            $display.toggleClass('se-cell-empty', !newVal);
            closeEditPopover();
            persistState();
        };

        if (isDate) {
            bindDatePickerEvents(pop, doSave);
            $(pop).find('.se-ep-clear').on('click', () => doSave(''));
        } else if (isTime) {
            bindTimePickerEvents(pop);
        } else {
            const input = pop.querySelector('input, textarea');
            input.focus();
            if (input.select) input.select();
        }
        $(pop).find('.se-ep-ok').on('click', () => doSave());
        $(pop).find('.se-ep-cancel').on('click', () => closeEditPopover());
        if (!isDate) {
            $(pop).on('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); doSave(); }
                if (ev.key === 'Escape') { ev.preventDefault(); closeEditPopover(); }
            });
        }
    });
}

/** Human-readable labels for supplementary categories. */
const SUPP_CATEGORY_LABELS = {
    'character-notes': 'Character Notes',
    'personalities':   'Personalities',
    'world-details':   'World Details',
    'timeline-notes':  'Timeline Notes',
    'others':          'Others',
};

function _suppCategoryLabel(cat) {
    return SUPP_CATEGORY_LABELS[cat] ?? cat;
}

/**
 * Open a draggable editor dialog for a supplementary file's content.
 * @param {string} fileName
 */
export function openSuppEditor(fileName) {
    const supp = state.supplementaryFiles.get(fileName);
    if (!supp) return;

    document.getElementById('se-supp-editor')?.remove();

    const overlay = document.getElementById('se-modal-overlay');
    if (!overlay) return;

    const content = supp.editedContent || supp.content;
    const panel = document.createElement('div');
    panel.id = 'se-supp-editor';
    panel.className = 'se-supp-editor';
    panel.innerHTML = `
        <div class="se-se-header">
            <span class="se-se-title">&#128196; ${escHtml(fileName)}</span>
            <button class="se-close-circle se-se-close">&times;</button>
        </div>
        <div class="se-se-body">
            <textarea class="se-se-textarea" id="se-se-content" spellcheck="true">${escHtml(content)}</textarea>
        </div>
        <div class="se-se-footer">
            <button class="se-btn se-btn-sm se-se-revert" id="se-se-revert">Revert to Original</button>
            <button class="se-btn se-btn-primary se-se-save" id="se-se-save">Save</button>
        </div>`;

    overlay.appendChild(panel);
    spawnPanel(panel, overlay, '.se-se-header', 560, 480);

    panel.querySelector('.se-se-close').addEventListener('click', () => panel.remove());
    panel.querySelector('#se-se-save').addEventListener('click', () => {
        supp.editedContent = panel.querySelector('#se-se-content').value;
        persistState();
        renderTable();
        panel.remove();
    });
    panel.querySelector('#se-se-revert').addEventListener('click', () => {
        panel.querySelector('#se-se-content').value = supp.content;
    });
    panel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') panel.remove();
    });
}

/**
 * Render the stats bar showing proportional act segments.
 */
export function renderStatsBar() {
    const $bar = $('#se-stats-bar');
    $bar.empty();

    if (state.entries.size === 0) {
        $bar.hide();
        return;
    }
    $bar.show();

    const total = state.entries.size + state.gaps.length;
    const actCounts = {};
    let unassigned = 0;

    for (const entry of state.entries.values()) {
        if (entry.actId) {
            const act = state.acts.get(entry.actId);
            if (act) {
                const key = act.id;
                if (!actCounts[key]) actCounts[key] = { count: 0, name: act.name, color: act.color.bg };
                actCounts[key].count++;
            } else {
                unassigned++;
            }
        } else {
            unassigned++;
        }
    }

    // Render act segments (clickable to change color)
    for (const [actId, { count, name, color }] of Object.entries(actCounts)) {
        const pct = (count / total * 100).toFixed(1);
        $bar.append(
            `<div class="se-stats-seg se-stats-seg-act" data-act-id="${actId}" style="background:${color};width:${pct}%;cursor:pointer;" title="Click to change color">` +
            `<span class="se-seg-tip">${escHtml(name)} — ${count} entries</span></div>`
        );
    }

    // Unassigned segment
    if (unassigned > 0) {
        const pct = (unassigned / total * 100).toFixed(1);
        $bar.append(
            `<div class="se-stats-seg" style="background:#555;width:${pct}%;">` +
            `<span class="se-seg-tip">Unassigned — ${unassigned} entries</span></div>`
        );
    }

    // Gaps segment
    if (state.gaps.length > 0) {
        const pct = (state.gaps.length / total * 100).toFixed(1);
        $bar.append(
            `<div class="se-stats-seg" style="background:repeating-linear-gradient(45deg,#fd971f,#fd971f 3px,transparent 3px,transparent 6px);width:${pct}%;">` +
            `<span class="se-seg-tip">Gaps — ${state.gaps.length} missing</span></div>`
        );
    }
}

/**
 * Render the warning banner showing detected gaps.
 */
export function renderWarningBanner() {
    const $banner = $('#se-warning-banner');
    if (state.gaps.length === 0) {
        $banner.hide();
        return;
    }
    const sorted = [...state.gaps].sort((a, b) => a - b);
    const gapList = sorted.map(n => '#' + n).join(', ');
    $banner.find('.se-warning-text').text(
        '\u26A0 Gaps detected: entries ' + gapList + ' are missing from the sequence'
    );
    $banner.show().css('display', 'flex');
}

/**
 * Update the selection bar display based on current selection state.
 */
export function renderSelectionBar() {
    const $bar = $('#se-selection-bar');
    $bar.show().css('display', 'flex');
    const count = state.selected.size;
    $bar.find('.se-sel-count').text(count + ' selected');
    $bar.toggleClass('se-sel-active', count > 0);
    $('#se-btn-create-act').prop('disabled', count === 0);
    $('#se-btn-new-entry').prop('disabled', count !== 1);
    $('#se-btn-simple-merge').prop('disabled', count < 2);
    $('#se-btn-split-entry').prop('disabled', count !== 1);
    $('#se-btn-bulk-fill').prop('disabled', count === 0);
}

/**
 * Close the currently active edit popover if any.
 */
export function closeEditPopover() {
    if (activeEditPopover) {
        activeEditPopover.remove();
        activeEditPopover = null;
    }
}

/**
 * Apply conflict highlight spans to content text.
 *
 * @param {string} content - The original entry content.
 * @param {Array<{text: string, reason: string, severity: string}>} conflicts - Conflict items.
 * @returns {string} HTML string with conflict spans.
 */
export function applyConflictHighlights(content, conflicts) {
    let html = escHtml(content);
    const sorted = [...conflicts].sort((a, b) => b.text.length - a.text.length);
    for (const c of sorted) {
        const cls = c.severity === 'error' ? 'se-conflict-mark'
            : c.severity === 'warning' ? 'se-conflict-mark-warn'
                : 'se-conflict-mark-info';
        const escaped = escHtml(c.text);
        const idx = html.indexOf(escaped);
        if (idx >= 0) {
            html = html.slice(0, idx) +
                `<span class="${cls}" title="${escAttr(c.reason)}">${escaped}</span>` +
                html.slice(idx + escaped.length);
        }
    }
    return html;
}

/**
 * Get the entry numbers of all currently selected entries.
 *
 * @returns {number[]} Array of selected entry numbers.
 */
export function getCheckedNums() {
    return [...state.selected];
}

// ─── Internal Helpers ────────────────────────

/**
 * Build a gap placeholder row from the gap-row template.
 *
 * @param {number} num - The missing entry number.
 * @returns {string} Filled HTML string.
 */
function buildGapRow(num) {
    return fillTemplate(gapRowTemplate, { num });
}

/**
 * Build an entry row from the entry-row template.
 *
 * @param {object} entry - The entry data object.
 * @returns {string} Filled HTML string.
 */
/**
 * Build the feedback cell + row style for an entry.
 * @param {number} num - Entry number.
 * @param {boolean} hasFeedback - Whether this entry has conflict feedback.
 * @param {Array|undefined} conflicts - Conflict items for this entry.
 * @returns {{ feedbackCell: string, rowStyle: string }}
 */
function buildFeedbackCell(num, hasFeedback, conflicts) {
    const sevColors = { error: 'rgba(249,38,114,0.12)', warning: 'rgba(253,151,31,0.10)', info: 'rgba(174,129,255,0.08)', ok: 'rgba(166,226,46,0.08)' };
    const sevLabels = { error: 'Error', warning: 'Warning', info: 'Info', ok: 'OK' };
    const sevClasses = { error: 'se-sev-error', warning: 'se-sev-warn', info: 'se-sev-info', ok: 'se-sev-ok' };

    if (hasFeedback) {
        let worstSev = 'ok';
        if (conflicts.some(c => c.severity === 'error')) worstSev = 'error';
        else if (conflicts.some(c => c.severity === 'warning')) worstSev = 'warning';
        else if (conflicts.some(c => c.severity === 'info')) worstSev = 'info';

        const clickable = worstSev === 'ok' ? '' : ` data-feedback-num="${num}" title="Click for details"`;
        const quickfix = worstSev === 'ok' ? '' : `<button class="se-quickfix-btn" data-quickfix-num="${num}" title="Open editor to fix">&#9998;</button>`;
        return {
            feedbackCell: `<td class="se-col-feedback"><span class="se-fb-chip ${sevClasses[worstSev]}"${clickable}>${sevLabels[worstSev]}</span>${quickfix}</td>`,
            rowStyle: `background:${sevColors[worstSev]};`,
        };
    }
    // Entry was not part of any conflict check — show dash or nothing
    if (Object.keys(state.conflicts).length > 0) {
        return { feedbackCell: '<td class="se-col-feedback"><span style="color:#555;">—</span></td>', rowStyle: '' };
    }
    return { feedbackCell: '', rowStyle: '' };
}

function buildEntryRow(entry) {
    const act = entry.actId ? state.acts.get(entry.actId) : null;
    const actBadge = act
        ? `<span class="se-act-badge" style="background:${act.color.bg};color:${act.color.fg};">${escHtml(act.name)}</span>`
        : '';

    const isSelected = state.selected.has(entry.num);
    const conflicts = state.conflicts[entry.num];
    const hasFeedback = conflicts && conflicts.length > 0;
    let contentHtml;
    if (hasFeedback) {
        contentHtml = applyConflictHighlights(entry.content, conflicts);
    } else {
        contentHtml = escHtml(entry.content);
    }

    // Build feedback cell — severity chip, clickable
    const { feedbackCell, rowStyle } = buildFeedbackCell(entry.num, hasFeedback, conflicts);

    // Health dot
    // Red:    no content, OR has error/warning conflicts
    // Yellow: has content + no hard conflicts, but missing any of date/time/location
    // Green:  has content + all metadata filled + no error/warning conflicts
    const hasContent     = !!entry.content.trim();
    const hasAllMeta     = !!(entry.date && entry.time && entry.location);
    const hasHardConflict = hasFeedback && conflicts.some(c => c.severity === 'error' || c.severity === 'warning');
    let healthColor, healthTitle;
    if (!hasContent) {
        healthColor = '#f92672'; healthTitle = 'No content';
    } else if (hasHardConflict) {
        healthColor = '#f92672'; healthTitle = 'Has conflicts';
    } else if (!hasAllMeta) {
        healthColor = '#e9c46a'; healthTitle = 'Missing metadata';
    } else {
        healthColor = '#a6e22e'; healthTitle = 'Valid';
    }
    const textColor = healthColor === '#a6e22e' ? '#1a1b12' : '#f8f8f2';
    const healthBadge = `<span class="se-health-badge" data-tooltip="${healthTitle}" style="background:${healthColor};color:${textColor};">${entry.num}</span>`;

    const rowClasses = [];
    if (isSelected) rowClasses.push('se-selected');
    if (entry.problematic) rowClasses.push('se-row-problematic');

    return fillTemplate(entryRowTemplate, {
        num: entry.num,
        healthBadge,
        rowClass: rowClasses.join(' '),
        rowStyle,
        checked: isSelected ? 'checked' : '',
        actBadge,
        contentAttr: escAttr(entry.content),
        contentHtml,
        contentModifiedClass: state.modified.has(entry.num) ? 'se-content-modified' : '',
        tokenCount: Math.ceil(entry.content.length / 4),
        wordCount: entry.content.split(/\s+/).filter(Boolean).length,
        dateDisplay: entry.date || 'Date',
        dateClass: entry.date ? '' : 'se-cell-empty',
        timeDisplay: entry.time || 'Time',
        timeClass: entry.time ? '' : 'se-cell-empty',
        locationDisplay: entry.location || 'Location',
        locationClass: entry.location ? '' : 'se-cell-empty',
        notesDisplay: entry.notes || 'Notes',
        notesClass: entry.notes ? '' : 'se-cell-empty',
        feedbackCell,
    });
}

/**
 * Attach checkbox change handlers with shift+click range selection.
 *
 * @param {jQuery} $body - The table body jQuery element.
 */
/**
 * Apply a shift+click range selection between lastCheckedNum and num.
 * @param {number} num - The clicked entry number.
 * @param {boolean} isChecked - Whether the checkbox is now checked.
 */
function applyShiftRange(num, isChecked) {
    const visibleNums = getFilteredEntries().filter(en => !en.isGap).map(en => en.num);
    const idxA = visibleNums.indexOf(lastCheckedNum);
    const idxB = visibleNums.indexOf(num);
    if (idxA < 0 || idxB < 0) return;

    const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
    for (let i = lo; i <= hi; i++) {
        if (isChecked) {
            state.selected.add(visibleNums[i]);
        } else {
            state.selected.delete(visibleNums[i]);
        }
    }
}

function bindCheckboxEvents($body) {
    // Use 'click' instead of 'change' so shiftKey is reliably available
    $body.find('input[type="checkbox"]').on('click', function (e) {
        const num = Number.parseInt(String($(this).data('num')), 10);
        const isChecked = this.checked;

        if (e.shiftKey && lastCheckedNum !== null) {
            applyShiftRange(num, isChecked);
        } else if (isChecked) {
            state.selected.add(num);
        } else {
            state.selected.delete(num);
        }

        lastCheckedNum = num;
        renderTable();
        renderSelectionBar();
        document.dispatchEvent(new CustomEvent('se:selection-changed'));
    });
}

/**
 * Bind row-level click for selection. Clicking anywhere on a row
 * (except checkbox, editable cells, or inputs) toggles selection.
 * Supports shift+click for range selection.
 *
 * @param {jQuery} $body - The table body jQuery element.
 */
function bindRowClickEvents($body) {
    $body.find('tr[data-num]').on('click', function (e) {
        // Skip if clicking on interactive elements
        const $target = $(e.target);
        if ($target.is('input, button, textarea, select')) return;
        if ($target.closest('.se-editable-cell, .se-cell-display').length) return;

        const num = Number.parseInt($(this).data('num'), 10);
        if (Number.isNaN(num)) return;

        // Content cell click: fire the editor callback (runs before renderTable)
        if ($target.closest('.se-content-cell').length && contentCellClickHandler) {
            contentCellClickHandler(num);
        }

        const isSelected = state.selected.has(num);
        const newState = !isSelected;

        if (e.shiftKey && lastCheckedNum !== null) {
            applyShiftRange(num, newState);
        } else if (newState) {
            state.selected.add(num);
        } else {
            state.selected.delete(num);
        }

        lastCheckedNum = num;
        renderTable();
        renderSelectionBar();
        document.dispatchEvent(new CustomEvent('se:selection-changed'));
    });

    // Act group header: toggle collapse
    $body.find('tr.se-act-group-header').on('click', function () {
        const actId = $(this).data('act-group');
        if (collapsedActs.has(actId)) {
            collapsedActs.delete(actId);
        } else {
            collapsedActs.add(actId);
        }
        renderTable();
    });
}

/**
 * Bind click handlers on editable cells to show the floating edit popover.
 *
 * @param {jQuery} $body - The table body jQuery element.
 */
// ─── Date / time conversion helpers ─────────────

// ─── Custom Date Picker ──────────────────────────────────────


/**
 * Parse mm/dd/yy into { month (0-based), day, year (4-digit) }.
 * Defaults to today if blank/invalid.
 */
function parseDateVal(str) {
    const today = new Date();
    if (!str) return { month: today.getMonth(), day: today.getDate(), year: today.getFullYear() };
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(str.trim());
    if (!m) return { month: today.getMonth(), day: today.getDate(), year: today.getFullYear() };
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return { month: Number(m[1]) - 1, day: Number(m[2]), year };
}

/** Build the calendar HTML for the date picker. */
function buildDatePickerHtml(val) {
    const { month, day, year } = parseDateVal(val);
    const curYear = new Date().getFullYear();
    const yearOpts = Array.from({ length: 201 }, (_, i) => {
        const y = curYear - 100 + i;
        return `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`;
    }).join('');
    const monthOpts = MONTH_NAMES.map((name, i) =>
        `<option value="${i}"${i === month ? ' selected' : ''}>${name}</option>`
    ).join('');
    return fillTemplate(datepickerTmpl, { month, day, year, monthOpts, yearOpts });
}

/** Render the day grid inside the date picker. */
function renderDayGrid(picker, viewMonth, viewYear) {
    const selDay = Number(picker.dataset.selDay);
    const selMonth = Number(picker.dataset.selMonth);
    const selYear = Number(picker.dataset.selYear);
    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

    // Day-of-week headers (rendered once, but cheap to rebuild)
    const namesEl = picker.querySelector('.se-dp-daynames');
    namesEl.innerHTML = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<span>${d}</span>`).join('');

    let html = '';
    for (let i = firstDow - 1; i >= 0; i--) {
        html += `<span class="se-dp-day se-dp-other">${daysInPrev - i}</span>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const isSel = d === selDay && viewMonth === selMonth && viewYear === selYear;
        const isToday = d === new Date().getDate() && viewMonth === new Date().getMonth() && viewYear === new Date().getFullYear();
        let cls = 'se-dp-day';
        if (isSel) cls += ' se-dp-selected';
        if (isToday && !isSel) cls += ' se-dp-today';
        html += `<span class="${cls}" data-day="${d}">${d}</span>`;
    }
    const totalCells = firstDow + daysInMonth;
    const remainder = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remainder; d++) {
        html += `<span class="se-dp-day se-dp-other">${d}</span>`;
    }
    picker.querySelector('.se-dp-days').innerHTML = html;
}

/** Bind prev/next, month/year select, and day-click events. */
function bindDatePickerEvents(pop, onSave) {
    const picker = pop.querySelector('.se-datepicker');
    const monthSel = picker.querySelector('.se-dp-month');
    const yearSel = picker.querySelector('.se-dp-year');
    let viewMonth = Number(monthSel.value);
    let viewYear = Number(yearSel.value);

    renderDayGrid(picker, viewMonth, viewYear);

    const refresh = () => {
        viewMonth = Number(monthSel.value);
        viewYear = Number(yearSel.value);
        renderDayGrid(picker, viewMonth, viewYear);
    };
    monthSel.addEventListener('change', refresh);
    yearSel.addEventListener('change', refresh);

    picker.querySelector('.se-dp-prev').addEventListener('click', () => {
        viewMonth--;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        monthSel.value = viewMonth;
        yearSel.value = viewYear;
        renderDayGrid(picker, viewMonth, viewYear);
    });
    picker.querySelector('.se-dp-next').addEventListener('click', () => {
        viewMonth++;
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        monthSel.value = viewMonth;
        yearSel.value = viewYear;
        renderDayGrid(picker, viewMonth, viewYear);
    });

    picker.querySelector('.se-dp-days').addEventListener('click', (e) => {
        const dayEl = e.target.closest('.se-dp-day:not(.se-dp-other)');
        if (!dayEl) return;
        const day = Number(dayEl.dataset.day);
        picker.dataset.selDay = day;
        picker.dataset.selMonth = viewMonth;
        picker.dataset.selYear = viewYear;
        const mm = String(viewMonth + 1).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const yy = String(viewYear).slice(-2);
        onSave(`${mm}/${dd}/${yy}`);
    });
}

// ─── Custom Time Picker ──────────────────────────────────────

/** Parse hh:mm AM/PM into { hour (1-12), minute (string), ampm }. */
function parseTimeVal(str) {
    if (!str) return { hour: 12, minute: '00', ampm: 'AM' };
    const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(str.trim());
    if (m12) return { hour: Number(m12[1]), minute: m12[2], ampm: m12[3].toUpperCase() };
    const m24 = /^(\d{2}):(\d{2})$/.exec(str.trim());
    if (m24) {
        let h = Number(m24[1]);
        const ampm = h >= 12 ? 'PM' : 'AM';
        if (h > 12) h -= 12;
        if (h === 0) h = 12;
        return { hour: h, minute: m24[2], ampm };
    }
    return { hour: 12, minute: '00', ampm: 'AM' };
}

/** Build the time picker HTML. */
function buildTimePickerHtml(val) {
    const { hour, minute, ampm } = parseTimeVal(val);
    const hourOpts = Array.from({ length: 12 }, (_, i) => {
        const h = i + 1;
        return `<option value="${h}"${h === hour ? ' selected' : ''}>${String(h).padStart(2, '0')}</option>`;
    }).join('');
    const minOpts = Array.from({ length: 60 }, (_, i) => {
        const mm = String(i).padStart(2, '0');
        return `<option value="${mm}"${mm === minute ? ' selected' : ''}>${mm}</option>`;
    }).join('');
    return fillTemplate(timepickerTmpl, {
        hourOpts,
        minOpts,
        amActiveClass: ampm === 'AM' ? ' active' : '',
        pmActiveClass: ampm === 'PM' ? ' active' : '',
    });
}

/** Bind AM/PM toggle events. */
function bindTimePickerEvents(pop) {
    const btns = pop.querySelectorAll('.se-tp-toggle');
    for (const btn of btns) {
        btn.addEventListener('click', () => {
            for (const b of btns) b.classList.remove('active');
            btn.classList.add('active');
        });
    }
}

/** Read the current time value from the picker as hh:mm AM/PM. */
function readTimePicker(pop) {
    const tp = pop.querySelector('.se-timepicker');
    if (!tp) return '';
    const hour = tp.querySelector('.se-tp-hour').value;
    const minute = tp.querySelector('.se-tp-minute').value;
    const amBtn = tp.querySelector('.se-tp-toggle.active');
    const ampm = amBtn ? amBtn.dataset.val : 'AM';
    return `${String(hour).padStart(2, '0')}:${minute} ${ampm}`;
}

// ─── Editable Cells ──────────────────────────────────────────

function bindEditableCells($body) {
    $body.find('.se-editable-cell .se-cell-display').on('click', function (e) {
        e.stopPropagation();
        closeEditPopover();

        const $td = $(this).closest('.se-editable-cell');
        const num = Number.parseInt($td.data('num'), 10);
        const field = $td.data('field');
        const entry = state.entries.get(num);
        if (!entry) return;

        const currentValue = entry[field] || '';
        const label = field.charAt(0).toUpperCase() + field.slice(1);
        const notExported = field === 'notes' ? ' (not exported)' : '';
        const isDate = field === 'date';
        const isTime = field === 'time';

        let fieldInput;
        if (isDate) {
            fieldInput = buildDatePickerHtml(currentValue);
        } else if (isTime) {
            fieldInput = buildTimePickerHtml(currentValue);
        } else if (field === 'notes') {
            fieldInput = `<textarea placeholder="${label}" rows="4">${escHtml(currentValue)}</textarea>`;
        } else {
            fieldInput = `<input type="text" value="${escAttr(currentValue)}" placeholder="${label}" />`;
        }

        const showOk = !isDate; // date auto-saves on day click
        const pop = document.createElement('div');
        pop.className = 'se-edit-popover' + (isDate ? ' se-edit-popover-wide' : '') + (field === 'notes' ? ' se-edit-popover-notes' : '');
        pop.innerHTML =
            `<div class="se-edit-popover-label">${label}${notExported}</div>` +
            fieldInput +
            '<div class="se-edit-popover-actions">' +
            (isDate ? '<button class="se-btn se-btn-sm se-ep-clear">Clear</button><span style="flex:1;"></span>' : '') +
            '<button class="se-btn se-btn-sm se-ep-cancel">Cancel</button>' +
            (showOk ? '<button class="se-btn se-btn-primary se-btn-sm se-ep-ok">OK</button>' : '') +
            '</div>';

        // Position below the cell, clamped to viewport
        const rect = $td[0].getBoundingClientRect();
        const popWidth = isDate ? 260 : 240;
        const popHeight = isDate ? 310 : (isTime ? 100 : 120);
        let left = rect.left;
        let top = rect.bottom + 6;
        if (left + popWidth > window.innerWidth) left = window.innerWidth - popWidth - 10;
        if (left < 4) left = 4;
        if (top + popHeight > window.innerHeight) {
            top = rect.top - popHeight;
            pop.classList.add('se-edit-popover-above');
        }

        pop.style.left = left + 'px';
        pop.style.top = top + 'px';

        document.body.appendChild(pop);
        activeEditPopover = pop;

        const $display = $(this);

        const doSave = (overrideVal) => {
            let newVal;
            if (typeof overrideVal === 'string') {
                newVal = overrideVal;
            } else if (isTime) {
                newVal = readTimePicker(pop);
            } else {
                const input = pop.querySelector('input, textarea');
                newVal = input ? input.value.trim() : '';
            }

            const oldVal = entry[field];
            entry[field] = newVal;

            state.lastAction = {
                description: `Edit #${num} ${field}: "${oldVal}" → "${newVal}"`,
                undo: () => { entry[field] = oldVal; renderTable(); },
            };
            updateUndoButton();

            $display.text(newVal || label);
            $display.toggleClass('se-cell-empty', !newVal);
            closeEditPopover();
            persistState();
            renderTable();
        };

        const doCancel = () => closeEditPopover();

        if (isDate) {
            bindDatePickerEvents(pop, doSave);
            $(pop).find('.se-ep-clear').on('click', () => doSave(''));
        } else if (isTime) {
            bindTimePickerEvents(pop);
        } else {
            const input = pop.querySelector('input, textarea');
            input.focus();
            if (input.select) input.select();
            attachAutocomplete(input, field, (val) => {
                input.value = val;
                doSave();
            });
        }

        $(pop).find('.se-ep-ok').on('click', () => doSave());
        $(pop).find('.se-ep-cancel').on('click', doCancel);

        // Keyboard shortcuts for non-date pickers
        if (!isDate) {
            $(pop).on('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); doSave(); }
                if (ev.key === 'Escape') { ev.preventDefault(); doCancel(); }
            });
        }
    });
}

/**
 * Bind HTML5 drag-and-drop on entry rows for reorder.
 * Dragging from the number cell moves the entry before the drop target.
 *
 * @param {jQuery} $body - The table body jQuery element.
 */
function bindDragReorder($body) {
    let dragNum = null;
    let currentOverRow = null;
    const body = $body[0];

    for (const tr of body.querySelectorAll('tr[data-num]')) {
        const num = Number.parseInt(tr.dataset.num, 10);
        if (tr.classList.contains('se-gap-row')) continue;

        const numCell = tr.querySelector('.se-col-num');
        if (numCell) {
            numCell.draggable = true;
            numCell.classList.add('se-drag-handle');
            numCell.addEventListener('dragstart', (e) => {
                dragNum = num;
                tr.classList.add('se-drag-source');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(num));
            });
        }

        tr.addEventListener('dragover', (e) => {
            if (dragNum === null || dragNum === num) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (currentOverRow !== tr) {
                if (currentOverRow) currentOverRow.classList.remove('se-drag-over');
                tr.classList.add('se-drag-over');
                currentOverRow = tr;
            }
        });

        tr.addEventListener('drop', (e) => {
            e.preventDefault();
            if (currentOverRow) currentOverRow.classList.remove('se-drag-over');
            currentOverRow = null;
            if (dragNum === null || dragNum === num) return;
            moveEntries([dragNum], num);
            dragNum = null;
        });

        tr.addEventListener('dragend', () => {
            dragNum = null;
            if (currentOverRow) currentOverRow.classList.remove('se-drag-over');
            currentOverRow = null;
            body.querySelectorAll('.se-drag-source').forEach(el => el.classList.remove('se-drag-source'));
        });
    }
}

/**
 * Update the pagination buttons and page info text.
 *
 * @param {number} totalPages - Total number of pages.
 */
function updatePaginationControls(totalPages) {
    $('#se-page-info').text(`Page ${state.currentPage} / ${totalPages}`);
    $('#se-page-first').prop('disabled', state.currentPage <= 1);
    $('#se-page-prev').prop('disabled', state.currentPage <= 1);
    $('#se-page-next').prop('disabled', state.currentPage >= totalPages);
}

/**
 * Sync the "Select All" header checkbox with the current page's selection state.
 */
function syncSelectAllCheckbox($body) {
    const $checkboxes = $body.find('input[type="checkbox"]');
    if ($checkboxes.length === 0) {
        $('#se-select-all').prop('checked', false);
        return;
    }
    const allChecked = $checkboxes.toArray().every(cb => cb.checked);
    $('#se-select-all').prop('checked', allChecked);
}

/**
 * Update the entry count display in the toolbar.
 */
function updateEntryCount() {
    const $el = $('#se-entry-count');
    if ($el.length) {
        $el.text(`${state.entries.size} entries \u2022 ${state.gaps.length} gaps`);
    }
}

/**
 * Update the undo button state and hint text.
 */
export function updateUndoButton() {
    const $box = $('#se-undo-box');
    const $desc = $('#se-undo-desc');
    if (state.lastAction) {
        $desc.text(state.lastAction.description);
        $box.show().css('display', 'flex');
    } else {
        $box.hide();
    }
}
