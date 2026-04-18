/**
 * @module entity-panel
 * @description Story Index — multi-section panel for tracking named entities and
 * AI-generated metadata categories across all entries.
 *
 * ## Structure
 * A floating draggable panel containing up to 5 section boxes per row, max 2 rows.
 * Each box has overflow-y scroll and a fixed max width.
 *
 * ## Sections
 * - **Names** (local heuristic): Sentient Beings sub-list + Other Names sub-list
 * - AI-generated sections (Key Topics, Weapons/Items, and any others the LLM finds)
 *   stacked modularly next to the Names section.
 *
 * ## AI Generation
 * Triggered by the "Generate" button. Uses selected entries, or all if none selected.
 * Calls the ST API with a structured JSON prompt. Results are stored in
 * state.entitySections and survive re-opens.
 *
 * ## Interaction
 * Clicking any entity name sets the Review table search filter to that name.
 */

import { state, persistState } from '../core/state.js';
import { escHtml, escAttr, spawnPanel } from '../core/utils.js';
import { registerPrompt, getPrompt } from '../core/system-prompts.js';

const PROMPT_KEY = 'entity-panel';
registerPrompt(PROMPT_KEY, 'Story Index — Entity Generation');

const STOP_WORDS = new Set([
    'the','a','an','in','on','at','to','for','of','and','or','but','with',
    'from','by','as','is','was','are','were','be','been','have','had','has',
    'do','did','does','not','no','so','if','up','out','it','its','he','she',
    'they','we','you','i','his','her','their','our','my','your','this','that',
    'these','those','then','than','when','where','who','which','what','how',
    'into','onto','over','after','before','about','through','while','there',
    'here','just','also','even','though','still','because','however','both',
    'each','all','any','some','such','new','old','one','two','him','them',
    'us','me','very','more','most','well','back','down','now','said','got',
    'get','let','put','see','saw','come','came','go','went','make','made',
    'take','took','know','knew','think','thought','look','looked','want',
    'wanted','tell','told','ask','asked','seem','seemed','feel','felt',
    'try','tried','leave','left','keep','kept','turn','turned','show','showed',
    'again','never','always','already','once','around','every','much','away',
    'actually','finally','suddenly','quickly','slowly','together','toward',
    'during','without','between','against','something','nothing','everything',
    'someone','anyone','everyone','somewhere','anywhere','everywhere',
]);

/** @type {HTMLElement|null} */
let _panel = null;

/** @type {Function|null} */
let _onFilter = null;

/** Max section boxes per row. */
const MAX_PER_ROW = 5;

// ─── Public API ──────────────────────────────────────────────

/**
 * Register filter callback (called with entity name on click).
 * @param {Function} fn
 */
export function setEntityFilterCallback(fn) {
    _onFilter = fn;
}

/** Toggle the Story Index panel open/closed. */
export function toggleEntitySidebar() {
    if (_panel) { _closePanel(); return; }
    _openPanel();
}

/** Open the Story Index panel. */
export function openEntitySidebar() {
    if (_panel) { _refresh(); return; }
    _openPanel();
}

/** Close and remove the Story Index panel. */
export function closeEntitySidebar() {
    _closePanel();
}

// ─── Private ─────────────────────────────────────────────────

function _openPanel() {
    const overlay = document.getElementById('se-modal-overlay');
    if (!overlay) return;

    _panel = document.createElement('div');
    _panel.id = 'se-entity-panel';
    _panel.className = 'se-entity-panel';
    _panel.innerHTML = _buildShell();
    overlay.appendChild(_panel);

    // Width depends on how many sections we have — start at 2-box width
    const w = Math.min(MAX_PER_ROW, 2) * 220 + 24;
    spawnPanel(_panel, overlay, '.se-ep-header', w, 480);

    _bindEvents();
    _refresh();
}

function _closePanel() {
    _panel?.remove();
    _panel = null;
}

function _buildShell() {
    return `
        <div class="se-ep-header">
            <span class="se-ep-title">&#128196; Story Index</span>
            <button class="se-close-circle se-ep-close">&times;</button>
        </div>
        <div class="se-ep-toolbar">
            <input type="text" class="se-ep-filter" id="se-ep-filter" placeholder="Filter across all sections…" />
            <button class="se-btn se-btn-sm se-ep-gen-btn" id="se-ep-gen" title="Generate AI sections from selected (or all) entries">&#10024; Generate</button>
            <span class="se-ep-gen-status" id="se-ep-gen-status"></span>
        </div>
        <div class="se-ep-grid" id="se-ep-grid"></div>`;
}

function _bindEvents() {
    _panel.querySelector('.se-ep-close').addEventListener('click', _closePanel);

    _panel.querySelector('#se-ep-filter').addEventListener('input', function () {
        _renderGrid(this.value.trim().toLowerCase());
    });

    _panel.querySelector('#se-ep-gen').addEventListener('click', _runAiGenerate);

    _panel.addEventListener('click', (e) => {
        const item = e.target.closest('.se-ep-item');
        if (!item) return;
        const name = item.dataset.name;
        if (_onFilter && name) _onFilter(name);
        _panel.querySelectorAll('.se-ep-item').forEach(el => el.classList.remove('se-ep-active'));
        item.classList.add('se-ep-active');
    });
}

