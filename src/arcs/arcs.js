/**
 * @module acts
 * @description Act creation, management, rendering, color picker, minimap overlay.
 *
 * ## What Are Acts?
 * Acts are user-defined groupings of sequential story entries (e.g., "Training Act",
 * "Battle of X"). Each entry can belong to at most one act. Acts get auto-assigned
 * colors from a cycling palette and can be renamed, recolored, deleted, or undone.
 *
 * ## Retroactive Act Detection
 * If a new act's lowest entry number is less than any existing act's range,
 * it's flagged as "retroactive" and the user is prompted to name it specially.
 */

import { ACT_COLORS, TEMPLATES } from '../core/constants.js';
import { state, persistState, snapshotState, restoreSnapshot } from '../core/state.js';
import { escHtml, escAttr, makeDraggable, spawnPanel } from '../core/utils.js';
import { renderTable, renderStatsBar, getCheckedNums, renderSelectionBar, updateUndoButton } from '../table/table.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';
import { openColorPicker, closeColorPicker, cpRenderFields, cpApplyFields } from './color-picker.js';

/** @type {string|null} Cached act-item template HTML. */
let actItemTemplate = null;

/**
 * Initialize the acts module by loading required templates.
 * Must be called once before any rendering.
 */
export async function initActs() {
    actItemTemplate = await loadTemplate('act-item');
}

/**
 * Enable or disable the "Create Act" button based on selection.
 */
export function updateActButtonState() {
    const checked = getCheckedNums();
    $('#se-btn-create-act').prop('disabled', checked.length === 0);
}

/**
 * Create a new act from the currently selected (checked) table entries.
 */
export function createActFromSelection() {
    const nums = getCheckedNums();
    if (nums.length === 0) return;

    // Separate assigned vs unassigned entries
    const assigned = nums.filter(n => state.entries.get(n)?.actId);
    const unassigned = nums.filter(n => !state.entries.get(n)?.actId);

    if (assigned.length > 0) {
        // Check if all assigned entries share the same act
        const actIds = new Set(assigned.map(n => state.entries.get(n).actId));

        if (actIds.size > 1) {
            // Mixed acts — error out
            alert('Selected entries belong to different acts. Select entries from only one act, or use the "Assign to act" dropdown to pick a specific act.');
            return;
        }

        // All assigned share the same act — add unassigned entries to it
        const targetActId = [...actIds][0];
        const act = state.acts.get(targetActId);
        if (!act) return;

        if (unassigned.length === 0) {
            alert(`All selected entries already belong to "${act.name}".`);
            return;
        }

        // Add unassigned entries to the existing act
        const oldActIds = unassigned.map(n => ({ num: n, actId: state.entries.get(n)?.actId || null }));
        for (const num of unassigned) {
            const entry = state.entries.get(num);
            if (entry) {
                entry.actId = targetActId;
                act.entryNums.add(num);
            }
        }

        state.lastAction = {
            description: `Add ${unassigned.length} entries to "${act.name}"`,
            undo: () => {
                for (const { num, actId } of oldActIds) {
                    const entry = state.entries.get(num);
                    if (entry) entry.actId = actId;
                    act.entryNums.delete(num);
                }
                refreshActUI();
                persistState();
            },
        };

        state.selected.clear();
        renderSelectionBar();
        refreshActUI();
        persistState();
        return;
    }

    // All entries are unassigned — create a new act
    const actName = promptForActName(nums);
    if (actName === null) return;

    const actId = buildAndRegisterAct(actName, nums);
    assignEntriesToAct(actId, nums);
    removeEmptyActs();

    // Save for undo
    state.lastAction = {
        description: `Create act "${actName}" with ${nums.length} entries`,
        undo: () => {
            const act = state.acts.get(actId);
            if (act) {
                for (const num of act.entryNums) {
                    const entry = state.entries.get(num);
                    if (entry) entry.actId = null;
                }
                state.acts.delete(actId);
            }
            refreshActUI();
            persistState();
        },
    };

    // Clear selection
    state.selected.clear();
    renderSelectionBar();

    refreshActUI();
    persistState();
}

/**
 * Prompt the user for an act name, handling retroactive detection.
 */
function promptForActName(nums) {
    const minNum = Math.min(...nums);
    const existingMins = getExistingActMins();
    const isRetroactive = existingMins.length > 0 && minNum < Math.min(...existingMins);

    let defaultName = `Act ${state.nextActId}`;
    if (isRetroactive) {
        defaultName = `Pre-Act (before #${Math.min(...existingMins)})`;
    }

    const promptMessage = isRetroactive
        ? `This act precedes existing acts. Name it (or leave blank for "${defaultName}"):`
        : `Name this act (or leave blank for "${defaultName}"):`;

    const name = prompt(promptMessage, defaultName);
    if (name === null) return null;
    return name.trim() || defaultName;
}

/**
 * Create an act object and register it in state.
 */
function buildAndRegisterAct(actName, nums) {
    // Use curated palette first, then fall back to random distinct colors
    const color = state.actColorIdx < ACT_COLORS.length
        ? ACT_COLORS[state.actColorIdx++]
        : generateDistinctColor();

    const actId = state.nextActId++;
    const act = {
        id: actId,
        name: actName,
        color,
        entryNums: new Set(nums),
        notes: '',
    };

    state.acts.set(actId, act);
    return actId;
}

/**
 * Generate a random vibrant color that is visually distinct from existing act colors.
 * Uses HSL with high saturation and mid-range lightness to avoid white/pale/dark colors.
 * Picks a hue that maximizes distance from all existing act hues.
 *
 * @returns {{ bg: string, fg: string }} Color pair for the act badge.
 */
function generateDistinctColor() {
    const existingHues = [];
    for (const act of state.acts.values()) {
        const hue = hexToHue(act.color.bg);
        if (hue !== null) existingHues.push(hue);
    }

    let bestHue;
    if (existingHues.length === 0) {
        // First act: random hue
        bestHue = Math.floor(Math.random() * 360);
    } else {
        // Find the hue with maximum minimum distance from all existing hues
        bestHue = 0;
        let bestDist = 0;
        for (let candidate = 0; candidate < 360; candidate += 5) {
            const minDist = Math.min(...existingHues.map(h => hueDistance(candidate, h)));
            if (minDist > bestDist) {
                bestDist = minDist;
                bestHue = candidate;
            }
        }
        // Add some jitter so it's not perfectly predictable
        bestHue = (bestHue + Math.floor(Math.random() * 15) - 7 + 360) % 360;
    }

    const saturation = 65 + Math.floor(Math.random() * 20); // 65-85%
    const lightness = 50 + Math.floor(Math.random() * 15);  // 50-65%

    const bg = hslToHex(bestHue, saturation, lightness);
    const fg = getLuminance(bg.replace('#', '')) > 0.4 ? '#272822' : '#fff';
    return { bg, fg };
}

