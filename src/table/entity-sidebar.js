/**
 * @module entity-sidebar
 * @description Named entity sidebar — scans all entry content for recurring
 * capitalised names/places/terms and surfaces them with entry-count badges.
 * Click any entity to filter the Review table to entries mentioning it.
 * No LLM required — uses capitalisation heuristics.
 */

import { state } from '../core/state.js';
import { escHtml, escAttr, spawnPanel } from '../core/utils.js';

const STOP_WORDS = new Set([
    'the','a','an','in','on','at','to','for','of','and','or','but','with',
    'from','by','as','is','was','are','were','be','been','have','had','has',
    'do','did','does','not','no','so','if','up','out','it','its','he','she',
    'they','we','you','i','his','her','their','our','my','your','this','that',
    'these','those','then','than','when','where','who','which','what','how',
    'into','onto','over','after','before','about','through','while','there',
    'here','just','also','even','though','still','because','however','both',
    'each','all','any','some','such','new','old','one','two','him','them',
    'us','me','very','more','most','well','back','down','now','her','said',
    'got','get','let','put','see','saw','come','came','go','went','make',
    'made','take','took','know','knew','think','thought','look','looked',
    'want','wanted','tell','told','ask','asked','seem','seemed','feel','felt',
    'try','tried','leave','left','keep','kept','turn','turned','show','showed',
    'again','never','always','already','once','around','every','much','away',
    'actually','finally','suddenly','quickly','slowly','together','toward',
    'during','without','between','against','something','nothing','everything',
    'someone','anyone','everyone','somewhere','anywhere','everywhere',
]);

/** @type {HTMLElement|null} */
let _panel = null;

/** @type {Function|null} Called with search string when entity is clicked. */
let _onFilter = null;

/**
 * Register the filter callback — called with the entity name when clicked.
 * @param {Function} fn
 */
export function setEntityFilterCallback(fn) {
    _onFilter = fn;
}

/**
 * Toggle the entity sidebar open/closed.
 */
export function toggleEntitySidebar() {
    if (_panel) { closeEntitySidebar(); return; }
    openEntitySidebar();
}

/**
 * Open the entity sidebar panel.
 */
export function openEntitySidebar() {
    if (_panel) { _refreshList(); return; }

    const overlay = document.getElementById('se-modal-overlay');
    if (!overlay) return;

    _panel = document.createElement('div');
    _panel.id = 'se-entity-sidebar';
    _panel.className = 'se-entity-sidebar';
    _panel.innerHTML = _buildHtml();
    overlay.appendChild(_panel);

    spawnPanel(_panel, overlay, '.se-es-header', 260, 420);
    _bindEvents();
    _refreshList();
}

/**
 * Close and remove the entity sidebar.
 */
export function closeEntitySidebar() {
    _panel?.remove();
    _panel = null;
}

// ─── Private helpers ─────────────────────────────────────────

function _buildHtml() {
    return `
        <div class="se-es-header">
            <span class="se-es-title">&#128269; Named Entities</span>
            <button class="se-close-circle se-es-close">&times;</button>
        </div>
        <div class="se-es-search-wrap">
            <input type="text" id="se-es-filter-input" class="se-es-filter-input" placeholder="Filter list…" />
        </div>
        <div class="se-es-list" id="se-es-list"></div>
        <div class="se-es-footer">
            <span class="se-es-hint" id="se-es-hint"></span>
            <button class="se-btn se-btn-sm se-es-refresh">&#8635;</button>
        </div>`;
}

function _bindEvents() {
    _panel.querySelector('.se-es-close').addEventListener('click', closeEntitySidebar);

    _panel.querySelector('.se-es-refresh').addEventListener('click', () => {
        _refreshList(_panel.querySelector('#se-es-filter-input').value);
    });

    _panel.querySelector('#se-es-filter-input').addEventListener('input', function () {
        _refreshList(this.value);
    });

    _panel.addEventListener('click', (e) => {
        const btn = e.target.closest('.se-es-item');
        if (!btn) return;
        const entity = btn.dataset.entity;
        if (_onFilter) _onFilter(entity);
        _panel.querySelectorAll('.se-es-item').forEach(el => el.classList.remove('se-es-active'));
        btn.classList.add('se-es-active');
    });
}

function _refreshList(filterText = '') {
    const entities = _extractEntities();
    const list = document.getElementById('se-es-list');
    const hint = document.getElementById('se-es-hint');
    if (!list) return;

    const q = filterText.trim().toLowerCase();
    const filtered = q ? entities.filter(e => e.name.toLowerCase().includes(q)) : entities;

    hint.textContent = `${entities.length} entities · ${state.entries.size} entries`;

    if (filtered.length === 0) {
        list.innerHTML = `<div class="se-es-empty">${
            entities.length === 0
                ? 'No recurring entities found.<br>Entities must appear in 2+ entries.'
                : 'No entities match the filter.'
        }</div>`;
        return;
    }

    list.innerHTML = filtered.map(({ name, count }) =>
        `<button class="se-es-item" data-entity="${escAttr(name)}">
            <span class="se-es-name">${escHtml(name)}</span>
            <span class="se-es-count">${count}</span>
        </button>`
    ).join('');
}

/**
 * Extract recurring capitalised entities from all entry content.
 * Uses capitalisation + sentence-boundary heuristics.
 * @returns {Array<{name: string, count: number}>} Sorted by entry count desc.
 */
function _extractEntities() {
    /** @type {Map<string, Set<number>>} entity name → entry nums that mention it */
    const entityMap = new Map();

    for (const [num, entry] of state.entries) {
        if (!entry.content) continue;
        const found = new Set();
        const words = entry.content.split(/\s+/);

        for (let i = 0; i < words.length; i++) {
            // Strip leading/trailing punctuation to get the bare word
            const word = words[i].replace(/^[^a-zA-Z]+|[^a-zA-Z']+$/g, '');
            if (word.length < 2 || !/^[A-Z]/.test(word)) continue;
            if (STOP_WORDS.has(word.toLowerCase())) continue;

            // Skip sentence-starting words (first word or follows .!?)
            const prev = i > 0 ? words[i - 1] : '';
            if (i === 0 || /[.!?]["']?$/.test(prev)) continue;

            // Greedily extend into a multi-word phrase (up to 3 extra words)
            let phrase = word;
            let consumed = 0;
            for (let j = i + 1; j < Math.min(i + 4, words.length); j++) {
                const next = words[j].replace(/^[^a-zA-Z]+|[^a-zA-Z']+$/g, '');
                if (next.length >= 2 && /^[A-Z]/.test(next) && !STOP_WORDS.has(next.toLowerCase())) {
                    phrase += ' ' + next;
                    consumed++;
                } else break;
            }
            i += consumed;

            found.add(phrase);
        }

        for (const name of found) {
            if (!entityMap.has(name)) entityMap.set(name, new Set());
            entityMap.get(name).add(num);
        }
    }

    return [...entityMap.entries()]
        .filter(([, nums]) => nums.size >= 2)
        .sort((a, b) => b[1].size - a[1].size)
        .map(([name, nums]) => ({ name, count: nums.size }));
}
