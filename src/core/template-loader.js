/**
 * @module template-loader
 * @description Loads HTML template files from the templates/ folder and provides
 * a simple placeholder replacement system.
 *
 * ## Why Templates?
 * Instead of embedding HTML strings in JavaScript, each UI component lives in its
 * own `.html` file. This keeps a clean separation between markup and logic.
 *
 * ## How It Works
 * 1. `loadTemplate(name)` fetches `templates/{name}.html` via HTTP
 * 2. Templates are cached after first load (no duplicate requests)
 * 3. `fillTemplate(html, data)` replaces `{{key}}` placeholders with values
 *
 * ## Usage
 * ```js
 * const html = await loadTemplate('entry-row');
 * const filled = fillTemplate(html, { num: 1, content: 'Hello' });
 * ```
 */

import { EXT_NAME, TEMPLATES } from './constants.js';

/** @type {Map<string, string>} Cache of loaded template HTML strings. */
const templateCache = new Map();

/** Base URL path for template files relative to ST's server root. */
const TEMPLATE_BASE = `/scripts/extensions/third-party/${EXT_NAME}/templates`;

/**
 * Load an HTML template file by name.
 * Fetches from `templates/{name}.html` and caches the result.
 *
 * @param {string} name - Template filename without extension (e.g., 'modal', 'entry-row').
 * @returns {Promise<string>} The raw HTML content of the template.
 * @throws {Error} If the template file cannot be fetched.
 *
 * @example
 * const modalHtml = await loadTemplate('modal');
 * $('body').append(modalHtml);
 */
export async function loadTemplate(name) {
    if (templateCache.has(name)) {
        return templateCache.get(name);
    }

    const url = `${TEMPLATE_BASE}/${name}.html`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`[Summary Editor] Failed to load template "${name}": ${response.status}`);
    }

    const html = await response.text();
    templateCache.set(name, html);
    return html;
}

/**
 * Replace `{{placeholder}}` tokens in a template string with values from a data object.
 * Unmatched placeholders are left as-is (useful for debugging missing data).
 *
 * @param {string} html - Template HTML with `{{key}}` placeholders.
 * @param {Object<string, string|number>} data - Key-value pairs for replacement.
 * @returns {string} HTML with placeholders filled in.
 *
 * @example
 * fillTemplate('<td>{{num}}</td><td>{{content}}</td>', { num: 1, content: 'Hello' })
 * // '<td>1</td><td>Hello</td>'
 */
export function fillTemplate(html, data) {
    return html.replaceAll(/\{\{(\w+)\}\}/g, (match, key) => {
        return key in data ? String(data[key]) : match;
    });
}

/**
 * Preload all templates needed by the application.
 * Call this during initialization to avoid loading delays during interaction.
 *
 * @returns {Promise<void>}
 */
export async function preloadAllTemplates() {
    await Promise.all(Object.values(TEMPLATES).map(name => loadTemplate(name)));
}