/**
 * Circular distance between two hues (0-360).
 */
function hueDistance(a, b) {
    const diff = Math.abs(a - b);
    return Math.min(diff, 360 - diff);
}

/**
 * Extract approximate hue (0-360) from a hex color string.
 */
function hexToHue(hex) {
    const h = hex.replace('#', '');
    if (h.length < 6) return null;
    const r = Number.parseInt(h.slice(0, 2), 16) / 255;
    const g = Number.parseInt(h.slice(2, 4), 16) / 255;
    const b = Number.parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (delta === 0) return 0;
    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = Math.round(hue * 60);
    return (hue + 360) % 360;
}

/**
 * Convert HSL values to a hex color string.
 */
function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Assign entries to an act, removing them from any previous act.
 */
function assignEntriesToAct(actId, nums) {
    for (const num of nums) {
        const entry = state.entries.get(num);
        if (!entry) continue;
        if (entry.actId && entry.actId !== actId) {
            const oldAct = state.acts.get(entry.actId);
            if (oldAct) oldAct.entryNums.delete(num);
        }
        entry.actId = actId;
    }
}

/**
 * Auto-create an act and assign entry numbers to it.
 * Used by part-based ingestion to auto-generate acts from file structure.
 *
 * @param {string} actName - Name for the act (e.g., "Part 1").
 * @param {number[]} entryNums - Entry numbers to assign.
 * @returns {number} The created act ID.
 */
export function autoCreateAct(actName, entryNums) {
    const actId = buildAndRegisterAct(actName, entryNums);
    assignEntriesToAct(actId, entryNums);
    return actId;
}

/**
 * Undo the most recent act creation (legacy, kept for backward compat).
 */
export function undoLastAct() {
    if (state.undoStack.length === 0) return;
    const action = state.undoStack.pop();
    if (action.type === 'create-act') {
        const act = state.acts.get(action.actId);
        if (act) {
            for (const num of act.entryNums) {
                const entry = state.entries.get(num);
                if (entry) entry.actId = null;
            }
            state.acts.delete(action.actId);
        }
    }
    refreshActUI();
    persistState();
}

/**
 * Delete a specific act after user confirmation.
 */
export function deleteAct(actId) {
    if (!confirm('Delete this act? Entries will become unassigned.')) return;

    const act = state.acts.get(actId);
    if (!act) return;

    const snap = snapshotState();
    const actName = act.name;

    for (const num of act.entryNums) {
        const entry = state.entries.get(num);
        if (entry) entry.actId = null;
    }
    state.acts.delete(actId);

    if (state.selectedActId === actId) state.selectedActId = null;

    state.lastAction = {
        description: `Delete act "${actName}"`,
        undo: () => {
            restoreSnapshot(snap);
            refreshActUI();
            persistState();
            updateUndoButton();
        },
    };
    updateUndoButton();
    refreshActUI();
    persistState();
}

/**
 * Render the act management panel (left side list).
 */
export function renderActPanel() {
    const $list = $('#se-act-list');
    $list.empty();
    $('#se-act-count').text(state.acts.size);

    if (state.acts.size === 0) {
        $list.append('<div style="padding:12px 20px;color:#75715e;">No acts created yet.</div>');
        renderActDetail(null);
        return;
    }

    for (const act of state.acts.values()) {
        const html = fillTemplate(actItemTemplate, {
            actId: act.id,
            colorBg: act.color.bg,
            colorFg: act.color.fg,
            nameHtml: escHtml(act.name),
            nameAttr: escAttr(act.name),
        });

        $list.append(html);
    }

    bindActPanelEvents($list);

    // Auto-select first act if none selected
    if (!state.selectedActId || !state.acts.has(state.selectedActId)) {
        state.selectedActId = state.acts.keys().next().value || null;
    }
    highlightSelectedAct();
    renderActDetail(state.selectedActId);
}

/**
 * Render the act detail panel (right side).
 *
 * @param {number|null} actId - The act to show details for.
 */
function renderActDetail(actId) {
    const $detail = $('#se-act-detail');
    if (!actId || !state.acts.has(actId)) {
        $detail.html('<div class="se-act-detail-empty" style="padding:40px;text-align:center;color:#75715e;">Select an act to see details</div>');
        return;
    }

    const act = state.acts.get(actId);
    const nums = [...act.entryNums].sort((a, b) => a - b);
    const segments = countSegments(nums);
    const actTokens = nums.reduce((sum, n) => {
        const e = state.entries.get(n);
        return sum + (e ? Math.ceil(e.content.length / 4) : 0);
    }, 0);

    let entriesHtml = '';
    for (const num of nums) {
        const entry = state.entries.get(num);
        if (!entry) continue;
        const preview = entry.content.length > 80 ? entry.content.slice(0, 80) + '...' : entry.content;
        entriesHtml += `<div><span style="color:#75715e;">#${num}</span> &mdash; ${escHtml(preview)}</div>`;
    }

    $detail.html(
        `<div class="se-act-detail-title">&#9632; ${escHtml(act.name)}</div>` +
        `<div class="se-act-entries-mini">` +
        `Range: #${nums[0] || '?'}\u2013#${nums.at(-1) || '?'} (${nums.length} entr${nums.length !== 1 ? 'ies' : 'y'}) &nbsp;|&nbsp; ${segments} segment${segments !== 1 ? 's' : ''} &nbsp;|&nbsp; ~${actTokens.toLocaleString()} tok</div>` +
        `<div class="se-act-notes-label">Act Notes</div>` +
        `<textarea class="se-act-notes-input" data-act-notes="${actId}" placeholder="Notes about this act (UI only, not exported)...">${escHtml(act.notes)}</textarea>` +
        `<div style="margin-top:20px;">` +
        `<div class="se-act-notes-label">Entries in this Act</div>` +
        `<div style="font-size:0.82em;color:#ccc;line-height:1.8;max-height:200px;overflow-y:auto;">${entriesHtml}</div>` +
        `</div>`
    );

    // Bind notes change
    $detail.find('.se-act-notes-input').on('change', function () {
        const oldNotes = act.notes;
        const newNotes = $(this).val();
        act.notes = newNotes;
        state.lastAction = {
            description: `Edit notes for act "${act.name}"`,
            undo: () => { act.notes = oldNotes; renderActDetail(actId); persistState(); updateUndoButton(); },
        };
        updateUndoButton();
        persistState();
    });
}

/**
 * Count contiguous segments in a sorted array of numbers.
 */
function countSegments(nums) {
    if (nums.length === 0) return 0;
    let segs = 1;
    for (let i = 1; i < nums.length; i++) {
        if (nums[i] !== nums[i - 1] + 1) segs++;
    }
    return segs;
}

