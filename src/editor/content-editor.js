/**
 * @module content-editor
 * @description Per-entry content editor dialog with API assist and conflict re-check.
 *
 * - Full-content editable textarea
 * - Conflict feedback displayed read-only below
 * - "Ask API" button rewrites content using ST's active model
 * - "Re-check" button re-runs conflict detection for this entry
 * - Editable system prompt (collapsible)
 * - Saved entries flagged in state.modified (light-blue tint in Review table)
 * - Ctrl+S to save, Escape to cancel
 */

import { state, persistState } from '../core/state.js';
import { renderTable } from '../table/table.js';
import { escHtml, spawnPanel } from '../core/utils.js';
import { reCheckEntry } from '../conflict/conflict-detection.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';
import { TEMPLATES, SEV_CSS } from '../core/constants.js';
import { registerPrompt, getPrompt, setPrompt } from '../core/system-prompts.js';

const PROMPT_KEY = 'content-editor';
const DEFAULT_SYSTEM_PROMPT =
    'You are a story editor. Review this summary entry and the conflict feedback below, ' +
    'then rewrite the content to resolve any issues while keeping the narrative style concise and clear. ' +
    'Return only the rewritten entry text — no preamble, no commentary.';

registerPrompt(PROMPT_KEY, 'Content Editor Revise', DEFAULT_SYSTEM_PROMPT);

// ─── Template cache ───────────────────────────────

let _editorTmpl = null;
let _feedbackItemTmpl = null;

async function ensureTemplates() {
    if (_editorTmpl) return;
    [_editorTmpl, _feedbackItemTmpl] = await Promise.all([
        loadTemplate(TEMPLATES.CONTENT_EDITOR),
        loadTemplate(TEMPLATES.CE_FEEDBACK_ITEM),
    ]);
}

/**
 * Open the content editor dialog for a given entry number.
 * @param {number} num - Entry number to edit.
 */
export async function openContentEditor(num) {
    const entry = state.entries.get(num);
    if (!entry) return;

    closeContentEditor();
    await ensureTemplates();

    const overlay = document.getElementById('se-modal-overlay');
    if (!overlay) return;

    const pop = document.createElement('div');
    pop.id = 'se-content-editor';
    pop.className = 'se-content-editor';
    pop.innerHTML = buildHtml(num, entry);

    overlay.appendChild(pop);

    // Center in overlay
    spawnPanel(pop, overlay, '.se-ce-header', 580, 560);
    pop.querySelector('#se-ce-textarea').focus();

    bindEvents(pop, num, entry);
}

/** Close and remove the content editor. */
export function closeContentEditor() {
    document.getElementById('se-content-editor')?.remove();
}

// ─── HTML builders ───────────────────────────────────────────

function countText(text) {
    const tokens = Math.ceil(text.length / 4);
    const words  = text.split(/\s+/).filter(Boolean).length;
    return `~${tokens} tokens · ${words} words`;
}

function buildHtml(num, entry) {
    return fillTemplate(_editorTmpl, {
        num,
        modifiedBadge: state.modified.has(num) ? '<span class="se-ce-modified-badge">Modified</span>' : '',
        content:       escHtml(entry.content),
        counterText:   countText(entry.content),
        systemPrompt:  escHtml(getPrompt(PROMPT_KEY)),
        feedbackHtml:  buildFeedbackHtml(state.conflicts[num]),
    });
}

function buildFeedbackHtml(conflicts) {
    if (!conflicts || conflicts.length === 0) {
        return '<span class="se-ce-fb-empty">No conflict feedback. Run "Check Conflicts" from the toolbar, or use Re-check above.</span>';
    }
    return conflicts.map(c => {
        const sev = c.severity || 'info';
        const criticismItems = (c.criticism || []).map(t => `<li>${escHtml(t)}</li>`).join('');
        const feedbackItems  = (c.feedback  || []).map(t => `<li>${escHtml(t)}</li>`).join('');
        return fillTemplate(_feedbackItemTmpl, {
            sevClass:       SEV_CSS[sev] || SEV_CSS.info,
            sevLabel:       sev.toUpperCase(),
            textPart:       c.text ? `<span class="se-ce-fb-text">${escHtml(c.text)}</span>` : '',
            criticismPart:  criticismItems ? `<ul class="se-ce-fb-bullets">${criticismItems}</ul>` : '',
            feedbackPart:   feedbackItems  ? `<ul class="se-ce-fb-bullets se-ce-fb-suggestions">${feedbackItems}</ul>` : '',
        });
    }).join('');
}

// ─── Event bindings ──────────────────────────────────────────

function bindEvents(pop, num, entry) {
    pop.querySelector('.se-ce-close').addEventListener('click', closeContentEditor);
    pop.querySelector('#se-ce-cancel').addEventListener('click', closeContentEditor);

    pop.querySelector('#se-ce-save').addEventListener('click', () => doSave(pop, num, entry));

    pop.querySelector('#se-ce-toggle-prompt').addEventListener('click', () => {
        const sec = pop.querySelector('#se-ce-prompt-section');
        sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
    });

    pop.querySelector('#se-ce-reset-prompt').addEventListener('click', () => {
        setPrompt(PROMPT_KEY, DEFAULT_SYSTEM_PROMPT);
        pop.querySelector('#se-ce-prompt-textarea').value = DEFAULT_SYSTEM_PROMPT;
    });

    pop.querySelector('#se-ce-ask-api').addEventListener('click', () => doAskApi(pop, num));
    pop.querySelector('#se-ce-recheck').addEventListener('click', () => doRecheck(pop, num));

    pop.querySelector('#se-ce-expand').addEventListener('click', () => {
        pop.classList.toggle('se-ce-fullscreen');
    });

    // Live token/word counter
    const $ta = pop.querySelector('#se-ce-textarea');
    const $counter = pop.querySelector('#se-ce-counter');
    if ($ta && $counter) {
        $ta.addEventListener('input', () => { $counter.textContent = countText($ta.value); });
    }

    pop.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); doSave(pop, num, entry); }
        if (e.key === 'Escape') closeContentEditor();
    });
}

