/**
 * @module ingestion
 * @description Handles file loading and parsing of summary entries.
 *
 * ## Two Parsing Modes
 *
 * ### Mode 1: Numbered Entries (default)
 * Scans for patterns like "1. content", "1 . content", etc.
 * Each numbered line starts a new entry; non-numbered lines are continuations.
 *
 * ### Mode 2: Part-Based Sections (fallback)
 * If no numbered entries are found, scans for "Part 1", "Part #2", etc.
 * Each Part becomes an act. Content after the Part header is split into
 * paragraphs (blank-line separated), and each paragraph becomes a sequentially
 * numbered entry auto-assigned to that Part's act.
 *
 * ## Merge Behavior
 * - Duplicate entry numbers across files: last-loaded file wins (user warned)
 * - Part-based entries are numbered starting after the highest existing entry
 */

import { ENTRY_PATTERNS, BRACKET_PATTERN } from '../core/constants.js';

/**
 * A line is a Part header if it contains the word "part" (any casing, with or
 * without markdown asterisks: *part*, **part**) AND a colon anywhere on the line.
 * Examples: "Part 1:", "**Part 2:** intro", "*part three:*", "Story part 4: ..."
 */
const PART_HEADER_RE = /\bpart\b/i;
import { state, persistState } from '../core/state.js';
import { detectGaps } from './gap-detection.js';
import { renderTable } from '../table/table.js';
import { renderActMinimap, updateFilterDropdown, autoCreateAct } from '../arcs/arcs.js';

/**
 * Parse a text string into numbered summary entries.
 * Lines matching numbered patterns start new entries; subsequent non-matching
 * lines are appended as continuation text to the current entry.
 *
 * @param {string} text - Raw file content to parse.
 * @returns {Array<{num: number, content: string}>} Parsed entries, sorted by appearance order.
 */
export function parseEntries(text) {
    const lines = text.split(/\r?\n/);
    const entries = [];
    let currentNum = null;
    let currentContent = '';

    for (const line of lines) {
        let matched = false;

        for (const pattern of ENTRY_PATTERNS) {
            const match = pattern.exec(line);
            if (match) {
                if (currentNum !== null) {
                    entries.push({ num: currentNum, content: currentContent.trim() });
                }
                currentNum = Number.parseInt(match[1], 10);
                currentContent = match[2] || '';
                matched = true;
                break;
            }
        }

        if (!matched && currentNum !== null) {
            currentContent += ' ' + line.trim();
        }
    }

    if (currentNum !== null) {
        entries.push({ num: currentNum, content: currentContent.trim() });
    }

    return entries;
}

/** Minimum character count for a single-block Part body to be considered "unsplit" / problematic. */
const UNSPLIT_THRESHOLD = 200;

/**
 * Finalize a Part: split its body into paragraphs and detect unsplit blocks.
 * @param {object} part - Part object with paragraphs field to populate.
 * @param {string[]} bodyLines - Raw lines from the Part body.
 * @returns {boolean} True if the Part body is a single unsplit block above threshold.
 */
function finalizePart(part, bodyLines) {
    part.paragraphs = splitIntoParagraphs(bodyLines);
    part.unsplit = part.paragraphs.length <= 1 && bodyLines.join(' ').trim().length >= UNSPLIT_THRESHOLD;
    return part.unsplit;
}

/**
 * Finalize and push the current part if one is active.
 * @param {object|null} part
 * @param {string[]} bodyLines
 * @param {object[]} parts
 * @returns {boolean} True if the part was unsplit (above threshold).
 */
function flushCurrentPart(part, bodyLines, parts) {
    if (part === null) return false;
    const unsplit = finalizePart(part, bodyLines);
    parts.push(part);
    return unsplit;
}

/**
 * Parse a text string into Part-based sections, then split each Part's
 * body into paragraphs. Each paragraph becomes a numbered entry.
 *
 * @param {string} text - Raw file content to parse.
 * @returns {{ parts: Array<{partNum: number, title: string, paragraphs: string[]}>, hasUnsplitParts: boolean }}
 */
