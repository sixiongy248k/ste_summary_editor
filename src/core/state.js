/**
 * @module state
 * @description Centralized application state for Summary Editor.
 *
 * This is the single source of truth — every module reads/writes from this object.
 * State is persisted to localStorage so acts, dates, and locations survive page reloads.
 *
 * ## Data Shapes
 *
 * **Entry:** `{ num, content, date, time, location, notes, actId, source }`
 * - `num` (number): The entry's sequential number (e.g., 1, 2, 3...)
 * - `content` (string): The summary text
 * - `date`, `time`, `location` (string): Optional metadata (exported in brackets)
 * - `notes` (string): UI-only annotation (never exported)
 * - `actId` (number|null): Which act this entry belongs to
 * - `source` (string): Filename this entry was ingested from
 *
 * **Act:** `{ id, name, color, entryNums, notes }`
 * - `id` (number): Unique act identifier
 * - `name` (string): User-provided act label
 * - `color` (object): `{ bg, fg }` from the color palette
 * - `entryNums` (Set<number>): Which entry numbers belong to this act
 * - `notes` (string): UI-only act annotation
 */

import { STORAGE_KEY } from './constants.js';

/**
 * The global application state object.
 * Modules import this directly and mutate it — then call `persistState()` to save.
 */
export const state = {
    /** @type {Map<number, object>} Entry number → entry data */
    entries: new Map(),

    /** @type {Map<number, object>} Act ID → act data */
    acts: new Map(),

    /** @type {number[]} Missing entry numbers in the sequence */
    gaps: [],

    /** @type {Array<{name: string, entryCount: number, valid: boolean}>} Ingested file info */
    files: [],

    /** @type {number} Auto-incrementing ID for the next act */
    nextActId: 1,

    /** @type {number} Index into ACT_COLORS palette (cycles) */
    actColorIdx: 0,

    /** @type {number} Current pagination page (1-based) */
    currentPage: 1,

    /** @type {string} Active search query (lowercase) */
    searchQuery: '',

    /** @type {string} Current sort column */
    sortBy: 'num',

    /** @type {'asc'|'desc'} Current sort direction */
    sortDir: 'asc',

    /** @type {'all'|'unassigned'|'gaps'|string} Current filter — 'all', 'unassigned', 'gaps', or an act ID */
    filterAct: 'all',

    /** @type {Array<{type: string, actId: number, nums: number[]}>} Single-level undo stack */
    undoStack: [],

    /** @type {string[]} Original filenames from ingested files */
    sourceFileNames: [],

    // ─── New state for tabbed UI ───

    /** @type {number} Currently active tab index (0=Ingest, 1=Review, 2=Edit, 3=Export) */
    activeTab: 0,

    /** @type {Set<number>} Currently selected (checked) entry numbers */
    selected: new Set(),

    /** @type {Object<number, Array<{text: string, reason: string, severity: string}>>} Conflict data keyed by entry number */
    conflicts: {},

    /** @type {Object<number, number[]>} Causal links: effectNum → [causeNum, ...] */
    causality: {},

    /** @type {boolean} Whether a conflict check is currently running */
    conflictRunning: false,

    /** @type {string} Last folder path used during ingest (for re-export default) */
    lastIngestFolder: '',

    /** @type {{description: string, undo: Function}|null} Last undoable action (single-level) */
    lastAction: null,

    /** @type {number|null} Currently selected act ID in the Acts panel */
    selectedActId: null,

    /** @type {Set<number>} Entry numbers whose content has been manually edited via the content editor */
    modified: new Set(),

    /** @type {string} Narrative story context generated after the first full conflict check */
    storyContext: '',

    /** @type {string} Hash of last full-export databank inject (skips re-upload if unchanged) */
    lastInjectHash: '',

    /** @type {Object<string, string>} Per-arc inject hashes: actId → content hash */
    lastInjectArcHashes: {},

    /** @type {Map<string, string>} Raw file content cache for preview panels (session-only, not persisted) */
    fileRawContent: new Map(),

    /** @type {Object<string, string>} System prompts keyed by prompt ID — persisted, seeded from defaults */
    systemPrompts: {},

    /** @type {Set<string>} Filenames marked as timeline reference files */
    timelineFiles: new Set(),

    /** @type {Array<{num: number, reason: string}>|null} Last timeline analysis results (session-only) */
    timelineAnalysisResults: null,

    /**
     * Supplementary files — non-summary files assigned a display category.
     * Keyed by filename. Category determines where they appear in Review tab.
     * @type {Map<string, {name: string, category: string, content: string, editedContent: string}>}
     */
    supplementaryFiles: new Map(),

    /**
     * AI-generated entity sections for the Story Index panel.
     * Persisted so they survive re-opens. Cleared when entries are cleared.
     * @type {Array<{key: string, title: string, items: Array<{name: string}>}>|null}
     */
    entitySections: null,
};

