/**
 * @module color-picker
 * @description Shared floating color picker powered by iro.js.
 *
 * Uses a box (SV) + hue-slider layout with a format row (HEX / HSL / RGB).
 * Provides a single reusable picker opened from act badge clicks.
 */

import { makeDraggable } from '../core/utils.js';

/** @type {object|null} iro.ColorPicker instance. */
let picker = null;

/** @type {jQuery|null} The floating container element. */
let $container = null;

/** @type {function|null} Current callback when color changes. */
let onChangeCallback = null;

/** @type {number|null} Act ID currently being color-edited. */
let activeActId = null;

/**
 * Rebuild input fields to match the selected format.
 * @param {object} color - iro color object
 * @param {string} mode - 'hex' | 'hsl' | 'rgb'
 * @param {jQuery} $fields - container to fill
 */
export function cpRenderFields(color, mode, $fields) {
    if (mode === 'hsl') {
        const { h, s, l } = color.hsl;
        $fields.html(
            `<input class="se-cp-field" data-key="h" value="${Math.round(h)}" placeholder="H" maxlength="3" />` +
            `<input class="se-cp-field" data-key="s" value="${Math.round(s)}" placeholder="S" maxlength="3" />` +
            `<input class="se-cp-field" data-key="l" value="${Math.round(l)}" placeholder="L" maxlength="3" />`
        );
    } else if (mode === 'rgb') {
        const { r, g, b } = color.rgb;
        $fields.html(
            `<input class="se-cp-field" data-key="r" value="${r}" placeholder="R" maxlength="3" />` +
            `<input class="se-cp-field" data-key="g" value="${g}" placeholder="G" maxlength="3" />` +
            `<input class="se-cp-field" data-key="b" value="${b}" placeholder="B" maxlength="3" />`
        );
    } else {
        $fields.html(
            `<input class="se-cp-field se-cp-field-hex" value="${color.hexString.replace('#', '')}" placeholder="rrggbb" maxlength="6" />`
        );
    }
}

/**
 * Apply field values back to an iro color object.
 * @param {object} color - iro color object (mutated in place)
 * @param {string} mode - 'hex' | 'hsl' | 'rgb'
 * @param {jQuery} $fields - fields container
 */
export function cpApplyFields(color, mode, $fields) {
    if (mode === 'hex') {
        const raw = $fields.find('.se-cp-field').val();
        const val = raw.replaceAll(/[^0-9a-fA-F]/g, '').slice(0, 6);
        if (val.length === 6) color.hexString = '#' + val;
    } else if (mode === 'hsl') {
        const h = Number.parseFloat($fields.find('[data-key="h"]').val()) || 0;
        const s = Number.parseFloat($fields.find('[data-key="s"]').val()) || 0;
        const l = Number.parseFloat($fields.find('[data-key="l"]').val()) || 0;
        color.hsl = { h, s, l };
    } else if (mode === 'rgb') {
        const r = Number.parseInt($fields.find('[data-key="r"]').val(), 10) || 0;
        const g = Number.parseInt($fields.find('[data-key="g"]').val(), 10) || 0;
        const b = Number.parseInt($fields.find('[data-key="b"]').val(), 10) || 0;
        color.rgb = { r, g, b };
    }
}

/**
 * Ensure the picker container + iro instance exist.
 * Lazily created on first use.
 */
function ensurePicker() {
    if ($container) return;

    $container = $(`
        <div class="se-iro-picker" id="se-iro-picker" style="display:none;">
            <div class="se-iro-header">
                <span class="se-iro-title">Color</span>
            </div>
            <div class="se-iro-box-wrap">
                <div id="se-iro-mount"></div>
            </div>
            <div class="se-cp-format-row">
                <div class="se-cp-swatch" id="se-cp-swatch"></div>
                <select class="se-cp-fmt-select" id="se-cp-fmt">
                    <option value="hex">HEX</option>
                    <option value="hsl">HSL</option>
                    <option value="rgb">RGB</option>
                </select>
                <div class="se-cp-fields" id="se-cp-flds"></div>
            </div>
        </div>
    `).appendTo('#se-modal-overlay');

    makeDraggable($container[0], $container.find('.se-iro-header')[0]);

    picker = new iro.ColorPicker('#se-iro-mount', {
        width: 210,
        color: '#a6e22e',
        borderWidth: 0,
        handleRadius: 7,
        layout: [
            { component: iro.ui.Box },
            { component: iro.ui.Slider, options: { sliderType: 'hue' } },
        ],
    });

    picker.on('color:change', (color) => {
        const mode = $('#se-cp-fmt').val() || 'hex';
        cpRenderFields(color, mode, $('#se-cp-flds'));
        $('#se-cp-swatch').css('background', color.hexString);
        if (onChangeCallback) onChangeCallback(color.hexString);
    });

    // Format dropdown → re-render fields without changing color
    $container.on('change', '#se-cp-fmt', () => {
        cpRenderFields(picker.color, $('#se-cp-fmt').val() || 'hex', $('#se-cp-flds'));
    });

    // Field input → push back into picker
    $container.on('input', '.se-cp-field', () => {
        const mode = $('#se-cp-fmt').val() || 'hex';
        cpApplyFields(picker.color, mode, $('#se-cp-flds'));
    });
}

/**
 * Open the floating color picker near a target element.
 *
 * @param {HTMLElement} anchorEl - Element to position near.
 * @param {string} currentColor - Starting hex color (e.g. '#a6e22e').
 * @param {number} actId - Act ID being edited.
 * @param {function} onChange - Called with new hex string on every change.
 */
export function openColorPicker(anchorEl, currentColor, actId, onChange) {
    ensurePicker();

    if (activeActId === actId && $container.is(':visible')) {
        closeColorPicker();
        return;
    }

    activeActId = actId;
    onChangeCallback = onChange;

    picker.color.hexString = currentColor;
    const mode = $('#se-cp-fmt').val() || 'hex';
    cpRenderFields(picker.color, mode, $('#se-cp-flds'));
    $('#se-cp-swatch').css('background', currentColor);

    // Position near anchor
    const rect = anchorEl.getBoundingClientRect();
    const overlay = document.getElementById('se-modal-overlay');
    const overlayRect = overlay.getBoundingClientRect();

    let left = rect.left - overlayRect.left + rect.width + 8;
    let top = rect.top - overlayRect.top;

    const pickerWidth = 250;
    const pickerHeight = 360;
    if (left + pickerWidth > overlayRect.width) {
        left = rect.left - overlayRect.left - pickerWidth - 8;
    }
    if (top + pickerHeight > overlayRect.height) {
        top = overlayRect.height - pickerHeight - 8;
    }
    top = Math.max(8, top);

    $container.css({ left: left + 'px', top: top + 'px', display: 'block' });
}

/**
 * Close the floating color picker.
 */
export function closeColorPicker() {
    if ($container) $container.hide();
    activeActId = null;
    onChangeCallback = null;
}

/**
 * Check if the picker is currently visible.
 * @returns {boolean}
 */
export function isColorPickerOpen() {
    return $container ? $container.is(':visible') : false;
}