function _refresh() {
    const q = _panel?.querySelector('#se-ep-filter')?.value.trim().toLowerCase() ?? '';
    _renderGrid(q);
}

// ─── Grid rendering ──────────────────────────────────────────

function _renderGrid(filterQ) {
    const grid = _panel?.querySelector('#se-ep-grid');
    if (!grid) return;

    // Build sections: Names first (local), then AI sections
    const sections = _buildSections();

    if (sections.length === 0) {
        grid.innerHTML = '<div class="se-ep-empty">No entries loaded. Run Generate to create AI sections.</div>';
        return;
    }

    // Lay sections into rows of MAX_PER_ROW
    const rows = [];
    for (let i = 0; i < sections.length; i += MAX_PER_ROW) {
        rows.push(sections.slice(i, i + MAX_PER_ROW));
    }
    // Cap at 2 rows
    const visibleRows = rows.slice(0, 2);

    grid.innerHTML = visibleRows.map(row =>
        `<div class="se-ep-row">${row.map(sec => _buildSectionBox(sec, filterQ)).join('')}</div>`
    ).join('');
}

/**
 * Build the list of sections to render.
 * Names section is always first (built locally).
 * AI sections from state.entitySections follow.
 */
function _buildSections() {
    const sections = [];

    // ── Names section (local heuristic) ──────────────────────
    const entities = _extractEntities();
    if (entities.length > 0 || state.entries.size > 0) {
        const sentient   = entities.filter(e => !e.isPlace).map(e => ({ name: e.name, count: e.count }));
        const otherNames = entities.filter(e => e.isPlace).map(e => ({ name: e.name, count: e.count }));

        sections.push({
            key:   'names',
            title: '&#128100; Names',
            subsections: [
                { label: 'Sentient Beings', items: sentient   },
                { label: 'Other Names',     items: otherNames },
            ],
        });
    }

    // ── AI-generated sections ──────────────────────────────────
    const aiSections = state.entitySections ?? [];
    for (const sec of aiSections) {
        sections.push({
            key:   sec.key,
            title: sec.title,
            items: sec.items,
        });
    }

    return sections;
}

function _buildSectionBox(sec, filterQ) {
    let inner = '';

    if (sec.subsections) {
        // Names section with subsections
        inner = sec.subsections.map(sub => {
            const filtered = filterQ
                ? sub.items.filter(i => i.name.toLowerCase().includes(filterQ))
                : sub.items;
            if (filtered.length === 0) return '';
            return `<div class="se-ep-sub-label">${escHtml(sub.label)}</div>` +
                filtered.map(i => _itemHtml(i)).join('');
        }).join('');
    } else {
        const filtered = filterQ
            ? (sec.items ?? []).filter(i => i.name.toLowerCase().includes(filterQ))
            : (sec.items ?? []);
        inner = filtered.length > 0
            ? filtered.map(i => _itemHtml(i)).join('')
            : `<div class="se-ep-section-empty">No items</div>`;
    }

    if (!inner.trim()) {
        inner = `<div class="se-ep-section-empty">Nothing matches</div>`;
    }

    return `
        <div class="se-ep-section">
            <div class="se-ep-section-header">${sec.title}</div>
            <div class="se-ep-section-body">${inner}</div>
        </div>`;
}

function _itemHtml(item) {
    const countBadge = item.count ? `<span class="se-ep-count">${item.count}</span>` : '';
    return `<button class="se-ep-item" data-name="${escAttr(item.name)}">` +
        `<span class="se-ep-name">${escHtml(item.name)}</span>${countBadge}</button>`;
}

// ─── Local entity extraction ─────────────────────────────────