function doSave(pop, num, entry) {
    const newContent = pop.querySelector('#se-ce-textarea').value;
    entry.content = newContent;
    state.modified.add(num);
    persistState();
    renderTable();
    closeContentEditor();
}

async function doAskApi(pop, num) {
    const btn = pop.querySelector('#se-ce-ask-api');
    const statusEl = pop.querySelector('#se-ce-api-status');

    const promptArea = pop.querySelector('#se-ce-prompt-textarea');
    if (promptArea) setPrompt(PROMPT_KEY, promptArea.value.trim() || DEFAULT_SYSTEM_PROMPT);

    const content = pop.querySelector('#se-ce-textarea').value;

    // Build context from evaluated + selected entries (never arbitrary neighbors)
    const evaluatedNums = Object.keys(state.conflicts).map(Number);
    const selectedNums = [...state.selected];
    const contextSet = new Set([...evaluatedNums, ...selectedNums, num]);
    const contextEntries = [...contextSet]
        .sort((a, b) => a - b)
        .map(n => {
            const e = state.entries.get(n);
            if (!e) return null;
            if (n === num) return { ...e, content }; // use current unsaved content
            return e;
        }).filter(Boolean);

    // Format context entries (all except the target itself)
    const contextLines = contextEntries
        .filter(e => e.num !== num)
        .map(e => `#${e.num}: ${e.content}`);

    // Conflict feedback for the target entry
    const conflicts = state.conflicts[num] || [];
    const feedbackLines = conflicts
        .filter(c => c.severity !== 'ok')
        .flatMap(c => [
            ...(c.criticism || []).map(t => `• ${t}`),
            ...(c.feedback  || []).map(t => `→ ${t}`),
        ]);

    let userMsg = '';
    if (contextLines.length > 0) {
        userMsg += `Context entries (for reference):\n${contextLines.join('\n')}\n\n`;
    }
    if (feedbackLines.length > 0) {
        userMsg += `Conflict feedback:\n${feedbackLines.join('\n')}\n\n`;
    }
    userMsg += `Entry #${num} (rewrite this):\n${content}`;

    // Prepend story context to system prompt if available
    const currentPrompt = getPrompt(PROMPT_KEY);
    const sysPrompt = state.storyContext
        ? `${currentPrompt}\n\n---\nStory context (from prior analysis):\n${state.storyContext}`
        : currentPrompt;

    btn.disabled = true;
    statusEl.textContent = 'Thinking…';
    statusEl.style.color = '#fd971f';

    try {
        const context = SillyTavern.getContext();
        const resp = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({
                type: 'quiet',
                chat_completion_source: context.chatCompletionSettings.chat_completion_source,
                model: context.getChatCompletionModel(),
                messages: [
                    { role: 'system', content: sysPrompt },
                    { role: 'user', content: userMsg },
                ],
                max_tokens: context.chatCompletionSettings.openai_max_tokens || 800,
                temperature: 0.5,
                stream: false,
            }),
        });

        if (!resp.ok) throw new Error(`API ${resp.status} ${resp.statusText}`);
        const data = await resp.json();
        const result = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
        if (result) {
            const ta = pop.querySelector('#se-ce-textarea');
            ta.value = result.trim();
            const counter = pop.querySelector('#se-ce-counter');
            if (counter) counter.textContent = countText(ta.value);
            statusEl.textContent = 'Done ✓';
            statusEl.style.color = '#a6e22e';
        } else {
            statusEl.textContent = 'No response';
            statusEl.style.color = '#f92672';
        }
    } catch (err) {
        console.error('[SE] Content editor API error:', err);
        statusEl.textContent = 'Error — check console';
        statusEl.style.color = '#f92672';
    }
    btn.disabled = false;
}

async function doRecheck(pop, num) {
    const btn = pop.querySelector('#se-ce-recheck');
    const statusEl = pop.querySelector('#se-ce-api-status');

    btn.disabled = true;
    statusEl.textContent = 'Re-checking…';
    statusEl.style.color = '#fd971f';

    try {
        // Pass current (unsaved) content as the override so results reflect edits in progress
        const currentContent = pop.querySelector('#se-ce-textarea').value;
        const result = await reCheckEntry(num, currentContent);

        if (result) {
            pop.querySelector('#se-ce-feedback-body').innerHTML = buildFeedbackHtml(result);
            statusEl.textContent = 'Updated ✓';
            statusEl.style.color = '#a6e22e';
        } else {
            statusEl.textContent = 'No response';
            statusEl.style.color = '#f92672';
        }
    } catch (err) {
        console.error('[SE] Re-check error:', err);
        statusEl.textContent = 'Error — check console';
        statusEl.style.color = '#f92672';
    }
    btn.disabled = false;
}
