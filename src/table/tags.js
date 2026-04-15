/**
 * @module tags
 * @description Chip/pill tag autocomplete for date, time, location fields.
 *
 * Collects unique values from existing entries and provides typeahead
 * suggestions when editing cells. Tags are session-scoped (derived from
 * current entries, cleared on character swap/reload).
 *
 * Also provides a "Tag Browser" panel accessible from the review toolbar
 * to view/manage all collected tags organized by category.
 */

import { state } from '../core/state.js';
import { escHtml, escAttr, spawnPanel } from '../core/utils.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';
import { TEMPLATES, ENTRY_FIELDS } from '../core/constants.js';

/** Fields that support tag autocomplete (mirrors ENTRY_FIELDS from constants). */
const TAG_FIELDS = ENTRY_FIELDS;

/**
 * Generate a sequence of transitional HSL border colors for pills.
 * Starts at a random hue per category; each subsequent pill shifts
 * by a consistent step creating a smooth gradient effect.
 *
 * @param {number} count - Number of colors to generate.
 * @param {string} field - Category field (used as seed for starting hue).
 * @returns {string[]} Array of hex color strings.
 */
function generatePillColors(count, field) {
    if (count === 0) return [];
    // Deterministic-ish starting hue per field so it's stable across opens
    const seedMap = { date: 0, time: 120, location: 240 };
    const hue = (seedMap[field] || 0) + (Math.random() * 60 - 30); // slight randomness
    const step = 360 / Math.max(count, 6); // spread across hue wheel
    const colors = [];
    for (let i = 0; i < count; i++) {
        colors.push(hslToHex(((hue + i * step) % 360 + 360) % 360, 65, 55));
    }
    return colors;
}

/**
 * Convert HSL to hex color string.
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @returns {string} Hex color like '#a6e22e'
 */
function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Collect all unique non-empty values for a given field from entries.
 * Returns them sorted alphabetically with usage counts.
 *
 * @param {string} field - One of 'date', 'time', 'location'.
 * @returns {Array<{value: string, count: number}>} Sorted unique values.
 */
export function getTagsForField(field) {
    const counts = new Map();
    for (const entry of state.entries.values()) {
        const val = (entry[field] || '').trim();
        if (val) {
            counts.set(val, (counts.get(val) || 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Get autocomplete suggestions for a partial input value.
 * Returns the top 5 matches, prioritized by frequency.
 *
 * @param {string} field - One of 'date', 'time', 'location'.
 * @param {string} query - Partial input text.
 * @returns {string[]} Up to 5 matching tag values.
 */
export function getSuggestions(field, query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return getTagsForField(field)
        .filter(t => t.value.toLowerCase().includes(q))
        .slice(0, 5)
        .map(t => t.value);
}

/**
 * Attach an autocomplete dropdown to a cell edit input.
 * Call this after creating the edit popover for date/time/location fields.
 *
 * @param {HTMLInputElement} input - The edit popover input element.
 * @param {string} field - One of 'date', 'time', 'location'.
 * @param {function} onSelect - Called with the selected tag value.
 */
export function attachAutocomplete(input, field, onSelect) {
    if (!TAG_FIELDS.includes(field)) return;

    // Create dropdown container (appended to body for z-index safety)
    const dropdown = document.createElement('div');
    dropdown.className = 'se-tag-dropdown';
    document.body.appendChild(dropdown);

    let selectedIdx = -1;

    /** Position the dropdown below the input using fixed coords. */
    const positionDropdown = () => {
        const rect = input.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        dropdown.style.top = (rect.bottom + 1) + 'px';
    };

    /** Bind mousedown handlers on all current option elements. */
    const bindOptionClicks = (stripCount) => {
        dropdown.querySelectorAll('.se-tag-option').forEach(el => {
            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const text = stripCount
                    ? el.textContent.replace(/\s*\(\d+\)$/, '')
                    : el.textContent;
                input.value = text;
                dropdown.style.display = 'none';
                onSelect(text);
            });
        });
    };

    const showDropdown = (html) => {
        dropdown.innerHTML = html;
        positionDropdown();
        dropdown.style.display = 'block';
    };

    const updateDropdown = () => {
        const suggestions = getSuggestions(field, input.value);
        selectedIdx = -1;

        if (suggestions.length === 0) {
            dropdown.style.display = 'none';
            return;
        }

        showDropdown(suggestions
            .map((s, i) => `<div class="se-tag-option" data-idx="${i}">${escHtml(s)}</div>`)
            .join(''));
        bindOptionClicks(false);
    };

    input.addEventListener('input', updateDropdown);

    // Keyboard navigation within autocomplete
    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.se-tag-option');
        if (items.length === 0 || dropdown.style.display === 'none') return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
            highlightItem(items, selectedIdx);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIdx = Math.max(selectedIdx - 1, 0);
            highlightItem(items, selectedIdx);
        } else if (e.key === 'Tab' && selectedIdx >= 0) {
            e.preventDefault();
            input.value = items[selectedIdx].textContent;
            dropdown.style.display = 'none';
            onSelect(items[selectedIdx].textContent);
        }
    });

    // Show existing tags immediately if input is empty (show top 5)
    if (!input.value) {
        const tags = getTagsForField(field).slice(0, 5);
        if (tags.length > 0) {
            showDropdown(tags
                .map((t, i) => `<div class="se-tag-option" data-idx="${i}">${escHtml(t.value)} <span class="se-tag-count">(${t.count})</span></div>`)
                .join(''));
            bindOptionClicks(true);
        }
    }

    // Hide on blur and clean up DOM
    input.addEventListener('blur', () => {
        setTimeout(() => { dropdown.style.display = 'none'; }, 150);
    });

    // Remove dropdown from DOM when popover closes
    const observer = new MutationObserver(() => {
        if (!document.body.contains(input)) {
            dropdown.remove();
            observer.disconnect();
        }
    });
    observer.observe(input.closest('.se-edit-popover') || document.body, { childList: true, subtree: true });
}

