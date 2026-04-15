/**
 * @module causality
 * @description Causal / dependency links between entries.
 *
 * Each link is a directed cause→effect relationship.
 * Stored as `state.causality[effectNum] = [causeNum, ...]`.
 *
 * UI:
 * - Causal Links panel in the Review tab (below conflict section).
 * - "+" opens inline From/To inputs — links all entries in range as a chain.
 * - Panel displays existing chains as range pills with remove buttons.
 * - Cell popover shows cause/effect links below the divider.
 * - Mindmap draws thin dashed arrows between linked entry cards.
 *
 * Causality data is never included in exports.
 */

import { state, persistState } from '../core/state.js';
import { makeDraggable } from '../core/utils.js';
import { loadTemplate, fillTemplate } from '../core/template-loader.js';
import { TEMPLATES } from '../core/constants.js';

// ─── Data helpers ────────────────────────────────

/**
 * Returns the entry numbers that CAUSE the given entry.
 * @param {number} num
 * @returns {number[]}
 */
export function getCauses(num) {
    return state.causality[num] ? [...state.causality[num]] : [];
}

/**
 * Returns the entry numbers that this entry CAUSES (effects).
 * @param {number} num
 * @returns {number[]}
 */
export function getEffects(num) {
    return Object.entries(state.causality)
        .filter(([, causes]) => causes.includes(num))
        .map(([k]) => Number(k));
}

/**
 * Add a cause→effect link.
 * @param {number} causeNum
 * @param {number} effectNum
 */
export function addLink(causeNum, effectNum) {
    if (causeNum === effectNum) return;
    if (!state.causality[effectNum]) state.causality[effectNum] = [];
    if (!state.causality[effectNum].includes(causeNum)) {
        state.causality[effectNum].push(causeNum);
        persistState();
    }
}

/**
 * Remove a cause→effect link.
 * @param {number} causeNum
 * @param {number} effectNum
 */
export function removeLink(causeNum, effectNum) {
    if (!state.causality[effectNum]) return;
    state.causality[effectNum] = state.causality[effectNum].filter(n => n !== causeNum);
    if (state.causality[effectNum].length === 0) delete state.causality[effectNum];
    persistState();
}

/**
 * Link all entries in a range as a sequential chain: from→from+1→…→to.
 * @param {number} from
 * @param {number} to
 */
export function addRangeLinks(from, to) {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    for (let i = lo; i < hi; i++) {
        addLink(i, i + 1);
    }
}

/**
 * Remove all sequential links in a range (reverse of addRangeLinks).
 * @param {number} from
 * @param {number} to
 */
export function removeRangeLinks(from, to) {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    for (let i = lo; i < hi; i++) {
        removeLink(i, i + 1);
    }
}

/**
 * Remove every causal link.
 */
export function clearAllLinks() {
    state.causality = {};
    persistState();
}

// ─── Template cache ───────────────────────────────

let _popoverTmpl = null;
let _chainPillTmpl = null;
let _chainPillRangeTmpl = null;

async function ensureTemplates() {
    if (_popoverTmpl) return;
    [_popoverTmpl, _chainPillTmpl, _chainPillRangeTmpl] = await Promise.all([
        loadTemplate(TEMPLATES.CAUSAL_POPOVER),
        loadTemplate(TEMPLATES.CHAIN_PILL),
        loadTemplate(TEMPLATES.CHAIN_PILL_RANGE),
    ]);
}

// ─── Floating popover ────────────────────────────

/**
 * Update the toolbar badge count and refresh popover content if open.
 */
export function renderCausalPanel() {
    const links = getAllLinks();
    const count = links.length;

    // Update toolbar button badge
    if (count > 0) {
        $('#se-causal-btn-badge').text(count).show();
    } else {
        $('#se-causal-btn-badge').hide();
    }

    // Refresh popover body if it's currently open
    const $pop = $('#se-causal-popover');
    if ($pop.length) refreshPopoverBody($pop, links);
}

/**
 * Open (or close if already open) the causal links floating popover.
 * Positions it below the toolbar button.
 */
