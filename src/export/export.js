/**
 * @module export
 * @description Handles exporting entries to .txt, .json, or .md files.
 *
 * ## Export Rules
 * - Entries are sorted numerically regardless of source file
 * - Bracket format: `[Date, Time | Location]` — omitted entirely if all fields empty
 * - The `notes` field is NEVER exported (UI-only)
 * - Act names are NEVER exported in .txt/.md (included only in .json metadata)
 * - .json export includes full act metadata for downstream tools
 *
 * ## New Features (v2)
 * - Live preview showing single entry as it will appear in file (black on white)
 * - Full preview pane with all entries
 * - Scope selection (all / current act / selected entries)
 * - Copy to clipboard
 */

import { state } from '../core/state.js';
import { buildBracket, escHtml } from '../core/utils.js';

/**
 * Get entries for export based on the current scope selection.
 *
 * @returns {object[]} Sorted array of entries matching the scope.
 */
function getScopedEntries() {
    const scope = $('.se-scope-btn.active').data('scope') || 'all';
    let entries;

    if (scope === 'selected' && state.selected.size > 0) {
        entries = [...state.selected]
            .map(num => state.entries.get(num))
            .filter(Boolean);
    } else if (scope === 'act') {
        // Use the act dropdown value, or fall back to selectedActId
        const actIdStr = $('#se-scope-act-select').val();
        const actId = actIdStr ? Number.parseInt(actIdStr, 10) : state.selectedActId;
        const act = actId ? state.acts.get(actId) : null;
        if (act) {
            entries = [...act.entryNums]
                .map(num => state.entries.get(num))
                .filter(Boolean);
        } else {
            entries = [...state.entries.values()];
        }
    } else {
        entries = [...state.entries.values()];
    }

    return entries.sort((a, b) => a.num - b.num);
}

/**
 * Build the full export content string for a given format.
 *
 * @param {'txt'|'json'|'md'} format - Output format.
 * @returns {string} The formatted export content.
 */
/**
 * Build export content from an explicit entries array (for per-arc inject, etc.).
 * @param {object[]} entries - Array of entry objects.
 * @param {string} format - 'txt' | 'json' | 'yaml'.
 * @returns {string}
 */
export function buildExportContentFrom(entries, format) {
    const sorted = [...entries].sort((a, b) => a.num - b.num);
    if (format === 'json') return buildJsonExport(sorted);
    if (format === 'yaml') return buildYamlExport(sorted);
    return sorted.map(entry => {
        const actName = entry.actId ? state.acts.get(entry.actId)?.name || null : null;
        const bracket = buildBracket(entry, actName);
        return `#${entry.num}. ${bracket ? bracket + ' ' : ''}${entry.content}`;
    }).join('\n');
}

export function buildExportContent(format) {
    const sorted = getScopedEntries();

    if (format === 'json') {
        return buildJsonExport(sorted);
    }

    if (format === 'yaml') {
        return buildYamlExport(sorted);
    }

    const lines = sorted.map(entry => {
        const actName = entry.actId ? state.acts.get(entry.actId)?.name || null : null;
        const bracket = buildBracket(entry, actName);
        const prefix = bracket ? `${bracket} ` : '';
        return `#${entry.num}. ${prefix}${entry.content}`;
    });

    if (format === 'md') {
        return `# Summary Export\n\n${lines.join('\n\n')}`;
    }

    return lines.join('\n');
}

/**
 * Build YAML-style export output.
 *
 * @param {object[]} sorted - Sorted entries.
 * @returns {string} YAML-formatted string.
 */
function buildYamlExport(sorted) {
    return sorted.map(entry => {
        const actName = entry.actId ? state.acts.get(entry.actId)?.name || null : null;
        const bracket = buildBracket(entry, actName);
        const prefix = bracket ? `${bracket} ` : '';
        return `${entry.num}: ${prefix}${entry.content}`;
    }).join('\n');
}

/**
 * Build structured JSON export with entry data and act metadata.
 */
function buildJsonExport(sorted) {
    const data = {
        exported: new Date().toISOString(),
        entries: sorted.map(e => ({
            num: e.num,
            content: e.content,
            date: e.date || null,
            time: e.time || null,
            location: e.location || null,
            act: e.actId ? state.acts.get(e.actId)?.name || null : null,
        })),
        acts: [...state.acts.values()].map(a => ({
            name: a.name,
            entries: [...a.entryNums].sort((x, y) => x - y),
            notes: a.notes || null,
        })),
    };
    return JSON.stringify(data, null, 2);
}

