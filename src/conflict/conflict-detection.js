/**
 * @module conflict-detection
 * @description LLM-based conflict detection for story summary entries.
 *
 * Calls SillyTavern's chat-completions backend directly to send entries
 * with a system prompt for inconsistency analysis. Results populate
 * a Feedback column in the review table and are stored in a log.
 */

import { state, persistState } from '../core/state.js';
import { escHtml, spawnPanel } from '../core/utils.js';
import { renderTable, renderStatsBar, getCheckedNums } from '../table/table.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';
import { TEMPLATES, SEVERITY, SEV_CSS } from '../core/constants.js';
import { registerPrompt, getPrompt } from '../core/system-prompts.js';

/** @type {HTMLElement|null} Cached story context panel. */
let $storyCtxEl = null;

// ─── Prompt registration ─────────────────────────────────────────────────────

registerPrompt('conflict-check', 'Conflict Check', '', { warnJson: true });

registerPrompt('story-context', 'Story Context Generation');

// ─── Analysis Log ────────────────────────

/** @type {Array<{timestamp: string, scope: string, model: string, results: Array}>} */
const analysisLog = [];

/**
 * Return the worst severity from a list of feedback items.
 * @param {Array<{severity: string}>} items
 * @returns {string}
 */
function getWorstSeverity(items) {
    if (items.some(f => f.severity === 'error')) return 'error';
    if (items.some(f => f.severity === 'warning')) return 'warning';
    if (items.some(f => f.severity === 'info')) return 'info';
    return 'ok';
}

// ─── Custom In-Modal Dialog ────────────────────────

/** @type {HTMLElement|null} Cached alert/confirm panel. */
let $dialogEl = null;
/** @type {HTMLElement|null} Cached conflict-results panel. */
let $crDialogEl = null;

/**
 * Show a themed dialog inside the SE modal.
 * @returns {Promise<boolean>} true if confirmed/OK, false if cancelled.
 */
async function showDialog({ type = 'alert', title = '', body = '', okText = 'OK', cancelText = 'Cancel', wide = false }) {
    if ($dialogEl) $dialogEl.remove();

    const showCancel = type === 'confirm';
    const tmpl = await loadTemplate(TEMPLATES.DIALOG_ALERT);
    const html = fillTemplate(tmpl, {
        wideCls:   wide ? ' se-fp-wide' : '',
        title,
        body,
        cancelBtn: showCancel ? `<button class="se-btn se-dialog-cancel">${escHtml(cancelText)}</button>` : '',
        okText:    escHtml(okText),
    });

    const overlay = document.getElementById('se-modal-overlay');
    $dialogEl = $(html).appendTo(overlay);

    const el = $dialogEl[0];
    spawnPanel(el, overlay, '.se-float-panel-header');

    return new Promise(resolve => {
        const cleanup = (result) => {
            $dialogEl.remove();
            $dialogEl = null;
            resolve(result);
        };
        $dialogEl.find('.se-dialog-ok').on('click', () => cleanup(true));
        $dialogEl.find('.se-dialog-cancel, .se-dialog-dismiss').on('click', () => cleanup(false));
        $dialogEl.find('.se-dialog-ok').trigger('focus');
    });
}

// ─── API Helpers ────────────────────────

/**
 * Get the current API connection status from SillyTavern.
 * @returns {{ connected: boolean, model: string, api: string }}
 */
export function getApiStatus() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const context = SillyTavern.getContext();
            const online = context?.onlineStatus !== 'no_connection';
            const model = context?.getChatCompletionModel?.() || context?.mainApi || '';
            const api = context?.chatCompletionSettings?.chat_completion_source
                || context?.mainApi || '';
            return { connected: online, model, api };
        }
    } catch (err) {
        console.warn('[Summary Editor] Failed to check API status:', err);
    }
    return { connected: false, model: '', api: '' };
}

/** Render the API status indicator in the header. */
export function renderApiStatus() {
    const $el = $('#se-api-status');
    if (!$el.length) return;

    const s = getApiStatus();
    const dot = s.connected ? 'connected' : 'disconnected';
    const label = s.connected ? escHtml(s.model) : 'No API connected';
    $el.html(`<span class="se-api-dot ${dot}"></span><span class="se-api-model">${label}</span>`);
}