export function parsePartEntries(text) {
    const lines = text.split(/\r?\n/);
    const parts = [];
    let currentPart = null;
    let bodyLines = [];
    let hasUnsplitParts = false;
    let partSeq = 0;

    for (const line of lines) {
        const partMatch = matchPartHeader(line);

        if (partMatch) {
            partSeq++;
            const partNum = partMatch.partNum ?? partSeq;
            if (flushCurrentPart(currentPart, bodyLines, parts)) hasUnsplitParts = true;
            currentPart = { partNum, title: `Part ${partNum}`, paragraphs: [] };
            bodyLines = [];
            if (partMatch.rest) bodyLines.push(partMatch.rest);
        } else if (currentPart !== null) {
            bodyLines.push(line);
        }
    }

    if (flushCurrentPart(currentPart, bodyLines, parts)) hasUnsplitParts = true;

    return { parts, hasUnsplitParts };
}

/**
 * Match a line as a Part header.
 * Rule: line contains the word "part" (case-insensitive, with or without markdown
 * asterisks) AND a colon appears anywhere on the same line.
 *
 * @param {string} line
 * @returns {{ partNum: number|null, rest: string } | null}
 */
function matchPartHeader(line) {
    if (!PART_HEADER_RE.test(line) || !line.includes(':')) return null;
    const numMatch = /\d+/.exec(line);
    const colonIdx = line.indexOf(':');
    return {
        partNum: numMatch ? Number.parseInt(numMatch[0], 10) : null,
        rest: line.slice(colonIdx + 1).trim(),
    };
}

/**
 * Split an array of lines into content paragraphs.
 * Uses blank-line separation only — no sentence/period-based splitting.
 * If the body has no blank lines, returns the full block as a single paragraph
 * (the caller marks this as "problematic" for manual splitting).
 *
 * @param {string[]} lines - Array of text lines from a Part section.
 * @returns {string[]} Array of paragraph strings.
 */
function splitIntoParagraphs(lines) {
    const blankSplit = splitByBlankLines(lines);
    if (blankSplit.length > 0) return blankSplit;

    // No blank-line splits — return the full block as a single paragraph
    const joined = lines.join(' ').trim();
    return joined.length > 0 ? [joined] : [];
}

/**
 * Split lines by blank-line boundaries.
 *
 * @param {string[]} lines - Array of text lines.
 * @returns {string[]} Paragraphs separated by blank lines.
 */
function splitByBlankLines(lines) {
    const paragraphs = [];
    let current = [];

    for (const line of lines) {
        if (line.trim() === '') {
            if (current.length > 0) {
                paragraphs.push(current.join(' ').trim());
                current = [];
            }
        } else {
            current.push(line.trim());
        }
    }

    if (current.length > 0) {
        paragraphs.push(current.join(' ').trim());
    }

    return paragraphs.filter(p => p.length > 0);
}

/**
 * Parse a JSON string into numbered summary entries.
 * Accepts an array of {num, content} objects, or an array of strings
 * (1-indexed), or an object with numeric keys.
 *
 * @param {string} text - Raw JSON string.
 * @returns {Array<{num: number, content: string}>} Parsed entries, or empty if invalid.
 */
export function parseJsonEntries(text) {
    try {
        const data = JSON.parse(text);

        // Array of {num, content} objects
        if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
            return data
                .filter(item => item.num != null && item.content != null)
                .map(item => ({ num: Number(item.num), content: String(item.content) }))
                .filter(e => !Number.isNaN(e.num) && e.content.length > 0);
        }

        // Array of strings (1-indexed)
        if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'string') {
            return data
                .map((content, i) => ({ num: i + 1, content: String(content).trim() }))
                .filter(e => e.content.length > 0);
        }

        // Object with numeric keys: { "1": "content", "2": "content" }
        if (typeof data === 'object' && !Array.isArray(data)) {
            return Object.entries(data)
                .map(([key, val]) => ({ num: Number(key), content: String(val).trim() }))
                .filter(e => !Number.isNaN(e.num) && e.content.length > 0)
                .sort((a, b) => a.num - b.num);
        }
    } catch { /* not valid JSON */ }
    return [];
}

/**
 * Parse a simple YAML-like string into numbered summary entries.
 * Supports the format:  1: content here  (numeric key: value per line).
 * Multi-line continuation is supported for indented lines.
 *
 * @param {string} text - Raw YAML-like string.
 * @returns {Array<{num: number, content: string}>} Parsed entries, or empty if invalid.
 */