/**
 * Format a single entry as a string for live preview based on format.
 * @param {object} entry
 * @param {string} format
 * @returns {string}
 */
function formatEntryForPreview(entry, format) {
    const actName = entry.actId ? state.acts.get(entry.actId)?.name || null : null;
    const bracket = buildBracket(entry, actName);

    if (format === 'json') {
        const obj = { num: entry.num, content: entry.content, date: entry.date || null, time: entry.time || null, location: entry.location || null };
        if (entry.actId) obj.act = actName;
        return JSON.stringify(obj, null, 2);
    }
    if (format === 'yaml') {
        return `${entry.num}: ${bracket ? bracket + ' ' : ''}${entry.content}`;
    }
    return `#${entry.num}. ${bracket ? bracket + ' ' : ''}${entry.content}`;
}

/**
 * Update the live preview pane.
 * - No selection → entry #1
 * - Partial selection → all selected entries (scrollable, same height)
 * - All selected → placeholder directing user to Full Preview
 */
export function updateLivePreview() {
    const $pre = $('#se-live-preview');
    const $label = $('#se-live-preview-label');
    if (!$pre.length) return;

    const allEntries = [...state.entries.values()].sort((a, b) => a.num - b.num);
    if (allEntries.length === 0) {
        $pre.text('(no entries loaded)');
        $label.text('Live Preview');
        return;
    }

    const format = $('#se-export-format').val() || 'txt';
    const selCount = state.selected.size;
    const totalCount = state.entries.size;

    // All entries selected → redirect to full preview
    if (selCount > 0 && selCount === totalCount) {
        $pre.addClass('se-live-preview-placeholder').html(
            '<span class="se-lp-placeholder-text">All entries selected — see Full Preview below for the complete rendering.</span>'
        );
        $label.text('Live Preview');
        return;
    }

    $pre.removeClass('se-live-preview-placeholder');

    // Partial selection → show selected entries, scrollable
    if (selCount > 0) {
        const selected = [...state.selected]
            .map(n => state.entries.get(n)).filter(Boolean)
            .sort((a, b) => a.num - b.num);
        // JSON/YAML need structured output (commas, array wrapper, etc.)
        const text = (format === 'json' || format === 'yaml')
            ? buildExportContentFrom(selected, format)
            : selected.map(e => formatEntryForPreview(e, format)).join('\n\n');
        $pre.addClass('se-live-preview-multi').text(text);
        $label.text(`Live Preview — ${selCount} selected entr${selCount === 1 ? 'y' : 'ies'}`);
        return;
    }

    // No selection → entry #1
    $pre.removeClass('se-live-preview-multi');
    $pre.text(formatEntryForPreview(allEntries[0], format));
    $label.text('Live Preview — Entry #1');
}

/**
 * Collect active inject toggles from the toolbar.
 * @returns {Set<string>} e.g. {'bold','headings','dividers'}
 */
function getActiveToggles() {
    const toggles = new Set();
    $('.se-preview-fmt-btn.active').each(function () { toggles.add($(this).data('pfmt')); });
    return toggles;
}

/**
 * Build the bracket HTML snippet, optionally bolded.
 * @param {string|null} bracket
 * @param {boolean} bold
 * @returns {string}
 */
function buildBracketHtml(bracket, bold) {
    if (!bracket) return '';
    const inner = escHtml(bracket);
    return bold
        ? `<span class="se-bracket"><strong>${inner}</strong></span> `
        : `<span class="se-bracket">${inner}</span> `;
}

/**
 * Build an explicit metadata tags line from an entry.
 * @param {object} entry
 * @param {string|null} actName
 * @returns {string} HTML string (empty if no metadata)
 */
function buildTagsLine(entry, actName) {
    const parts = [];
    if (entry.date) parts.push(`date: ${escHtml(entry.date)}`);
    if (entry.time) parts.push(`time: ${escHtml(entry.time)}`);
    if (entry.location) parts.push(`location: ${escHtml(entry.location)}`);
    if (actName) parts.push(`act: ${escHtml(actName)}`);
    if (parts.length === 0) return '';
    return `\n<span class="se-bracket">[${parts.join(' | ')}]</span>`;
}

/**
 * Format a single entry as HTML for the full preview, layering active inject toggles.
 * @param {object} entry
 * @param {Set<string>} toggles - Active inject toggle names.
 * @returns {string} HTML string
 */
