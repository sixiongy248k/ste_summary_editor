/**
 * @module tooltip
 * @description Hover tooltip for truncated content cells in the timeline table.
 *
 * When entry content is too long for the table cell, it gets CSS-truncated.
 * Hovering over the truncated text shows a positioned tooltip with a preview
 * (capped at ~50 words with "...").
 *
 * A "Show Full" checkbox in the toolbar removes the CSS clamp so all
 * content is visible inline without needing tooltips.
 */

/** Max words shown in the hover tooltip before truncating with "..." */
const TOOLTIP_WORD_LIMIT = 50;

/**
 * Truncate text to a word limit, appending "..." if exceeded.
 *
 * @param {string} text - Full text.
 * @param {number} limit - Max number of words.
 * @returns {string} Truncated text.
 */
function truncateWords(text, limit) {
    const words = text.split(/\s+/);
    if (words.length <= limit) return text;
    return words.slice(0, limit).join(' ') + '...';
}

/**
 * Bind tooltip show/hide events on content text elements.
 * Should be called once during initialization.
 */
export function bindTooltipEvents() {
    $(document).on('mouseenter', '.se-content-text', showTooltip);
    $(document).on('mouseleave', '.se-content-text', hideTooltip);
}

/**
 * Show a tooltip near the hovered element with a truncated preview.
 * Skipped when "Show Full" mode is active (content is already visible).
 *
 * @this {HTMLElement} The hovered .se-content-text element.
 */
function showTooltip() {
    // Don't show tooltip if full content is already visible
    if ($('#se-table').hasClass('se-show-full-content')) return;

    const fullText = $(this).data('full');
    if (!fullText) return;

    hideTooltip();

    const preview = truncateWords(fullText, TOOLTIP_WORD_LIMIT);
    const $tip = $('<div class="se-tooltip"></div>').text(preview);
    $('body').append($tip);

    const rect = this.getBoundingClientRect();
    $tip.css({
        top: rect.bottom + 8,
        left: Math.min(rect.left, window.innerWidth - 520),
    });
}

/**
 * Remove all tooltips from the DOM.
 */
export function hideTooltip() {
    $('.se-tooltip').remove();
}
