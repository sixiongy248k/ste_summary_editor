/**
 * @module timeline-analysis
 * @description Timeline file marking and LLM-powered timeline consistency analysis.
 *
 * - Auto-detects timeline files by filename/content keyword on ingest
 * - Per-file toggle in the Ingest file drawer
 * - "Analyze Timeline" button in Review toolbar (enabled when ≥1 file marked)
 * - Sends timeline content + entries to LLM; returns [{num, reason}] for issues
 * - Floating draggable results panel with Relaxed/Medium/Thorough judgment toggle
 * - Re-run button; editable system prompt via hub
 * - Completely separate from conflict detection — does NOT touch Feedback column
 */

import { state, persistState } from '../core/state.js';
import { registerPrompt, getPrompt } from '../core/system-prompts.js';
import { escHtml, spawnPanel } from '../core/utils.js';

const PROMPT_KEY = 'timeline-analysis';

registerPrompt(PROMPT_KEY, 'Timeline Analysis', [
    'You are a story timeline analyst. You will receive one or more reference timeline files',
    'and a list of numbered story summary entries.',
    'Identify entries whose content contradicts or is inconsistent with the timeline.',
    'Return ONLY a valid JSON array: [{"num": N, "reason": "brief explanation"}, ...]',
    'Return [] if no issues are found.',
    'Do not include entries that are fine. Output nothing but the JSON array.',
].join(' '), { warnJson: true });

/** Judgment level descriptions — prepended to user message */
const LEVEL_HINTS = {
    relaxed:  'Flag only clear contradictions: entries that directly contradict established timeline facts.',
    medium:   'Flag inconsistencies and sequence problems: events out of order or conflicting with established timing.',
    thorough: 'Flag ALL potential timeline issues: minor hints, ambiguous timing, or anything that could contradict established facts.',
};

let _panel = null;
let _currentLevel = 'medium';

// ─── Public API ──────────────────────────────────────────────

/**
 * Scan all loaded files and auto-mark any that look like timeline references.
 * Called after ingestion completes.
 */
export function autoDetectTimelineFiles() {
    for (const file of state.files) {
        if (!file.valid || state.timelineFiles.has(file.name)) continue;
        const nameHit = file.name.toLowerCase().includes('timeline');
        const raw = state.fileRawContent.get(file.name) || '';
        const contentHit = (raw.toLowerCase().match(/\btimeline\b/g) || []).length >= 3;
        if (nameHit || contentHit) {
            state.timelineFiles.add(file.name);
        }
    }
}

/**
 * Toggle a file's timeline-reference status.
 * @param {string} filename
 */
export function toggleTimelineFile(filename) {
    if (state.timelineFiles.has(filename)) state.timelineFiles.delete(filename);
    else state.timelineFiles.add(filename);
    persistState();
}

/** @returns {boolean} Whether any timeline file is currently marked */
export function hasTimelineFiles() {
    return state.timelineFiles.size > 0 &&
        [...state.timelineFiles].some(n => state.files.some(f => f.name === n && f.valid));
}

/**
 * Open (or re-open) the timeline results panel.
 * If results already exist, shows them immediately. Otherwise shows empty state.
 */
export function openTimelinePanel() {
    if (_panel) { _panel.remove(); _panel = null; }

    const overlay = document.getElementById('se-modal-overlay');
    if (!overlay) return;

    _panel = document.createElement('div');
    _panel.id = 'se-timeline-panel';
    _panel.className = 'se-timeline-panel';
    _panel.innerHTML = _buildPanelHtml();
    overlay.appendChild(_panel);

    spawnPanel(_panel, overlay, '.se-tl-header', 540, 480);
    _bindPanelEvents();
    _renderResults(state.timelineAnalysisResults);
}

export function closeTimelinePanel() {
    _panel?.remove();
    _panel = null;
}

/**
 * Run the LLM timeline analysis and display results in the panel.
 * @param {boolean} [fromPanel=false] Called from the Re-run button inside the panel.
 */