function formatEntryForFullPreview(entry, toggles) {
    const actName = entry.actId ? state.acts.get(entry.actId)?.name || null : null;
    const bracket = buildBracket(entry, actName);

    const bracketHtml = buildBracketHtml(bracket, toggles.has('bold'));
    const tagsLine = toggles.has('tags') ? buildTagsLine(entry, actName) : '';
    const heading = toggles.has('headings')
        ? `<span class="se-entry-num">## Entry ${entry.num}</span>\n`
        : '';
    const bullet = toggles.has('bullets') ? '- ' : '';
    const numPrefix = `<span class="se-entry-num">#${entry.num}.</span> `;

    let line = `${heading}${bullet}${numPrefix}${bracketHtml}${escHtml(entry.content)}${tagsLine}`;

    if (toggles.has('quotes')) {
        line = line.split('\n').map(l => `&gt; ${l}`).join('\n');
    }
    return line;
}

/**
 * Render the full preview pane with all exported entries.
 * Respects the file format (.txt/.json/.yaml) and inject toggles.
 */
export function renderFullPreview() {
    const $pre = $('#se-full-preview');
    if (!$pre.length) return;

    const format = $('#se-export-format').val() || 'txt';
    const sorted = getScopedEntries();
    const isTxt = format === 'txt';

    // Show/hide the "txt only" note and disable buttons for non-txt formats
    $('#se-preview-fmt-note').toggle(!isTxt);
    $('.se-preview-fmt-btn').toggleClass('se-preview-fmt-btn-disabled', !isTxt);

    // JSON / YAML → show raw output as text (inject toggles don't apply)
    if (format === 'json') {
        $pre.text(buildJsonExport(sorted));
        updatePreviewStats(sorted);
        return;
    }
    if (format === 'yaml') {
        $pre.text(buildYamlExport(sorted));
        updatePreviewStats(sorted);
        return;
    }

    // TXT → render with inject toggles as HTML
    const toggles = getActiveToggles();
    const separator = toggles.has('dividers') ? '\n\n---\n\n' : '\n\n';
    const lines = sorted.map(entry => formatEntryForFullPreview(entry, toggles));
    $pre.html(lines.join(separator));
    updatePreviewStats(sorted);
}

/**
 * Update the token/word count badge below the preview label.
 * @param {object[]} sorted
 */
function updatePreviewStats(sorted) {
    const totalChars = sorted.reduce((s, e) => s + e.content.length, 0);
    const totalWords = sorted.reduce((s, e) => s + e.content.split(/\s+/).filter(Boolean).length, 0);
    const totalTokens = Math.ceil(totalChars / 4);
    $('#se-export-token-total').text(`${sorted.length} entries · ~${totalTokens.toLocaleString()} tok · ${totalWords.toLocaleString()} words`);
}

/**
 * Show or toggle the export preview pane.
 */
export function showExportPreview() {
    renderFullPreview();
}

/**
 * Handle the "Download Export" button click.
 * Supports "download" (browser save) and "new-folder" (zip with folder path) destinations.
 */
export async function handleExport(rewordFn) {
    const format = $('#se-export-format').val();
    const doRag = $('#se-export-rag').is(':checked') && $('#se-export-rag-confirm').is(':checked');

    if (doRag && rewordFn) {
        await rewordFn();
    }

    const content = buildExportContent(format);
    let ext = '.txt';
    if (format === 'json') ext = '.json';
    else if (format === 'md') ext = '.md';
    else if (format === 'yaml') ext = '.yaml';
    const baseName = getExportBaseName();
    const fileName = baseName + ext;

    const dest = $('#se-export-dest').val();
    if (dest === 'new-folder' || dest === 'source-folder') {
        const folderPath = ($('#se-folder-path').val() || '').trim();
        if (!folderPath) {
            alert('Please enter a folder path for the export.');
            return;
        }
        const cleanPath = folderPath.replace(/[/\\]+$/, '');
        await downloadFolderZip(cleanPath, fileName, content);
        return;
    }

    downloadFile(fileName, content, format === 'json' ? 'application/json' : 'text/plain');

    // Auto-inject into databank if toggle is enabled
    if ($('#se-export-auto-inject').is(':checked') && globalThis.SummaryEditorAutoInject) {
        globalThis.SummaryEditorAutoInject();
    }
}

/**
 * Build clipboard text based on current selection state.
 * - Partial selection → selected entries only
 * - All selected or no selection → full export
 * @returns {string}
 */