/**
 * Highlight a specific item in the autocomplete dropdown.
 *
 * @param {NodeList} items - All dropdown option elements.
 * @param {number} idx - Index to highlight.
 */
function highlightItem(items, idx) {
    items.forEach((el, i) => {
        el.classList.toggle('se-tag-option-active', i === idx);
    });
}

/**
 * Show the tag browser dialog with all tags organized by category.
 * Tabs for Date, Time, Location — each showing an alphabetically
 * sorted list of pills with usage count and delete button.
 */
export async function showTagBrowser(onClose) {
    const sections = TAG_FIELDS.map(field => {
        const tags = getTagsForField(field);
        const label = field.charAt(0).toUpperCase() + field.slice(1);
        return { field, label, tags };
    });

    const hasTags = sections.some(s => s.tags.length > 0);
    if (!hasTags) {
        alert('No tags yet. Tags are created as you fill in date, time, and location fields.');
        return;
    }

    const [panelTmpl, tabTmpl, pillTmpl, panelSectionTmpl] = await Promise.all([
        loadTemplate(TEMPLATES.DIALOG_TAG_BROWSER),
        loadTemplate(TEMPLATES.TB_TAB),
        loadTemplate(TEMPLATES.TB_PILL),
        loadTemplate(TEMPLATES.TB_PANEL),
    ]);

    const tabsHtml = sections.map((s, i) =>
        fillTemplate(tabTmpl, {
            activeCls: i === 0 ? ' se-tb-tab-active' : '',
            field:     s.field,
            label:     s.label,
            count:     s.tags.length,
        })
    ).join('');

    const panelsHtml = sections.map((s, i) => {
        const pillListHtml = s.tags.length === 0
            ? '<div class="se-tb-empty">No tags</div>'
            : (() => {
                const colors = generatePillColors(s.tags.length, s.field);
                return s.tags.map((t, idx) =>
                    fillTemplate(pillTmpl, {
                        value:       escAttr(t.value),
                        field:       s.field,
                        borderColor: colors[idx],
                        text:        escHtml(t.value),
                        count:       t.count,
                    })
                ).join('');
            })();
        return fillTemplate(panelSectionTmpl, {
            field:       s.field,
            hiddenStyle: i === 0 ? '' : ' style="display:none;"',
            pillListHtml,
        });
    }).join('');

    const html = fillTemplate(panelTmpl, {
        tabsHtml,
        panelsHtml,
        firstField: sections[0].field,
        firstLabel: sections[0].label,
    });

    const overlay = document.getElementById('se-modal-overlay');
    const $dialog = $(html).appendTo(overlay);
    const dlgEl = $dialog[0];
    spawnPanel(dlgEl, overlay, '.se-float-panel-header');

    // Tab switching — also update the clear section button text
    $dialog.on('click', '.se-tb-tab', function () {
        const field = $(this).data('tb-field');
        const label = field.charAt(0).toUpperCase() + field.slice(1);
        $dialog.find('.se-tb-tab').removeClass('se-tb-tab-active');
        $(this).addClass('se-tb-tab-active');
        $dialog.find('.se-tb-panel').hide();
        $dialog.find(`.se-tb-panel[data-tb-panel="${field}"]`).show();
        // Update clear button text and data attribute
        const $clearBtn = $dialog.find('.se-tb-clear-section');
        $clearBtn.text(`Clear ${label}`).data('tb-field', field);
    });

    // Remove individual tag — clear field value from all matching entries
    $dialog.on('click', '.se-tb-pill-x', function () {
        const $pill = $(this).closest('.se-tb-pill');
        const field = $pill.data('tb-field');
        const value = $pill.data('tb-value');
        for (const entry of state.entries.values()) {
            if (entry[field] === value) entry[field] = '';
        }
        $pill.remove();
    });

    // Clear section
    $dialog.on('click', '.se-tb-clear-section', function () {
        const field = $(this).data('tb-field');
        for (const entry of state.entries.values()) {
            entry[field] = '';
        }
        $dialog.find(`.se-tb-panel[data-tb-panel="${field}"] .se-tb-pill-list`)
            .html('<div class="se-tb-empty">No tags</div>');
    });

    // Clear all
    $dialog.on('click', '.se-tb-clear-all', function () {
        if (!confirm('Clear all date, time, and location values from all entries?')) return;
        for (const entry of state.entries.values()) {
            entry.date = '';
            entry.time = '';
            entry.location = '';
        }
        $dialog.find('.se-tb-pill-list').html('<div class="se-tb-empty">No tags</div>');
    });

    const closeDialog = () => { $dialog.remove(); if (onClose) onClose(); };
    $dialog.find('.se-dialog-ok, .se-dialog-close').on('click', closeDialog);
}

