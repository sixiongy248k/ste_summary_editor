/**
 * @module timeline-editor
 * @description AI-powered editor for timeline notes supplementary files.
 *
 * Opened by the 📅 Timeline toolbar button when a timeline-notes file is assigned.
 * Shows the file content in an editable textarea with:
 *  - "Refine with AI" (content exists) — improves precision/accuracy
 *  - "Generate from Summaries" (content empty) — builds a timeline from entries
 *
 * Uses a self-registering system prompt ('timeline-editor').
 */

import { state, persistState } from '../core/state.js';
import { escHtml, spawnPanel } from '../core/utils.js';
import { registerPrompt, getPrompt } from '../core/system-prompts.js';
import { renderTable } from '../table/table.js';
import { TEMPLATES } from '../core/constants.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';

const PROMPT_KEY = 'timeline-editor';

const _DEFAULT_REFINE =
    'You are a story timeline editor. The user will provide their current timeline notes and the full story summary entries. ' +
    'Rewrite the timeline to be more precise, chronologically accurate, and internally consistent with the story entries. ' +
    'Preserve all events. Fix vague durations, unclear ordering, and contradictions. ' +
    'Return only the improved timeline text. No commentary, no headings.';

const _DEFAULT_GENERATE =
    'You are a story timeline builder. The user will provide numbered story summary entries with optional dates, times, and locations. ' +
    'Create a clear, ordered timeline of events from this material. ' +
    'Group events by rough time period where possible. Note key locations. ' +
    'Return only the timeline text. No commentary, no headings.';

registerPrompt(PROMPT_KEY, 'Timeline Editor — Refine/Generate', _DEFAULT_REFINE);

/** @type {HTMLElement|null} */
let _panel = null;

// ─── Public API ──────────────────────────────────────────────

/**
 * Open the timeline editor panel.
 * Uses the first timeline-notes supplementary file found.
 */
export async function openTimelineEditor() {
    const file = _getTimelineFile();
    if (!file) {
        alert('No timeline-notes file assigned. Assign a supplementary file with category "Timeline Notes" first.');
        return;
    }

    _panel?.remove();
    const overlay = document.getElementById('se-modal-overlay');
    if (!overlay) return;

    const content = file.editedContent || file.content || '';
    const isEmpty = _isEffectivelyEmpty(content);
    const actionBtn = isEmpty
        ? `<button class="se-btn se-btn-primary se-te-action" id="se-te-action">&#10024; Generate from Summaries</button>`
        : `<button class="se-btn se-btn-primary se-te-action" id="se-te-action">&#10024; Refine with AI</button>`;

    const tmpl = await loadTemplate(TEMPLATES.TIMELINE_EDITOR_PANEL);
    _panel = document.createElement('div');
    _panel.id = 'se-timeline-editor';
    _panel.className = 'se-timeline-editor';
    _panel.innerHTML = fillTemplate(tmpl, {
        fileName:  escHtml(file.name),
        actionBtn,
        promptKey: PROMPT_KEY,
        content:   escHtml(content),
    });
    overlay.appendChild(_panel);

    spawnPanel(_panel, overlay, '.se-te-header', 600, 520);
    _bindEvents(file, isEmpty);
}

/** Close and remove the timeline editor panel. */
export function closeTimelineEditor() {
    _panel?.remove();
    _panel = null;
}

// ─── Private helpers ─────────────────────────────────────────

/**
 * Returns true if the content is empty or only contains a header/title
 * with nothing substantive after the first colon.
 * e.g. "Timeline Notes:" or "Story Timeline:" → effectively empty → Generate mode.
 */
function _isEffectivelyEmpty(content) {
    const trimmed = content.trim();
    if (!trimmed) return true;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) return false;
    // Only treat as empty if the colon is on the first line and nothing follows
    const firstNewline = trimmed.indexOf('\n');
    if (firstNewline !== -1 && colonIdx > firstNewline) return false;
    const afterColon = trimmed.slice(colonIdx + 1).trim();
    return afterColon.length === 0;
}

function _getTimelineFile() {
    for (const f of state.supplementaryFiles.values()) {
        if (f.category === 'timeline-notes') return f;
    }
    return null;
}


