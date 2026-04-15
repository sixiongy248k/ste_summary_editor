# Summary Editor

> A SillyTavern third-party extension for ingesting, organizing, and exporting numbered story summaries with arc grouping, gap detection, causal linking, content editing, and visual timeline/location tools.

![Version](https://img.shields.io/github/v/release/sixiongy248k/ste_summary_editor?label=version)
![CI](https://github.com/sixiongy248k/ste_summary_editor/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Platform](https://img.shields.io/badge/platform-SillyTavern-purple)

---

## Key Features

| Feature | Description |
|---------|-------------|
| **4-Tab Workflow** | Ingest → Review → Edit → Export — each tab shows an item count badge |
| **Multi-format Ingest** | `.txt`, `.json`, `.yaml` + Part-based sections + rich bracket re-import format |
| **Review Table** | Custom date/time pickers, inline location/notes, stats bar, conflict detection |
| **Content Editor** | Click any content cell to open a draggable editor — edit, send to API, re-check conflicts |
| **Simple Merge** | Select 2+ entries → merge into one combined entry (earliest act wins) |
| **Split Entry** | Select 1 entry → highlight segments with distinct colours → split into N entries |
| **Act/Arc Management** | Create, color, rename, delete acts; minimap grid; two-view timeline panel |
| **Causal Links** | Link entries by range; chain pills; Link Merge chains irreversibly |
| **Timeline Diagram** | Monthly-grouped top/bottom alternating layout; dated entries grouped by month |
| **Location Bubbles** | Physics-based bubble cluster chart — bubble size ∝ location visit frequency |
| **Export** | `.txt` / `.json` / `.yaml`; scoped; re-export to source; zip; databank inject; per-arc inject |
| **Token Counts** | Per-entry badge, live counter in Content Editor, per-arc total in Edit tab, running total in Export |
| **Story Context** | Auto-generated narrative summary after conflict check; editable; sent with every API call |
| **Named Entities** | Heuristic entity sidebar — recurring capitalised names/places with entry-count badges; click to filter |
| **Timeline Analysis** | LLM-powered timeline consistency check against reference files; Relaxed/Medium/Thorough strictness |
| **Broad Undo** | Covers file load, clear all, new entry, merge, split, move, swap, act operations, links, field edits |

---

## Installation

### Option 1: SillyTavern extension installer

In ST: Extensions → Manage Extensions → Install from URL:
```
https://github.com/sixiongy248k/ste_summary_editor
```

### Option 2: Manual

1. Clone or download this repo
2. Copy the folder into:
   ```
   SillyTavern/public/scripts/extensions/third-party/summary-editor/
   ```
3. Restart SillyTavern → enable **Summary Editor** in the Extensions panel

### Option 3: Deploy script

```powershell
# PowerShell
powershell -ExecutionPolicy Bypass -File deploy.ps1 --clean
```
```bash
# Bash / WSL / Git Bash
bash deploy.sh --clean
```

---

## Usage

1. Open SillyTavern → **Extensions** → **Open Summary Editor**
2. **Ingest** — drop your summary `.txt` / `.json` / `.yaml` files
3. **Review** — edit metadata, assign arcs, check conflicts, edit content, merge/split entries
4. **Edit** — manage arc names/colours/notes; use the minimap + timeline/bubble views
5. **Export** — choose format and scope, preview, then download or inject into databank

**Re-importing:** Export as `.txt` — the `#N. (Act|date:...) content` format re-ingests with all metadata preserved.

---

## Tab Reference

<details>
<summary><strong>Tab 1: Ingest</strong></summary>

- Drop or browse multiple `.txt`, `.json`, or `.yaml` files
- **Parsing modes:** numbered entries, Part-based sections, rich bracket re-import format
- Click the **Ingested Files** header to open the assignment panel — toggle any file as a Timeline reference
- File list drawer with entry counts, status icons, and per-file removal

</details>

<details>
<summary><strong>Tab 2: Review</strong></summary>

**Table columns:** Checkbox | # | Arc | Content | Date | Time | Location | Notes

- **Content cell** → opens the draggable Content Editor (edit, API revise, re-check conflicts)
- **Date** → custom calendar picker; **Time** → custom clock picker
- Selection bar: Assign act, Create act, Move Before, Swap, New Entry, Merge, Split
- Shift+click to select a contiguous range
- Live search, sort by any column, filter by arc / gaps / unassigned
- **Conflict Detection** — LLM analysis with severity chips (Error / Warning / Info); per-entry re-check
- **Named Entities sidebar** — recurring capitalised names/places; click to filter table
- **Timeline Analysis** — check entries against reference timeline files

</details>

<details>
<summary><strong>Tab 3: Edit (Arcs)</strong></summary>

- Arc list + detail view (entry list, notes, range)
- Color picker (iro.js wheel), rename inline, arc notes, delete
- **Minimap** — colour-coded grid of all entries; click any cell for a content popover
- **Timeline view** — monthly-grouped, alternating above/below axis, causality arrows
- **Location Bubbles** — physics-based bubble cluster chart by visit frequency

</details>

<details>
<summary><strong>Tab 4: Export</strong></summary>

- Formats: `.txt`, `.json`, `.yaml`
- Scope: all / current arc / selected entries
- Destinations: source folder, browser download, custom path, zip
- Databank inject (ST attachment API); per-arc inject; auto-inject on export
- Live and full preview; copy to clipboard

</details>

---

## Project Structure

```
summary-editor/
├── manifest.json              ST extension manifest
├── index.js                   Entry point (thin orchestrator)
├── style.css                  All styles (Monokai dark palette)
├── settings.html              ST Extensions panel drawer
├── dev.ps1 / dev.sh           Interactive dev toolkit (see configs/DEV.md)
├── deploy.ps1 / deploy.sh     Deploy to local ST installation
├── configs/
│   ├── DEV.md                 Dev toolkit usage guide
│   ├── SILLYTAVERN_NOTES.md   ST environment notes
│   └── WISHLIST.md            Future feature ideas
├── lib/
│   ├── tailwind-config.js     Tailwind CDN configuration
│   └── iro.min.js             iro.js v5.5.2 color picker (MPL 2.0)
├── src/
│   ├── core/                  state, utils, system-prompts, constants, keyboard
│   ├── ingest/                ingestion, gap-detection, ingest-split, files-panel
│   ├── table/                 table, tags, tooltip, reorder, entity-sidebar
│   ├── arcs/                  arcs, location-bubbles, color-picker
│   ├── editor/                content-editor, split-entry, causality
│   ├── export/                export, databank
│   ├── analysis/              conflict-detection, timeline-analysis
│   └── integration/           rag-reword, magic-wand, blacklist
├── templates/                 HTML templates (loaded at runtime via fetch)
└── .github/
    ├── workflows/             ci.yml, release.yml
    └── PULL_REQUEST_TEMPLATE.md
```

---

## Tech Stack

| Component | Choice |
|-----------|--------|
| Language | Vanilla JS (ES Modules) — no build step |
| UI | jQuery (ST-native global) |
| Styling | Tailwind Play CDN + custom CSS (`se-` prefix) |
| Color theme | Monokai Dark (`#272822` bg, `#a6e22e` green, `#f92672` pink) |
| State | `localStorage` |
| Templates | HTML files loaded via `fetch` |
| Linting | ESLint 9 |
| Versioning | semantic-release + conventional commits |

---

## License

[GNU Affero General Public License v3.0](LICENSE) — see LICENSE for full text.
