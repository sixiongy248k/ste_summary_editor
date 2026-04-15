# Summary Editor — Wishlist

Future features and expansion ideas. Items here are not committed — they're candidates for future work.

---

## Completed

### Core & Review
- **Info tooltip fix** — repositioned to avoid container clipping
- **Custom date/time pickers** — calendar grid (month/year dropdowns + day grid) and clock picker (hour/minute + AM/PM) replacing native inputs that reset on navigation
- **Content Editor** — click any content cell → draggable non-modal dialog; edit content, view conflict feedback (read-only), ask connected API to revise with a customisable system prompt, re-check conflicts on this entry only; saved entries get light-blue tint + ✎ icon
- **Simple Merge** — select 2+ entries → merge content with `\n\n`; earliest act wins; no renumbering
- **Split Entry** — select 1 entry → mark text segments with distinct random colours → split into N entries; all entries above shift up by N-1; `shiftEntriesUp` handles all state atomically
- **Modified indicator** — `state.modified` Set persisted to localStorage; edited entries visually flagged in table
- **New Entry button** — inserts blank entry after selected row, shifts all downstream up by 1
- **Expanded undo** — undoable: file load, clear all, tab navigation, new entry, merge, split, move, swap, assign to act, create act, delete act, rename act, act notes, causal link/remove/clear, conflict clear, date/time/location/notes field edits
- **Draggable non-blocking panels** — every dialog/panel draggable by header; drag-constraint keeps panel on-screen; all panels float without darkening background

### Act Map & Visualizations
- **Mindmap redesign** — custom SVG bezier mindmap replaced mermaid; Monokai dark, act-colored branches, drag-to-pan + zoom
- **Color picker redesign** — iro.js Box+Hue layout + HEX/HSL/RGB format dropdown
- **Causality links** — `state.causality` persisted; chain button per row; floating dialog; cell popover pills; mindmap dashed arrows; **Link Merge** (renamed from Merge) for cross-act awareness
- **Timeline top/bottom layout** — entries grouped by calendar month, not exact date; undated always top; dated months alternate top/bottom to prevent clipping; dynamic canvas height
- **Location Bubble Chart** — physics simulation (gravity + repulsion, 260 iterations); bubble size ∝ √(visit count); 20-colour modern palette; auto-inverted text; cluster centred in viewport; toggle from timeline with a view button
- **Frosted glass toolbar** — horizontal bar (view toggles + label) + vertical sidebar (zoom/expand) float as `position:absolute` over the timeline viewport with `backdrop-filter: blur(14px)`; transparent in both normal and expanded modes

### Ingestion & File Management
- **Filename gating** — files must contain "sum" + a digit to be recognized; all others rejected with reason
- **Flexible Part detection** — any line with `part` (word boundary) + colon on same line; handles markdown formatting
- **5 rejection reasons** — unsupported extension, empty file, filename not recognized, no valid structure, malformed data; shown per-file in orange
- **File drawer improvements** — per-file remove button (×), OK file read-only preview, orange ℹ + rejection reason for invalid files
- **Ingest split improvements** — position-based entry insertion, auto-trim summary/part header prefixes, single-piece confirm, orphan Part act cleanup
- **Info tooltip overhaul** — scrollable tooltip with file recognition rules, recognized formats, and rejection reasons listed
- **Act stats relocation** — range/entries/tokens moved from act list items to act detail panel header

### Settings & Access Control
- **Character blacklist** — autocomplete search for characters, shown as removable pills; blocked characters can't open editor or see wand option
- **Tag blacklist** — autocomplete search for ST tags (including folder tags); all characters with a blacklisted tag are blocked
- **Blocked state sync** — CHAT_CHANGED event refreshes blocked state; settings button shows "Blocked for this character" when active
- **Updated description** — settings panel description updated to reflect current feature set

### Export & Databank
- **Export format notes** — contextual hint per format (txt/json/yaml) about formatting fidelity
- **Download by Source / Download as Zip** — multi-file export options
- **Token/word counts** — per-entry `~N tok` badge in table; live counter in Content Editor; per-arc total in Edit tab; running total in Export panel
- **Incremental databank inject** — content hash tracking; skips re-upload when nothing changed since last inject
- **Inject by Arc** — each arc uploaded as its own `SE_Arc_<name>` ST attachment; per-arc hash tracking skips unchanged arcs
- **Auto-inject on export** — optional checkbox: push to databank automatically after every download export
- **Story context panel** — narrative summary auto-generated after full conflict check; editable; sent as context with every subsequent conflict check and API call

### Conflict & Story Context
- **Story context generation** — silent background API call after full conflict check; stored in `state.storyContext`; prepended to conflict-check and content-editor API prompts
- **Editable story context panel** — accessible via "📖 Story Context" button in conflict results dialog; user edits persist to `state.storyContext`

