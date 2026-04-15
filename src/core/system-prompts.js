/**
 * @module system-prompts
 * @description Central registry for all LLM system prompts used by Summary Editor.
 *
 * ## Self-registering pattern
 * Each module calls `registerPrompt(key, label, defaultText)` at load time.
 * The hub iterates `getRegisteredPrompts()` and renders a card per entry automatically.
 * Adding a new LLM call never requires changes to the hub — just call `registerPrompt`.
 *
 * ## Persistence
 * Prompts are stored in `state.systemPrompts` (plain object, persisted via localStorage).
 * Call `seedDefaultPrompts()` once after `loadPersistedState()` to fill in missing keys.
 */

import { state } from './state.js';
import { escHtml, spawnPanel } from './utils.js';

/** Separate localStorage key so prompts survive the main state clear on page load. */
const PROMPTS_KEY = 'se-system-prompts-v1';

/** @type {Array<{key: string, label: string, defaultText: string, warnJson: boolean}>} */
const _registry = [];

/**
 * Register a prompt with the hub. Call at module load time (top-level, outside functions).
 * No-op if the key is already registered.
 *
 * @param {string} key - Unique identifier, e.g. 'conflict-check'
 * @param {string} label - Display name shown in the hub card
 * @param {string} defaultText - Default prompt text, seeded on first load
 * @param {{ warnJson?: boolean }} [opts]
 *   - `warnJson`: show a warning that this prompt must instruct the model to return JSON
 */
export function registerPrompt(key, label, defaultText, opts = {}) {
    if (_registry.some(r => r.key === key)) return;
    _registry.push({ key, label, defaultText, warnJson: !!opts.warnJson });
}

/**
 * Return a snapshot of all registered prompts (used by the hub).
 * @returns {Array<{key: string, label: string, defaultText: string, warnJson: boolean}>}
 */
export function getRegisteredPrompts() {
    return [..._registry];
}

/**
 * Get the current live value of a prompt.
 * Falls back to the registered default if the key has not been seeded yet.
 * @param {string} key
 * @returns {string}
 */
export function getPrompt(key) {
    if (state.systemPrompts && key in state.systemPrompts) return state.systemPrompts[key];
    return _registry.find(r => r.key === key)?.defaultText ?? '';
}

/**
 * Persist a new value for a prompt.
 * Writes to `state.systemPrompts` and calls `persistState()`.
 * @param {string} key
 * @param {string} value
 */
export function setPrompt(key, value) {
    if (!state.systemPrompts) state.systemPrompts = {};
    state.systemPrompts[key] = value;
    try {
        const saved = JSON.parse(localStorage.getItem(PROMPTS_KEY) || '{}');
        saved[key] = value;
        localStorage.setItem(PROMPTS_KEY, JSON.stringify(saved));
    } catch { /* ignore */ }
}

/**
 * Seed prompts into `state.systemPrompts` from the separate localStorage key,
 * falling back to registered defaults for any key not yet saved.
 * Call once during initialization — after all modules have been imported so
 * all `registerPrompt()` calls have already run.
 */
export function seedDefaultPrompts() {
    if (!state.systemPrompts) state.systemPrompts = {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(PROMPTS_KEY) || '{}'); } catch { /* ignore */ }
    for (const { key, defaultText } of _registry) {
        state.systemPrompts[key] = key in saved ? saved[key] : defaultText;
    }
}

// ─── Single-prompt edit popup ─────────────────────────────────────────────────

/**
 * Open a small draggable popup to edit a single registered prompt.
 * Replaces any previously open edit-prompt popup.
 * @param {string} key
 */
