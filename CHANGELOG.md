# [1.1.0](https://github.com/Alphonsos88k/ste_summary_editor/compare/v1.0.1...v1.1.0) (2026-04-18)


### Bug Fixes

* summary files header now appears on page 1 regardless of page count ([ed84634](https://github.com/Alphonsos88k/ste_summary_editor/commit/ed8463452e75efb8b699accb5c85ec37ac91a04d))
* supp rows on last page only, summary header on first page, live ingest preview refresh ([ac2a989](https://github.com/Alphonsos88k/ste_summary_editor/commit/ac2a989567d0f735a1eb78f4e2442de69b422541))


### Features

* supplementary files, timeline editor, entity heuristics, live ingest preview ([efb442c](https://github.com/Alphonsos88k/ste_summary_editor/commit/efb442ce0080ff010146a14bc735c0677dba979d))
* themed subheader rows, Summary filter option, fix checked/unchecked preserved ([e59365d](https://github.com/Alphonsos88k/ste_summary_editor/commit/e59365de7bd6cecdb670f86fcb7116988521e2b6)), closes [#a6e22e](https://github.com/Alphonsos88k/ste_summary_editor/issues/a6e22e) [#66d9e8](https://github.com/Alphonsos88k/ste_summary_editor/issues/66d9e8)

# 1.0.0 (2026-04-18)


### Bug Fixes

* summary files header now appears on page 1 regardless of page count ([ed84634](https://github.com/Alphonsos88k/ste_summary_editor/commit/ed8463452e75efb8b699accb5c85ec37ac91a04d))
* supp rows on last page only, summary header on first page, live ingest preview refresh ([ac2a989](https://github.com/Alphonsos88k/ste_summary_editor/commit/ac2a989567d0f735a1eb78f4e2442de69b422541))
* use KEY_PAT for semantic-release and update CI job names for bra… ([#9](https://github.com/Alphonsos88k/ste_summary_editor/issues/9)) ([fbf838a](https://github.com/Alphonsos88k/ste_summary_editor/commit/fbf838a7950365fc304a2c93ebe3f8d3f974f239))
* use KEY_PAT for semantic-release and update CI job names for branch protection ([1304129](https://github.com/Alphonsos88k/ste_summary_editor/commit/1304129f0e9c66395a246e61cc35c6a677b0f301))


### Features

* supplementary files, timeline editor, entity heuristics, live ingest preview ([efb442c](https://github.com/Alphonsos88k/ste_summary_editor/commit/efb442ce0080ff010146a14bc735c0677dba979d))
* themed subheader rows, Summary filter option, fix checked/unchecked preserved ([e59365d](https://github.com/Alphonsos88k/ste_summary_editor/commit/e59365de7bd6cecdb670f86fcb7116988521e2b6)), closes [#a6e22e](https://github.com/Alphonsos88k/ste_summary_editor/issues/a6e22e) [#66d9e8](https://github.com/Alphonsos88k/ste_summary_editor/issues/66d9e8)

# 1.0.0 (2026-04-18)


### Bug Fixes

* use KEY_PAT for semantic-release and update CI job names for bra… ([#9](https://github.com/Alphonsos88k/ste_summary_editor/issues/9)) ([fbf838a](https://github.com/Alphonsos88k/ste_summary_editor/commit/fbf838a7950365fc304a2c93ebe3f8d3f974f239))
* use KEY_PAT for semantic-release and update CI job names for branch protection ([1304129](https://github.com/Alphonsos88k/ste_summary_editor/commit/1304129f0e9c66395a246e61cc35c6a677b0f301))

## [1.0.2](https://github.com/Alphonsos88k/ste_summary_editor/compare/v1.0.1...v1.0.2) (2026-04-18)


### Features

* **Bulk Refine** — new Utils panel tool; batch AI-rewrite for all entries or current selection with configurable system prompt; progress bar with per-entry streaming updates; cancel mid-run support
* **Supplementary Files** — non-summary files can now be assigned a category (Character Notes, Personalities, World Details, Timeline Notes, Others); appear as dedicated rows in the Review table with full editable date/time/location/notes columns; survive state persistence
* **Story Index / Entity Panel** — AI-powered multi-section panel extracting Sentient Beings, Locations, Items, Events, and Relationships from entries; regenerate per section or all; editable results; registered system prompt with JSON-return warning
* **Folder Ingestion** — directory picker ingests all valid summary files from a folder recursively; same validation and dedup pipeline as single-file ingest
* **Timeline Editor** — new draggable panel opened by the Timeline toolbar button; detects whether the assigned timeline-notes file is empty (Generate mode) or has content (Refine mode); sends entries + story context to LLM; shows AI suggestion in a review area before accepting; registered system prompt
* **Destructive Export** — "Overwrite Source Files" button in Export panel; double-confirm flow with backup ZIP download before individual file overwrites; staggered downloads 300 ms apart


### Quality of Life

* Supplementary file rows in Review table show live editable date/time/location/notes with "(no export effect)" label — same popover UX as regular entry rows
* Filter dropdown gains **Summary: All** option (shows only entry rows, hides supp section) and per-category **Supplementary** options
* **Summary Files** subheader appears above entry rows on page 1 of the Review table when supplementary files are also present
* **Supplementary Files** subheader appears on the last paginator page only — no longer bleeds into every page
* Ingest preview pill refreshes in real time when a category is assigned or changed — no longer requires closing and reopening the panel
* `updateFilterDropdown` now preserves `checked` / `unchecked` static options on every rebuild (previously stripped on first call)
* Utils panel body gains `max-height` + overflow scroll so 5+ functions don't overflow the panel


### Bug Fixes

* Supplementary radio button did nothing on click — `state.supplementaryFiles` entry was never initialized when Supplementary was selected, so `isSupp` was always false and the category dropdown never appeared
* Entity generation system prompt was blank in the hub even after a default was registered — `seedDefaultPrompts` preserved an empty string from localStorage instead of falling back to the newly-added default; fixed by only keeping saved values that are non-empty after trim
* Timeline toolbar button stayed disabled after assigning a Timeline Notes category — `hasTimelineFiles()` required `f.valid` which supplementary candidate files never have; now checks `state.supplementaryFiles` directly for the `timeline-notes` category
* Ingest preview right panel showed "(no entries)" for non-summary files — supp files matched the valid-file click handler after their class was renamed; `openIngestPreview` now detects supplementary files and shows raw content with a status pill instead of parsed entries
* Teal "assigned" badge not showing in file drawer — class list included both `invalid` and `supp-assigned`; cleaned to `supp-assigned` only
* Review table showed empty state when only supplementary files were loaded and no regular entries existed — table is now kept visible when any supplementary file has a category assigned
* `_buildSuppRadio` received an unused `file` argument causing a linter warning — signature reduced to `(radioName, isSupp)`; negated condition `!isSupp ? 'checked' : ''` corrected to `isSupp ? '' : 'checked'`
* Summary Files subheader failed to appear on page 1 when there were multiple paginator pages — the last-page early-return guard fired before the prepend; summary header logic now runs before the last-page check


### Adjustments

* Timeline radio button removed from Files panel — timeline status is now derived automatically from the Supplementary → Timeline Notes category assignment
* `hasTimelineFiles()` checks `state.supplementaryFiles` for `timeline-notes` category in addition to the legacy `state.timelineFiles` set
* `seedDefaultPrompts` skips saved values that are empty/whitespace so new defaults always populate on first load after a default is added
* Entity extraction heuristics extended with `NON_BEING_WORDS` (days, months, planets, deity titles, honorifics) and a "the"-context ratio check (>50% → classified as place or thing, not a being) — prevents Earth, Sunday, God, King, etc. from appearing in Sentient Beings
* `_buildEntriesContext` in timeline-editor now includes date/time/location metadata per entry for richer LLM context
* `_isEffectivelyEmpty` in timeline-editor treats files whose content is only a header before the first colon (e.g. "Timeline Notes:") as empty, triggering Generate mode


### UI / CSS

* Section subheader rows are non-interactive: `pointer-events: none` + explicit hover override so they never highlight like entry rows
* **Summary Files** subheader — green diagonal-stripe background (`rgba(166,226,46,…)`), `#a6e22e` label text
* **Supplementary Files** subheader — cyan radial dot-grid background (`rgba(102,217,232,…)`), `#66d9e8` label text
* Supplementary file badge in Files panel drawer: orange pill when unassigned ("choose category"), teal pill when assigned ("Supplementary · Category Name")
* `.se-fp-file-row.se-fp-supp-pending` — orange left-border tint for unassigned supplementary candidates
* `.se-fp-supplementary` — teal left-border tint for assigned supplementary files
* `.se-btn-destructive` — pink (`#f92672`) button variant for the Overwrite Source Files action
* `.se-timeline-editor` full CSS block — header, toolbar, body textarea, result review area, footer save/revert row
* `.se-ipp-supp-assigned` + `.se-ipp-supp-pill` — teal background block and badge for the ingest preview panel when a supplementary file has a category
* `.se-utils-body` gains `max-height: 320px; overflow-y: auto` so the Utils panel scrolls when more than 5 tools are listed


## [1.0.1](https://github.com/Alphonsos88k/ste_summary_editor/compare/v1.0.0...v1.0.1) (2026-04-15)


### Bug Fixes

* copy to clipboard mirrors live preview selection ([d9ffbb9](https://github.com/Alphonsos88k/ste_summary_editor/commit/d9ffbb9a1c566c844d55e46ff7fa8b7f3e9c7ed2))
* copy to clipboard now uses scoped entries matching the full preview ([5fa3f70](https://github.com/Alphonsos88k/ste_summary_editor/commit/5fa3f70db0dee532785776eeb563b18132f87d26))


# 1.0.0 (2026-04-15)


### Bug Fixes

* add iro and mermaid to ESLint globals ([0ed1939](https://github.com/Alphonsos88k/ste_summary_editor/commit/0ed19392c2e8f7e7a279f65481b42fef2192ccca))
* artifact name slash, clean up all lint warnings ([4ef305b](https://github.com/Alphonsos88k/ste_summary_editor/commit/4ef305b9b5654d00265cb74c4676f46271c8fcfc))


### Features

* add -Action flag to dev scripts for non-interactive use ([4b28d56](https://github.com/Alphonsos88k/ste_summary_editor/commit/4b28d5662993ebdaf325477c8858f4e3b53a8dec))
