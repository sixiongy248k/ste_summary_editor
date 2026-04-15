/**
 * @module databank
 * @description Handles injecting exported summaries into SillyTavern's databank
 * as character attachments.
 *
 * ## Modes
 * - **Append** (default): Creates a new entry with incremental naming
 *   `SE_Entry_1: bulk_summary`, `SE_Entry_2: bulk_summary`, etc.
 *   Each inject creates a new entry so the user always knows which is newer.
 * - **Overwrite** (destructive): Replaces any existing entry with the same name.
 *   Does not use incremental naming — uses a fixed name `SE_bulk_summary`.
 *
 * ## Naming Convention
 * Append mode: `SE_Entry_N: bulk_summary.ext` where N auto-increments
 * Overwrite mode: `SE_bulk_summary.ext` (fixed, replaces existing)
 *
 * ## API Pattern
 * Uses `SillyTavern.getContext()` for extensionSettings, character info,
 * and `/api/files/upload` endpoint for file upload.
 */

import { buildExportContent } from './export.js';
import { spawnPanel } from '../core/utils.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';
import { TEMPLATES } from '../core/constants.js';
import { state, persistState } from '../core/state.js';

/** @type {number} Tracks the next append entry number (session-scoped). */
let nextEntryNum = 1;

/**
 * Fast content hash for change detection (same algorithm as hashString).
 * @param {string} str
 * @returns {string}
 */
function hashContent(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.trunc(((h << 5) - h) + str.codePointAt(i));
    }
    return String(Math.abs(h));
}

/**
 * Scan existing attachments to determine the next SE_Entry number.
 * @param {object} context - SillyTavern context.
 * @param {string|undefined} avatar - Character avatar key.
 */
function syncEntryNumber(context, avatar) {
    if (!avatar) return;
    const existing = context.extensionSettings?.character_attachments?.[avatar] || [];
    for (const att of existing) {
        const match = att.name?.match(/^SE_Entry_(\d+):/);
        if (match) {
            const n = Number.parseInt(match[1], 10);
            if (n >= nextEntryNum) nextEntryNum = n + 1;
        }
    }
}

/**
 * Build the target filename based on mode and format.
 * @param {string} mode - 'append' or 'overwrite'.
 * @param {string} ext - File extension including dot.
 * @returns {string} Target filename.
 */
function buildTargetFileName(mode, ext) {
    if (mode === 'overwrite') return `SE_bulk_summary${ext}`;
    return `SE_Entry_${nextEntryNum}: bulk_summary${ext}`;
}

/**
 * Inject the current summary export into the active character's databank.
 * Shows a mode selection dialog, builds the file, uploads, and registers.
 */
export async function handleDatabankInject() {
    const context = SillyTavern.getContext();

    if (context.characterId === undefined && !context.groupId) {
        alert('No character or group selected. Open a chat first.');
        return;
    }

    const avatar = context.characters?.[context.characterId]?.avatar;
    syncEntryNumber(context, avatar);

    const mode = await showInjectDialog();
    if (!mode) return;

    const format = $('#se-export-format').val();
    let ext = '.txt';
    if (format === 'json') ext = '.json';
    else if (format === 'yaml') ext = '.yaml';

    const fileName = buildTargetFileName(mode, ext);
    const content = buildExportContent(format);

    // Incremental: skip upload if content hasn't changed since last inject
    const contentHash = hashContent(content);
    if (mode === 'overwrite' && contentHash === state.lastInjectHash) {
        alert('Databank is already up to date — no changes since last inject.');
        return;
    }

    try {
        if (mode === 'overwrite') removeExistingEntry(context, avatar, fileName);
        await uploadToDatabank(context, fileName, content);
        if (mode === 'append') nextEntryNum++;
        if (mode === 'overwrite') {
            state.lastInjectHash = contentHash;
            persistState();
        }
        alert(`Successfully injected "${fileName}" into databank.`);
    } catch (err) {
        console.error('[Summary Editor] Databank inject failed:', err);
        alert(`Databank injection failed: ${err.message}\n\nYou can still use the Download Export button.`);
    }
}

/**
 * Show the inject mode dialog.
 * @returns {Promise<string|null>} 'append', 'overwrite', or null if cancelled.
 */
async function showInjectDialog() {
    const tmpl = await loadTemplate(TEMPLATES.DIALOG_DATABANK_INJECT);
    const html = fillTemplate(tmpl, { nextNum: nextEntryNum });

    const overlay = document.getElementById('se-modal-overlay');
    const $dialog = $(html).appendTo(overlay);
    const dlgEl = $dialog[0];
    spawnPanel(dlgEl, overlay, '.se-float-panel-header');

    return new Promise(resolve => {
        const close = (result) => { $dialog.remove(); resolve(result); };
        $dialog.find('.se-inject-mode').on('click', function () { close($(this).data('mode')); });
        $dialog.find('.se-dialog-cancel').on('click', () => close(null));
    });
}

/**
 * Remove an existing attachment by name (for overwrite mode).
 *
 * @param {object} context - SillyTavern context.
 * @param {string} avatar - Character avatar key.
 * @param {string} fileName - Name to match and remove.
 */
function removeExistingEntry(context, avatar, fileName) {
    if (!avatar || !context.extensionSettings?.character_attachments?.[avatar]) return;
    const attachments = context.extensionSettings.character_attachments[avatar];
    const idx = attachments.findIndex(a => a.name === fileName);
    if (idx !== -1) {
        attachments.splice(idx, 1);
        context.saveSettingsDebounced();
    }
}

/**
 * Convert a string to base64.
 * @param {string} text - The text to encode.
 * @returns {string} Base64-encoded string.
 */
function textToBase64(text) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCodePoint(byte);
    }
    return btoa(binary);
}

/**
 * Upload file content to ST's server and register it as a character attachment.
 *
 * @param {object} context - SillyTavern context from getContext().
 * @param {string} fileName - Display name for the attachment.
 * @param {string} content - File content as a string.
 */
async function uploadToDatabank(context, fileName, content) {
    const base64Data = textToBase64(content);
    const slug = hashString(fileName);
    const uniqueFileName = `${Date.now()}_${slug}.txt`;

    const headers = context.getRequestHeaders?.() || {};
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: uniqueFileName, data: base64Data }),
    });

    if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
    }

    const result = await response.json();
    const fileUrl = result.path;

    if (!fileUrl) {
        throw new Error('Server did not return a file path');
    }

    const attachment = {
        url: fileUrl,
        size: Math.round(base64Data.length * 0.75),
        name: fileName,
        created: Date.now(),
    };

    const avatar = context.characters?.[context.characterId]?.avatar;
    if (!avatar) {
        throw new Error('Could not determine character avatar for attachment registration');
    }

    if (!context.extensionSettings.character_attachments) {
        context.extensionSettings.character_attachments = {};
    }
    if (!Array.isArray(context.extensionSettings.character_attachments[avatar])) {
        context.extensionSettings.character_attachments[avatar] = [];
    }

    context.extensionSettings.character_attachments[avatar].push(attachment);
    context.saveSettingsDebounced();
}

/**
 * Simple string hash (same algorithm as ST's getStringHash).
 * @param {string} str - Input string.
 * @returns {number} Numeric hash.
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.codePointAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = Math.trunc(hash);
    }
    return Math.abs(hash);
}