/**
 * Highlight the currently selected act in the list.
 */
function highlightSelectedAct() {
    $('.se-act-item').removeClass('se-selected-act');
    if (state.selectedActId) {
        $(`.se-act-item[data-act-id="${state.selectedActId}"]`).addClass('se-selected-act');
    }
}

/**
 * Render the horizontal act mini-map strip (used in Review tab stats bar).
 */
export function renderActMinimap() {
    // This is now handled by renderStatsBar in table.js
    // Keeping for backward compatibility if called
}

/**
 * Build and render the full minimap overlay grid.
 */
export function buildMinimapOverlay() {
    const $grid = $('#se-minimap-grid');
    const $legend = $('#se-minimap-legend');
    $grid.empty();
    $legend.empty();

    if (state.entries.size === 0) return;

    const allNums = [...state.entries.keys()];
    const maxNum = Math.max(...allNums, ...state.gaps);

    for (let i = 1; i <= maxNum; i++) {
        const entry = state.entries.get(i);
        const isGap = state.gaps.includes(i);

        const cell = document.createElement('div');
        cell.className = 'se-minimap-cell';
        cell.textContent = i;
        cell.dataset.num = i;

        if (isGap) {
            cell.className += ' se-gap-cell';
            cell.textContent = '?';
        } else if (entry) {
            if (entry.actId) {
                const act = state.acts.get(entry.actId);
                if (act) {
                    cell.style.background = act.color.bg;
                    cell.style.color = act.color.fg;
                }
            } else {
                cell.className += ' se-unassigned';
            }
        } else {
            continue; // Skip numbers that are neither entries nor gaps
        }

        $grid.append(cell);
    }

    // Build legend
    const legendItems = [];
    for (const act of state.acts.values()) {
        legendItems.push(
            `<div class="se-legend-item"><div class="se-legend-swatch" style="background:${act.color.bg};"></div> ${escHtml(act.name)}</div>`
        );
    }
    // Unassigned legend item — plain label only (assign controls are in the cell popover)
    const unassignedCount = [...state.entries.values()].filter(e => !e.actId).length;
    if (unassignedCount > 0) {
        legendItems.push(
            `<div class="se-legend-item">` +
            `<div class="se-legend-swatch" style="background:#555;"></div>` +
            `Unassigned (${unassignedCount})` +
            `</div>`
        );
    }
    legendItems.push('<div class="se-legend-item"><div class="se-legend-swatch" style="background:repeating-linear-gradient(45deg,#fd971f,#fd971f 2px,transparent 2px,transparent 4px);"></div> Gap</div>');
    $legend.html(legendItems.join(''));

    bindMinimapEvents($grid);
    // Respect the active view (timeline or location-bubbles)
    if (_timelineRenderer) {
        _timelineRenderer();
    } else {
        buildTimelineDiagram();
    }
}

// ─── Mindmap / Timeline Helpers ────────────────────────────────

/** Parse a date string, returning null if invalid. */
function tlParseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Horizontal Timeline ─────────────────────────────────────────

/**
 * Optional canvas-render override set by the view toggle in index.js.
 * If non-null, buildMinimapOverlay calls this instead of buildTimelineDiagram.
 * @type {Function|null}
 */
let _timelineRenderer = null;

/**
 * Register a custom function to re-render the timeline canvas.
 * Pass null to restore the default timeline diagram.
 * @param {Function|null} fn
 */
export function setTimelineRenderer(fn) {
    _timelineRenderer = fn;
}

/**
 * Build a horizontal timeline diagram from entries.
 *
 * Layout rules:
 * - A horizontal axis runs across the canvas (Y position is computed
 *   dynamically to leave room for cards above and below).
 * - Undated entries: grouped by act, always rendered ABOVE the axis.
 * - Dated entries: grouped by calendar MONTH (not exact date).
 *   Within a month the entries are sorted date → time ascending.
 *   Month groups alternate BELOW / ABOVE the axis (first group below,
 *   second above, third below, …) to avoid stacks clipping one another.
 * - Canvas height accommodates the tallest top-stack and tallest bottom-stack.
 */