/**
 * Build the conflict prompt from entries.
 * @param {Array<object>} entries
 * @returns {{ prompt: string, tokenEstimate: number }}
 */
function buildConflictPrompt(entries) {
    const sorted = entries.slice().sort((a, b) => a.num - b.num);
    const lines = sorted.map(e => {
        const meta = [];
        if (e.date) meta.push(`Date: ${e.date}`);
        if (e.time) meta.push(`Time: ${e.time}`);
        if (e.location) meta.push(`Location: ${e.location}`);
        const metaStr = meta.length ? ` [${meta.join(', ')}]` : '';
        return `${e.num}. ${e.content}${metaStr}`;
    });

    const prompt = lines.join('\n');
    const tokenEstimate = Math.ceil((prompt.length + getPrompt('conflict-check').length) / 4);
    return { prompt, tokenEstimate };
}

/**
 * Determine which entries to check based on current selection state.
 * @returns {Array<object>|null} Target entries, or null if none valid.
 */
function resolveTargetEntries() {
    const selectAllChecked = $('#se-select-all').is(':checked');
    const checked = getCheckedNums();
    const useAll = selectAllChecked || checked.length === 0;

    if (useAll) return [...state.entries.values()];
    return checked.map(num => state.entries.get(num)).filter(Boolean);
}

/**
 * Send entries to ST's chat-completions backend for analysis.
 * @param {string} prompt - The assembled entry text.
 * @param {string} [systemContext] - Optional story context to prepend to the system prompt.
 * @returns {Promise<string>} Raw model response text.
 */
async function callConflictAPI(prompt, systemContext = '') {
    const context = SillyTavern.getContext();
    const oai = context.chatCompletionSettings;

    const base = getPrompt('conflict-check');
    const sysPrompt = systemContext
        ? `${base}\n\n---\nSTORY CONTEXT (summary of prior analysis):\n${systemContext}`
        : base;

    const resp = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            type: 'quiet',
            chat_completion_source: oai.chat_completion_source,
            model: context.getChatCompletionModel(),
            messages: [
                { role: 'system', content: sysPrompt },
                { role: 'user', content: prompt },
            ],
            max_tokens: oai.openai_max_tokens || 2000,
            temperature: 0.3,
            stream: false,
        }),
    });

    if (!resp.ok) {
        throw new Error(`API ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content
        || data?.choices?.[0]?.text
        || (typeof data === 'string' ? data : '');
}

/**
 * Extract a JSON array from raw model text.
 * Handles markdown fences, loose objects, trailing commas, etc.
 * @param {string} raw
 * @returns {Array|null} Parsed array or null.
 */
function extractJsonArray(raw) {
    // 1. Strip markdown fences
    const text = raw.replaceAll(/`{3,}[a-z]*\s*/gi, '').trim();

    // 2. Try direct parse
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return [parsed];
    } catch { /* continue */ }

    // 3. Extract outermost [...]
    const arrayMatch = /\[[\s\S]*\]/.exec(text);
    if (arrayMatch) {
        const fixed = arrayMatch[0].replaceAll(/,\s*\]/g, ']');
        try {
            const parsed = JSON.parse(fixed);
            if (Array.isArray(parsed)) return parsed;
        } catch { /* continue */ }
    }

    // 4. Collect individual {...} objects
    const objects = [];
    const objRegex = /\{[^{}]*\}/g;
    let match;
    while ((match = objRegex.exec(text)) !== null) {
        try {
            objects.push(JSON.parse(match[0]));
        } catch { /* skip malformed */ }
    }
    return objects.length > 0 ? objects : null;
}

/**
 * Normalize a result item to ensure it has the "problems" array format.
 * Handles old "reason" string format from models that ignore the prompt.
 * @param {object} item
 * @returns {object} Normalized item with problems array.
 */
