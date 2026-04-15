/**
 * @module reorder
 * @description Entry reorder operations: move-to-position and swap.
 *
 * ## Move-to-Position
 * Moves one or more selected entries to before a target entry number.
 * All entries between source and target shift to fill the gap.
 *
 * ## Swap
 * Exchanges the position (entry number) of exactly two entries,
 * preserving all metadata (content, act, date, etc.).
 */

import { state, persistState } from '../core/state.js';
import { detectGaps } from '../ingest/gap-detection.js';
import { renderTable, renderSelectionBar } from './table.js';

/**
 * Move selected entries to before a target position.
 * Renumbers all entries to maintain a contiguous sequence.
 *
 * @param {number[]} selectedNums - Entry numbers to move (sorted).
 * @param {number} targetNum - The entry number to insert before.
 */
export function moveEntries(selectedNums, targetNum) {
    if (selectedNums.length === 0) return;

    // Build ordered list of all entry numbers
    const allNums = [...state.entries.keys()].sort((a, b) => a - b);

    // Remove selected entries from the list
    const remaining = allNums.filter(n => !selectedNums.includes(n));

    // Find insertion index in the remaining list
    let insertIdx = remaining.indexOf(targetNum);
    if (insertIdx === -1) {
        // Target might have been in the selected set; find nearest position
        insertIdx = remaining.findIndex(n => n >= targetNum);
        if (insertIdx === -1) insertIdx = remaining.length;
    }

    // Build the new order: remaining[0..insertIdx-1] + selected + remaining[insertIdx..]
    const newOrder = [
        ...remaining.slice(0, insertIdx),
        ...selectedNums,
        ...remaining.slice(insertIdx),
    ];

    // Renumber all entries sequentially starting from 1
    renumberEntries(newOrder);

    // Override with a clearer description using original entry numbers
    if (state.lastAction) {
        if (selectedNums.length === 1) {
            state.lastAction.description = `Moved entry #${selectedNums[0]} to before entry #${targetNum}`;
        } else {
            state.lastAction.description = `Moved entries #${selectedNums[0]}–#${selectedNums.at(-1)} to before entry #${targetNum}`;
        }
    }
}

/**
 * Swap the positions of exactly two entries.
 *
 * @param {number} numA - First entry number.
 * @param {number} numB - Second entry number.
 */
export function swapEntries(numA, numB) {
    const entryA = state.entries.get(numA);
    const entryB = state.entries.get(numB);
    if (!entryA || !entryB) return;

    // Save for undo
    const oldA = { ...entryA };
    const oldB = { ...entryB };

    // Swap: put A's content at B's number and vice versa
    state.entries.set(numA, { ...entryB, num: numA });
    state.entries.set(numB, { ...entryA, num: numB });

    // Update act entry sets
    updateActEntryNums(oldA.actId, numA, numB);
    updateActEntryNums(oldB.actId, numB, numA);

    state.lastAction = {
        description: `Swap entry #${numA} ↔ #${numB}`,
        undo: () => {
            state.entries.set(numA, { ...oldA, num: numA });
            state.entries.set(numB, { ...oldB, num: numB });
            // Restore act sets
            for (const act of state.acts.values()) {
                act.entryNums.delete(numA);
                act.entryNums.delete(numB);
            }
            if (oldA.actId) state.acts.get(oldA.actId)?.entryNums.add(numA);
            if (oldB.actId) state.acts.get(oldB.actId)?.entryNums.add(numB);
            detectGaps();
            renderTable();
            persistState();
        },
    };

    state.selected.clear();
    detectGaps();
    renderTable();
    renderSelectionBar();
    persistState();
}

/**
 * Update an act's entryNums set when an entry changes number.
 *
 * @param {number|null} actId - The act ID to update.
 * @param {number} oldNum - The old entry number to remove.
 * @param {number} newNum - The new entry number to add.
 */
function updateActEntryNums(actId, oldNum, newNum) {
    if (!actId) return;
    const act = state.acts.get(actId);
    if (!act) return;
    act.entryNums.delete(oldNum);
    act.entryNums.add(newNum);
}

/**
 * Renumber all entries based on a new ordering.
 * Rebuilds the entries Map with sequential numbering from 1.
 *
 * @param {number[]} orderedNums - Current entry numbers in desired order.
 */