function buildClipboardContent() {
    const format = $('#se-export-format').val() || 'txt';
    const selCount = state.selected.size;
    const totalCount = state.entries.size;

    // Partial selection → only selected entries
    if (selCount > 0 && selCount < totalCount) {
        const selected = [...state.selected]
            .map(n => state.entries.get(n)).filter(Boolean)
            .sort((a, b) => a.num - b.num);
        return buildExportContentFrom(selected, format);
    }

    // All selected or no selection → full export
    return buildExportContent(format);
}

/**
 * Copy export content to clipboard.
 * Respects current table selection: partial → selected entries, else full export.
 */
export async function copyToClipboard() {
    const content = buildClipboardContent();

    try {
        await navigator.clipboard.writeText(content);

        const $popover = $('#se-copy-popover');
        const preview = content.length > 800 ? `${content.slice(0, 800)}…` : content;
        $('#se-copy-popover-body').text(preview);
        $popover.addClass('active');

        clearTimeout(copyToClipboard._timer);
        copyToClipboard._timer = setTimeout(() => $popover.removeClass('active'), 3000);
    } catch (err) {
        console.warn('[Summary Editor] Clipboard copy failed:', err);
        alert('Failed to copy to clipboard. Your browser may not support this feature.');
    }
}

/**
 * Update the scope button counts.
 */
export function updateScopeCounts() {
    $('#se-scope-all-count').text(state.entries.size);
    $('#se-scope-sel-count').text(state.selected.size);
}

/**
 * Populate the act scope dropdown with available acts.
 * Defaults to first act if none selected.
 */
export function updateActScopeDropdown() {
    const $sel = $('#se-scope-act-select');
    if (!$sel.length) return;

    $sel.empty();
    for (const act of state.acts.values()) {
        $sel.append(`<option value="${act.id}">${act.name} (${act.entryNums.size})</option>`);
    }

    // Default to first act or selectedActId
    if (state.selectedActId && state.acts.has(state.selectedActId)) {
        $sel.val(state.selectedActId);
    }
}

/**
 * Trigger a browser file download.
 */
export function downloadFile(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();

    anchor.remove();
    URL.revokeObjectURL(url);
}

/**
 * Download each source file separately with its entries re-exported.
 * Warns user that files will have the same names as originals.
 */
export function downloadBySource() {
    const format = $('#se-export-format').val() || 'txt';
    const grouped = groupEntriesBySource();

    if (grouped.size === 0) {
        alert('No entries to export.');
        return;
    }

    const fileCount = grouped.size;
    if (!confirm(`This will download ${fileCount} file${fileCount > 1 ? 's' : ''} with their original names. Files with the same name will overwrite if saved to the same folder.\n\nContinue?`)) {
        return;
    }

    let delay = 0;
    for (const [fileName, entries] of grouped) {
        const content = buildContentForEntries(entries, format);
        const ext = format === 'json' ? '.json' : format === 'md' ? '.md' : '.txt';
        const name = fileName.replace(/\.[^.]+$/, '') + ext;
        setTimeout(() => downloadFile(name, content, format === 'json' ? 'application/json' : 'text/plain'), delay);
        delay += 300;
    }
}

/**
 * Download all source files bundled in a single zip.
 */
export async function downloadAsZip() {
    const format = $('#se-export-format').val() || 'txt';
    const grouped = groupEntriesBySource();

    if (grouped.size === 0) {
        alert('No entries to export.');
        return;
    }

    const files = [];
    for (const [fileName, entries] of grouped) {
        const content = buildContentForEntries(entries, format);
        const ext = format === 'json' ? '.json' : format === 'md' ? '.md' : '.txt';
        const name = fileName.replace(/\.[^.]+$/, '') + ext;
        files.push({ name, content });
    }

    const zipBlob = buildZipBlob(files);
    const timestamp = new Date().toISOString().slice(0, 10);
    downloadFile(`summary_export_${timestamp}.zip`, zipBlob, 'application/zip');
}

/**
 * Download export as a zip with files inside a named folder.
 *
 * @param {string} folderPath - Folder name/path to use inside the zip.
 * @param {string} fileName - The export filename (e.g. bulk_summary.txt).
 * @param {string} content - The export content string.
 * @param {string} format - The export format (txt/json/md/yaml).
 */
async function downloadFolderZip(folderPath, fileName, content) {
    const folderName = folderPath.replaceAll('\\', '/');
    const files = [{ name: `${folderName}/${fileName}`, content }];
    const zipBlob = buildZipBlob(files);
    const zipName = folderName.split('/').pop() || 'export';
    downloadFile(`${zipName}.zip`, zipBlob, 'application/zip');
}