export async function toggleCausalPopover() {
    const $existing = $('#se-causal-popover');
    if ($existing.length) {
        $existing.remove();
        return;
    }

    await ensureTemplates();
    const links = getAllLinks();
    const html = fillTemplate(_popoverTmpl, {
        clearAllStyle: links.length > 0 ? '' : 'display:none;',
        chainsHtml:    buildChainsHtml(buildChains(links)),
    });
    const $pop = $(html).appendTo('#se-modal-overlay');

    // Position below the toolbar button
    const btn = document.getElementById('se-causal-btn');
    if (btn) {
        const rect = btn.getBoundingClientRect();
        const overlay = document.getElementById('se-modal-overlay').getBoundingClientRect();
        $pop.css({
            left: Math.min(rect.left - overlay.left, overlay.width - 300) + 'px',
            top: (rect.bottom - overlay.top + 6) + 'px',
        });
    }

    makeDraggable($pop[0], $pop.find('.se-causal-pop-header')[0]);
}

function refreshPopoverBody($pop, links) {
    const count = links.length;
    $('#se-causal-clear-all').toggle(count > 0);
    $('#se-causal-chains').html(buildChainsHtml(buildChains(links)));
}

function buildChainsHtml(chains) {
    if (chains.length === 0) {
        return '<span class="se-causal-empty">No links yet. Add a range above.</span>';
    }
    return chains.map(chain => {
        const first = chain[0].cause;
        const last = chain.at(-1).effect;
        const mergeBtn = `<button class="se-causal-chain-merge" data-from="${first}" data-to="${last}" title="Merge linked chain into one entry (irreversible)">&#x22D3; Link Merge</button>`;
        const editBtn  = `<button class="se-causal-chain-edit" data-from="${first}" data-to="${last}" title="Edit range">&#x270E;</button>`;
        const rmBtn    = `<button class="se-causal-chain-rm-range" data-from="${first}" data-to="${last}">&times;</button>`;
        const tmpl = chain.length === 1 ? _chainPillTmpl : _chainPillRangeTmpl;
        return fillTemplate(tmpl, { first, last, len: chain.length, mergeBtn, editBtn, rmBtn });
    }).join('');
}

// ─── Chain detection helpers ──────────────────────

/**
 * Get all cause→effect pairs sorted by cause number.
 * @returns {Array<{cause: number, effect: number}>}
 */
function getAllLinks() {
    const links = [];
    for (const [effectStr, causes] of Object.entries(state.causality)) {
        const effect = Number(effectStr);
        for (const cause of causes) {
            links.push({ cause, effect });
        }
    }
    return links.sort((a, b) => a.cause - b.cause || a.effect - b.effect);
}

/**
 * Group sorted link pairs into sequential chains.
 * A chain extends when the next link's cause equals the last link's effect.
 * @param {Array<{cause: number, effect: number}>} links - Sorted pairs.
 * @returns {Array<Array<{cause: number, effect: number}>>}
 */
function buildChains(links) {
    if (links.length === 0) return [];
    const chains = [[links[0]]];
    for (let i = 1; i < links.length; i++) {
        const current = chains.at(-1);
        const tail = current.at(-1);
        if (links[i].cause === tail.effect) {
            current.push(links[i]);
        } else {
            chains.push([links[i]]);
        }
    }
    return chains;
}

// ─── Cell-popover snippet ────────────────────────

/**
 * Build the HTML snippet shown in the cell popover for causal links.
 * Returns an empty string if no links exist.
 * @param {number} num
 * @returns {string}
 */
export function buildCausalPopoverHtml(num) {
    const causes = getCauses(num);
    const effects = getEffects(num);
    if (causes.length > 0 || effects.length > 0) {
        const causePart = causes.length > 0
            ? `<span class="se-causal-pop-label">Caused by:</span> `
              + causes.map(c => `<span class="se-causal-pop-pill cause">&#x2190; #${c}</span>`).join(' ')
            : '';
        const effectPart = effects.length > 0
            ? `<span class="se-causal-pop-label">Causes:</span> `
              + effects.map(e => `<span class="se-causal-pop-pill effect">&#x2192; #${e}</span>`).join(' ')
            : '';
        return `<div class="se-causal-pop-row">${[causePart, effectPart].filter(Boolean).join('  ')}</div>`;
    }
    return '';
}
