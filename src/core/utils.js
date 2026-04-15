/**
 * @module utils
 * @description Shared utility functions used across Summary Editor modules.
 * Small, pure helpers — no side effects, no DOM access.
 */

/**
 * Escape a string for safe insertion into HTML content.
 * Prevents XSS by converting <, >, &, etc. to HTML entities.
 *
 * @param {string} str - Raw text to escape.
 * @returns {string} HTML-safe string.
 *
 * @example
 * escHtml('<script>alert("xss")</script>')
 * // '&lt;script&gt;alert("xss")&lt;/script&gt;'
 */
export function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Escape a string for safe use inside an HTML attribute value.
 * Handles quotes and angle brackets.
 *
 * @param {string} str - Raw text to escape.
 * @returns {string} Attribute-safe string.
 */
export function escAttr(str) {
    return String(str || '')
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

/**
 * Create a debounced version of a function.
 * The function will only execute after `ms` milliseconds have passed
 * since the last time it was called. Useful for search input handlers.
 *
 * @param {Function} fn - The function to debounce.
 * @param {number} ms - Delay in milliseconds.
 * @returns {Function} Debounced function.
 *
 * @example
 * const search = debounce(() => filterTable(), 200);
 * inputElement.addEventListener('input', search);
 */
export function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

/**
 * Make a floating element draggable by holding its handle.
 * Uses pointer capture for reliable drag across the document.
 *
 * @param {HTMLElement} el - The element to move (must be position:fixed or absolute).
 * @param {HTMLElement} handle - The area the user grabs to drag.
 */
export function makeDraggable(el, handle) {
    let startX, startY, startLeft, startTop;

    handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        startX = e.clientX;
        startY = e.clientY;
        const rect = el.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        const newLeft = startLeft + e.clientX - startX;
        const newTop  = startTop  + e.clientY - startY;
        const minVisible = 48; // keep at least this many px of the header on-screen
        el.style.left = Math.max(-(el.offsetWidth - minVisible), Math.min(window.innerWidth - minVisible, newLeft)) + 'px';
        el.style.top  = Math.max(0, Math.min(window.innerHeight - minVisible, newTop)) + 'px';
    });

    handle.addEventListener('pointerup', (e) => {
        if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    });
}

/**
 * Z-index stack manager — keeps z-indexes bounded and recycled.
 *
 * All floating panels register here. Whenever a panel is opened or clicked
 * it moves to the top of the stack and z-indexes are reassigned from BASE_Z
 * upward.  Panels removed from the DOM are pruned automatically on the next
 * raise, so the counter never grows unboundedly.
 *
 * Usage:  registerPanel(el)  — call once after appending the panel to the DOM.
 */
const _BASE_Z = 10100;
const _stack  = []; // panels ordered bottom (index 0) → top (last)

function _raise(el) {
    // Prune disconnected panels
    for (let i = _stack.length - 1; i >= 0; i--) {
        if (!_stack[i].isConnected) _stack.splice(i, 1);
    }
    const i = _stack.indexOf(el);
    if (i !== -1) _stack.splice(i, 1);
    _stack.push(el);
    _stack.forEach((p, idx) => { p.style.zIndex = _BASE_Z + idx; });
}

/**
 * Register a panel with the z-index stack.
 * Brings it to the top immediately and wires pointerdown to re-raise on click.
 * @param {HTMLElement} el
 */
export function registerPanel(el) {
    _raise(el);
    el.addEventListener('pointerdown', () => _raise(el), true);
}

/**
 * Compute a centered spawn position for a floating panel within an overlay,
 * with a small random jitter so multiple open panels don't perfectly overlap.
 *
 * @param {number} panelW - Approximate panel width in px.
 * @param {number} panelH - Approximate panel height in px.
 * @param {number} ow     - Overlay width in px.
 * @param {number} oh     - Overlay height in px.
 * @param {number} [jitter=60] - Max random offset per axis (px).
 * @returns {{ left: number, top: number }}
 */
export function centeredPos(panelW, panelH, ow, oh, jitter = 60) {
    const jx = Math.round((Math.random() - 0.5) * 2 * jitter);
    const jy = Math.round((Math.random() - 0.5) * 2 * jitter);
    return {
        left: Math.max(16, (ow - panelW) / 2 + jx),
        top:  Math.max(16, (oh - panelH) / 2 + jy),
    };
}

/**
 * Position, make draggable, and register a panel that has already been
 * appended to its overlay.  Covers the two common patterns:
 *
 * - **Known size** (`panelW` + `panelH` supplied): positions immediately via
 *   `centeredPos` with jitter.
 * - **Unknown size** (omit both): defers to `requestAnimationFrame` so the
 *   browser can measure the element first, then applies jitter to the
 *   measured centre.
 *
 * @param {HTMLElement} el        - Panel (must already be in the DOM).
 * @param {HTMLElement} overlay   - The overlay it lives in.
 * @param {string}      headerSel - CSS selector for the drag handle inside el.
 * @param {number}      [panelW]  - Known panel width in px.
 * @param {number}      [panelH]  - Known panel height in px.
 */
export function spawnPanel(el, overlay, headerSel, panelW, panelH) {
    const ow = overlay.offsetWidth  || window.innerWidth;
    const oh = overlay.offsetHeight || window.innerHeight;

    if (panelW !== undefined && panelH !== undefined) {
        const pos = centeredPos(panelW, panelH, ow, oh);
        el.style.left = pos.left + 'px';
        el.style.top  = pos.top  + 'px';
    } else {
        const jx = Math.round((Math.random() - 0.5) * 120);
        const jy = Math.round((Math.random() - 0.5) * 120);
        requestAnimationFrame(() => {
            el.style.left = Math.max(16, (ow - el.offsetWidth)  / 2 + jx) + 'px';
            el.style.top  = Math.max(16, (oh - el.offsetHeight) / 2 + jy) + 'px';
        });
    }

    makeDraggable(el, el.querySelector(headerSel));
    registerPanel(el);
}

/**
 * Build the bracket prefix for an exported entry.
 * Format: `(Act n.|date:val|time:val|location:val)` — fields omitted if empty.
 * Returns empty string if all fields are blank and no act name given.
 *
 * @param {{ date: string, time: string, location: string, actId?: number }} entry - Entry with metadata.
 * @param {string} [actName] - Optional act/arc name to include.
 * @returns {string} Bracket string like `(Act One|date:Jan 1|time:3pm|location:Forest)` or `""`.
 */
export function buildBracket(entry, actName) {
    const segments = [];

    if (actName) segments.push(actName);
    if (entry.date) segments.push(`date:${entry.date}`);
    if (entry.time) segments.push(`time:${entry.time}`);
    if (entry.location) segments.push(`location:${entry.location}`);

    if (segments.length === 0) return '';
    return `(${segments.join('|')})`;
}