export function openEditPromptPopup(key) {
    const reg = _registry.find(r => r.key === key);
    if (!reg) return;

    document.getElementById('se-edit-prompt-popup')?.remove();

    const warnHtml = reg.warnJson
        ? '<div class="se-ep-warn">&#9888; This prompt must instruct the model to return valid JSON — removing that instruction will break parsing.</div>'
        : '';

    const pop = document.createElement('div');
    pop.id = 'se-edit-prompt-popup';
    pop.className = 'se-find-replace';
    pop.style.cssText = 'width:420px;';
    pop.innerHTML =
        `<div class="se-fr-header" id="se-ep-hdr">` +
        `  <span class="se-fr-title">&#9881; ${escHtml(reg.label)}</span>` +
        `  <button class="se-close-circle" id="se-ep-close">&times;</button>` +
        `</div>` +
        `<div class="se-fr-body">` +
        warnHtml +
        `  <textarea id="se-ep-textarea" class="se-fr-input" rows="8" style="resize:vertical;">${escHtml(getPrompt(key))}</textarea>` +
        `  <div class="se-fr-actions">` +
        `    <button class="se-btn se-btn-sm se-ep-reset-btn" id="se-ep-reset">Reset to default</button>` +
        `    <button class="se-btn se-btn-primary" id="se-ep-save">Save</button>` +
        `  </div>` +
        `</div>`;

    const overlay = document.getElementById('se-modal-overlay') || document.body;
    overlay.appendChild(pop);

    spawnPanel(pop, overlay, '#se-ep-hdr', 420, 400);

    document.getElementById('se-ep-close').addEventListener('click', () => pop.remove());
    document.getElementById('se-ep-reset').addEventListener('click', () => {
        document.getElementById('se-ep-textarea').value = reg.defaultText;
    });
    document.getElementById('se-ep-save').addEventListener('click', () => {
        setPrompt(key, document.getElementById('se-ep-textarea').value);
        pop.remove();
    });
}

// ─── Hub panel ────────────────────────────────────────────────────────────────

/**
 * Open the System Prompts hub panel.
 * Renders one editable card per registered prompt. Auto-saves on textarea blur.
 * Grows automatically as new prompts are registered anywhere in the codebase.
 */
export function openSystemPromptHub() {
    document.getElementById('se-sys-prompt-hub')?.remove();

    const cards = _registry.map(({ key, label, defaultText, warnJson }) => {
        const warnHtml = warnJson
            ? `<div class="se-ep-warn">&#9888; Must return valid JSON</div>`
            : '';
        return `<div class="se-sph-card">` +
            `<div class="se-sph-card-label">${escHtml(label)}</div>` +
            warnHtml +
            `<textarea class="se-fr-input se-sph-textarea" rows="5" ` +
            `data-prompt-key="${escHtml(key)}" ` +
            `data-default-text="${escHtml(defaultText)}"` +
            `>${escHtml(getPrompt(key))}</textarea>` +
            `<div class="se-sph-card-foot">` +
            `<button class="se-btn se-btn-sm se-ep-reset-btn se-sph-reset" data-reset-key="${escHtml(key)}">Reset</button>` +
            `</div>` +
            `</div>`;
    }).join('');

    const hub = document.createElement('div');
    hub.id = 'se-sys-prompt-hub';
    hub.className = 'se-find-replace se-sph';
    hub.style.cssText = 'width:460px;';
    hub.innerHTML =
        `<div class="se-fr-header" id="se-sph-hdr">` +
        `  <span class="se-fr-title">&#9881; System Prompts</span>` +
        `  <button class="se-close-circle" id="se-sph-close">&times;</button>` +
        `</div>` +
        `<div class="se-sph-body">${cards || '<div style="padding:12px;color:var(--se-muted);">No prompts registered yet.</div>'}</div>`;

    const overlay = document.getElementById('se-modal-overlay') || document.body;
    overlay.appendChild(hub);

    spawnPanel(hub, overlay, '#se-sph-hdr', 460, 600);
    document.getElementById('se-sph-close').addEventListener('click', () => hub.remove());

    // Auto-save on blur
    hub.querySelectorAll('.se-sph-textarea').forEach(ta => {
        ta.addEventListener('blur', () => setPrompt(ta.dataset.promptKey, ta.value));
    });

    // Per-card reset
    hub.querySelectorAll('.se-sph-reset').forEach(btn => {
        btn.addEventListener('click', () => {
            const k = btn.dataset.resetKey;
            const def = _registry.find(r => r.key === k)?.defaultText ?? '';
            const ta = hub.querySelector(`.se-sph-textarea[data-prompt-key="${k}"]`);
            if (ta) { ta.value = def; setPrompt(k, def); }
        });
    });
}
