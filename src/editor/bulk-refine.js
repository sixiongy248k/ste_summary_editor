/**
 * @module bulk-refine
 * @description Bulk API refinement for selected entries.
 *
 * Sends selected entries (with any conflict feedback) to the LLM for revision.
 * Reuses the Content Editor system prompt key so they share one configurable prompt.
 *
 * Flow:
 * 1. User selects entries → clicks "Bulk Refine" in Utils panel
 * 2. Module checks conflict data for each entry
 *    - None have data → warn "No conflict check run, proceed anyway?"
 *    - Some have data → confirm with counts
 * 3. On confirm → open draggable panel, show selected entries
 * 4. "Run All" → streams API calls sequentially per entry
 * 5. Each result shown with Accept / Discard buttons
 * 6. Accept → saves to entry.content, marks as modified
 */

import { state, persistState } from '../core/state.js';
import { renderTable } from '../table/table.js';
import { escHtml, spawnPanel } from '../core/utils.js';
import { getPrompt } from '../core/system-prompts.js';

/** Shared prompt key — reuses Content Editor's configurable prompt. */
const PROMPT_KEY = 'content-editor';

/** @type {HTMLElement|null} */
let _panel = null;

// ─── Public API ──────────────────────────────────────────────

/**
 * Open the Bulk Refine panel for currently selected entries.
 * Validates selection and conflict state, then shows the panel.
 */
export function openBulkRefine() {
    const selected = [...state.selected].sort((a, b) => a - b);
    if (selected.length === 0) {
        alert('Select at least one entry to refine.');
        return;
    }

    const withFeedback = selected.filter(n => _hasNonOkConflict(n));
    const noFeedback   = selected.filter(n => !_hasNonOkConflict(n));

    if (noFeedback.length === selected.length) {
        const ok = confirm(
            `None of the ${selected.length} selected entr${selected.length === 1 ? 'y has' : 'ies have'} been conflict-checked.\n\n` +
            `The AI will revise based on content only.\n\nProceed anyway?`
        );
        if (!ok) return;
    } else if (noFeedback.length > 0) {
        const ok = confirm(
            `${withFeedback.length} of ${selected.length} entries have conflict feedback.\n` +
            `${noFeedback.length} entries have no conflict data and will be revised on content only.\n\nProceed?`
        );
        if (!ok) return;
    }

    _showPanel(selected);
}

/**
 * Close and remove the Bulk Refine panel.
 */
export function closeBulkRefine() {
    _panel?.remove();
    _panel = null;
}

// ─── Private helpers ─────────────────────────────────────────

function _hasNonOkConflict(num) {
    return (state.conflicts[num] || []).some(c => c.severity !== 'ok');
}

function _showPanel(nums) {
    closeBulkRefine();
    const overlay = document.getElementById('se-modal-overlay');
    if (!overlay) return;

    _panel = document.createElement('div');
    _panel.id = 'se-bulk-refine-panel';
    _panel.className = 'se-bulk-refine-panel';
    _panel.innerHTML = _buildHtml(nums);
    overlay.appendChild(_panel);

    spawnPanel(_panel, overlay, '.se-br-header', 520, 560);
    _bindEvents(nums);
}

function _buildHtml(nums) {
    const rows = nums.map(n => {
        const entry = state.entries.get(n);
        if (!entry) return '';
        const conflicts  = (state.conflicts[n] || []).filter(c => c.severity !== 'ok');
        const hasConfl   = conflicts.length > 0;
        const preview    = escHtml(entry.content.slice(0, 140)) + (entry.content.length > 140 ? '…' : '');
        const badgeCls   = hasConfl ? 'se-br-badge-warn' : 'se-br-badge-none';
        const badgeTxt   = hasConfl ? `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}` : 'no conflicts';
        return `
        <div class="se-br-entry" data-num="${n}">
            <div class="se-br-entry-header">
                <span class="se-br-num">#${n}</span>
                <span class="se-br-badge ${badgeCls}">${badgeTxt}</span>
                <span class="se-br-status" id="se-br-status-${n}"></span>
            </div>
            <div class="se-br-original">${preview}</div>
            <div class="se-br-result" id="se-br-result-${n}" style="display:none;">
                <textarea class="se-br-result-text" id="se-br-result-text-${n}" rows="4"></textarea>
                <div class="se-br-result-actions">
                    <button class="se-btn se-btn-sm se-br-accept" data-num="${n}">Accept ✓</button>
                    <button class="se-btn se-btn-sm se-br-discard" data-num="${n}">Discard</button>
                </div>
            </div>
        </div>`;
    }).join('');

    return `
        <div class="se-br-header">
            <span class="se-br-title">&#9889; Bulk Refine &mdash; ${nums.length} entr${nums.length === 1 ? 'y' : 'ies'}</span>
            <button class="se-close-circle se-br-close">&times;</button>
        </div>
        <div class="se-br-toolbar">
            <button class="se-btn se-btn-primary se-br-run" id="se-br-run">&#9654; Run All</button>
            <span class="se-br-overall-status" id="se-br-overall-status"></span>
        </div>
        <div class="se-br-body">${rows}</div>`;
}