### QoL & Ergonomics
- **Find & replace across entries** — floating draggable panel; search/replace with case-toggle and live match count; Replace All with undo
- **Bulk metadata fill** — floating panel; apply date, time, or location to all selected entries at once; undoable
- **Conflict quick-fix shortcut** — "✎ Fix" button in Feedback column opens Content Editor pre-loaded for the entry; one-click fix loop
- **Fullscreen content editor** — ⛶ expand button in Content Editor toggles full-panel fixed overlay for focused long-form rewriting
- **Collapsible act sections** — act group header rows with chevron; click to fold/unfold entire act group in act-sorted view; collapse state persists across re-renders
- **Keyboard navigation** — arrow keys move `.se-row-focused` between rows with smooth scroll; `Enter` opens Content Editor; `Delete` removes entry (with confirm); `Space` toggles checkbox
- **Entry completeness indicator** — colored pill badge replaces plain entry number: green (content + all meta + no hard conflicts), yellow (missing metadata), red (no content or hard conflicts); tooltip on hover; auto-updates on cell save
- **Smart gap suggest** — ✨ Suggest button on hover in gap rows; sends ±5 surrounding entries to LLM as context; result shown in draggable panel with "Use this" button to fill the gap; undoable
- **Named entity sidebar** — `src/table/entity-sidebar.js`; capitalisation heuristics; floating draggable panel; count badge; click → sets table search query
- **Timeline file analysis** — `src/analysis/timeline-analysis.js`; 📅 toggle per file in ingest drawer (auto-detects by filename/content); `📅 Timeline` toolbar button; draggable results panel; Relaxed/Medium/Thorough strictness; editable system prompt; JSON `[{num, reason}]` response; separate from conflict detection
- **Utils panel** — draggable floating panel (`⚙ Utils`) containing Find & Replace, Named Entities, Tag Browser, Causal Links
- **Review toolbar reorganisation** — entry count next to Show Full with gradient divider; Check Conflicts joined button group; Utils panel replaces individual toolbar buttons
- **System prompt hub** — self-registering `registerPrompt(key, label, default)` registry in `src/core/system-prompts.js`; hub panel (`⚙ Prompts` button in Acts toolbar) shows one editable card per registered prompt; individual ⚙ edit buttons next to each LLM-calling function; bidirectional sync via `state.systemPrompts[key]`; persisted separately in `se-system-prompts-v1` localStorage key (survives main state clear); prompts registered: conflict-check, story-context, rag-reword, gap-suggest, content-editor
- **Drag-to-reorder rows** — drag handle on num cell; HTML5 drag-and-drop; drop highlights target row; calls `moveEntries([dragNum], targetNum)` on drop
- **Notes cell truncation** — notes cell truncates with ellipsis at column width; popover uses `<textarea>` with `overflow-y: auto` and `resize: vertical` for long notes
- **Review table column widths as constants** — `TABLE_COLS` in `constants.js`; injected as CSS custom properties at startup; CSS reads `var(--se-col-*)` for all column widths; single-source-of-truth for table layout

---

## TODO NOW

### Remaining upgrades

- **Modular / organic-growth coding practice** — self-registering modules; features contribute to shared UI by calling a registry function; aggregators iterate the registry without knowing about individual features; applied to system prompt hub; general principle for all future work

---

## v1 — Summary Refiner (Core Purpose)

### LLM-Assisted Summary Refinement (bulk)
- "Refine" button per entry or bulk selection
- Presents 3 alternative rewrites to choose from
- Distinct from Content Editor's single-entry API revise — this is a bulk quality pass

---

## v2 — Expansion: Side Information & Character Tracking

### Non-Numbered File Ingestion
- Allow ingesting files without numbered entries as supplementary/side information
- Separate category from main story entries
- Shown in minimap UI under an "Others" category

### Arc Panel Enhancements
- Disclaimer/description: "Edit arc groupings or attach additional side information such as character notes, world details, etc."
- Entries without an act shown as "Others" in minimap

### Character Tracking Fields
- User-defined metadata per entry: character development, appearance, relationships, power, resources
- Searchable/filterable in Review
- Visible in arc detail panel
- Optionally exported in JSON

### Custom Metadata Tracks
- User creates named tracks (e.g. "Voss - Power Level")
- Per-entry chip annotations
- Minimap overlay mode: show where tracked attributes change

---

## v1.5 — Summaries Reorganizer (Destructive Export)

### Folder-Based Ingest & Replace
- Load an entire folder of summary files
- **Destructive export mode:** replaces and overwrites source files
- Double-confirmation with explicit warning + backup-as-zip option

---

## Ideas / Maybe Later
- Diff view: before/after when refining entries
- Version history per entry (undo beyond single level)
- Import from other formats (CSV, Google Docs)
- Story consistency score (aggregate conflict results)
- Timeline: click a card to jump to that entry in the Review table
- Bubble chart: click a bubble to filter Review table to that location
