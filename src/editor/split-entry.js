/**
 * @module split-entry
 * @description Split one entry into multiple entries by highlight-marking segments.
 *
 * ## How it works
 * 1. User opens the split dialog for the selected entry.
 * 2. Content is shown in a read-only textarea.
 * 3. User selects text in the textarea, then clicks "Mark Segment".
 *    Each mark gets a distinct random color — one color = one new entry.
 * 4. Segments are shown in a list with a colored swatch and text preview.
 *    Clicking a segment's × removes its mark.
 * 5. "Split" creates N entries (replacing the original):
 *    - Original entry number keeps segment[0] content.
 *    - Segments [1..N-1] are inserted as new entries at +1, +2, … .
 *    - All existing entries above the original get shifted up by (N-1).
 *    - Act assignment, causality, and gaps are updated accordingly.
 */

import { state, persistState, snapshotState, restoreSnapshot } from '../core/state.js';
import { renderTable, renderSelectionBar, updateUndoButton } from '../table/table.js';
import { detectGaps } from '../ingest/gap-detection.js';
import { escHtml, spawnPanel } from '../core/utils.js';
import { shiftEntriesUp } from '../table/reorder.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';
import { TEMPLATES } from '../core/constants.js';

/** Visually distinct colors for segment highlighting. */
const SEGMENT_COLORS = [
    '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#f72585',
    '#c77dff', '#fb5607', '#06d6a0', '#e9c46a', '#48cae4',
    '#ff9f1c', '#2dc653', '#e63946', '#a8dadc', '#ff70a6',
];

/** @type {Array<{start:number, end:number, color:string, text:string}>} */
let segments = [];
let colorIndex = 0;

// ─── Template cache ───────────────────────────────

let _dialogTmpl = null;
let _segItemTmpl = null;

async function ensureTemplates() {
    if (_dialogTmpl) return;
    [_dialogTmpl, _segItemTmpl] = await Promise.all([
        loadTemplate(TEMPLATES.SPLIT_DIALOG),
        loadTemplate(TEMPLATES.SEG_ITEM),
    ]);
}

/**
 * Open the split dialog for the given entry number.
 * @param {number} num - The entry number to split.
 */
export async function openSplitDialog(num) {
    const entry = state.entries.get(num);
    if (!entry) return;

    closeSplitDialog();
    segments = [];
    colorIndex = 0;

    await ensureTemplates();

    const overlay = document.getElementById('se-modal-overlay');
    if (!overlay) return;

    const pop = document.createElement('div');
    pop.id = 'se-split-dialog';
    pop.className = 'se-split-dialog';
    pop.innerHTML = fillTemplate(_dialogTmpl, { num, content: escHtml(entry.content) });
    overlay.appendChild(pop);

    spawnPanel(pop, overlay, '.se-sp-header', 620, 560);
    bindEvents(pop, num, entry);
}

/** Close and remove the split dialog. */
export function closeSplitDialog() {
    document.getElementById('se-split-dialog')?.remove();
    segments = [];
    colorIndex = 0;
}

// ─── Events ───────────────────────────────────────────────────

function bindEvents(pop, num, entry) {
    pop.querySelector('.se-sp-close').addEventListener('click', closeSplitDialog);
    pop.querySelector('#se-sp-cancel').addEventListener('click', closeSplitDialog);

    pop.querySelector('#se-sp-mark').addEventListener('click', () => {
        const ta = pop.querySelector('#se-sp-textarea');
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        if (start === end) return; // no selection

        const text = entry.content.slice(start, end);
        if (!text.trim()) return;

        // Check for overlap with existing segments
        const overlaps = segments.some(s => start < s.end && end > s.start);
        if (overlaps) {
            const hint = pop.querySelector('#se-sp-seg-count');
            hint.textContent = '⚠ Overlaps an existing segment';
            hint.style.color = '#f92672';
            setTimeout(() => { hint.style.color = ''; refreshSegmentCount(pop); }, 1500);
            return;
        }

        const color = SEGMENT_COLORS[colorIndex % SEGMENT_COLORS.length];
        colorIndex++;
        segments.push({ start, end, color, text });
        segments.sort((a, b) => a.start - b.start);

        refreshAll(pop, entry.content);
    });

    pop.querySelector('#se-sp-clear-all').addEventListener('click', () => {
        segments = [];
        colorIndex = 0;
        refreshAll(pop, entry.content);
    });

    // Remove segment by clicking its × button
    pop.querySelector('#se-sp-segments').addEventListener('click', (e) => {
        const rm = e.target.closest('.se-sp-seg-remove');
        if (!rm) return;
        const idx = Number.parseInt(rm.dataset.idx, 10);
        segments.splice(idx, 1);
        refreshAll(pop, entry.content);
    });

    pop.querySelector('#se-sp-split').addEventListener('click', () => {
        doSplit(num, entry);
    });

    pop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSplitDialog();
    });
}