/**
 * Save the current state to localStorage.
 * Converts Maps and Sets to serializable formats.
 * Call this after any mutation that should survive a page reload.
 */
export function persistState() {
    try {
        const data = {
            entries: [...state.entries.entries()].map(([k, v]) => [k, { ...v }]),
            acts: [...state.acts.entries()].map(([k, v]) => [k, {
                ...v,
                entryNums: [...v.entryNums],
            }]),
            nextActId: state.nextActId,
            actColorIdx: state.actColorIdx,
            sourceFileNames: state.sourceFileNames,
            causality: state.causality,
            lastIngestFolder: state.lastIngestFolder,
            modified: [...state.modified],
            storyContext: state.storyContext,
            lastInjectHash: state.lastInjectHash,
            lastInjectArcHashes: state.lastInjectArcHashes,
            timelineFiles:    [...state.timelineFiles],
        entitySections:   state.entitySections ?? null,
        supplementaryFiles: [...state.supplementaryFiles.entries()].map(([k, v]) => [k, v]),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
        console.warn('[Summary Editor] Failed to persist state:', err);
    }
}

/**
 * Take a deep snapshot of the mutable state properties used by undo operations.
 * Call before any destructive operation; pass the result to `restoreSnapshot` to undo.
 * @returns {object}
 */
export function snapshotState() {
    return {
        entries:         new Map([...state.entries.entries()].map(([k, v]) => [k, { ...v }])),
        acts:            new Map([...state.acts.entries()].map(([k, v]) => [k, { ...v, entryNums: new Set(v.entryNums) }])),
        causality:       structuredClone(state.causality),
        gaps:            [...state.gaps],
        modified:        new Set(state.modified),
        selected:        new Set(state.selected),
        files:           [...state.files],
        sourceFileNames: [...state.sourceFileNames],
        nextActId:       state.nextActId,
        actColorIdx:     state.actColorIdx,
        conflicts:       { ...state.conflicts },
        fileRawContent:  new Map(state.fileRawContent),
    };
}

/**
 * Restore state from a snapshot created by `snapshotState`.
 * Does NOT call `persistState()` or re-render — caller is responsible.
 * @param {object} snap
 */
export function restoreSnapshot(snap) {
    state.entries         = snap.entries;
    state.acts            = snap.acts;
    state.causality       = snap.causality;
    state.gaps            = snap.gaps;
    state.modified        = snap.modified;
    state.selected        = snap.selected;
    state.files           = snap.files;
    state.sourceFileNames = snap.sourceFileNames;
    state.nextActId       = snap.nextActId;
    state.actColorIdx     = snap.actColorIdx;
    state.conflicts       = snap.conflicts;
    state.fileRawContent  = snap.fileRawContent;
}

/**
 * Load previously saved state from localStorage.
 * Restores Maps and Sets from their serialized forms.
 * Safe to call even if no saved state exists — it simply does nothing.
 */
export function loadPersistedState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const data = JSON.parse(raw);

        state.entries = new Map(data.entries || []);
        state.acts = new Map((data.acts || []).map(([k, v]) => [k, {
            ...v,
            entryNums: new Set(v.entryNums || []),
        }]));
        state.nextActId = data.nextActId || 1;
        state.actColorIdx = data.actColorIdx || 0;
        state.sourceFileNames = data.sourceFileNames || [];
        state.causality = data.causality || {};
        state.lastIngestFolder = data.lastIngestFolder || '';
        state.modified = new Set(data.modified || []);
        state.storyContext = data.storyContext || '';
        state.lastInjectHash = data.lastInjectHash || '';
        state.lastInjectArcHashes = data.lastInjectArcHashes || {};
        state.timelineFiles    = new Set(data.timelineFiles || []);
        state.entitySections   = data.entitySections ?? null;
        state.supplementaryFiles = new Map((data.supplementaryFiles || []).map(([k, v]) => [k, v]));
    } catch (err) {
        console.warn('[Summary Editor] Failed to load persisted state:', err);
    }
}