function normalizeResultItem(item) {
    // Support both "criticism" (new) and "problems" (legacy) field names
    const raw = item.criticism || item.problems;
    if (!raw || !Array.isArray(raw)) {
        const reason = item.reason || item.criticism || item.problems || '';
        item.criticism = typeof reason === 'string' && reason ? [reason] : [];
    } else {
        item.criticism = raw;
    }
    // Normalize feedback to array
    if (!item.feedback) item.feedback = [];
    if (typeof item.feedback === 'string') item.feedback = item.feedback ? [item.feedback] : [];
    if (!item.severity) item.severity = 'warning';
    return item;
}

/**
 * Parse and display conflict results from raw model response.
 * @param {string} responseText - Raw model output.
 * @param {string} scopeLabel - Description of what was checked.
 * @param {string} modelName - Model used for the check.
 * @returns {Promise<boolean>} true if successfully parsed.
 */
async function handleConflictResponse(responseText, scopeLabel, modelName) {
    if (!responseText || responseText.trim() === '') {
        await showDialog({ type: 'alert', title: 'Empty Response', body: 'Model did not return any response.' });
        return false;
    }

    const rawResults = extractJsonArray(responseText);

    if (!rawResults) {
        console.warn('[Summary Editor] Could not extract JSON from response:', responseText);
        await showDialog({
            type: 'alert',
            title: 'Parse Error',
            body: 'Could not extract conflict data from model response. Check browser console (F12) for raw output.',
        });
        return false;
    }

    // Normalize all items
    const results = rawResults.map(normalizeResultItem);

    // Overwrite most recent log entry (each check replaces the last)
    const logEntry = {
        timestamp: new Date().toLocaleString(),
        scope: scopeLabel,
        model: modelName,
        results,
    };
    if (analysisLog.length > 0) {
        analysisLog[0] = logEntry;
    } else {
        analysisLog.push(logEntry);
    }

    processConflictResponse(results);
    showConflictResultsDialog(logEntry);
    return true;
}

// ─── Feedback Detail Dialog ────────────────────────

/**
 * Show a detail dialog for a specific entry's feedback.
 * Called when clicking a feedback chip in the review table.
 * @param {number} entryNum
 */
export function showFeedbackDetail(entryNum) {
    const feedbackItems = state.conflicts[entryNum];
    if (!feedbackItems || feedbackItems.length === 0) return;

    const entry = state.entries.get(entryNum);
    const contentPreview = entry
        ? (entry.content.length > 300 ? entry.content.slice(0, 300) + '...' : entry.content)
        : '';

    // Find worst severity for the header
    const headerSev = getWorstSeverity(feedbackItems);
    const sevMap = { error: ['se-sev-error', 'Error'], warning: ['se-sev-warn', 'Warning'], info: ['se-sev-info', 'Info'], ok: ['se-sev-ok', 'OK'] };
    const [headerCls, headerLabel] = sevMap[headerSev] || sevMap.info;

    // Build criticism + feedback sections
    let criticismHtml = '';
    let feedbackHtml = '';
    for (const item of feedbackItems) {
        const [cls, label] = sevMap[item.severity] || sevMap.info;
        const bullets = (item.criticism || []).map(
            p => `<li>${escHtml(p)}</li>`
        ).join('');

        if (bullets) {
            criticismHtml += `
                <div class="se-fb-section">
                    <div class="se-fb-sev-header">
                        <span class="se-cr-sev ${cls}">${label}</span>
                        <span class="se-fb-text-preview">${escHtml(item.text || '')}</span>
                    </div>
                    <ul class="se-fb-problems">${bullets}</ul>
                </div>`;
        }

        const fbItems = item.feedback || [];
        if (fbItems.length > 0) {
            const fbBulletHtml = fbItems.map(f => `<li>${escHtml(f)}</li>`).join('');
            feedbackHtml += `
                <div class="se-fb-section se-fb-suggestion">
                    <div class="se-fb-sev-header">
                        <span class="se-cr-sev ${cls}">${label}</span>
                    </div>
                    <ul class="se-fb-suggestion-list">${fbBulletHtml}</ul>
                </div>`;
        }
    }

    const body = `
        <div class="se-fb-detail">
            <div class="se-fb-original-label">Original Text</div>
            <div class="se-fb-original">${escHtml(contentPreview)}</div>
            <div class="se-fb-divider"></div>
            <div class="se-fb-original-label">Criticism
                <span class="se-cr-sev ${headerCls}" style="margin-left:8px;">${headerLabel}</span>
            </div>
            ${criticismHtml || '<div style="color:#555;padding:8px;">No issues found.</div>'}
            <div class="se-fb-divider"></div>
            <div class="se-fb-original-label">Feedback</div>
            ${feedbackHtml || '<div style="color:#555;padding:8px;">No suggestions.</div>'}
        </div>`;

    showDialog({ type: 'alert', title: `Feedback — Entry #${entryNum}`, body, wide: true });
}

