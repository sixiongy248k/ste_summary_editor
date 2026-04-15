/**
 * @module magic-wand
 * @description Injects a "Revamp Summary" option into SillyTavern's magic wand dropdown.
 *
 * ## What Is the Magic Wand?
 * ST has a built-in "magic wand" button with a dropdown of text manipulation options.
 * This module adds our own option to that dropdown so users can launch Summary Editor
 * directly from ST's existing UI workflow.
 *
 * ## Integration Strategy
 * ST's wand menu is dynamically rendered, so we use two approaches:
 * 1. A MutationObserver that watches for the wand container to appear
 * 2. A delayed fallback injection (3 seconds after page load)
 *
 * This ensures the option appears regardless of when ST renders the wand.
 *
 * ## Blacklist Awareness
 * If the current character is blocked, the wand option is removed (not just hidden).
 * The observer re-checks on every DOM mutation, so switching to a blocked character
 * automatically hides it.
 */

/** @type {Function|null} */
let _isBlockedFn = null;

/**
 * Set up the magic wand integration.
 * Injects the "Revamp Summary" option into ST's wand dropdown menu.
 *
 * @param {Function} openEditorFn - Callback to open the Summary Editor modal.
 * @param {Function} [isBlockedFn] - Returns true if the current character is blacklisted.
 */
export function injectMagicWandOption(openEditorFn, isBlockedFn) {
    _isBlockedFn = isBlockedFn || null;
    observeForWandMenu(openEditorFn);
    fallbackWandInjection(openEditorFn);
}

/**
 * Use a MutationObserver to detect when ST's wand menu appears in the DOM,
 * then inject our option into it. If the character is blocked, remove instead.
 *
 * @param {Function} openEditorFn - Callback to open the editor.
 */
function observeForWandMenu(openEditorFn) {
    const observer = new MutationObserver(() => {
        const $wand = findWandContainer();
        if (!$wand.length) return;

        if (_isBlockedFn?.()) {
            $wand.find('#se-wand-option').remove();
        } else if (!$wand.find('#se-wand-option').length) {
            injectWandButton($wand, openEditorFn);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Delayed fallback: try to inject the wand option 3 seconds after load.
 * Covers the case where the wand container already existed before our observer started.
 *
 * @param {Function} openEditorFn - Callback to open the editor.
 */
function fallbackWandInjection(openEditorFn) {
    setTimeout(() => {
        const $wand = findWandContainer();
        if (!$wand.length) return;

        if (_isBlockedFn?.()) {
            $wand.find('#se-wand-option').remove();
        } else if (!$wand.find('#se-wand-option').length) {
            injectWandButton($wand, openEditorFn);
        }
    }, 3000);
}

/**
 * Find ST's magic wand dropdown container in the DOM.
 * In ST 1.17.0, the wand menu is `#extensionsMenu` containing
 * `div.extension_container` children for each built-in extension.
 *
 * @returns {jQuery} The wand container element (may be empty if not found).
 */
function findWandContainer() {
    return $('#extensionsMenu');
}

/**
 * Append the "Summary Editor" button to the wand container.
 * Matches the exact structure of ST's built-in wand items
 * (list-group-item flex-container flexGap5 with icon + span).
 *
 * @param {jQuery} $container - The wand dropdown container.
 * @param {Function} openEditorFn - Callback to open the editor.
 */
function injectWandButton($container, openEditorFn) {
    $container.append(
        '<div id="se-wand-option" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="Open Summary Editor">' +
        '<div class="fa-fw fa-solid fa-book extensionsMenuExtensionButton"></div>' +
        '<span>Summary Editor</span>' +
        '</div>',
    );
    $('#se-wand-option').on('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Small delay to let ST's wand dropdown close before opening our overlay
        setTimeout(() => openEditorFn(), 50);
    });
}
