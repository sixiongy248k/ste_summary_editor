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

import { EXT_NAME, TEMPLATES } from './constants.js';
import { state } from './state.js';
import { escHtml, spawnPanel } from './utils.js';
import { loadTemplate, fillTemplate } from './template-loader.js';

/** Separate localStorage key so prompts survive the main state clear on page load. */
const PROMPTS_KEY = 'se-system-prompts-v1';

/** Base URL for prompt text files. */
const PROMPTS_BASE = `/scripts/extensions/third-party/${EXT_NAME}/configs/prompts`;

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
        // Only use saved value if it is non-empty; otherwise fall back to the registered default.
        // This ensures that adding a default to a previously-blank prompt populates it on next load.
        const savedVal = key in saved ? saved[key] : '';
        state.systemPrompts[key] = savedVal.trim() ? savedVal : (defaultText ?? '');
    }
}

/**
 * Fetch prompt default text from `configs/prompts/{key}.txt` for every registered prompt.
 * Updates each registry entry's `defaultText` in place so `seedDefaultPrompts` picks it up.
 * Call once during init, after all modules are imported but before `seedDefaultPrompts`.
 */
export async function loadPromptDefaults() {
    await Promise.all(_registry.map(async (entry) => {
        try {
            const res = await fetch(`${PROMPTS_BASE}/${entry.key}.txt`);
            if (res.ok) entry.defaultText = (await res.text()).trim();
        } catch { /* keep empty default on network error */ }
    }));
}

// ─── Single-prompt edit popup ─────────────────────────────────────────────────

/**
 * Open a small draggable popup to edit a single registered prompt.
 * Replaces any previously open edit-prompt popup.
 * @param {string} key
 */
export async function openEditPromptPopup(key) {
    const reg = _registry.find(r => r.key === key);
    if (!reg) return;

    document.getElementById('se-edit-prompt-popup')?.remove();

    const warnHtml = reg.warnJson
        ? '<div class="se-ep-warn">&#9888; This prompt must instruct the model to return valid JSON — removing that instruction will break parsing.</div>'
        : '';

    const tmpl = await loadTemplate(TEMPLATES.EDIT_PROMPT_POPUP);
    const pop = document.createElement('div');
    pop.id = 'se-edit-prompt-popup';
    pop.className = 'se-find-replace';
    pop.style.cssText = 'width:420px;';
    pop.innerHTML = fillTemplate(tmpl, {
        label:      escHtml(reg.label),
        warnHtml,
        promptText: escHtml(getPrompt(key)),
    });

    const overlay = document.getElementById('se-modal-overlay') || document.body;
    overlay.appendChild(pop);

    spawnPanel(pop, overlay, '#se-ep-hdr', 420, 400);

    pop.querySelector('#se-ep-close').addEventListener('click', () => pop.remove());
    pop.querySelector('#se-ep-reset').addEventListener('click', () => {
        pop.querySelector('#se-ep-textarea').value = reg.defaultText;
    });
    pop.querySelector('#se-ep-save').addEventListener('click', () => {
        setPrompt(key, pop.querySelector('#se-ep-textarea').value);
        pop.remove();
    });
}

// ─── Hub panel ────────────────────────────────────────────────────────────────

/**
 * Open the System Prompts hub panel.
 * Renders one editable card per registered prompt. Auto-saves on textarea blur.
 * Grows automatically as new prompts are registered anywhere in the codebase.
 */
export async function openSystemPromptHub() {
    document.getElementById('se-sys-prompt-hub')?.remove();

    const [hubTmpl, cardTmpl] = await Promise.all([
        loadTemplate(TEMPLATES.SYSTEM_PROMPT_HUB),
        loadTemplate(TEMPLATES.SPH_CARD),
    ]);

    const cards = _registry.map(({ key, label, defaultText, warnJson }) => {
        const warnHtml = warnJson ? '<div class="se-ep-warn">&#9888; Must return valid JSON</div>' : '';
        return fillTemplate(cardTmpl, {
            label:       escHtml(label),
            warnHtml,
            key:         escHtml(key),
            defaultText: escHtml(defaultText),
            promptText:  escHtml(getPrompt(key)),
        });
    }).join('');

    const hub = document.createElement('div');
    hub.id = 'se-sys-prompt-hub';
    hub.className = 'se-find-replace se-sph';
    hub.style.cssText = 'width:460px;';
    hub.innerHTML = fillTemplate(hubTmpl, {
        cards: cards || '<div style="padding:12px;color:var(--se-muted);">No prompts registered yet.</div>',
    });

    const overlay = document.getElementById('se-modal-overlay') || document.body;
    overlay.appendChild(hub);

    spawnPanel(hub, overlay, '#se-sph-hdr', 460, 600);
    hub.querySelector('#se-sph-close').addEventListener('click', () => hub.remove());

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