export function parseYamlEntries(text) {
    const lines = text.split(/\r?\n/);
    const entries = [];
    let currentNum = null;
    let currentContent = '';
    const keyPattern = /^(\d+)\s*:\s*(.*)$/;

    for (const line of lines) {
        const match = keyPattern.exec(line);
        if (match) {
            if (currentNum !== null) {
                entries.push({ num: currentNum, content: currentContent.trim() });
            }
            currentNum = Number.parseInt(match[1], 10);
            currentContent = match[2] || '';
        } else if (currentNum !== null && /^\s+\S/.test(line)) {
            // Indented continuation line
            currentContent += ' ' + line.trim();
        } else if (line.trim() === '' && currentNum !== null) {
            // Blank lines are allowed between entries
        }
    }

    if (currentNum !== null) {
        entries.push({ num: currentNum, content: currentContent.trim() });
    }

    return entries.filter(e => e.content.length > 0);
}

/**
 * Parse a single file's text content by dispatching to the appropriate parser.
 *
 * @param {string} text - Raw file content.
 * @param {string} ext - Lowercase file extension (e.g. 'json', 'yaml', 'txt').
 * @returns {{ parsed: Array<{num: number, content: string}>, mode: string }}
 */
function parseByExtension(text, ext) {
    if (ext === 'json') {
        return { parsed: parseJsonEntries(text), mode: 'json' };
    }
    if (ext === 'yaml' || ext === 'yml') {
        const yamlResult = parseYamlEntries(text);
        if (yamlResult.length > 0) return { parsed: yamlResult, mode: 'yaml' };
        return { parsed: parseEntries(text), mode: 'numbered' };
    }
    return { parsed: parseEntries(text), mode: 'numbered' };
}

/**
 * Check if a filename is recognized as a summary file.
 * Must contain "sum" (case-insensitive) AND at least one digit.
 * @param {string} fileName
 * @returns {boolean}
 */
function isSummaryFilename(fileName) {
    const base = fileName.split('/').pop().split('\\').pop().toLowerCase();
    return base.includes('sum') && /\d/.test(base);
}

/** Supported file extensions for ingestion. */
const SUPPORTED_EXTENSIONS = new Set(['txt', 'json', 'yaml', 'yml']);

/**
 * Process a single file: parse, merge into state, and record results.
 *
 * @param {string} text - Raw file content.
 * @param {string} fileName - Source file name.
 * @param {Array} validFiles - Accumulator for successfully parsed files.
 * @param {Array<{name:string, reason:string}>} invalidFiles - Accumulator for rejected files with reasons.
 * @param {number[]} duplicates - Accumulator for duplicate entry numbers.
 */
function processFile(text, fileName, validFiles, invalidFiles, duplicates) {
    const ext = fileName.split('.').pop().toLowerCase();

    if (!SUPPORTED_EXTENSIONS.has(ext)) {
        invalidFiles.push({ name: fileName, reason: 'Unsupported file type \u2014 only .txt, .json, .yaml accepted', rawContent: text });
        return;
    }

    if (text.trim().length === 0) {
        invalidFiles.push({ name: fileName, reason: 'File is empty \u2014 no content to parse', rawContent: '' });
        return;
    }

    if (!isSummaryFilename(fileName)) {
        invalidFiles.push({ name: fileName, reason: 'Filename not recognized \u2014 must contain \u201csum\u201d and a digit', rawContent: text });
        return;
    }

    const { parsed, mode } = parseByExtension(text, ext);

    if (parsed.length > 0) {
        validFiles.push({ name: fileName, count: parsed.length, mode });
        mergeNumberedEntries(parsed, fileName, duplicates);
        return;
    }

    // Last fallback: Part-based parsing
    const { parts, hasUnsplitParts } = parsePartEntries(text);
    if (parts.some(p => p.paragraphs.length > 0)) {
        mergePartEntriesWithSplitCheck(parts, fileName, hasUnsplitParts, validFiles);
        return;
    }

    if (ext === 'json') {
        invalidFiles.push({ name: fileName, reason: 'Malformed JSON \u2014 could not parse valid entries', rawContent: text });
    } else if (ext === 'yaml' || ext === 'yml') {
        invalidFiles.push({ name: fileName, reason: 'Malformed YAML \u2014 could not parse valid entries', rawContent: text });
    } else {
        invalidFiles.push({ name: fileName, reason: 'No valid structure \u2014 no numbered entries or part headers found', rawContent: text });
    }
}

/**
 * Merge Part-based entries and handle unsplit parts (problematic flag).
 */
