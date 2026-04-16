/**
 * @module rag-reword
 * @description Experimental feature: rewrite summary entries for RAG retrieval clarity.
 *
 * ## How It Works
 * 1. User enables the "Reword for RAG" checkbox in the export panel
 * 2. Must also confirm "I understand this rewrites my content"
 * 3. Each entry is sent to ST's active model via a silent API call
 * 4. The model rewrites it as a single clear sentence for better RAG embedding
 * 5. Bracket metadata ([Date, Time | Location]) is preserved verbatim
 *
 * ## Error Handling
 * - If an API call fails for a specific entry, the original content is kept
 * - Failed entries are logged and reported in a summary alert after completion
 * - The progress bar shows real-time completion percentage
 */

import { state, persistState } from '../core/state.js';
import { renderTable } from '../table/table.js';
import { registerPrompt, getPrompt } from '../core/system-prompts.js';

const PROMPT_KEY = 'rag-reword';

registerPrompt(PROMPT_KEY, 'RAG Reword');

/**
 * Reword all entries using ST's active model for RAG optimization.
 * Shows a progress bar and handles per-entry failures gracefully.
 *
 * @returns {Promise<void>} Resolves when all entries have been processed.
 */
export async function rewordForRAG() {
    const sorted = [...state.entries.values()].sort((a, b) => a.num - b.num);
    const total = sorted.length;
    let completed = 0;
    const failures = [];

    showProgress(true);
    updateProgressBar(0);

    for (const entry of sorted) {
        try {
            const rewritten = await rewordSingleEntry(entry.content);
            if (rewritten) {
                entry.content = rewritten;
            }
        } catch (err) {
            console.warn(`[Summary Editor] RAG reword failed for #${entry.num}:`, err);
            failures.push(entry.num);
        }

        completed++;
        updateProgressBar(Math.round((completed / total) * 100));
    }

    showProgress(false);

    if (failures.length) {
        alert(
            `RAG reword completed. ${failures.length} entries failed and kept originals: ` +
            `#${failures.join(', #')}`
        );
    }

    renderTable();
    persistState();
}

/**
 * Send a single entry's content to the model for rewriting.
 *
 * @param {string} content - The original entry text.
 * @returns {Promise<string|null>} Rewritten text, or null if the API returned nothing.
 */
async function rewordSingleEntry(content) {
    const context = SillyTavern.getContext();
    const prompt = getPrompt(PROMPT_KEY) + content;

    // ST's generateQuietPrompt sends to the active model without adding to chat history
    const response = await context.generateQuietPrompt?.(prompt);
    return response ? response.trim() : null;
}

/**
 * Show or hide the RAG progress bar.
 *
 * @param {boolean} visible - Whether the progress bar should be visible.
 */
function showProgress(visible) {
    $('#se-rag-progress').toggle(visible);
}

/**
 * Update the RAG progress bar fill percentage.
 *
 * @param {number} percent - Percentage complete (0–100).
 */
function updateProgressBar(percent) {
    $('#se-rag-progress-fill').css('width', `${percent}%`);
}
