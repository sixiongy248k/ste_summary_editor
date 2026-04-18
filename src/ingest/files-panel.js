/**
 * @module files-panel
 * @description Floating assignment panel for ingested files.
 *
 * Opened by clicking the "Ingested Files" drawer header title.
 * Shows all loaded files with per-file assignment mode radio buttons.
 * Supported modes: Default (no assignment), Timeline, and Supplementary.
 *
 * Supplementary assignment lets the user categorise non-summary files
 * (character notes, world details, etc.) so they appear at the end of
 * the Review tab as a single content block per file.
 */

import { state } from '../core/state.js';
import { toggleTimelineFile } from '../analysis/timeline-analysis.js';
import { escHtml, escAttr, makeDraggable, spawnPanel, registerPanel } from '../core/utils.js';

/** Supplementary categories available for non-summary files. */
export const SUPP_CATEGORIES = [
    { value: 'character-notes', label: 'Character Notes' },
    { value: 'personalities',   label: 'Personalities'   },
    { value: 'world-details',   label: 'World Details'   },
    { value: 'timeline-notes',  label: 'Timeline Notes'  },
    { value: 'others',          label: 'Others'           },
];

/** @type {HTMLElement|null} */
let _panel = null;

// ─── Public API ──────────────────────────────────────────────

/**
 * Open the files assignment panel (or refresh if already open).
 */
export function openFilesPanel() {
    if (_panel) { _renderRows(); return; }

    const overlay = document.getElementById('se-modal-overlay');
    if (!overlay) return;

    _panel = document.createElement('div');
    _panel.id = 'se-files-panel';
    _panel.className = 'se-files-panel';
    _panel.innerHTML = _buildHtml();
    overlay.appendChild(_panel);

    // Position to the right of the file drawer, or centred if drawer is closed
    const drawer = document.getElementById('se-file-drawer');
    if (drawer?.classList.contains('open')) {
        const drawerRect  = drawer.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        _panel.style.left = Math.max(8, drawerRect.right - overlayRect.left + 10) + 'px';
        _panel.style.top  = Math.max(8, drawerRect.top   - overlayRect.top) + 'px';
        makeDraggable(_panel, _panel.querySelector('.se-fp-header'));
        registerPanel(_panel);
    } else {
        spawnPanel(_panel, overlay, '.se-fp-header', 360, 380);
    }
    _bindEvents();
    _renderRows();
}

/**
 * Close and remove the files panel.
 */
export function closeFilesPanel() {
    _panel?.remove();
    _panel = null;
}

/**
 * Toggle the panel open/closed.
 */
export function toggleFilesPanel() {
    if (_panel) { closeFilesPanel(); return; }
    openFilesPanel();
}

/**
 * Re-render the file rows if the panel is open.
 * Call this whenever state.files or state.timelineFiles changes.
 */
export function refreshFilesPanel() {
    if (_panel) _renderRows();
}

// ─── Private helpers ─────────────────────────────────────────

function _buildHtml() {
    return `
        <div class="se-fp-header">
            <span class="se-fp-title">&#128194; Ingested Files</span>
            <button class="se-close-circle se-fp-close">&times;</button>
        </div>
        <div class="se-fp-section-label">Assignment Mode</div>
        <div class="se-fp-body" id="se-fp-body"></div>`;
}

function _bindEvents() {
    _panel.querySelector('.se-fp-close').addEventListener('click', closeFilesPanel);
    _panel.addEventListener('change', _handleChange);
}

function _handleChange(e) {
    const radio = e.target.closest('input[type="radio"]');
    if (radio) { _handleRadioChange(radio); return; }

    const sel = e.target.closest('select.se-fp-supp-cat');
    if (sel) _handleCategoryChange(sel);
}

function _handleRadioChange(radio) {
    const row = radio.closest('.se-fp-file-row');
    if (!row) return;
    const filename = row.dataset.file;
    const value    = radio.value;

    if (value === 'supplementary') {
        if (!state.supplementaryFiles.has(filename)) {
            const rawContent = state.fileRawContent?.get(filename) || '';
            state.supplementaryFiles.set(filename, {
                name:          filename,
                category:      '',
                content:       rawContent,
                editedContent: rawContent,
            });
        }
    } else {
        // Leaving supplementary → clear timeline too if it was timeline-notes
        const prev = state.supplementaryFiles.get(filename);
        if (prev?.category === 'timeline-notes' && state.timelineFiles.has(filename)) {
            toggleTimelineFile(filename);
        }
        state.supplementaryFiles.delete(filename);
    }

    document.dispatchEvent(new CustomEvent('se:supplementary-changed'));
    _renderRows();
}

