/**
 * @module ingest-split
 * @description Overlay panel for manually splitting problematic files on the Ingest tab.
 *
 * When a file's content can't be automatically parsed into numbered entries,
 * this panel lets the user select and mark segments using multiple colors.
 * Un-highlighted text is automatically kept as separate entries.
 *
 * The panel overlays the right side of the ingest tab (the drop zone area)
 * and can be swapped to a different problematic file without closing.
 */

import { state, persistState } from '../core/state.js';
import { escHtml } from '../core/utils.js';
import { detectGaps } from './gap-detection.js';
import { renderTable, renderSelectionBar } from '../table/table.js';
import { shiftEntriesUp } from '../table/reorder.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';
import { TEMPLATES } from '../core/constants.js';
/** Visually distinct colors for segment highlighting (shared palette). */
const SEGMENT_COLORS = [
    '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#f72585',
    '#c77dff', '#fb5607', '#06d6a0', '#e9c46a', '#48cae4',
    '#ff9f1c', '#2dc653', '#e63946', '#a8dadc', '#ff70a6',
];

/** @type {Array<{start:number, end:number, color:string, text:string}>} */
let segments = [];
let colorIndex = 0;
let activeFileName = null;

/** Patterns to strip common header prefixes from split pieces (case-insensitive). */
const HEADER_PREFIXES = [
    /^summary\s*\|?\s*/i,
    /^summaries\s*\|?\s*/i,
    /^story\s+so\s+far\s*\|?\s*/i,
    /^part\s*#?\s*\d+\s*[:=-]?\s*/i,
];

let _panelTmpl = null;
let _segItemTmpl = null;
let _previewTmpl = null;

async function ensureTemplates() {
    if (_panelTmpl) return;
    [_panelTmpl, _segItemTmpl, _previewTmpl] = await Promise.all([
        loadTemplate(TEMPLATES.INGEST_SPLIT_PANEL),
        loadTemplate(TEMPLATES.SEG_ITEM),
        loadTemplate(TEMPLATES.INGEST_PREVIEW_PANEL),
    ]);
}

/**
 * Open the ingest split panel for the given problematic file.
 * Renders as an overlay inside `.se-ingest-area`.
 *
 * @param {string} fileName - The problematic file name.
 * @param {Function} onResolve - Callback after confirm (receives fileName).
 */
export async function openIngestSplit(fileName, onResolve) {
    const rawContent = state.fileRawContent.get(fileName);
    if (!rawContent) return;

    closeIngestSplit();
    segments = [];
    colorIndex = 0;
    activeFileName = fileName;

    await ensureTemplates();

    const area = document.querySelector('.se-ingest-area');
    if (!area) return;

    const panel = document.createElement('div');
    panel.id = 'se-ingest-split-panel';
    panel.className = 'se-isp-overlay';
    panel.innerHTML = fillTemplate(_panelTmpl, {
        fileName: escHtml(fileName),
        content: escHtml(rawContent),
    });
    area.appendChild(panel);

    bindPanelEvents(panel, rawContent, fileName, onResolve);
}

/**
 * Swap to a different problematic file without closing the panel.
 * @param {string} fileName
 * @param {Function} onResolve
 */
export async function swapIngestSplit(fileName, onResolve) {
    if (!isIngestSplitOpen()) {
        await openIngestSplit(fileName, onResolve);
        return;
    }
    // Just reopen — closeIngestSplit + openIngestSplit
    await openIngestSplit(fileName, onResolve);
}

/** Close and remove the ingest split panel. */
export function closeIngestSplit() {
    document.getElementById('se-ingest-split-panel')?.remove();
    segments = [];
    colorIndex = 0;
    activeFileName = null;
}

/** @returns {boolean} Whether the panel is currently open. */
export function isIngestSplitOpen() {
    return !!document.getElementById('se-ingest-split-panel');
}

/** @returns {string|null} Currently active file in the panel. */
export function getActiveFileName() {
    return activeFileName;
}

// ─── Events ─────────────────────────────────────────────