export async function buildTimelineDiagram() {
    const $canvas = $('#se-timeline-canvas');
    $canvas.empty();
    $canvas.css({ position: 'relative', overflow: 'visible' });

    if (state.entries.size === 0) {
        $canvas.html('<div style="color:#75715e;padding:20px;text-align:center;">No entries to map</div>');
        return;
    }

    const CARD_W    = 200;
    const CARD_H    = 54;
    const CARD_GAP  = 5;
    const COL_GAP   = 28;    // gap between adjacent column centres
    const TICK      = 14;    // tick length on each side of axis
    const LABEL_GAP = 28;    // extra space between axis and the start of bottom cards
                              // (leaves room for top-column date labels below the axis)
    const MARGIN    = 52;
    const ABOVE_PAD = 24;    // padding above the topmost top-stack card
    const MS_DAY    = 86400000;
    const MAX_DAYS  = 365 * 15;
    const MAX_EXTENT = 1800;

    const all     = [...state.entries.values()].sort((a, b) => a.num - b.num);
    const dated   = all.filter(e => e.date);
    const undated = all.filter(e => !e.date);

    // ── Undated: group by act (always rendered top / above axis) ──
    const undatedColMap = new Map();
    for (const e of undated) {
        const key = e.actId ?? 'none';
        if (!undatedColMap.has(key)) undatedColMap.set(key, []);
        undatedColMap.get(key).push(e);
    }
    const undatedCols = [...undatedColMap.entries()]
        .map(([key, entries]) => ({
            act:     key !== 'none' ? state.acts.get(key) ?? null : null,
            entries: entries.sort((a, b) => a.num - b.num),
            side:    'top',
        }))
        .sort((a, b) => a.entries[0].num - b.entries[0].num);

    // ── Dated: group by YYYY-MM (month) ───────────────────────
    const monthMap = new Map();
    for (const e of dated) {
        const d   = tlParseDate(e.date);
        const key = d
            ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            : e.date.slice(0, 7);
        if (!monthMap.has(key)) monthMap.set(key, []);
        monthMap.get(key).push(e);
    }
    const dateGroups = [...monthMap.entries()].map(([monthKey, entries]) => {
        // Sort by date then time within the month
        entries.sort((a, b) => {
            const dc = a.date.localeCompare(b.date);
            return dc !== 0 ? dc : (a.time || '').localeCompare(b.time || '');
        });
        const rep = tlParseDate(entries[0].date);
        return {
            monthKey,
            ts:    rep ? rep.getTime() : 0,
            entries,
            label: rep
                ? rep.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                : monthKey,
        };
    }).sort((a, b) => a.ts - b.ts);

    // ── Alternate dated groups top / bottom ────────────────────
    // First group → bottom, second → top, third → bottom, …
    // This prevents adjacent month stacks clipping each other.
    for (let i = 0; i < dateGroups.length; i++) {
        dateGroups[i].side = i % 2 === 0 ? 'bottom' : 'top';
    }

    // ── Baseline = median timestamp ────────────────────────────
    const baseline = dateGroups.length > 0
        ? dateGroups[Math.floor(dateGroups.length / 2)].ts
        : 0;

    // ── Assign raw X offsets (origin = undated-cluster centre) ──
    let maxDiff = 1;
    for (const g of dateGroups) {
        const d = Math.abs(g.ts - baseline) / MS_DAY;
        if (d > maxDiff) maxDiff = d;
    }
    for (const g of dateGroups) {
        const days = (g.ts - baseline) / MS_DAY;
        const sign = days >= 0 ? 1 : -1;
        const t    = Math.min(Math.sqrt(Math.abs(days) / Math.max(maxDiff, MAX_DAYS / 4)), 1);
        g.rawX     = sign * t * MAX_EXTENT / 2;
    }

    // Enforce minimum column spacing on each side
    const left  = dateGroups.filter(g => g.rawX < 0).sort((a, b) => b.rawX - a.rawX);
    const right = dateGroups.filter(g => g.rawX >= 0).sort((a, b) => a.rawX - b.rawX);
    const minSpacing = CARD_W + COL_GAP;
    for (let i = 1; i < right.length; i++) {
        if (right[i].rawX - right[i-1].rawX < minSpacing)
            right[i].rawX = right[i-1].rawX + minSpacing;
    }
    for (let i = 1; i < left.length; i++) {
        if (left[i-1].rawX - left[i].rawX < minSpacing)
            left[i].rawX = left[i-1].rawX - minSpacing;
    }

    // ── Undated cluster centre X (origin = 0) ─────────────────
    const clusterW = undatedCols.length > 0
        ? undatedCols.length * (CARD_W + COL_GAP) - COL_GAP
        : 0;
    let colX = -clusterW / 2;
    for (const col of undatedCols) {
        col.centreX = colX + CARD_W / 2;
        colX += CARD_W + COL_GAP;
    }

    // ── Stack heights ──────────────────────────────────────────
    const colHeight = col => Math.max(0, col.entries.length * (CARD_H + CARD_GAP) - CARD_GAP);
    for (const col of undatedCols) col.stackH = colHeight(col);
    for (const g   of dateGroups)  g.stackH   = colHeight(g);

    // ── Max top / bottom stack heights ─────────────────────────
    let maxTopH    = 0;
    let maxBottomH = 0;
    for (const col of undatedCols) maxTopH = Math.max(maxTopH, col.stackH);
    for (const g of dateGroups) {
        if (g.side === 'top') maxTopH    = Math.max(maxTopH, g.stackH);
        else                  maxBottomH = Math.max(maxBottomH, g.stackH);
    }

    // ── Axis Y is placed to leave room for everything above ────
    // ABOVE_PAD + maxTopH + TICK = space needed above axis
    // An extra 24px provides room for the "Undated / Past / Future" labels
    const AXIS_Y  = MARGIN + ABOVE_PAD + maxTopH + TICK + 24;
    const canvasH = AXIS_Y + TICK + LABEL_GAP + maxBottomH + MARGIN;

    // ── Bounding box X ─────────────────────────────────────────
    let minX = -clusterW / 2 - MARGIN;
    let maxX =  clusterW / 2 + MARGIN;
    for (const g of dateGroups) {
        minX = Math.min(minX, g.rawX - CARD_W / 2 - MARGIN);
        maxX = Math.max(maxX, g.rawX + CARD_W / 2 + MARGIN);
    }
    const originX = -minX + MARGIN;
    const canvasW = maxX - minX + MARGIN;

    // ── Draw ──────────────────────────────────────────────────
    const svgParts  = [];
    const htmlParts = [];
    const cardCenters = {};

    // Axis line
    svgParts.push(
        `<line x1="0" y1="${AXIS_Y}" x2="${canvasW}" y2="${AXIS_Y}" stroke="#3e3d32" stroke-width="1.5" opacity="0.9"/>`
    );
    if (dateGroups.length > 0) {
        svgParts.push(`<text x="8" y="${AXIS_Y - 8}" fill="#555" font-size="10" font-family="monospace">← Past</text>`);
        svgParts.push(`<text x="${canvasW - 8}" y="${AXIS_Y - 8}" fill="#555" font-size="10" font-family="monospace" text-anchor="end">Future →</text>`);
    }
    if (undatedCols.length > 0) {
        svgParts.push(
            `<text x="${originX}" y="${AXIS_Y - 8}" fill="#75715e" font-size="10" font-family="monospace" text-anchor="middle">Undated</text>`
        );
    }

    /**
     * Draw one column (undated or month-group) on either side of the axis.
     * @param {number}  centreX    - raw X offset from origin (before adding originX)
     * @param {Array}   entries    - entry objects, sorted for this column
     * @param {string}  color      - hex colour for tick, label, and card accent
     * @param {string}  labelText  - column header text (act name or "Mar 2013")
     * @param {boolean} isDate     - true for dated columns (show time/act pills)
     * @param {'top'|'bottom'} side - which side of the axis to draw on
     */
    function drawCol(centreX, entries, color, labelText, isDate, side) {
        const cx    = centreX + originX;
        const isTop = side === 'top';

        // Tick — goes upward for top, downward for bottom
        const tickY2 = isTop ? AXIS_Y - TICK : AXIS_Y + TICK;
        svgParts.push(
            `<line x1="${cx}" y1="${AXIS_Y}" x2="${cx}" y2="${tickY2}" stroke="${color}" stroke-width="2" opacity="0.7"/>`
        );

        // Label:
        //   bottom columns → label sits just above the axis (between axis and empty space above)
        //   top    columns → label sits just below the axis (in the LABEL_GAP space before bottom cards)
        const labelY = isTop
            ? AXIS_Y + 17           // below axis, inside the LABEL_GAP buffer
            : AXIS_Y - 20;          // above axis
        svgParts.push(
            `<text x="${cx}" y="${labelY}" fill="${color}" font-size="10" font-weight="700" ` +
            `font-family="monospace" text-anchor="middle" dominant-baseline="auto">${escHtml(labelText)}</text>`
        );

        // Cards — stacked in the correct direction
        entries.forEach((entry, i) => {
            let top;
            if (isTop) {
                // Stack grows upward: card 0 is closest to axis
                top = AXIS_Y - TICK - (i + 1) * CARD_H - i * CARD_GAP;
            } else {
                // Stack grows downward: card 0 is closest to axis
                top = AXIS_Y + TICK + LABEL_GAP + i * (CARD_H + CARD_GAP);
            }
            const cy       = top + CARD_H / 2;
            const cardLeft = cx - CARD_W / 2;

            // Spoke from tick end to the near edge of the nearest card
            const spokeFrom = isTop ? AXIS_Y - TICK : AXIS_Y + TICK;
            const spokeTo   = isTop ? top + CARD_H  : top;
            svgParts.push(
                `<line x1="${cx}" y1="${spokeFrom}" x2="${cx}" y2="${spokeTo}" stroke="${color}" stroke-width="1" opacity="0.15"/>`
            );

            const content = entry.content
                ? escHtml(entry.content.slice(0, 68)) + (entry.content.length > 68 ? '…' : '')
                : '<span style="color:#555;">empty</span>';
            const pills = [];
            if (isDate && entry.time) pills.push(`<span class="se-mm-pill">${escHtml(entry.time)}</span>`);
            if (entry.location)       pills.push(`<span class="se-mm-pill">${escHtml(entry.location)}</span>`);
            if (isDate && entry.actId) {
                const a = state.acts.get(entry.actId);
                if (a) pills.push(`<span class="se-mm-pill" style="background:${a.color.bg};color:${a.color.fg};">${escHtml(a.name)}</span>`);
            }
            htmlParts.push(
                `<div class="se-mm-card" style="top:${top}px;left:${cardLeft}px;width:${CARD_W}px;--mm-c:${color};" data-num="${entry.num}">` +
                `<div class="se-mm-card-head"><span class="se-mm-card-num" style="color:${color};">#${entry.num}</span>` +
                `<span class="se-mm-card-text">${content}</span></div>` +
                (pills.length ? `<div class="se-mm-card-tags">${pills.join('')}</div>` : '') +
                `</div>`
            );
            cardCenters[entry.num] = { cx, cy };
        });
    }

    // Draw undated columns (always top)
    for (const col of undatedCols) {
        const color = col.act ? col.act.color.bg : '#666';
        const label = col.act ? col.act.name : 'Unassigned';
        drawCol(col.centreX, col.entries, color, label, false, 'top');
    }

    // Draw dated month groups (alternating top/bottom)
    for (const g of dateGroups) {
        drawCol(g.rawX, g.entries, '#a6e22e', g.label, true, g.side);
    }

    // Causality arrows
    const arrowMarker = `<defs><marker id="causal-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#ae81ff" opacity="0.8"/></marker></defs>`;
    for (const [effectStr, causes] of Object.entries(state.causality)) {
        const eTo = cardCenters[Number(effectStr)];
        if (!eTo) continue;
        for (const causeNum of causes) {
            const eFrom = cardCenters[causeNum];
            if (!eFrom) continue;
            const cpX = (eFrom.cx + eTo.cx) / 2;
            const cpY = Math.min(eFrom.cy, eTo.cy) - 28;
            svgParts.push(
                `<path d="M${eFrom.cx},${eFrom.cy} Q${cpX},${cpY} ${eTo.cx},${eTo.cy}" ` +
                `stroke="#ae81ff" stroke-width="1.5" fill="none" stroke-dasharray="5,3" opacity="0.7" marker-end="url(#causal-arrow)"/>`
            );
        }
    }

    const svgEl = `<svg class="se-mm-svg" xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" style="position:absolute;top:0;left:0;pointer-events:none;">${arrowMarker}${svgParts.join('')}</svg>`;
    $canvas.html(svgEl + htmlParts.join(''));
    $canvas.css({ width: canvasW + 'px', height: canvasH + 'px' });

    // Scroll to centre the undated cluster
    requestAnimationFrame(() => {
        const $vp = $('#se-timeline-viewport');
        $vp[0].scrollLeft = originX - $vp.width() / 2;
        $vp[0].scrollTop  = 0;
    });
}