// ─── Results Table Dialog ────────────────────────

const RESULTS_PER_PAGE = 10;

/**
 * Show the conflict results in a paginated table dialog.
 * @param {{ timestamp: string, scope: string, model: string, results: Array }} logEntry
 */
async function showConflictResultsDialog(logEntry) {
    const results = logEntry.results;

    if (results.length === 0) {
        showDialog({
            type: 'alert',
            title: 'No Conflicts Found',
            body: `<span style="color:#a6e22e;">&#10003;</span> No inconsistencies detected in ${logEntry.scope}.<br><span style="color:#75715e;font-size:0.82em;">${escHtml(logEntry.model)} &mdash; ${logEntry.timestamp}</span>`,
        });
        return;
    }

    const totalPages = Math.ceil(results.length / RESULTS_PER_PAGE);
    let currentPage = 1;

    const errors = results.filter(r => r.severity === SEVERITY.ERROR).length;
    const warns  = results.filter(r => r.severity === SEVERITY.WARNING).length;
    const infos  = results.filter(r => r.severity === SEVERITY.INFO).length;
    const oks    = results.filter(r => r.severity === SEVERITY.OK).length;

    /** Human-readable label per severity. */
    const SEV_LABEL = { error: 'Error', warning: 'Warning', info: 'Info', ok: 'OK' };

    function buildTablePage(page) {
        const start = (page - 1) * RESULTS_PER_PAGE;
        const pageItems = results.slice(start, start + RESULTS_PER_PAGE);

        let rows = '';
        for (const item of pageItems) {
            const sev = item.severity || SEVERITY.INFO;
            const sevClass = SEV_CSS[sev] ?? SEV_CSS[SEVERITY.INFO];
            const sevLabel = SEV_LABEL[sev] ?? SEV_LABEL[SEVERITY.INFO];

            const bullets = (item.criticism || []).map(p => `<li>${escHtml(p)}</li>`).join('');
            const fbBullets = (item.feedback || []).length > 0
                ? '<ul class="se-cr-bullets">' + item.feedback.map(f => `<li>${escHtml(f)}</li>`).join('') + '</ul>'
                : '<span style="color:#555;">—</span>';

            rows += `<tr>
                <td class="se-cr-entry">#${item.entry ?? '?'}</td>
                <td><span class="se-cr-sev ${sevClass}">${sevLabel}</span></td>
                <td class="se-cr-text">${escHtml(item.text || '')}</td>
                <td class="se-cr-reason"><ul class="se-cr-bullets">${bullets}</ul></td>
                <td class="se-cr-feedback">${fbBullets}</td>
            </tr>`;
        }

        return rows;
    }

    function buildBody(page) {
        const errorPlural = errors === 1 ? '' : 's';
        const warnPlural = warns === 1 ? '' : 's';
        const entryCount = new Set(results.map(r => r.entry)).size;
        const entryPlural = entryCount === 1 ? 'y' : 'ies';
        const summaryHtml = `<div class="se-cr-summary">
            <span style="color:#a6e22e;">${oks} ok</span> &middot;
            <span style="color:#f92672;">${errors} error${errorPlural}</span> &middot;
            <span style="color:#fd971f;">${warns} warning${warnPlural}</span> &middot;
            <span style="color:#ae81ff;">${infos} info</span>
            &mdash; ${results.length} total across ${entryCount} entr${entryPlural}
        </div>
        <div class="se-cr-meta">${escHtml(logEntry.model)} &mdash; ${logEntry.timestamp} &mdash; ${logEntry.scope}</div>
        <div class="se-cr-table-wrap">
            <table class="se-cr-table">
                <thead><tr>
                    <th>Entry</th><th>Severity</th><th>Text</th><th>Criticism</th><th>Feedback</th>
                </tr></thead>
                <tbody id="se-cr-tbody">${buildTablePage(page)}</tbody>
            </table>
        </div>`;

        const paginatorHtml = totalPages > 1
            ? `<div class="se-cr-paginator">
                <button class="se-btn se-btn-sm" id="se-cr-prev" ${page > 1 ? '' : 'disabled'}>&laquo; Prev</button>
                <span class="se-cr-page-info">Page ${page} / ${totalPages}</span>
                <button class="se-btn se-btn-sm" id="se-cr-next" ${page < totalPages ? '' : 'disabled'}>Next &raquo;</button>
            </div>`
            : '';

        return summaryHtml + paginatorHtml;
    }

    if ($crDialogEl) { $crDialogEl.remove(); $crDialogEl = null; }

    const tmpl = await loadTemplate(TEMPLATES.DIALOG_CONFLICT_RESULTS);
    const html = fillTemplate(tmpl, { bodyHtml: buildBody(currentPage) });

    const overlay = document.getElementById('se-modal-overlay');
    $crDialogEl = $(html).appendTo(overlay);

    const el = $crDialogEl[0];
    spawnPanel(el, overlay, '.se-float-panel-header');

    const cleanup = () => { $crDialogEl.remove(); $crDialogEl = null; };
    $crDialogEl.find('.se-dialog-ok').on('click', cleanup);

    $crDialogEl.on('click', '#se-cr-story-ctx-btn', () => openStoryContextPanel());

    $crDialogEl.on('click', '#se-cr-prev', () => {
        if (currentPage > 1) { currentPage--; $('#se-cr-body').html(buildBody(currentPage)); }
    });
    $crDialogEl.on('click', '#se-cr-next', () => {
        if (currentPage < totalPages) { currentPage++; $('#se-cr-body').html(buildBody(currentPage)); }
    });
}