function bindPanelEvents(panel, rawContent, fileName, onResolve) {
    panel.querySelector('.se-isp-close').addEventListener('click', closeIngestSplit);
    panel.querySelector('#se-isp-cancel').addEventListener('click', closeIngestSplit);

    panel.querySelector('#se-isp-mark').addEventListener('click', () => {
        const ta = panel.querySelector('#se-isp-textarea');
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        if (start === end) return;

        const text = rawContent.slice(start, end);
        if (!text.trim()) return;

        if (segments.some(s => start < s.end && end > s.start)) {
            showOverlapWarning(panel);
            return;
        }

        const color = SEGMENT_COLORS[colorIndex % SEGMENT_COLORS.length];
        colorIndex++;
        segments.push({ start, end, color, text });
        segments.sort((a, b) => a.start - b.start);

        refreshPanel(panel, rawContent);
    });

    panel.querySelector('#se-isp-clear-all').addEventListener('click', () => {
        segments = [];
        colorIndex = 0;
        refreshPanel(panel, rawContent);
    });

    panel.querySelector('#se-isp-segments').addEventListener('click', (e) => {
        const rm = e.target.closest('.se-sp-seg-remove');
        if (!rm) return;
        const idx = Number.parseInt(rm.dataset.idx, 10);
        segments.splice(idx, 1);
        refreshPanel(panel, rawContent);
    });

    panel.querySelector('#se-isp-confirm').addEventListener('click', () => {
        doIngestSplit(rawContent, fileName);
        if (onResolve) onResolve(fileName);
        closeIngestSplit();
    });
}

function showOverlapWarning(panel) {
    const hint = panel.querySelector('#se-isp-seg-count');
    hint.textContent = '\u26A0 Overlaps an existing segment';
    hint.style.color = '#f92672';
    setTimeout(() => { hint.style.color = ''; refreshSegCount(panel, null); }, 1500);
}

// ─── Rendering ──────────────────────────────────────────

function refreshPanel(panel, rawContent) {
    renderPanelPreview(panel, rawContent);
    renderSegList(panel);
    refreshSegCount(panel, rawContent);

    const pieces = buildPieces(rawContent);
    panel.querySelector('#se-isp-confirm').disabled = pieces.length === 0;
}

function refreshSegCount(panel, rawContent) {
    const el = panel.querySelector('#se-isp-seg-count');
    if (!el) return;
    const totalPieces = rawContent ? buildPieces(rawContent).length : segments.length;
    const gapCount = totalPieces - segments.length;
    let label = `${segments.length} marked`;
    if (gapCount > 0) label += ` + ${gapCount} other`;
    label += ` = ${totalPieces} total`;
    el.textContent = label;
}

function renderPanelPreview(panel, content) {
    const preview = panel.querySelector('#se-isp-preview');
    if (segments.length === 0) {
        preview.innerHTML = '';
        return;
    }

    let html = '';
    let cursor = 0;
    for (const seg of segments) {
        if (seg.start > cursor) {
            html += `<span class="se-sp-gap">${escHtml(content.slice(cursor, seg.start))}</span>`;
        }
        html += `<mark style="background:${seg.color};color:#272822;border-radius:3px;padding:0 2px;">${escHtml(content.slice(seg.start, seg.end))}</mark>`;
        cursor = seg.end;
    }
    if (cursor < content.length) {
        html += `<span class="se-sp-gap">${escHtml(content.slice(cursor))}</span>`;
    }
    preview.innerHTML = html;
}

function renderSegList(panel) {
    const list = panel.querySelector('#se-isp-segments');
    if (segments.length === 0) {
        list.innerHTML = '';
        return;
    }
    list.innerHTML = segments.map((seg, i) => {
        const preview = seg.text.length > 50 ? seg.text.slice(0, 47) + '\u2026' : seg.text;
        return fillTemplate(_segItemTmpl, {
            color: seg.color,
            num: i + 1,
            preview: escHtml(preview),
            idx: i,
        });
    }).join('');
}

// ─── Split operation ────────────────────────────────────

/**
 * Remove all problematic placeholder entries for a file from state and return
 * their numbers (used to determine the correct insertion point).
 * @param {string} fileName
 * @returns {number[]}
 */
function removeFilePlaceholders(fileName) {
    const nums = [];
    for (const [num, entry] of state.entries) {
        if (entry.source === fileName && entry.problematic) nums.push(num);
    }
    for (const num of nums) {
        const e = state.entries.get(num);
        if (e?.actId) state.acts.get(e.actId)?.entryNums.delete(num);
        state.entries.delete(num);
    }
    return nums;
}

/**
 * Build pieces from current segments + gaps in the raw content.
 * @param {string} content
 * @returns {Array<{text: string, color: string|null}>}
 */
function buildPieces(content) {
    const pieces = [];
    let cursor = 0;
    for (const seg of segments) {
        if (seg.start > cursor) {
            const gap = content.slice(cursor, seg.start).trim();
            if (gap) pieces.push({ text: gap, color: null });
        }
        pieces.push({ text: seg.text, color: seg.color });
        cursor = seg.end;
    }
    if (cursor < content.length) {
        const gap = content.slice(cursor).trim();
        if (gap) pieces.push({ text: gap, color: null });
    }
    return pieces;
}

