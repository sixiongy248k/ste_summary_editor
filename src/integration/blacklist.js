/**
 * @module blacklist
 * @description Character and tag blacklist for Summary Editor.
 *
 * Stores blacklisted character avatars and tag IDs in ST's extensionSettings.
 * When the current character (or any of its tags) matches the blacklist,
 * the editor button is disabled and the magic wand option is hidden.
 */

import { EXT_NAME } from '../core/constants.js';
import { escHtml, escAttr } from '../core/utils.js';

/* ───────────────────────── Settings helpers ───────────────────────── */

/** @returns {object} The extension settings object, initialised if needed. */
function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[EXT_NAME]) {
        context.extensionSettings[EXT_NAME] = { blacklistedCharacters: [], blacklistedTags: [] };
    }
    const s = context.extensionSettings[EXT_NAME];
    if (!s.blacklistedCharacters) s.blacklistedCharacters = [];
    if (!s.blacklistedTags) s.blacklistedTags = [];
    return s;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

/* ───────────────────────── Public API ───────────────────────── */

/**
 * Check if the currently selected character is filtered.
 * Returns a reason string or null if not filtered.
 *
 * @returns {'character'|'tag'|null}
 */
export function getFilterReason() {
    const context = SillyTavern.getContext();
    const chid = context.characterId;
    if (chid == null || !context.characters?.[chid]) return null;

    const avatar = context.characters[chid].avatar;
    const settings = getSettings();

    if (settings.blacklistedCharacters.includes(avatar)) return 'character';

    if (settings.blacklistedTags.length > 0) {
        const charTags = context.tagMap?.[avatar] || [];
        if (charTags.some(tid => settings.blacklistedTags.includes(tid))) return 'tag';
    }

    return null;
}

/**
 * Check if the currently selected character is filtered (boolean shorthand).
 * @returns {boolean}
 */
export function isCharacterBlocked() {
    return getFilterReason() !== null;
}

/**
 * Update the settings-panel button and blacklist pills to reflect
 * the current character's filtered state.
 */
export function refreshBlockedState() {
    const reason = getFilterReason();
    const labels = { character: 'Blocked by blacklisted character', tag: 'Blocked by tag' };
    $('#se_open_btn')
        .prop('disabled', reason !== null)
        .val(reason ? labels[reason] : 'Open Summary Editor');
    renderPills();
}

/* ───────────────────────── Pill rendering ───────────────────────── */

function renderPills() {
    const context = SillyTavern.getContext();
    const settings = getSettings();

    // Character pills
    const $cp = $('#se-bl-char-pills').empty();
    for (const avatar of settings.blacklistedCharacters) {
        const char = context.characters?.find(c => c.avatar === avatar);
        const name = char?.name || avatar;
        $cp.append(
            `<span class="se-bl-pill" data-avatar="${escAttr(avatar)}">` +
            `${escHtml(name)}<span class="se-bl-pill-x" data-bl-remove-char="${escAttr(avatar)}">&times;</span>` +
            '</span>',
        );
    }

    // Tag pills
    const $tp = $('#se-bl-tag-pills').empty();
    for (const tagId of settings.blacklistedTags) {
        const tag = context.tags?.find(t => t.id === tagId);
        const name = tag?.name || tagId;
        const bg = tag?.color || '#555';
        const fg = tag?.color2 || '#fff';
        $tp.append(
            `<span class="se-bl-pill" data-tag-id="${escAttr(tagId)}" ` +
            `style="background:${escAttr(bg)};color:${escAttr(fg)};border-color:${escAttr(bg)};">` +
            `${escHtml(name)}<span class="se-bl-pill-x" data-bl-remove-tag="${escAttr(tagId)}">&times;</span>` +
            '</span>',
        );
    }
}

/* ───────────────────────── Event binding ───────────────────────── */

/**
 * Bind autocomplete inputs and pill remove buttons in the settings panel.
 * Call once after the settings HTML has been injected.
 */
export function bindBlacklistEvents() {
    const settings = getSettings();

    // ── Character autocomplete ──
    $('#se-bl-char-search').on('input', function () {
        const query = $(this).val().toLowerCase().trim();
        const $dd = $('#se-bl-char-dropdown');
        if (!query) { $dd.empty().hide(); return; }

        const context = SillyTavern.getContext();
        const matches = (context.characters || [])
            .filter(c => c?.name && c.name.toLowerCase().includes(query)
                && !settings.blacklistedCharacters.includes(c.avatar))
            .slice(0, 10);

        if (!matches.length) { $dd.empty().hide(); return; }

        $dd.empty();
        for (const ch of matches) {
            $dd.append(
                `<div class="se-bl-option" data-bl-add-char="${escAttr(ch.avatar)}">${escHtml(ch.name)}</div>`,
            );
        }
        $dd.show();
    });

    $(document).on('click', '[data-bl-add-char]', function () {
        const avatar = $(this).attr('data-bl-add-char');
        if (!settings.blacklistedCharacters.includes(avatar)) {
            settings.blacklistedCharacters.push(avatar);
            saveSettings();
        }
        $('#se-bl-char-search').val('');
        $('#se-bl-char-dropdown').empty().hide();
        refreshBlockedState();
    });

    // ── Tag autocomplete ──
    $('#se-bl-tag-search').on('input', function () {
        const query = $(this).val().toLowerCase().trim();
        const $dd = $('#se-bl-tag-dropdown');
        if (!query) { $dd.empty().hide(); return; }

        const context = SillyTavern.getContext();
        const matches = (context.tags || [])
            .filter(t => t?.name && t.name.toLowerCase().includes(query)
                && !settings.blacklistedTags.includes(t.id))
            .slice(0, 10);

        if (!matches.length) { $dd.empty().hide(); return; }

        $dd.empty();
        for (const tag of matches) {
            const border = tag.color ? ` style="border-left:3px solid ${escAttr(tag.color)};padding-left:6px;"` : '';
            const folder = (tag.folder_type && tag.folder_type !== 'NONE') ? ' &#128193;' : '';
            $dd.append(
                `<div class="se-bl-option" data-bl-add-tag="${escAttr(tag.id)}"${border}>${escHtml(tag.name)}${folder}</div>`,
            );
        }
        $dd.show();
    });

    $(document).on('click', '[data-bl-add-tag]', function () {
        const tagId = $(this).attr('data-bl-add-tag');
        if (!settings.blacklistedTags.includes(tagId)) {
            settings.blacklistedTags.push(tagId);
            saveSettings();
        }
        $('#se-bl-tag-search').val('');
        $('#se-bl-tag-dropdown').empty().hide();
        refreshBlockedState();
    });

    // ── Remove pills ──
    $(document).on('click', '[data-bl-remove-char]', function () {
        const avatar = $(this).attr('data-bl-remove-char');
        settings.blacklistedCharacters = settings.blacklistedCharacters.filter(a => a !== avatar);
        saveSettings();
        refreshBlockedState();
    });

    $(document).on('click', '[data-bl-remove-tag]', function () {
        const tagId = $(this).attr('data-bl-remove-tag');
        settings.blacklistedTags = settings.blacklistedTags.filter(t => t !== tagId);
        saveSettings();
        refreshBlockedState();
    });

    // ── Close dropdowns on outside click ──
    $(document).on('click', function (e) {
        if (!$(e.target).closest('.se-bl-input-wrap').length) {
            $('.se-bl-dropdown').empty().hide();
        }
    });

    // Initial render
    refreshBlockedState();
}
