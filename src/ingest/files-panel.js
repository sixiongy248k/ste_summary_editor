/**
 * @module files-panel
 * @description Floating assignment panel for ingested files.
 *
 * Opened by clicking the "Ingested Files" drawer header title.
 * Shows all loaded files with per-file assignment mode radio buttons.
 * Currently supported modes: Default (no assignment) and Timeline.
 *
 * Timeline assignment reads/writes state.timelineFiles — auto-detected
 * on ingest, manually overridable here.
 */

import { state } from '../core/state.js';
import { toggleTimelineFile, hasTimelineFiles } from '../analysis/timeline-analysis.js';
import { escHtml, escAttr, makeDraggable, spawnPanel, registerPanel } from '../core/utils.js';

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

    // Radio change → update assignment state
    _panel.addEventListener('change', (e) => {
        const radio = e.target.closest('input[type="radio"]');
        if (!radio) return;
        const row = radio.closest('.se-fp-file-row');
        if (!row) return;
        const filename = row.dataset.file;
        const value    = radio.value;
        const isTl     = state.timelineFiles.has(filename);

        if ((value === 'timeline') !== isTl) toggleTimelineFile(filename);

        // Sync timeline toolbar button
        const tlBtn = document.getElementById('se-btn-timeline');
        if (tlBtn) tlBtn.disabled = !hasTimelineFiles();

        _renderRows();
    });
}

function _renderRows() {
    const body = document.getElementById('se-fp-body');
    if (!body) return;

    if (state.files.length === 0) {
        body.innerHTML = '<div class="se-fp-empty">No files ingested yet.</div>';
        return;
    }

    body.innerHTML = state.files.map(file => {
        const isTimeline = file.valid && state.timelineFiles.has(file.name);
        // Radio name: sanitised to avoid invalid HTML attribute chars
        const radioName  = 'fp-mode-' + file.name.replace(/[^a-zA-Z0-9]/g, '_');

        let statusIcon  = '&#10003;';
        let statusClass = '';
        if      (file.problematic) { statusIcon = '?';       statusClass = 'se-fp-status-warn';    }
        else if (!file.valid)      { statusIcon = '&#9432;'; statusClass = 'se-fp-status-invalid'; }

        return `
            <div class="se-fp-file-row${isTimeline ? ' se-fp-timeline' : ''}" data-file="${escAttr(file.name)}">
                <div class="se-fp-file-info">
                    <span class="se-fp-status ${statusClass}">${statusIcon}</span>
                    <span class="se-fp-filename">${escHtml(file.name)}</span>
                    ${file.entryCount > 0 ? `<span class="se-fp-count">${file.entryCount}</span>` : ''}
                </div>
                <div class="se-fp-modes">
                    <label class="se-fp-mode-label">
                        <input type="radio" name="${escAttr(radioName)}" value="none" ${!isTimeline ? 'checked' : ''}><span>Default</span>
                    </label>
                    <label class="se-fp-mode-label">
                        <input type="radio" name="${escAttr(radioName)}" value="timeline" ${isTimeline ? 'checked' : ''}><span>Timeline</span>
                    </label>
                </div>
            </div>`;
    }).join('');
}