function mergePartEntriesWithSplitCheck(parts, fileName, hasUnsplitParts, validFiles) {
    const entryCount = mergePartEntries(parts, fileName);
    if (hasUnsplitParts) {
        const unsplitContent = parts
            .filter(p => p.unsplit)
            .flatMap(p => p.paragraphs)
            .join('\n\n');
        validFiles.push({ name: fileName, count: entryCount, mode: 'parts', problematic: true });
        state.fileRawContent.set(fileName, unsplitContent);
    } else {
        validFiles.push({ name: fileName, count: entryCount, mode: 'parts' });
    }
}


/**
 * Handle the file input change event.
 * Reads each selected file, dispatches to the appropriate parser based on
 * file extension, merges into global state, detects gaps, and re-renders.
 *
 * @param {Event} event - The file input `change` event.
 */
export async function handleFileInput(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    // Filter out already-loaded files
    const skippedDupes = [];
    const newFiles = files.filter(f => {
        if (state.sourceFileNames.includes(f.name)) {
            skippedDupes.push(f.name);
            return false;
        }
        return true;
    });

    if (skippedDupes.length > 0 && newFiles.length === 0) {
        displayWarnings([`Duplicate files detected — already loaded: ${skippedDupes.join(', ')}`]);
        $('#se-file-input').val('');
        return;
    }

    const duplicates = [];
    const invalidFiles = [];
    const validFiles = [];

    for (const file of newFiles) {
        const text = await file.text();
        processFile(text, file.name, validFiles, invalidFiles, duplicates);
        state.sourceFileNames.push(file.name);
    }

    // Store raw content for invalid files so preview panel can show it
    for (const inv of invalidFiles) {
        if (inv.rawContent) state.fileRawContent.set(inv.name, inv.rawContent);
    }

    // Append new file statuses to existing list (preserve files from previous loads)
    state.files = [
        ...state.files,
        ...validFiles.map(f => ({
            name: f.name, entryCount: f.count, valid: true,
            mode: f.mode, problematic: f.problematic || false,
        })),
        ...invalidFiles.map(f => ({ name: f.name, entryCount: 0, valid: false, problematic: false, rejectReason: f.reason })),
    ];

    detectGaps();

    const warnings = buildWarnings(invalidFiles, duplicates);
    if (skippedDupes.length > 0) {
        warnings.unshift(`Skipped duplicate files (already loaded): ${skippedDupes.join(', ')}`);
    }
    displayWarnings(warnings);

    updateFilterDropdown();
    renderTable();
    renderActMinimap();
    persistState();

    $('#se-file-input').val('');
}

/**
 * Parse a bracket metadata block from the start of an entry's content string.
 * Supports the format: `(ActName|date:val|time:val|location:val) rest of content`
 * All fields are optional and order-independent.
 *
 * @param {string} content - Raw content after the entry number.
 * @returns {{ content: string, actName: string|null, date: string, time: string, location: string }}
 */
function parseBracketMetadata(content) {
    const match = BRACKET_PATTERN.exec(content);
    if (!match) return { content, actName: null, date: '', time: '', location: '' };

    const inner = match[1];
    const rest = content.slice(match[0].length);
    const parts = inner.split('|').map(s => s.trim());

    let actName = null;
    let date = '';
    let time = '';
    let location = '';

    for (const part of parts) {
        const lower = part.toLowerCase();
        if (lower.startsWith('date:')) {
            date = part.slice(5).trim();
        } else if (lower.startsWith('time:')) {
            time = part.slice(5).trim();
        } else if (lower.startsWith('location:')) {
            location = part.slice(9).trim();
        } else if (part.length > 0) {
            actName = part; // first unkeyed segment is treated as act name
        }
    }

    return { content: rest, actName, date, time, location };
}

/**
 * Merge numbered entries into global state.
 * If an entry's content starts with a bracket block `(Act|date:...|...)`,
 * the metadata fields are extracted and applied (Type 3 ingest format).
 *
 * @param {Array<{num: number, content: string}>} parsed - Parsed entries.
 * @param {string} fileName - Source file name.
 * @param {number[]} duplicates - Array to collect duplicate entry numbers.
 */