/**
 * Toggle the minimap overlay visibility.
 */
export function toggleMinimap() {
    const $overlay = $('#se-minimap-overlay');
    $overlay.toggleClass('open');
    if ($overlay.hasClass('open')) {
        buildMinimapOverlay();
    }
    closeAllPopovers();
}

/**
 * Close all floating popovers (cell popover, gap popover).
 */
export function closeAllPopovers() {
    $('#se-cell-popover').hide();
    $('#se-gap-popover').hide();
    closeColorPicker();
}

/**
 * Update the act filter dropdown with current act names.
 */
export function updateFilterDropdown() {
    const $filter = $('#se-filter');
    const current = $filter.val();

    $filter.find('option').not('[value="all"],[value="unassigned"],[value="gaps"]').remove();

    for (const act of state.acts.values()) {
        $filter.append(`<option value="${act.id}">Act: ${escHtml(act.name)}</option>`);
    }

    if ($filter.find(`option[value="${current}"]`).length) {
        $filter.val(current);
    } else {
        $filter.val('all');
        state.filterAct = 'all';
    }
}

/**
 * Update the bulk act assign dropdown in the selection bar.
 */
export function updateBulkActDropdown() {
    const $select = $('#se-bulk-act-assign');
    $select.find('option').not(':first').remove();

    for (const act of state.acts.values()) {
        $select.append(`<option value="${act.id}">${escHtml(act.name)}</option>`);
    }
    $select.append('<option value="new" style="color:#a6e22e;">+ New Act...</option>');
}

/**
 * Update tab badges with current counts.
 */
export function updateTabBadges() {
    const fileCount = state.files.length;
    const entryCount = state.entries.size;
    const actCount = state.acts.size;

    $('#se-tab-badge-ingest').text(fileCount > 0 ? `${fileCount} file${fileCount !== 1 ? 's' : ''}` : '');
    $('#se-tab-badge-review').text(entryCount > 0 ? `${entryCount} entries` : '');
    $('#se-tab-badge-acts').text(actCount > 0 ? `${actCount} group${actCount !== 1 ? 's' : ''}` : '');
}

// ─── Internal Helpers ────────────────────────

function getExistingActMins() {
    const mins = [];
    for (const act of state.acts.values()) {
        const actNums = [...act.entryNums];
        if (actNums.length) mins.push(Math.min(...actNums));
    }
    return mins;
}

function removeEmptyActs() {
    for (const [id, act] of state.acts) {
        if (act.entryNums.size === 0) state.acts.delete(id);
    }
}


/**
 * Bind events on the act panel list items.
 */