function renumberEntries(orderedNums) {
    // Snapshot old entries and build undo data
    const oldEntries = new Map();
    for (const [num, entry] of state.entries) {
        oldEntries.set(num, { ...entry });
    }
    const oldActSets = new Map();
    for (const [id, act] of state.acts) {
        oldActSets.set(id, new Set(act.entryNums));
    }

    // Build new entries map
    const newEntries = new Map();
    const numMapping = new Map(); // oldNum → newNum

    orderedNums.forEach((oldNum, idx) => {
        const newNum = idx + 1;
        const entry = oldEntries.get(oldNum);
        if (!entry) return;
        numMapping.set(oldNum, newNum);
        newEntries.set(newNum, { ...entry, num: newNum });
    });

    // Update state
    state.entries = newEntries;

    // Update act entry sets
    for (const act of state.acts.values()) {
        const newSet = new Set();
        for (const oldNum of act.entryNums) {
            const newNum = numMapping.get(oldNum);
            if (newNum != null) newSet.add(newNum);
        }
        act.entryNums = newSet;
    }

    // Update selection
    const newSelected = new Set();
    for (const oldNum of state.selected) {
        const newNum = numMapping.get(oldNum);
        if (newNum != null) newSelected.add(newNum);
    }
    state.selected = newSelected;

    const moveDesc = numMapping.size === 1
        ? `Move entry #${[...numMapping.keys()][0]} to position #${[...numMapping.values()][0]}`
        : `Move ${numMapping.size} entries to new positions`;
    state.lastAction = {
        description: moveDesc,
        undo: () => {
            state.entries = oldEntries;
            for (const [id, nums] of oldActSets) {
                const act = state.acts.get(id);
                if (act) act.entryNums = nums;
            }
            state.selected.clear();
            detectGaps();
            renderTable();
            renderSelectionBar();
            persistState();
        },
    };

    detectGaps();
    renderTable();
    renderSelectionBar();
    persistState();
}

/**
 * Shift all entries with num > aboveNum upward by `count` positions.
 * Updates act entryNums, causality, gaps, selection, and state.modified.
 * Does NOT persist or re-render — caller must do so.
 *
 * @param {number} aboveNum - Entries strictly above this number get shifted.
 * @param {number} count - Number of positions to shift up.
 */
export function shiftEntriesUp(aboveNum, count) {
    shiftEntryKeys(aboveNum, count);
    shiftActEntryNums(aboveNum, count);
    shiftCausalityKeys(aboveNum, count);
    state.gaps     = state.gaps.map(g => (g > aboveNum ? g + count : g));
    state.selected = shiftNumSet(state.selected, aboveNum, count);
    state.modified = shiftNumSet(state.modified, aboveNum, count);
}

function shiftEntryKeys(aboveNum, count) {
    const keysDesc = [...state.entries.keys()].filter(k => k > aboveNum).sort((a, b) => b - a);
    for (const k of keysDesc) {
        const entry = state.entries.get(k);
        const newK = k + count;
        entry.num = newK;
        state.entries.set(newK, entry);
        state.entries.delete(k);
    }
}

function shiftActEntryNums(aboveNum, count) {
    for (const act of state.acts.values()) {
        const toAdd = [];
        for (const n of act.entryNums) {
            if (n > aboveNum) { act.entryNums.delete(n); toAdd.push(n + count); }
        }
        for (const n of toAdd) act.entryNums.add(n);
    }
}

function shiftCausalityKeys(aboveNum, count) {
    const causalKeysDesc = Object.keys(state.causality).map(Number)
        .filter(k => k > aboveNum).sort((a, b) => b - a);
    for (const k of causalKeysDesc) {
        state.causality[k + count] = state.causality[k];
        delete state.causality[k];
    }
    for (const k of Object.keys(state.causality)) {
        state.causality[k] = state.causality[k].map(c => (c > aboveNum ? c + count : c));
    }
}

function shiftNumSet(set, aboveNum, count) {
    const next = new Set();
    for (const n of set) next.add(n > aboveNum ? n + count : n);
    return next;
}

/**
 * Show the move-to-position dialog.
 * Prompts for a target entry number and moves selected entries before it.
 */
export function showMoveDialog() {
    const nums = [...state.selected].sort((a, b) => a - b);
    if (nums.length === 0) return;

    const label = nums.length === 1
        ? `Move entry #${nums[0]} to before which entry number?`
        : `Move ${nums.length} entries to before which entry number?`;

    const target = prompt(label);
    if (target === null) return;

    const targetNum = Number.parseInt(target, 10);
    if (Number.isNaN(targetNum) || targetNum < 1) {
        alert('Please enter a valid entry number.');
        return;
    }

    moveEntries(nums, targetNum);
}

/**
 * Show the swap dialog.
 * If exactly 2 entries are selected, swaps them immediately.
 * Otherwise prompts for the second entry number.
 */
export function showSwapDialog() {
    const nums = [...state.selected].sort((a, b) => a - b);

    if (nums.length === 2) {
        swapEntries(nums[0], nums[1]);
        return;
    }

    if (nums.length === 1) {
        const other = prompt(`Swap entry #${nums[0]} with which entry number?`);
        if (other === null) return;
        const otherNum = Number.parseInt(other, 10);
        if (Number.isNaN(otherNum) || !state.entries.has(otherNum)) {
            alert('Please enter a valid existing entry number.');
            return;
        }
        if (otherNum === nums[0]) return;
        swapEntries(nums[0], otherNum);
        return;
    }

    alert('Select exactly 1 or 2 entries to swap.');
}