function _bindEvents(nums) {
    _panel.querySelector('.se-br-close').addEventListener('click', closeBulkRefine);

    _panel.querySelector('#se-br-run').addEventListener('click', () => _runAll(nums));

    _panel.addEventListener('click', (e) => {
        const accept = e.target.closest('.se-br-accept');
        if (accept) { _acceptResult(Number.parseInt(accept.dataset.num, 10)); return; }

        const discard = e.target.closest('.se-br-discard');
        if (discard) { _discardResult(Number.parseInt(discard.dataset.num, 10)); }
    });
}

async function _runAll(nums) {
    const runBtn    = _panel?.querySelector('#se-br-run');
    const statusEl  = _panel?.querySelector('#se-br-overall-status');

    if (runBtn) runBtn.disabled = true;
    if (statusEl) { statusEl.textContent = `Running 0 / ${nums.length}…`; statusEl.style.color = '#fd971f'; }

    let done = 0;
    for (const num of nums) {
        if (!_panel) break; // panel was closed mid-run
        await _runSingle(num);
        done++;
        if (statusEl) statusEl.textContent = `Running ${done} / ${nums.length}…`;
    }

    if (statusEl && _panel) {
        statusEl.textContent = `Done (${done} / ${nums.length}) ✓`;
        statusEl.style.color = '#a6e22e';
    }
    if (runBtn && _panel) runBtn.disabled = false;
}

async function _runSingle(num) {
    const entry    = state.entries.get(num);
    if (!entry) return;

    const statusEl = _panel?.querySelector(`#se-br-status-${num}`);
    if (statusEl) { statusEl.textContent = 'Thinking…'; statusEl.style.color = '#fd971f'; }

    const conflicts = (state.conflicts[num] || []).filter(c => c.severity !== 'ok');
    const feedbackLines = conflicts.flatMap(c => [
        ...(c.criticism || []).map(t => `• ${t}`),
        ...(c.feedback  || []).map(t => `→ ${t}`),
    ]);

    let userMsg = '';
    if (feedbackLines.length > 0) {
        userMsg += `Conflict feedback for this entry:\n${feedbackLines.join('\n')}\n\n`;
    }
    userMsg += `Entry #${num} (rewrite this):\n${entry.content}`;

    const base      = getPrompt(PROMPT_KEY);
    const sysPrompt = state.storyContext
        ? `${base}\n\n---\nStory context:\n${state.storyContext}`
        : base;

    try {
        const ctx  = SillyTavern.getContext();
        const resp = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: ctx.getRequestHeaders(),
            body: JSON.stringify({
                type: 'quiet',
                chat_completion_source: ctx.chatCompletionSettings.chat_completion_source,
                model: ctx.getChatCompletionModel(),
                messages: [
                    { role: 'system', content: sysPrompt },
                    { role: 'user',   content: userMsg   },
                ],
                max_tokens:  ctx.chatCompletionSettings.openai_max_tokens || 800,
                temperature: 0.5,
                stream:      false,
            }),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data   = await resp.json();
        const result = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';

        if (result && _panel) {
            const resultDiv  = _panel.querySelector(`#se-br-result-${num}`);
            const resultText = _panel.querySelector(`#se-br-result-text-${num}`);
            if (resultDiv && resultText) {
                resultText.value       = result.trim();
                resultDiv.style.display = 'block';
            }
            if (statusEl) { statusEl.textContent = 'Ready ✓'; statusEl.style.color = '#a6e22e'; }
        } else if (_panel) {
            if (statusEl) { statusEl.textContent = 'No response'; statusEl.style.color = '#f92672'; }
        }
    } catch (err) {
        console.error('[SE] Bulk refine error:', err);
        if (statusEl && _panel) { statusEl.textContent = 'Error'; statusEl.style.color = '#f92672'; }
    }
}

function _acceptResult(num) {
    const textEl = _panel?.querySelector(`#se-br-result-text-${num}`);
    if (!textEl) return;

    const entry = state.entries.get(num);
    if (!entry) return;

    entry.content = textEl.value.trim();
    state.modified.add(num);
    persistState();
    renderTable();

    const resultDiv = _panel?.querySelector(`#se-br-result-${num}`);
    if (resultDiv) resultDiv.innerHTML = '<div class="se-br-accepted">Accepted ✓</div>';

    const statusEl = _panel?.querySelector(`#se-br-status-${num}`);
    if (statusEl) { statusEl.textContent = 'Saved'; statusEl.style.color = '#a6e22e'; }
}

function _discardResult(num) {
    const resultDiv = _panel?.querySelector(`#se-br-result-${num}`);
    if (resultDiv) resultDiv.style.display = 'none';

    const statusEl = _panel?.querySelector(`#se-br-status-${num}`);
    if (statusEl) { statusEl.textContent = 'Discarded'; statusEl.style.color = '#75715e'; }
}