function bindActPanelEvents($list) {
    // Act item click → select act
    $list.find('.se-act-item').on('click', function (e) {
        if ($(e.target).is('input, button, .se-color-swatch, .se-hex-input')) return;
        state.selectedActId = Number.parseInt($(this).data('act-id'), 10);
        highlightSelectedAct();
        renderActDetail(state.selectedActId);
    });

    // Rename
    $list.find('.se-act-name-input[data-act-id]').on('change', function () {
        const actId = Number.parseInt($(this).data('act-id'), 10);
        const act = state.acts.get(actId);
        if (act) {
            const oldName = act.name;
            const newName = $(this).val().trim() || act.name;
            if (newName === oldName) return;
            act.name = newName;
            state.lastAction = {
                description: `Rename act "${oldName}" → "${newName}"`,
                undo: () => { act.name = oldName; refreshActUI(); persistState(); updateUndoButton(); },
            };
            updateUndoButton();
            refreshActUI();
            persistState();
        }
    });

    // Delete
    $list.find('[data-delete-act]').on('click', function () {
        deleteAct(Number.parseInt($(this).data('delete-act'), 10));
    });

    // Color picker — open iro.js picker on badge click
    $list.find('[data-color-picker]').on('click', function (e) {
        e.stopPropagation();
        const actId = Number.parseInt($(this).data('color-picker'), 10);
        const act = state.acts.get(actId);
        if (!act) return;
        openColorPicker(this, act.color.bg, actId, (hex) => {
            const fg = getLuminance(hex.replace('#', '')) > 0.4 ? '#272822' : '#fff';
            applyActColor(actId, hex, fg);
        });
    });
}

/**
 * Apply a new color to an act and refresh UI.
 */
export function applyActColor(actId, bg, fg) {
    const act = state.acts.get(actId);
    if (!act) return;
    act.color = { bg, fg };
    refreshActUI();
    persistState();
}

/**
 * Calculate relative luminance from a hex color string.
 */
