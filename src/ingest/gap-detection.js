/**
 * @module gap-detection
 * @description Scans the merged entry pool for missing numbers in the sequence.
 *
 * After ingestion, entries might have gaps (e.g., 1, 2, 3, 5 → #4 is missing).
 * This module finds those gaps so they can be displayed as warning rows in the table.
 *
 * ## How It Works
 * 1. Get all entry numbers and sort them
 * 2. Walk from the smallest to the largest
 * 3. Any integer not present in the entries Map is a "gap"
 * 4. Gaps are stored in `state.gaps` for the table renderer to show as placeholder rows
 */

import { state } from '../core/state.js';

/**
 * Scan `state.entries` for missing sequential numbers and update `state.gaps`.
 * Should be called after any ingestion or entry removal.
 *
 * @example
 * // If state.entries has keys [1, 2, 3, 5, 8]:
 * detectGaps();
 * // state.gaps → [4, 6, 7]
 */
export function detectGaps() {
    state.gaps = [];

    if (state.entries.size === 0) return;

    const nums = [...state.entries.keys()].sort((a, b) => a - b);
    const min = nums[0];
    const max = nums[nums.length - 1];

    for (let i = min; i <= max; i++) {
        if (!state.entries.has(i)) {
            state.gaps.push(i);
        }
    }
}