// ─── Rendering ───────────────────────────────────────────────

function refreshAll(pop, content) {
    renderPreview(pop, content);
    renderSegmentList(pop);
    refreshSegmentCount(pop, content);
    // Enable split when marking produces at least 2 pieces (segments + gaps)
    pop.querySelector('#se-sp-split').disabled = buildAllPieces(content).length < 2;
}

function refreshSegmentCount(pop, content) {
    const el = pop.querySelector('#se-sp-seg-count');
    const totalPieces = content ? buildAllPieces(content).length : segments.length;
    const gapCount = totalPieces - segments.length;
    let label = `${segments.length} marked`;
    if (gapCount > 0) label += ` + ${gapCount} other`;
    label += ` = ${totalPieces} total`;
    el.textContent = label;
    el.style.color = '';
}

function renderPreview(pop, content) {
    const preview = pop.querySelector('#se-sp-preview');
    if (segments.length === 0) {
        preview.innerHTML = '';
        return;
    }

    let html = '';
    let cursor = 0;
    for (const seg of segments) {
        if (seg.start > cursor) {
            // Gap region — un-highlighted text that becomes its own entry
            const gap = content.slice(cursor, seg.start);
            html += `<span class="se-sp-gap">${escHtml(gap)}</span>`;
        }
        html += `<mark style="background:${seg.color};color:#272822;border-radius:3px;padding:0 2px;">${escHtml(content.slice(seg.start, seg.end))}</mark>`;
        cursor = seg.end;
    }
    if (cursor < content.length) {
        html += `<span class="se-sp-gap">${escHtml(content.slice(cursor))}</span>`;
    }
    preview.innerHTML = html;
}

function renderSegmentList(pop) {
    const list = pop.querySelector('#se-sp-segments');
    if (segments.length === 0) {
        list.innerHTML = '';
        return;
    }
    list.innerHTML = segments.map((seg, i) => {
        const preview = seg.text.length > 60 ? seg.text.slice(0, 57) + '…' : seg.text;
        return fillTemplate(_segItemTmpl, {
            color:   seg.color,
            num:     i + 1,
            preview: escHtml(preview),
            idx:     i,
        });
    }).join('');
}

// ─── Piece assembly ─────────────────────────────────────────

/**
 * Build an ordered array of all pieces: marked segments + gap text between them.
 * Gaps are un-highlighted regions that become their own entries.
 *
 * @param {string} content - Full entry content string.
 * @returns {Array<{text: string, color: string|null}>} Ordered pieces (null color = gap).
 */
export function buildAllPieces(content) {
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

// ─── Split operation ─────────────────────────────────────────

function doSplit(num, entry) {
    const pieces = buildAllPieces(entry.content);
    if (pieces.length < 2) return;

    const confirmed = confirm(
        `Split entry #${num} into ${pieces.length} entries?\n` +
        `Entries #${num + 1} and above will shift up by ${pieces.length - 1}.`
    );
    if (!confirmed) return;

    const snap = snapshotState();
    const pieceCount = pieces.length;
    const shift = pieceCount - 1;
    const actId = entry.actId;

    shiftEntriesUp(num, shift);

    if (actId) state.acts.get(actId)?.entryNums.delete(num);

    for (let i = 0; i < pieces.length; i++) {
        const newNum = num + i;
        state.entries.set(newNum, {
            num: newNum,
            content: pieces[i].text,
            date: i === 0 ? (entry.date || '') : '',
            time: i === 0 ? (entry.time || '') : '',
            location: i === 0 ? (entry.location || '') : '',
            notes: '',
            actId: actId || null,
            source: entry.source || '',
        });
        if (actId) state.acts.get(actId)?.entryNums.add(newNum);
    }

    state.selected.clear();
    state.lastAction = {
        description: `Split entry #${num} into ${pieceCount} entries`,
        undo: () => {
            restoreSnapshot(snap);
            detectGaps();
            renderTable();
            renderSelectionBar();
            persistState();
            updateUndoButton();
        },
    };
    updateUndoButton();
    detectGaps();
    persistState();
    renderTable();
    renderSelectionBar();
    closeSplitDialog();
}