export async function runTimelineAnalysis(_fromPanel = false) {
    if (!hasTimelineFiles()) return;
    if (!_panel) openTimelinePanel();

    const statusEl = _panel?.querySelector('#se-tl-status');
    const runBtn   = _panel?.querySelector('#se-tl-run');
    if (statusEl) { statusEl.textContent = 'Analysing…'; statusEl.style.color = '#fd971f'; }
    if (runBtn)   runBtn.disabled = true;

    try {
        const timelineContent = _buildTimelineContent();
        const entryLines = _buildEntryLines();
        const levelHint  = LEVEL_HINTS[_currentLevel] || LEVEL_HINTS.medium;

        const userMsg =
            `Judgment level: ${_currentLevel.toUpperCase()}\n${levelHint}\n\n` +
            `Timeline reference:\n${timelineContent}\n\n` +
            `Story entries to check:\n${entryLines}`;

        const ctx = SillyTavern.getContext();
        const resp = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: ctx.getRequestHeaders(),
            body: JSON.stringify({
                type: 'quiet',
                chat_completion_source: ctx.chatCompletionSettings.chat_completion_source,
                model: ctx.getChatCompletionModel(),
                messages: [
                    { role: 'system', content: getPrompt(PROMPT_KEY) },
                    { role: 'user',   content: userMsg },
                ],
                max_tokens: ctx.chatCompletionSettings.openai_max_tokens || 1200,
                temperature: 0.2,
                stream: false,
            }),
        });

        if (!resp.ok) throw new Error(`API ${resp.status}`);
        const data   = await resp.json();
        const raw    = (data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '').trim();
        const match  = raw.match(/\[[\s\S]*\]/);
        const parsed = match ? JSON.parse(match[0]) : [];

        state.timelineAnalysisResults = Array.isArray(parsed) ? parsed : [];
        _renderResults(state.timelineAnalysisResults);

        if (statusEl) {
            const n = state.timelineAnalysisResults.length;
            statusEl.textContent = n === 0 ? 'No issues found ✓' : `${n} issue${n > 1 ? 's' : ''} found`;
            statusEl.style.color = n === 0 ? '#a6e22e' : '#f92672';
        }
    } catch (err) {
        console.error('[SE] Timeline analysis error:', err);
        if (statusEl) { statusEl.textContent = 'Error — check console'; statusEl.style.color = '#f92672'; }
    }

    if (runBtn) runBtn.disabled = false;
}

// ─── Private helpers ─────────────────────────────────────────

function _buildPanelHtml() {
    const files = [...state.timelineFiles].filter(n => state.files.some(f => f.name === n && f.valid));
    const fileList = files.map(n => `<span class="se-tl-file-pill">${escHtml(n)}</span>`).join('');
    return `
        <div class="se-tl-header">
            <span class="se-tl-title">&#128197; Timeline Analysis</span>
            <button class="se-close-circle se-tl-close">&times;</button>
        </div>
        <div class="se-tl-controls">
            <div class="se-tl-files">${fileList || '<span class="se-tl-no-files">No timeline files marked</span>'}</div>
            <div class="se-tl-level-wrap">
                <span class="se-tl-level-label">Strictness:</span>
                ${['relaxed','medium','thorough'].map(l =>
                    `<button class="se-tl-level-btn${l === _currentLevel ? ' active' : ''}" data-level="${l}">${l.charAt(0).toUpperCase() + l.slice(1)}</button>`
                ).join('')}
                <button class="se-btn se-btn-sm se-prompt-edit-btn" data-edit-prompt="${PROMPT_KEY}" title="Edit analysis prompt" style="margin-left:6px;">&#9881;</button>
            </div>
            <div class="se-tl-action-row">
                <button class="se-btn se-btn-primary se-btn-sm" id="se-tl-run">&#9654; Run Analysis</button>
                <span id="se-tl-status" class="se-tl-status"></span>
            </div>
        </div>
        <div class="se-tl-results" id="se-tl-results">
            <div class="se-tl-empty">Click Run Analysis to begin.</div>
        </div>`;
}

function _bindPanelEvents() {
    _panel.querySelector('.se-tl-close').addEventListener('click', closeTimelinePanel);
    _panel.querySelector('#se-tl-run').addEventListener('click', () => runTimelineAnalysis(true));

    _panel.addEventListener('click', (e) => {
        const btn = e.target.closest('.se-tl-level-btn');
        if (!btn) return;
        _currentLevel = btn.dataset.level;
        _panel.querySelectorAll('.se-tl-level-btn').forEach(b => b.classList.toggle('active', b.dataset.level === _currentLevel));
    });
}

function _renderResults(results) {
    const el = _panel?.querySelector('#se-tl-results');
    if (!el) return;
    if (!results) { el.innerHTML = '<div class="se-tl-empty">Click Run Analysis to begin.</div>'; return; }
    if (results.length === 0) { el.innerHTML = '<div class="se-tl-empty se-tl-ok">&#10003; No timeline issues found.</div>'; return; }

    el.innerHTML =
        `<table class="se-tl-table">
            <thead><tr><th>Entry #</th><th>Issue</th></tr></thead>
            <tbody>
                ${results.map(r =>
                    `<tr><td class="se-tl-num">${escHtml(String(r.num))}</td><td class="se-tl-reason">${escHtml(r.reason)}</td></tr>`
                ).join('')}
            </tbody>
        </table>`;
}

function _buildTimelineContent() {
    return [...state.timelineFiles]
        .filter(n => state.files.some(f => f.name === n && f.valid))
        .map(n => `[${n}]\n${state.fileRawContent.get(n) || '(content unavailable)'}`)
        .join('\n\n---\n\n');
}

function _buildEntryLines() {
    const nums = state.selected.size > 0
        ? [...state.selected].sort((a, b) => a - b)
        : [...state.entries.keys()].sort((a, b) => a - b);
    return nums.map(n => {
        const e = state.entries.get(n);
        if (!e) return null;
        const meta = [e.date, e.time, e.location].filter(Boolean).join(', ');
        return `#${n}${meta ? ` (${meta})` : ''}: ${e.content}`;
    }).filter(Boolean).join('\n');
}