// ─── Analysis Log Viewer ────────────────────────

/**
 * Show the analysis log dialog listing previous conflict checks.
 */
export function showAnalysisLog() {
    if (analysisLog.length === 0) {
        showDialog({
            type: 'alert',
            title: 'Analysis Log',
            body: 'No previous conflict analyses found.<br><span style="color:#75715e;font-size:0.82em;">Run a conflict check first.</span>',
        });
        return;
    }

    // Show the most recent (only) log entry directly
    const entry = analysisLog[0];
    processConflictResponse(entry.results);
    showConflictResultsDialog(entry);
}

// ─── Main Entry Point ────────────────────────

/**
 * Run the conflict check. Sends selected entries (or all) to the LLM.
 */
export async function runConflictCheck() {
    const status = getApiStatus();

    if (!status.connected) {
        await showDialog({ type: 'alert', title: 'No API Connected', body: 'Connect a model in SillyTavern\'s API panel first.' });
        return;
    }
    if (state.conflictRunning) return;
    if (state.entries.size === 0) {
        await showDialog({ type: 'alert', title: 'No Entries', body: 'No entries loaded. Go to <em>Ingest</em> tab first.' });
        return;
    }

    const targetEntries = resolveTargetEntries();
    if (!targetEntries || targetEntries.length === 0) {
        await showDialog({ type: 'alert', title: 'No Entries', body: 'No valid entries to check.' });
        return;
    }

    const { prompt, tokenEstimate } = buildConflictPrompt(targetEntries);
    const useAll = targetEntries.length === state.entries.size;
    const scopeLabel = useAll
        ? `all ${targetEntries.length} entries`
        : `${targetEntries.length} selected entries`;
    const scopeHtml = useAll
        ? `all <strong>${targetEntries.length}</strong> entries`
        : `<strong>${targetEntries.length}</strong> selected entries`;

    const confirmed = await showDialog({
        type: 'confirm',
        title: 'Check Conflicts',
        body: `
            <div class="se-dialog-row"><span class="se-dialog-label">Scope</span><span>${scopeHtml}</span></div>
            <div class="se-dialog-row"><span class="se-dialog-label">Model</span><span>${escHtml(status.model)}</span></div>
            <div class="se-dialog-row"><span class="se-dialog-label">API</span><span>${escHtml(status.api)}</span></div>
            <div class="se-dialog-row"><span class="se-dialog-label">Est. Tokens</span><span>~${tokenEstimate.toLocaleString()}</span></div>
            <p style="margin-top:12px;color:#75715e;font-size:0.85em;">Sends entry content to the connected LLM for analysis.</p>`,
        okText: 'Run Check',
        cancelText: 'Cancel',
    });
    if (!confirmed) return;

    state.conflictRunning = true;

    const $btn = $('#se-conflict-btn');
    const $progress = $('#se-conflict-progress');
    const $fill = $('#se-conflict-progress-fill');

    $btn.prop('disabled', true).text('Checking...');
    $progress.show();

    let pct = 0;
    const interval = setInterval(() => { pct += 5; $fill.css('width', Math.min(pct, 95) + '%'); }, 200);

    try {
        const responseText = await callConflictAPI(prompt, state.storyContext || '');
        clearInterval(interval);
        $fill.css('width', '100%');

        if (await handleConflictResponse(responseText, scopeLabel, status.model)) {
            $('#se-conflict-clear').show();
            $('#se-conflict-log-btn').show();
            // Generate narrative story context in background for use by re-check and revise
            generateStoryContext(targetEntries);
        }
    } catch (err) {
        clearInterval(interval);
        const msg = String(err?.message || err || 'Unknown error');
        await showDialog({
            type: 'alert',
            title: 'Conflict Check Failed',
            body: `<span style="color:#f92672;">${escHtml(msg)}</span>
                   <p style="margin-top:8px;color:#75715e;font-size:0.82em;">
                   Check the browser console (F12) for more details.</p>`,
        });
        console.error('[Summary Editor] Conflict check error:', err);
    } finally {
        state.conflictRunning = false;
        $btn.prop('disabled', false).html('&#9888; Check Conflicts');
        setTimeout(() => { $progress.hide(); $fill.css('width', '0%'); }, 800);
    }
}