/**
 * Execute the split: insert M entries at the correct position in the sequence.
 *
 * Insertion point = min number of the file's placeholder entries (placed right
 * after the last good file during ingest). Subsequent entries shift up if they
 * would collide with the new range.
 */
function doIngestSplit(rawContent, fileName) {
    const pieces = buildPieces(rawContent);
    if (pieces.length === 0) return;
    const M = pieces.length;

    // Remove placeholders; returned nums give us the insertion point
    const placeholderNums = removeFilePlaceholders(fileName);

    let insertionPoint;
    if (placeholderNums.length > 0) {
        insertionPoint = Math.min(...placeholderNums);
    } else {
        insertionPoint = state.entries.size > 0 ? Math.max(...state.entries.keys()) + 1 : 1;
    }

    // Shift anything that would collide with the new range
    const firstCollision = [...state.entries.keys()]
        .filter(k => k >= insertionPoint)
        .sort((a, b) => a - b)[0];
    if (firstCollision !== undefined && firstCollision < insertionPoint + M) {
        shiftEntriesUp(insertionPoint - 1, insertionPoint + M - firstCollision);
    }

    // Insert new entries (trim header prefixes from each piece)
    for (let i = 0; i < M; i++) {
        const num = insertionPoint + i;
        state.entries.set(num, {
            num,
            content: trimHeaderPrefix(pieces[i].text),
            date: '', time: '', location: '', notes: '',
            actId: null, source: fileName,
        });
    }

    // Remove auto-created "Part N" acts that are now empty (orphaned by the split)
    for (const [actId, act] of state.acts) {
        if (act.entryNums.size === 0 && /^Part\s+\d+$/i.test(act.name)) {
            state.acts.delete(actId);
        }
    }

    // Mark file as resolved
    state.fileRawContent.delete(fileName);
    const fileInfo = state.files.find(f => f.name === fileName);
    if (fileInfo) {
        fileInfo.problematic = false;
        fileInfo.entryCount = M;
    }

    detectGaps();
    persistState();
    renderTable();
    renderSelectionBar();
}

// ─── Header prefix trimming ───────────────────────────

/**
 * Strip common header prefixes like "Summary | Story so far | Part 3:" from text.
 * @param {string} text
 * @returns {string}
 */
function trimHeaderPrefix(text) {
    let result = text;
    for (const re of HEADER_PREFIXES) {
        result = result.replace(re, '');
    }
    return result.trim() || text;
}

// ─── Read-only preview panel ────────────────────

/**
 * Open a read-only preview panel for a file.
 * For valid files: shows parsed entries.
 * For invalid files: shows rejection reason + raw content.
 *
 * @param {string} fileName - The file name to preview.
 * @param {string} [rejectReason] - If provided, shows as a greyed-out checked checkbox subheader.
 */
export async function openIngestPreview(fileName, rejectReason) {
    closeIngestPreview();
    closeIngestSplit();

    await ensureTemplates();

    const area = document.querySelector('.se-ingest-area');
    if (!area) return;

    let content;
    let rejectBlock = '';

    if (rejectReason) {
        // Invalid file — show raw content from cache
        const raw = state.fileRawContent.get(fileName) || '';
        content = raw || '(empty file)';
        rejectBlock =
            '<div class="se-ipp-reject">' +
            '<label class="se-ipp-reject-label">' +
            '<input type="checkbox" checked disabled /> ' +
            escHtml(rejectReason) +
            '</label></div>';
    } else {
        // Valid file — show parsed entries
        const entries = [];
        for (const [, entry] of state.entries) {
            if (entry.source === fileName) entries.push(entry);
        }
        entries.sort((a, b) => a.num - b.num);
        content = entries.length > 0
            ? entries.map(e => `#${e.num}. ${e.content}`).join('\n\n')
            : '(no entries)';
    }

    const panel = document.createElement('div');
    panel.id = 'se-ingest-preview-panel';
    panel.className = 'se-isp-overlay';
    panel.innerHTML = fillTemplate(_previewTmpl, {
        fileName: escHtml(fileName),
        rejectBlock,
        content: escHtml(content),
    });
    area.appendChild(panel);

    panel.querySelector('.se-ipp-close')
        ?.addEventListener('click', closeIngestPreview);
}

/** Close and remove the read-only preview panel. */
export function closeIngestPreview() {
    document.getElementById('se-ingest-preview-panel')?.remove();
}