export function getLuminance(hex) {
    const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
    const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
    const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Show a dialog to customize all act colors.
 * Chips at top, divider, shared iro.js wheel below.
 * Clicking a chip selects it; the wheel controls the selected chip.
 */
export async function showActColorDialog() {
    if (state.acts.size === 0) return;

    const firstAct = state.acts.values().next().value;
    const [panelTmpl, itemTmpl] = await Promise.all([
        loadTemplate(TEMPLATES.DIALOG_COLOR_PICKER),
        loadTemplate(TEMPLATES.ACD_ITEM),
    ]);

    const listHtml = [...state.acts.values()].map(act => {
        const isFirst = act.id === firstAct.id;
        return fillTemplate(itemTmpl, {
            selCls:    isFirst ? ' se-acd-selected' : '',
            id:        act.id,
            selBorder: isFirst ? ` style="border-left-color:${act.color.bg};"` : '',
            bg:        act.color.bg,
            name:      escHtml(act.name),
            count:     act.entryNums.size,
        });
    }).join('');

    const html = fillTemplate(panelTmpl, { actListHtml: listHtml, firstColor: firstAct.color.bg });

    const overlay = document.getElementById('se-modal-overlay');
    const $dialog = $(html).appendTo(overlay);
    const dlgEl = $dialog[0];
    spawnPanel(dlgEl, overlay, '.se-float-panel-header');

    const picker = new iro.ColorPicker('#se-acd-wheel', {
        width: 220,
        color: firstAct.color.bg,
        borderWidth: 0,
        handleRadius: 7,
        layout: [
            { component: iro.ui.Box },
            { component: iro.ui.Slider, options: { sliderType: 'hue' } },
        ],
    });

    let selectedActId = firstAct.id;

    const getMode = () => $dialog.find('#se-acd-fmt').val() || 'hex';
    const $flds = () => $dialog.find('#se-acd-flds');

    // Render initial fields
    cpRenderFields(picker.color, getMode(), $flds());

    // Box/slider change → update swatch, preview, fields, row border accent
    picker.on('color:change', (color) => {
        const hex = color.hexString;
        const fg = getLuminance(hex.replace('#', '')) > 0.4 ? '#272822' : '#fff';
        const $row = $dialog.find(`.se-acd-item[data-acd-id="${selectedActId}"]`);
        $row.find('.se-acd-swatch').css('background', hex);
        $row.css('border-left-color', hex);
        $dialog.find('#se-acd-preview').css('background', hex);
        cpRenderFields(color, getMode(), $flds());
        applyActColor(selectedActId, hex, fg);
    });

    // Format dropdown → re-render fields without changing color
    $dialog.on('change', '#se-acd-fmt', () => {
        cpRenderFields(picker.color, getMode(), $flds());
    });

    // Field input → push back into picker
    $dialog.on('input', '.se-cp-field', () => {
        cpApplyFields(picker.color, getMode(), $flds());
    });

    // Click a row → select it, update picker to its color
    $dialog.on('click', '.se-acd-item', function () {
        const actId = Number.parseInt($(this).data('acd-id'), 10);
        const act = state.acts.get(actId);
        if (!act) return;

        selectedActId = actId;
        $dialog.find('.se-acd-item')
            .removeClass('se-acd-selected')
            .css('border-left-color', '');
        $(this).addClass('se-acd-selected').css('border-left-color', act.color.bg);

        picker.color.hexString = act.color.bg;
        $dialog.find('#se-acd-preview').css('background', act.color.bg);
        cpRenderFields(picker.color, getMode(), $flds());
    });

    const cleanup = () => {
        $dialog.remove();
        renderStatsBar();
    };

    $dialog.find('.se-dialog-ok, .se-dialog-close').on('click', cleanup);
}

/**
 * Bind click events on minimap cells.
 */
// ─── Entry Selector Grid ────────────────────────

/**
 * Show a grid dialog for selecting entries and assigning them to acts.
 * Each entry is a small numbered square colored by its current act.
 * User selects entries, then clicks an action pill to assign/create/clear.
 */
export async function showEntrySelector() {
    if (state.entries.size === 0) return;

    const selected = new Set();
    const allNums = [...state.entries.keys()].sort((a, b) => a - b);

    const [panelTmpl, cellTmpl, pillTmpl] = await Promise.all([
        loadTemplate(TEMPLATES.DIALOG_ENTRY_SELECTOR),
        loadTemplate(TEMPLATES.ESG_CELL),
        loadTemplate(TEMPLATES.ESG_PILL),
    ]);

    function buildGrid() {
        return allNums.map(num => {
            const entry = state.entries.get(num);
            const act = entry?.actId ? state.acts.get(entry.actId) : null;
            return fillTemplate(cellTmpl, {
                selCls: selected.has(num) ? ' se-esg-selected' : '',
                num,
                bg:     act ? act.color.bg : '#3e3d32',
                fg:     act ? act.color.fg : '#888',
                title:  escHtml(`#${num}${act ? ' — ' + act.name : ' — Unassigned'}`),
            });
        }).join('');
    }

    function buildPills() {
        const actPills = [...state.acts.values()].map(act =>
            fillTemplate(pillTmpl, {
                extraCls:  '',
                dataAttr:  `data-esg-act="${act.id}"`,
                style:     `background:${act.color.bg};color:${act.color.fg};`,
                label:     escHtml(act.name),
            })
        ).join('');
        const newPill  = fillTemplate(pillTmpl, { extraCls: ' se-esg-pill-new',   dataAttr: 'data-esg-action="new"',   style: '', label: '+ New Act' });
        const clearPill = fillTemplate(pillTmpl, { extraCls: ' se-esg-pill-clear', dataAttr: 'data-esg-action="clear"', style: '', label: 'Clear' });
        return actPills + newPill + clearPill;
    }

    const html = fillTemplate(panelTmpl, { gridHtml: buildGrid(), pillsHtml: buildPills() });

    const overlay = document.getElementById('se-modal-overlay');
    const $dialog = $(html).appendTo(overlay);
    const dlgEl = $dialog[0];
    spawnPanel(dlgEl, overlay, '.se-float-panel-header');

    function updateCount() {
        $dialog.find('#se-esg-count').text(`${selected.size} selected`);
    }

    function refreshGrid() {
        $dialog.find('#se-esg-grid').html(buildGrid());
        updateCount();
    }

    // Drag-stroke selection: pointerdown starts a select/deselect mode,
    // dragging over cells applies it. Clicking a single cell still works.
    let dragMode = null; // 'select' | 'deselect'
    let dragTouched = new Set();

    function touchCell(num, $cell) {
        if (dragTouched.has(num)) return;
        dragTouched.add(num);
        if (dragMode === 'select') {
            selected.add(num);
            $cell.addClass('se-esg-selected');
        } else {
            selected.delete(num);
            $cell.removeClass('se-esg-selected');
        }
        updateCount();
    }

    $dialog.on('pointerdown', '.se-esg-cell', function (e) {
        e.preventDefault();
        const num = Number.parseInt($(this).data('esg-num'), 10);
        dragMode = selected.has(num) ? 'deselect' : 'select';
        dragTouched = new Set();
        touchCell(num, $(this));
        // Capture pointer on the grid so pointermove keeps firing during drag
        const grid = $dialog.find('#se-esg-grid')[0];
        if (grid?.setPointerCapture) grid.setPointerCapture(e.pointerId);
    });

    $dialog.on('pointermove', '#se-esg-grid', function (e) {
        if (!dragMode) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el) return;
        const $cell = $(el).closest('.se-esg-cell');
        if (!$cell.length) return;
        const num = Number.parseInt($cell.data('esg-num'), 10);
        if (!Number.isNaN(num)) touchCell(num, $cell);
    });

    $dialog.on('pointerup pointercancel', '#se-esg-grid', () => {
        dragMode = null;
        dragTouched = new Set();
    });

    // Select All / Clear / Unassigned
    $dialog.on('click', '#se-esg-all', () => {
        for (const n of allNums) selected.add(n);
        refreshGrid();
    });
    $dialog.on('click', '#se-esg-none', () => {
        selected.clear();
        refreshGrid();
    });
    $dialog.on('click', '#se-esg-unassigned', () => {
        if (selected.size === 0) {
            for (const n of allNums) selected.add(n);
        } else {
            const inverted = allNums.filter(n => !selected.has(n));
            selected.clear();
            for (const n of inverted) selected.add(n);
        }
        refreshGrid();
    });

    // Click an act pill → assign selected entries to that act
    $dialog.on('click', '[data-esg-act]', function () {
        if (selected.size === 0) return;
        const actId = Number.parseInt($(this).data('esg-act'), 10);
        const actName = state.acts.get(actId)?.name ?? `Act #${actId}`;
        const snap = snapshotState();
        assignEntriesToActById(actId, [...selected]);
        state.lastAction = {
            description: `Assign ${selected.size} entr${selected.size === 1 ? 'y' : 'ies'} to "${actName}"`,
            undo: () => { restoreSnapshot(snap); refreshActUI(); persistState(); updateUndoButton(); },
        };
        updateUndoButton();
        selected.clear();
        refreshGrid();
        $dialog.find('#se-esg-pills').html(buildPills());
    });

    // New Act pill → prompt for name, create, assign
    $dialog.on('click', '[data-esg-action="new"]', () => {
        if (selected.size === 0) return;
        const nums = [...selected];
        const defaultName = `Act ${state.nextActId}`;
        const name = prompt(`Name for new act (${nums.length} entries):`, defaultName);
        if (name === null) return;
        const snap = snapshotState();
        const actId = buildAndRegisterAct(name.trim() || defaultName, nums);
        assignEntriesToActById(actId, nums);
        state.lastAction = {
            description: `New act "${name.trim() || defaultName}" with ${nums.length} entr${nums.length === 1 ? 'y' : 'ies'}`,
            undo: () => { restoreSnapshot(snap); refreshActUI(); persistState(); updateUndoButton(); },
        };
        updateUndoButton();
        selected.clear();
        refreshGrid();
        $('#se-esg-pills').html(buildPills());
    });

    // Clear pill → unassign selected entries
    $dialog.on('click', '[data-esg-action="clear"]', () => {
        if (selected.size === 0) return;
        const snap = snapshotState();
        const count = selected.size;
        for (const num of selected) {
            const entry = state.entries.get(num);
            if (!entry) continue;
            if (entry.actId) {
                const act = state.acts.get(entry.actId);
                if (act) act.entryNums.delete(num);
                entry.actId = null;
            }
        }
        removeEmptyActs();
        state.lastAction = {
            description: `Unassign ${count} entr${count === 1 ? 'y' : 'ies'} from act`,
            undo: () => { restoreSnapshot(snap); refreshActUI(); persistState(); updateUndoButton(); },
        };
        updateUndoButton();
        persistState();
        selected.clear();
        refreshGrid();
        $('#se-esg-pills').html(buildPills());
    });

    const cleanup = () => {
        $dialog.remove();
        refreshActUI();
    };

    $dialog.find('.se-dialog-ok').on('click', cleanup);
}

/**
 * Assign entries to an act by ID, removing from previous acts.
 * @param {number} actId
 * @param {number[]} nums
 */
function assignEntriesToActById(actId, nums) {
    assignEntriesToAct(actId, nums);
    removeEmptyActs();
    persistState();
}

/** Prompt for a name, create an act, assign nums to it, then refresh UI. */
function createActForNums(nums) {
    if (nums.length === 0) return;
    const defaultName = `Act ${state.nextActId}`;
    const name = prompt(`Name for new act (${nums.length} entries):`, defaultName);
    if (name === null) return;
    const actId = buildAndRegisterAct(name.trim() || defaultName, nums);
    assignEntriesToActById(actId, nums);
    renderTable();
    renderActPanel();
    buildMinimapOverlay();
}

