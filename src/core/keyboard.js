/**
 * @module keyboard
 * @description Keyboard shortcut handler for the Summary Editor modal.
 *
 * ## Shortcuts (only active when the modal is open)
 * - `Escape` — Close the editor
 * - `Space` — Toggle the checkbox on the hovered/focused table row
 * - `A` — Create an act from the current selection
 * - `Arrow Up/Down` — Move focus between table rows
 * - `Enter` — Open content editor for the focused row
 * - `Delete` — Remove the focused entry (with confirmation)
 *
 * These shortcuts are disabled when the user is typing in an input, textarea, or select.
 */

import { getCheckedNums } from '../table/table.js';
import { createActFromSelection } from '../arcs/arcs.js';

/** @type {Function|null} */
let _openContentEditorFn = null;
/** @type {Function|null} */
let _deleteEntryFn = null;

/**
 * Attach the global keyboard event listener.
 * Should be called once during initialization.
 *
 * @param {Function} closeEditorFn - Callback to close the modal.
 * @param {{ openContentEditor?: Function, deleteEntry?: Function }} [opts]
 */
export function bindKeyboardShortcuts(closeEditorFn, opts = {}) {
    _openContentEditorFn = opts.openContentEditor || null;
    _deleteEntryFn = opts.deleteEntry || null;
    $(document).on('keydown', (e) => handleKeydown(e, closeEditorFn));
}

/**
 * Handle a keydown event. Checks if the modal is open and the user
 * isn't typing in a form field before processing shortcuts.
 *
 * @param {KeyboardEvent} e - The keyboard event.
 * @param {Function} closeEditorFn - Callback to close the modal.
 */
function handleKeydown(e, closeEditorFn) {
    // Only handle shortcuts when the modal is visible
    if (!$('#se-modal-overlay').hasClass('active')) return;

    // Escape always works, even in inputs
    if (e.key === 'Escape') {
        closeEditorFn();
        return;
    }

    // Don't intercept shortcuts when user is typing in a form field
    if (isUserTyping(e)) return;

    if (e.key === ' ') {
        handleSpaceToggle(e);
    } else if (e.key === 'a' || e.key === 'A') {
        handleActShortcut();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        handleArrowNav(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
        handleEnterKey(e);
    } else if (e.key === 'Delete') {
        handleDeleteKey();
    }
}

/**
 * Check if the event target is a text input element.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function isUserTyping(e) {
    return $(e.target).is('input, textarea, select, [contenteditable]');
}

/**
 * Space key: toggle the checkbox on the currently hovered or focused row.
 * @param {KeyboardEvent} e
 */
function handleSpaceToggle(e) {
    e.preventDefault();

    const $focused = $('#se-table-body tr.se-row-focused');
    const $row = $focused.length ? $focused : $('#se-table-body tr:hover').first();
    if ($row.length) {
        const $checkbox = $row.find('input[type="checkbox"]');
        $checkbox.prop('checked', !$checkbox.prop('checked')).trigger('change');
    }
}

/** A key: create act from selection. */
function handleActShortcut() {
    if (getCheckedNums().length > 0) {
        createActFromSelection();
    }
}

/**
 * Arrow key: move focus to the next/previous row.
 * @param {number} direction - +1 for down, -1 for up.
 */
function handleArrowNav(direction) {
    const $rows = $('#se-table-body tr[data-num]');
    if (!$rows.length) return;

    const $focused = $rows.filter('.se-row-focused');
    let idx = $focused.length ? $rows.index($focused) + direction : 0;
    idx = Math.max(0, Math.min($rows.length - 1, idx));

    $rows.removeClass('se-row-focused');
    const $target = $rows.eq(idx);
    $target.addClass('se-row-focused');

    // Scroll into view
    $target[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Enter key: open content editor for the focused row. */
function handleEnterKey(e) {
    const $focused = $('#se-table-body tr.se-row-focused');
    if (!$focused.length || !_openContentEditorFn) return;
    e.preventDefault();
    const num = Number.parseInt($focused.data('num'), 10);
    if (!Number.isNaN(num)) _openContentEditorFn(num);
}

/** Delete key: remove the focused entry. */
function handleDeleteKey() {
    const $focused = $('#se-table-body tr.se-row-focused');
    if (!$focused.length || !_deleteEntryFn) return;
    const num = Number.parseInt($focused.data('num'), 10);
    if (!Number.isNaN(num)) _deleteEntryFn(num);
}