/** Strip non-letter chars from start/end of a word token. */
const STRIP_RE = /^[^a-zA-Z]+|[^a-zA-Z']+$/g;

/** Place-name keywords (lowercase) for `isPlace` heuristic. */
const PLACE_WORDS = new Set([
    'forest','city','village','town','castle','kingdom','mountain','river',
    'ocean','lake','road','street','temple','ruins','island','valley',
    'cave','tower','palace',
]);

function _isPlaceName(name) {
    const lower = name.toLowerCase();
    for (const pw of PLACE_WORDS) {
        if (lower.includes(pw)) return true;
    }
    return false;
}

/**
 * Try to extend a single capitalised word into a multi-word phrase.
 * Returns { phrase, consumed } where consumed is how many extra words were taken.
 */
function _extendPhrase(words, startIdx) {
    let phrase   = words[startIdx].replaceAll(STRIP_RE, '');
    let consumed = 0;
    for (let j = startIdx + 1; j < Math.min(startIdx + 4, words.length); j++) {
        const next = words[j].replaceAll(STRIP_RE, '');
        if (next.length >= 2 && /^[A-Z]/.test(next) && !STOP_WORDS.has(next.toLowerCase())) {
            phrase += ' ' + next;
            consumed++;
        } else break;
    }
    return { phrase, consumed };
}

/**
 * Scan one entry's content and return a Set of candidate entity names.
 */
function _scanEntry(content) {
    const found = new Set();
    const words = content.split(/\s+/);

    for (let i = 0; i < words.length; i++) {
        const word = words[i].replaceAll(STRIP_RE, '');
        if (word.length < 2 || !/^[A-Z]/.test(word)) continue;
        if (STOP_WORDS.has(word.toLowerCase())) continue;

        const prev = i > 0 ? words[i - 1] : '';
        if (i === 0 || /[.!?]["']?$/.test(prev)) continue;

        const { phrase, consumed } = _extendPhrase(words, i);
        i += consumed;
        found.add(phrase);
    }
    return found;
}

function _extractEntities() {
    const entityMap = new Map();

    for (const [num, entry] of state.entries) {
        if (!entry.content) continue;
        for (const name of _scanEntry(entry.content)) {
            if (!entityMap.has(name)) entityMap.set(name, new Set());
            entityMap.get(name).add(num);
        }
    }

    return [...entityMap.entries()]
        .filter(([, nums]) => nums.size >= 2)
        .toSorted((a, b) => b[1].size - a[1].size)
        .map(([name, nums]) => ({ name, count: nums.size, isPlace: _isPlaceName(name) }));
}

// ─── AI generation ────────────────────────────────────────────

/** Build the block of entry text to send for AI generation. */
function _buildEntryTexts() {
    const nums = state.selected.size > 0 ? [...state.selected] : [...state.entries.keys()];
    return nums
        .toSorted((a, b) => a - b)
        .map(n => { const e = state.entries.get(n); return e ? `#${n}: ${e.content}` : null; })
        .filter(Boolean)
        .join('\n');
}

/** Call ST API and return the raw text response. */
async function _callGenerateApi(entryTexts) {
    const sysPrompt = getPrompt(PROMPT_KEY) ||
        'You are a story analyst. Extract named entities from the provided story entries and return a JSON array of sections. ' +
        'Each section has: { "key": string, "title": string, "items": [{"name": string}] }. ' +
        'Create sections for: Key Topics, Weapons/Items/Potions, Factions/Groups, and any other relevant categories you find. ' +
        'Do NOT include character names (those are handled separately). ' +
        'Return only valid JSON. No markdown fences.';

    const ctx  = SillyTavern.getContext();
    const resp = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({
            type: 'quiet',
            chat_completion_source: ctx.chatCompletionSettings.chat_completion_source,
            model: ctx.getChatCompletionModel(),
            messages: [
                { role: 'system', content: sysPrompt },
                { role: 'user',   content: `Story entries:\n${entryTexts}\n\nReturn a JSON array of category sections.` },
            ],
            max_tokens:  ctx.chatCompletionSettings.openai_max_tokens || 1200,
            temperature: 0.3,
            stream:      false,
        }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
}

function _setStatus(statusEl, text, color) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = color;
}

async function _doGenerate(entryTexts, statusEl) {
    const text   = await _callGenerateApi(entryTexts);
    const parsed = _parseAiResponse(text);
    if (parsed.length > 0) {
        state.entitySections = parsed;
        persistState();
        _refresh();
        _setStatus(statusEl, `${parsed.length} sections ✓`, '#a6e22e');
    } else {
        _setStatus(statusEl, 'No data returned', '#f92672');
    }
}

async function _runAiGenerate() {
    const genBtn   = _panel?.querySelector('#se-ep-gen');
    const statusEl = _panel?.querySelector('#se-ep-gen-status');

    if (genBtn) genBtn.disabled = true;
    _setStatus(statusEl, 'Generating…', '#fd971f');

    const entryTexts = _buildEntryTexts();
    if (!entryTexts) {
        _setStatus(statusEl, 'No entries', '#f92672');
        if (genBtn) genBtn.disabled = false;
        return;
    }

    try {
        await _doGenerate(entryTexts, statusEl);
    } catch (err) {
        console.error('[SE] Entity panel generate error:', err);
        if (_panel) _setStatus(statusEl, 'Error', '#f92672');
    }

    if (genBtn && _panel) genBtn.disabled = false;
}

function _parseAiResponse(text) {
    try {
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        const data = JSON.parse(cleaned);
        if (!Array.isArray(data)) return [];
        return data
            .filter(s => s && typeof s.key === 'string' && typeof s.title === 'string' && Array.isArray(s.items))
            .map(s => ({
                key:   s.key,
                title: s.title,
                items: s.items
                    .filter(i => i && typeof i.name === 'string')
                    .map(i => ({ name: i.name.trim() })),
            }));
    } catch {
        return [];
    }
}