function mergeNumberedEntries(parsed, fileName, duplicates) {
    for (const entry of parsed) {
        if (state.entries.has(entry.num)) {
            duplicates.push(entry.num);
        }

        const existing = state.entries.get(entry.num);
        const meta = parseBracketMetadata(entry.content);

        // Resolve act ID from bracket act name if provided
        let actId = existing?.actId || null;
        if (meta.actName) {
            const matchedAct = [...state.acts.values()].find(
                a => a.name.toLowerCase() === meta.actName.toLowerCase()
            );
            if (matchedAct) {
                actId = matchedAct.id;
            }
        }

        state.entries.set(entry.num, {
            num: entry.num,
            content: meta.content,
            date: meta.date || existing?.date || '',
            time: meta.time || existing?.time || '',
            location: meta.location || existing?.location || '',
            notes: existing?.notes || '',
            actId,
            source: fileName,
        });

        // Register entry in the act's entryNums set
        if (actId && state.acts.has(actId)) {
            state.acts.get(actId).entryNums.add(entry.num);
        }
    }
}

/**
 * Merge Part-based entries into global state and auto-create acts.
 * Entry numbers start after the current highest entry number.
 *
 * @param {Array<{partNum: number, title: string, paragraphs: string[]}>} parts - Parsed parts.
 * @param {string} fileName - Source file name.
 * @returns {number} Total number of entries created.
 */
function mergePartEntries(parts, fileName) {
    // Start numbering after existing entries
    let nextNum = 1;
    if (state.entries.size > 0) {
        nextNum = Math.max(...state.entries.keys()) + 1;
    }

    let totalEntries = 0;

    for (const part of parts) {
        if (part.paragraphs.length === 0) continue;

        const entryNums = [];

        for (const paragraph of part.paragraphs) {
            state.entries.set(nextNum, {
                num: nextNum,
                content: paragraph,
                date: '',
                time: '',
                location: '',
                notes: '',
                actId: null,
                source: fileName,
                problematic: part.unsplit || false,
            });
            entryNums.push(nextNum);
            nextNum++;
            totalEntries++;
        }

        // Auto-create an act for this part
        autoCreateAct(part.title, entryNums);
    }

    return totalEntries;
}

/**
 * Build an array of user-facing warning messages from ingestion results.
 *
 * @param {string[]} invalidFiles - Filenames with no parseable content.
 * @param {number[]} duplicates - Entry numbers that appeared in multiple files.
 * @returns {string[]} Warning messages to display.
 */
function buildWarnings(invalidFiles, duplicates) {
    const warnings = [];

    if (invalidFiles.length) {
        warnings.push(`Unrecognized files: ${invalidFiles.map(f => f.name).join(', ')}`);
    }
    if (duplicates.length) {
        const unique = [...new Set(duplicates)];
        warnings.push(`Duplicate entries (last file wins): #${unique.join(', #')}`);
    }
    if (state.gaps.length) {
        warnings.push(`Missing entries in sequence: #${state.gaps.join(', #')}`);
    }

    return warnings;
}

/**
 * Remove a file and all its entries from state.
 * Cleans up acts (removes entry nums, deletes empty acts), causality links,
 * selection, modified set, and file lists.
 *
 * @param {string} fileName - The file to remove.
 */
export function removeFile(fileName) {
    const numsToRemove = new Set();
    for (const [num, entry] of state.entries) {
        if (entry.source === fileName) numsToRemove.add(num);
    }

    for (const num of numsToRemove) state.entries.delete(num);

    for (const [actId, act] of state.acts) {
        for (const num of numsToRemove) act.entryNums.delete(num);
        if (act.entryNums.size === 0) state.acts.delete(actId);
    }

    for (const num of numsToRemove) {
        delete state.causality[num];
        state.selected.delete(num);
        state.modified.delete(num);
    }
    for (const key of Object.keys(state.causality)) {
        state.causality[key] = state.causality[key].filter(n => !numsToRemove.has(n));
        if (state.causality[key].length === 0) delete state.causality[key];
    }

    state.files = state.files.filter(f => f.name !== fileName);
    state.sourceFileNames = state.sourceFileNames.filter(n => n !== fileName);
    state.fileRawContent.delete(fileName);
}

/**
 * Show or hide the warning banner based on messages.
 *
 * @param {string[]} warnings - Array of warning strings to display.
 */
function displayWarnings(warnings) {
    const $banner = $('#se-warning-banner');
    if (warnings.length) {
        $banner.find('.se-warning-text').html(warnings.map(w => `&#9888; ${w}`).join('<br>'));
        $banner.show().css('display', 'flex');
    } else {
        $banner.hide();
    }
}