function _handleCategoryChange(sel) {
    const row = sel.closest('.se-fp-file-row');
    if (!row) return;
    const filename = row.dataset.file;
    const category = sel.value;
    const existing = state.supplementaryFiles.get(filename);

    // Auto-toggle timelineFiles based on whether category is timeline-notes
    const wasTl = state.timelineFiles.has(filename);
    const isTl  = category === 'timeline-notes';
    if (isTl && !wasTl)  toggleTimelineFile(filename);
    if (!isTl && wasTl)  toggleTimelineFile(filename);

    if (category) {
        const rawContent = state.fileRawContent.get(filename) || '';
        state.supplementaryFiles.set(filename, {
            name:          filename,
            category,
            content:       rawContent,
            editedContent: existing?.editedContent ?? rawContent,
            date:          existing?.date     ?? '',
            time:          existing?.time     ?? '',
            location:      existing?.location ?? '',
            notes:         existing?.notes    ?? '',
        });
    } else {
        state.supplementaryFiles.delete(filename);
    }

    document.dispatchEvent(new CustomEvent('se:supplementary-changed'));
    _renderRows();
}

function _renderRows() {
    const body = document.getElementById('se-fp-body');
    if (!body) return;

    if (state.files.length === 0) {
        body.innerHTML = '<div class="se-fp-empty">No files ingested yet.</div>';
        return;
    }

    body.innerHTML = state.files.map(file => _buildFileRow(file)).join('');
}

function _fileStatusIcon(file, isAssigned) {
    if (file.problematic)              return { icon: '?',       cls: 'se-fp-status-warn'          };
    if (file.isSupplementaryCandidate) return isAssigned
        ? { icon: '&#10003;', cls: 'se-fp-status-supp-assigned' }
        : { icon: '&#9432;',  cls: 'se-fp-status-supp'          };
    if (!file.valid)                   return { icon: '&#9432;', cls: 'se-fp-status-invalid'        };
    return { icon: '&#10003;', cls: '' };
}

function _buildSuppRadio(radioName, isSupp) {
    const checked = isSupp ? 'checked' : '';
    return `<label class="se-fp-mode-label">
        <input type="radio" name="${escAttr(radioName)}" value="supplementary" ${checked}><span>Supplementary</span>
    </label>`;
}

function _buildCatSelect(isSupp, suppEntry) {
    if (!isSupp) return '';
    const opts = SUPP_CATEGORIES.map(c => {
        const sel = suppEntry?.category === c.value ? 'selected' : '';
        return `<option value="${c.value}" ${sel}>${c.label}</option>`;
    }).join('');
    return `<div class="se-fp-supp-cat-wrap">
        <select class="se-fp-supp-cat" title="Supplementary category">
            <option value="">-- choose category --</option>
            ${opts}
        </select>
    </div>`;
}

function _buildAssignedBadge(suppEntry) {
    if (!suppEntry) return '';
    if (suppEntry.category) {
        return `<span class="se-fp-supp-badge se-fp-supp-badge-assigned">Supplementary &middot; ${escHtml(_suppLabel(suppEntry.category))}</span>`;
    }
    return `<span class="se-fp-supp-badge se-fp-supp-badge-pending">choose category</span>`;
}

function _buildFileRow(file) {
    const suppEntry  = state.supplementaryFiles.get(file.name);
    const isSupp     = !!suppEntry;
    const isAssigned = isSupp && !!suppEntry.category;
    const radioName  = 'fp-mode-' + file.name.replaceAll(/[^a-zA-Z0-9]/g, '_');

    const { icon: statusIcon, cls: statusClass } = _fileStatusIcon(file, isAssigned);

    let rowClass = '';
    if (isAssigned) rowClass = ' se-fp-supplementary';
    else if (isSupp) rowClass = ' se-fp-supp-pending';

    const noneChecked = isSupp ? '' : 'checked';
    const countBadge  = file.entryCount > 0 ? `<span class="se-fp-count">${file.entryCount}</span>` : '';
    const assignBadge = _buildAssignedBadge(suppEntry);

    // Valid summary files have no assignment options — they're ingested as-is
    if (file.valid) {
        return `
        <div class="se-fp-file-row" data-file="${escAttr(file.name)}">
            <div class="se-fp-file-info">
                <span class="se-fp-status ${statusClass}">${statusIcon}</span>
                <span class="se-fp-filename">${escHtml(file.name)}</span>
                ${countBadge}
            </div>
        </div>`;
    }

    return `
        <div class="se-fp-file-row${rowClass}" data-file="${escAttr(file.name)}">
            <div class="se-fp-file-info">
                <span class="se-fp-status ${statusClass}">${statusIcon}</span>
                <span class="se-fp-filename">${escHtml(file.name)}</span>
                ${countBadge}${assignBadge}
            </div>
            <div class="se-fp-modes">
                <label class="se-fp-mode-label">
                    <input type="radio" name="${escAttr(radioName)}" value="none" ${noneChecked}><span>Default</span>
                </label>
                ${_buildSuppRadio(radioName, isSupp)}
            </div>
            ${_buildCatSelect(isSupp, suppEntry)}
        </div>`;
}

function _suppLabel(value) {
    return SUPP_CATEGORIES.find(c => c.value === value)?.label ?? value;
}