// ─── Response Processing ────────────────────────

/**
 * Process parsed conflict results into state and render.
 * @param {Array<{entry: number, text: string, problems: string[], severity: string}>} results
 */
function processConflictResponse(results) {
    if (!Array.isArray(results)) return;

    // Merge into existing conflicts — new results overwrite per-entry,
    // but entries not in this batch keep their previous feedback.
    for (const item of results) {
        if (!item.entry) continue;
        state.conflicts[item.entry] = [{
            text: item.text || '',
            criticism: item.criticism || [],
            feedback: item.feedback || [],
            severity: item.severity || 'warning',
        }];
    }

    renderTable();
    renderStatsBar();

    const total = results.length;
    const errors = results.filter(r => r.severity === 'error').length;
    const warns = results.filter(r => r.severity === 'warning').length;
    const infos = results.filter(r => r.severity === 'info').length;
    const oks = results.filter(r => r.severity === 'ok').length;
    const issues = errors + warns + infos;

    $('#se-conflict-summary').show().html(
        `<span style="color:#a6e22e;">${oks} ok</span> \u00B7 ` +
        `<span style="color:#f92672;">${errors} errors</span> \u00B7 ` +
        `<span style="color:#fd971f;">${warns} warnings</span> \u00B7 ` +
        `<span style="color:#ae81ff;">${infos} info</span> \u2014 ` +
        `${issues} issue${issues !== 1 ? 's' : ''} found across ${total} entries reviewed`
    );
}

/** Clear all conflict highlights and summary. */
export function clearConflicts() {
    state.conflicts = {};
    $('#se-conflict-summary').hide();
    $('#se-conflict-clear').hide();
    renderTable();
}

/**
 * Check if any conflict feedback exists.
 * @returns {boolean}
 */
export function hasConflictFeedback() {
    return Object.keys(state.conflicts).length > 0;
}

/**
 * Open (or focus) the floating Story Context panel.
 * Draggable, non-blocking. Shows state.storyContext in an editable textarea.
 */