/**
 * Group all entries by their source filename.
 * @returns {Map<string, object[]>} Source filename → sorted entries.
 */
function groupEntriesBySource() {
    const grouped = new Map();
    for (const entry of state.entries.values()) {
        const src = entry.source || 'unknown.txt';
        if (!grouped.has(src)) grouped.set(src, []);
        grouped.get(src).push(entry);
    }
    for (const entries of grouped.values()) {
        entries.sort((a, b) => a.num - b.num);
    }
    return grouped;
}

/**
 * Build export content for a specific set of entries.
 */
function buildContentForEntries(entries, format) {
    if (format === 'json') {
        return JSON.stringify({
            exported: new Date().toISOString(),
            entries: entries.map(e => ({
                num: e.num,
                content: e.content,
                date: e.date || null,
                time: e.time || null,
                location: e.location || null,
                act: e.actId ? state.acts.get(e.actId)?.name || null : null,
            })),
        }, null, 2);
    }

    const lines = entries.map(entry => {
        const actName = entry.actId ? state.acts.get(entry.actId)?.name || null : null;
        const bracket = buildBracket(entry, actName);
        const prefix = bracket ? `${bracket} ` : '';
        return `#${entry.num}. ${prefix}${entry.content}`;
    });

    if (format === 'md') {
        return `# Summary Export\n\n${lines.join('\n\n')}`;
    }
    return lines.join('\n');
}

/**
 * Build a minimal ZIP file blob from an array of { name, content } files.
 * Uses the ZIP format spec directly — no external library needed.
 */
function buildZipBlob(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const centralDir = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = encoder.encode(file.name);
        const contentBytes = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
        const crc = crc32(contentBytes);

        // Local file header (30 + nameLen + contentLen)
        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true); // signature
        lv.setUint16(4, 20, true);          // version needed
        lv.setUint16(6, 0, true);           // flags
        lv.setUint16(8, 0, true);           // compression (store)
        lv.setUint16(10, 0, true);          // mod time
        lv.setUint16(12, 0, true);          // mod date
        lv.setUint32(14, crc, true);        // crc32
        lv.setUint32(18, contentBytes.length, true); // compressed size
        lv.setUint32(22, contentBytes.length, true); // uncompressed size
        lv.setUint16(26, nameBytes.length, true);    // filename length
        lv.setUint16(28, 0, true);          // extra length
        localHeader.set(nameBytes, 30);

        parts.push(localHeader, contentBytes);

        // Central directory entry
        const cdEntry = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(cdEntry.buffer);
        cv.setUint32(0, 0x02014b50, true);  // signature
        cv.setUint16(4, 20, true);           // version made by
        cv.setUint16(6, 20, true);           // version needed
        cv.setUint16(8, 0, true);            // flags
        cv.setUint16(10, 0, true);           // compression
        cv.setUint16(12, 0, true);           // mod time
        cv.setUint16(14, 0, true);           // mod date
        cv.setUint32(16, crc, true);         // crc32
        cv.setUint32(20, contentBytes.length, true); // compressed
        cv.setUint32(24, contentBytes.length, true); // uncompressed
        cv.setUint16(28, nameBytes.length, true);    // name length
        cv.setUint16(30, 0, true);           // extra length
        cv.setUint16(32, 0, true);           // comment length
        cv.setUint16(34, 0, true);           // disk start
        cv.setUint16(36, 0, true);           // internal attrs
        cv.setUint32(38, 0, true);           // external attrs
        cv.setUint32(42, offset, true);      // local header offset
        cdEntry.set(nameBytes, 46);
        centralDir.push(cdEntry);

        offset += localHeader.length + contentBytes.length;
    }

    // End of central directory
    const cdOffset = offset;
    let cdSize = 0;
    for (const entry of centralDir) {
        parts.push(entry);
        cdSize += entry.length;
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);    // signature
    ev.setUint16(4, 0, true);              // disk number
    ev.setUint16(6, 0, true);              // cd disk
    ev.setUint16(8, files.length, true);   // entries on disk
    ev.setUint16(10, files.length, true);  // total entries
    ev.setUint32(12, cdSize, true);        // cd size
    ev.setUint32(16, cdOffset, true);      // cd offset
    ev.setUint16(20, 0, true);             // comment length
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
}

/**
 * CRC-32 calculation for ZIP file integrity.
 */
function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Derive the base filename for exports.
 */
function getExportBaseName() {
    return 'bulk_summary';
}