function bindMinimapEvents($grid) {
    $grid.find('.se-minimap-cell').on('click', function (e) {
        e.stopPropagation();
        closeAllPopovers();

        const num = Number.parseInt($(this).data('num'), 10);
        const isGap = $(this).hasClass('se-gap-cell');

        if (isGap) {
            showGapPopover(e, num);
        } else {
            showCellPopover(e, num);
        }
    });
}

/**
 * Show the cell content popover on a minimap cell click.
 */
function showCellPopover(e, num) {
    const entry = state.entries.get(num);
    if (!entry) return;

    const act = entry.actId ? state.acts.get(entry.actId) : null;
    const chips = ['date', 'time', 'location'].map(field => {
        const val = entry[field];
        const filled = val && val.trim() !== '';
        const cls = filled ? 'se-meta-chip filled' : 'se-meta-chip missing';
        const icon = filled ? '&#10003;' : '&#10007;';
        const label = field.charAt(0).toUpperCase() + field.slice(1);
        const text = filled ? (label + ': ' + escHtml(val)) : ('Needs ' + label);
        return `<span class="${cls}">${icon} ${text}</span>`;
    }).join('');

    let actHtml;
    if (act) {
        actHtml = `<span class="se-act-badge se-cell-popover-act" style="background:${act.color.bg};color:${act.color.fg};">${escHtml(act.name)}</span>`;
    } else if (state.acts.size === 0) {
        actHtml = `<button class="se-btn se-btn-sm se-pop-new-act-btn" data-num="${num}">+ New Act</button>`;
    } else {
        const opts = [...state.acts.values()]
            .map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`)
            .join('');
        actHtml = `<select class="se-pop-act-select" data-num="${num}">` +
            `<option value="">Assign…</option>${opts}` +
            `<option value="new">+ New Act</option></select>`;
    }

    let content = entry.content;
    if (content.length > 500) content = content.slice(0, 500) + '...';

    // Check for conflict highlights
    const conflicts = state.conflicts[num];
    let contentHtml = escHtml(content);
    if (conflicts && conflicts.length > 0) {
        // Apply inline conflict marks
        const sorted = [...conflicts].sort((a, b) => b.text.length - a.text.length);
        for (const c of sorted) {
            const cls = c.severity === 'error' ? 'se-conflict-mark'
                : c.severity === 'warning' ? 'se-conflict-mark-warn'
                    : 'se-conflict-mark-info';
            const escaped = escHtml(c.text);
            const idx = contentHtml.indexOf(escaped);
            if (idx >= 0) {
                contentHtml = contentHtml.slice(0, idx) +
                    `<span class="${cls}" title="${escAttr(c.reason)}">${escaped}</span>` +
                    contentHtml.slice(idx + escaped.length);
            }
        }
    }

    const $pop = $('#se-cell-popover');
    $pop.html(
        '<div class="se-cell-popover-header">' +
        '<div class="se-cell-popover-id">' +
        `<span class="se-cell-popover-num">#${num}</span>` +
        actHtml +
        '</div>' +
        '<button class="se-close-circle se-cell-popover-close">&times;</button>' +
        '</div>' +
        `<div class="se-cell-popover-content">${contentHtml}</div>` +
        '<hr class="se-cell-popover-divider">' +
        `<div class="se-cell-popover-tags">${chips}</div>`
    );

    const x = Math.min(e.clientX + 8, window.innerWidth - 400);
    const y = Math.min(e.clientY + 8, window.innerHeight - 300);
    $pop.css({ left: x, top: y }).show();
    makeDraggable($pop[0], $pop.find('.se-cell-popover-header')[0]);

    $pop.find('.se-cell-popover-close').on('click', () => closeAllPopovers());

    $pop.find('.se-pop-new-act-btn').on('click', function () {
        createActForNums([Number.parseInt($(this).data('num'), 10)]);
        closeAllPopovers();
    });

    $pop.find('.se-pop-act-select').on('change', function () {
        const val = $(this).val();
        const n = Number.parseInt($(this).data('num'), 10);
        if (!val) return;
        if (val === 'new') {
            createActForNums([n]);
        } else {
            assignEntriesToActById(Number.parseInt(val, 10), [n]);
            renderTable();
            renderActPanel();
            buildMinimapOverlay();
        }
        closeAllPopovers();
    });
}

/**
 * Show the gap popover on a minimap gap cell click.
 */
function showGapPopover(e, num) {
    const $pop = $('#se-gap-popover');
    $pop.html(
        '<button class="se-close-circle se-gap-popover-close">&times;</button>' +
        `<div class="se-gap-popover-title">\u26A0 Missing Entry #${num}</div>` +
        '<div class="se-gap-popover-actions">' +
        `<textarea class="se-gap-popover-input" id="se-gap-input-${num}" placeholder="Type or paste content for entry #${num}..."></textarea>` +
        `<button class="se-btn se-btn-primary se-btn-sm" id="se-gap-add-${num}">Add Entry</button>` +
        '<div class="se-gap-popover-or">\u2014 or \u2014</div>' +
        `<button class="se-btn se-btn-sm" id="se-gap-browse-${num}">\uD83D\uDCC2 Browse File for #${num}</button>` +
        '</div>'
    );

    const x = Math.min(e.clientX + 8, window.innerWidth - 340);
    const y = Math.min(e.clientY + 8, window.innerHeight - 260);
    $pop.css({ left: x, top: y }).show();
    makeDraggable($pop[0], $pop.find('.se-gap-popover-title')[0]);

    $pop.find('.se-gap-popover-close').on('click', () => closeAllPopovers());

    $pop.find(`#se-gap-add-${num}`).on('click', () => {
        const content = $(`#se-gap-input-${num}`).val().trim();
        if (!content) {
            alert('Please enter content for entry #' + num);
            return;
        }

        state.entries.set(num, {
            num,
            content,
            date: '',
            time: '',
            location: '',
            notes: '',
            actId: null,
            source: 'manual',
        });
        state.gaps = state.gaps.filter(g => g !== num);

        state.lastAction = {
            description: `Added missing entry #${num}`,
            undo: () => {
                state.entries.delete(num);
                state.gaps.push(num);
                refreshActUI();
            },
        };

        closeAllPopovers();
        refreshActUI();
        persistState();
    });

    $pop.find(`#se-gap-browse-${num}`).on('click', () => {
        // Trigger the file input for single-entry browse
        alert(`File picker for entry #${num} — use the Ingest tab to load files.`);
        closeAllPopovers();
    });
}

/**
 * Convenience: refresh all act-related UI components in one call.
 */
function refreshActUI() {
    updateFilterDropdown();
    updateBulkActDropdown();
    updateTabBadges();
    renderTable();
    renderActPanel();
    // Auto-refresh minimap/timeline if overlay is open
    if ($('#se-minimap-overlay').hasClass('open')) {
        buildMinimapOverlay();
    }
}