function _buildEntriesContext() {
    const sorted = [...state.entries.values()].sort((a, b) => a.num - b.num);
    const lines = sorted.map(e => {
        let meta = '';
        const parts = [];
        if (e.date)     parts.push(`date: ${e.date}`);
        if (e.time)     parts.push(`time: ${e.time}`);
        if (e.location) parts.push(`location: ${e.location}`);
        if (parts.length) meta = ` [${parts.join(', ')}]`;
        return `#${e.num}.${meta} ${e.content}`;
    });
    return lines.join('\n');
}

function _setStatus(text, color) {
    const el = _panel?.querySelector('#se-te-status');
    if (el) { el.textContent = text; el.style.color = color || '#75715e'; }
}

async function _runApi(prompt, userMessage) {
    const ctx = SillyTavern.getContext();
    const resp = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({
            type: 'quiet',
            chat_completion_source: ctx.chatCompletionSettings?.chat_completion_source,
            model: ctx.getChatCompletionModel?.(),
            messages: [
                { role: 'system', content: prompt },
                { role: 'user',   content: userMessage },
            ],
        }),
    });
    if (!resp.ok) throw new Error(`API error ${resp.status}`);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? data.output ?? '';
}

async function _doAction(file, isEmpty) {
    const btn = _panel?.querySelector('#se-te-action');
    if (btn) btn.disabled = true;
    _setStatus(isEmpty ? 'Generating…' : 'Refining…', '#fd971f');

    const currentContent = _panel?.querySelector('#se-te-content')?.value || '';
    const entriesText    = _buildEntriesContext();
    const sysPrompt      = getPrompt(PROMPT_KEY);

    let userMessage;
    if (isEmpty) {
        const ctx = state.storyContext ? `\n\nStory context:\n${state.storyContext}` : '';
        userMessage = `Story entries:\n${entriesText}${ctx}\n\nGenerate a timeline.`;
    } else {
        const ctx = state.storyContext ? `\n\nStory context:\n${state.storyContext}` : '';
        userMessage = `Current timeline:\n${currentContent}\n\nStory entries:\n${entriesText}${ctx}\n\nRefine the timeline.`;
    }

    try {
        const result = await _runApi(sysPrompt, userMessage);
        if (!_panel) return;

        const resultWrap = _panel.querySelector('#se-te-result-wrap');
        const resultArea = _panel.querySelector('#se-te-result');
        if (resultWrap && resultArea) {
            resultArea.value = result.trim();
            resultWrap.style.display = 'block';
        }
        _setStatus('Done — review below', '#a6e22e');
    } catch (err) {
        _setStatus(`Error: ${err.message}`, '#f92672');
        console.error('[Summary Editor] Timeline editor API error:', err);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function _bindEvents(file, isEmpty) {
    _panel.querySelector('.se-te-close').addEventListener('click', closeTimelineEditor);

    _panel.querySelector('#se-te-action').addEventListener('click', () => _doAction(file, isEmpty));

    _panel.querySelector('#se-te-save').addEventListener('click', () => {
        const newContent = _panel.querySelector('#se-te-content')?.value || '';
        file.editedContent = newContent;
        persistState();
        renderTable();
        _setStatus('Saved', '#a6e22e');
    });

    _panel.querySelector('#se-te-revert').addEventListener('click', () => {
        const ta = _panel.querySelector('#se-te-content');
        if (ta) ta.value = file.content || '';
    });

    _panel.querySelector('#se-te-accept')?.addEventListener('click', () => {
        const result = _panel.querySelector('#se-te-result')?.value || '';
        if (!result) return;
        if (!confirm('Accept this AI suggestion and replace the current timeline?')) return;
        const ta = _panel.querySelector('#se-te-content');
        if (ta) ta.value = result;
        _panel.querySelector('#se-te-result-wrap').style.display = 'none';
        _setStatus('Accepted — click Save to write', '#a6e22e');
    });

    _panel.querySelector('#se-te-reject')?.addEventListener('click', () => {
        _panel.querySelector('#se-te-result-wrap').style.display = 'none';
        _setStatus('', '');
    });
}
