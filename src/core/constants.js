/**
 * @module constants
 * @description Central place for all shared constants used across Summary Editor.
 * Changing a value here updates it everywhere — no magic strings scattered around.
 */

/** Extension identifier used for ST registration and localStorage keys. */
export const EXT_NAME = 'summary-editor';

/** Human-readable name shown in headers and UI. */
export const EXT_DISPLAY = 'Summary Editor';

/** localStorage key for persisted state (acts, entries, metadata). */
export const STORAGE_KEY = 'se_state';

/** How many table rows to show per page. */
export const ROWS_PER_PAGE = 20;

/**
 * Cycling palette for act badge colors.
 * Each entry has a `bg` (background) and `fg` (text) color.
 * Inspired by Monokai theme — high contrast on dark backgrounds.
 */
export const ACT_COLORS = [
    { bg: '#a6e22e', fg: '#272822' }, // green
    { bg: '#66d9e8', fg: '#272822' }, // cyan
    { bg: '#ae81ff', fg: '#272822' }, // purple
    { bg: '#fd971f', fg: '#272822' }, // orange
    { bg: '#f92672', fg: '#fff' },    // pink
    { bg: '#e6db74', fg: '#272822' }, // yellow
    { bg: '#dc143c', fg: '#fff' },    // crimson
    { bg: '#1a3a6b', fg: '#fff' },    // dark blue
];

/**
 * Regex patterns for detecting numbered summary entries.
 * Tries strict "1. text" first, then progressively fuzzier formats.
 * Each pattern captures: group(1) = entry number, group(2) = content text.
 */
export const ENTRY_PATTERNS = [
    /^#?(\d+)\.\s*(.*)/,      // 1. content  OR  #1. content
    /^(\d+)\s+\.\s*(.*)/,     // 1 . content
    /^(\d+)\.\.\s*(.*)/,      // 1.. content
    /^(\d+)\s+\.\.\s*(.*)/    // 1 .. content
];

/**
 * Regex to detect and parse the rich bracket metadata block in an entry line.
 * Matches: (Act|date:val|time:val|location:val)
 * All fields are optional and can appear in any order.
 * Group 1 = full bracket string (consumed from content).
 */
export const BRACKET_PATTERN = /^\(([^)]+)\)\s*/;

/**
 * Regex patterns for detecting "Part N" section headers.
 * Case-insensitive. "part" can appear anywhere in the line (e.g. "Story so far part 1:").
 * Captures: group(1) = part number, group(2) = rest of line after the part marker.
 */
export const PART_PATTERNS = [
    /\bpart\s*(\d+)\s*[:-]?\s*(.*)/i,    // part 1: ..., Story so far part 1: ..., Part1...
    /\bpart\s+#\s*(\d+)\s*[:-]?\s*(.*)/i, // part # 1, Part #1
    /\bpart\s*#(\d+)\s*[:-]?\s*(.*)/i,    // Part#1
];

/**
 * Conflict severity levels used by conflict-detection and content-editor.
 */
export const SEVERITY = Object.freeze({
    ERROR:   'error',
    WARNING: 'warning',
    INFO:    'info',
    OK:      'ok',
});

/**
 * CSS class name for each severity level (maps to .se-sev-* rules in style.css).
 */
export const SEV_CSS = Object.freeze({
    error:   'se-sev-error',
    warning: 'se-sev-warn',
    info:    'se-sev-info',
    ok:      'se-sev-ok',
});

/**
 * Entry metadata fields that support date/time/location tagging.
 */
export const ENTRY_FIELDS = Object.freeze(['date', 'time', 'location']);

/**
 * Review table column widths.
 * Fixed px for small controls; percentages for data columns.
 * Edit here — CSS vars are injected at startup from these values.
 */
export const TABLE_COLS = Object.freeze({
    check:    '36px',
    num:      '50px',
    act:      '9%',
    content:  '47%',
    date:     '8%',
    time:     '9%',
    location: '12%',
    notes:    '10%',
    feedback: '5%',
});

/**
 * Month names used by the date picker.
 */
export const MONTH_NAMES = Object.freeze([
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]);

/**
 * Template path keys for all loadTemplate() calls.
 * Values are the path strings passed to loadTemplate().
 */
export const TEMPLATES = Object.freeze({
    MODAL:                   'modal',
    EXPORT_PANEL:            'export-panel',
    ENTRY_ROW:               'entry-row',
    GAP_ROW:                 'gap-row',
    ACT_ITEM:                'act-item',
    DIALOG_ALERT:            'partials/dialog-alert',
    DIALOG_CONFLICT_RESULTS: 'partials/dialog-conflict-results',
    DIALOG_COLOR_PICKER:     'partials/dialog-color-picker',
    DIALOG_ENTRY_SELECTOR:   'partials/dialog-entry-selector',
    DIALOG_DATABANK_INJECT:  'partials/dialog-databank-inject',
    DIALOG_TAG_BROWSER:      'partials/dialog-tag-browser',
    CAUSAL_POPOVER:          'partials/causal-popover',
    DATEPICKER:              'partials/datepicker',
    TIMEPICKER:              'partials/timepicker',
    CONTENT_EDITOR:          'partials/content-editor',
    SEG_ITEM:                'partials/seg-item',
    CE_FEEDBACK_ITEM:        'partials/ce-feedback-item',
    CHAIN_PILL:              'partials/chain-pill',
    CHAIN_PILL_RANGE:        'partials/chain-pill-range',
    SPLIT_DIALOG:            'partials/split-dialog',
    INGEST_SPLIT_PANEL:      'partials/ingest-split-panel',
    INGEST_PREVIEW_PANEL:    'partials/ingest-preview-panel',
    STORY_CONTEXT_PANEL:     'partials/story-context-panel',
    ACD_ITEM:                'partials/acd-item',
    ESG_CELL:                'partials/esg-cell',
    ESG_PILL:                'partials/esg-pill',
    TB_TAB:                  'partials/tb-tab',
    TB_PILL:                 'partials/tb-pill',
    TB_PANEL:                'partials/tb-panel',
    UTILS_PANEL:             'partials/utils-panel',
    FIND_REPLACE_PANEL:      'partials/find-replace-panel',
    BULK_FILL_PANEL:         'partials/bulk-fill-panel',
    GAP_SUGGEST_PANEL:       'partials/gap-suggest-panel',
    NEW_ENTRY_PROMPT:        'partials/new-entry-prompt',
    FILE_ITEM:               'partials/file-item',
});