export async function openStoryContextPanel() {
    if ($storyCtxEl && $storyCtxEl.length && document.body.contains($storyCtxEl[0])) {
        $storyCtxEl.find('#se-story-ctx-textarea').trigger('focus');
        return;
    }

    const tmpl = await loadTemplate(TEMPLATES.STORY_CONTEXT_PANEL);
    const html = fillTemplate(tmpl, { body: escHtml(state.storyContext || '') });

    const overlay = document.getElementById('se-modal-overlay');
    $storyCtxEl = $(html).appendTo(overlay);

    const el = $storyCtxEl[0];
    spawnPanel(el, overlay, '.se-float-panel-header');

    $storyCtxEl.find('.se-story-ctx-close').on('click', () => {
        $storyCtxEl.remove();
        $storyCtxEl = null;
    });

    $storyCtxEl.find('#se-story-ctx-save').on('click', () => {
        state.storyContext = $storyCtxEl.find('#se-story-ctx-textarea').val().trim();
        persistState();
        const $saved = $storyCtxEl.find('#se-story-ctx-saved');
        $saved.show();
        setTimeout(() => $saved.hide(), 1800);
    });
}

/**
 * Generate a compact narrative story context from the given entries and store
 * it in `state.storyContext`. Called silently after each full conflict check
 * so subsequent re-checks and API revisions have rich story context available.
 * @param {Array<object>} entries - Entries to summarize.
 */
async function generateStoryContext(entries) {
    try {
        const stContext = SillyTavern.getContext();
        const oai = stContext.chatCompletionSettings;
        const { prompt } = buildConflictPrompt(entries);

        const resp = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: stContext.getRequestHeaders(),
            body: JSON.stringify({
                type: 'quiet',
                chat_completion_source: oai.chat_completion_source,
                model: stContext.getChatCompletionModel(),
                messages: [
                    { role: 'system', content: getPrompt('story-context') },
                    { role: 'user', content: prompt },
                ],
                max_tokens: 400,
                temperature: 0.4,
                stream: false,
            }),
        });

        if (!resp.ok) return;
        const data = await resp.json();
        const result = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
        if (result.trim()) {
            state.storyContext = result.trim();
            persistState();
            // Refresh panel textarea if open
            $storyCtxEl?.find('#se-story-ctx-textarea').val(state.storyContext);
        }
    } catch (err) {
        console.warn('[SE] generateStoryContext failed:', err);
    }
}

/**
 * Re-run conflict detection for a single entry using previously evaluated
 * entries and/or checkbox-selected entries as context — never arbitrary neighbors.
 * If neither source has any entries, only the target entry itself is sent.
 *
 * @param {number} num - The entry number to re-check.
 * @param {string} [contentOverride] - Optional content to use instead of stored content.
 * @returns {Promise<Array|null>} Conflict items for `num`, or null on failure.
 */
export async function reCheckEntry(num, contentOverride) {
    if (!state.entries.has(num)) return null;

    // Context = previously evaluated entries ∪ checkbox-selected entries ∪ target
    const evaluatedNums = Object.keys(state.conflicts).map(Number);
    const selectedNums = [...state.selected];
    const contextSet = new Set([...evaluatedNums, ...selectedNums, num]);

    const entries = [...contextSet]
        .sort((a, b) => a - b)
        .map(n => {
            const e = state.entries.get(n);
            if (!e) return null;
            if (n === num && contentOverride !== undefined) return { ...e, content: contentOverride };
            return e;
        }).filter(Boolean);

    const { prompt } = buildConflictPrompt(entries);
    try {
        const raw = await callConflictAPI(prompt, state.storyContext || '');
        const rawResults = extractJsonArray(raw);
        if (!rawResults) return null;
        const results = rawResults.map(normalizeResultItem);
        // Update state.conflicts for all entries in the context window
        for (const item of results) {
            if (!item.entry) continue;
            state.conflicts[item.entry] = [{
                text: item.text || '',
                criticism: item.criticism || [],
                feedback: item.feedback || [],
                severity: item.severity || 'warning',
            }];
        }
        return state.conflicts[num] || [];
    } catch (err) {
        console.error('[SE] reCheckEntry error:', err);
        return null;
    }
}
