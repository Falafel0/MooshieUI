# Prompt Studio

Prompt Studio builds and edits prompts inside Mooshie. Open it from the sidebar. All four workspaces use one draft; switching between them and reopening the app preserve the document and saved working preferences. The draft and personal catalog are stored separately for each browser user.

## Build

Choose Character, Wardrobe or Scene. Assembly parameters use the complete database by default. The Shared set selector also offers Quick assembly and your own global sets. The same source selection is available to the insertion palette in Mix and Editor.

Collections for this zone provides the relevant resources: characters and poses for Character, garments and outfit recipes for Wardrobe, composition, backgrounds, artists and generation styles for Scene. Consolidated tags are partitioned by their source zone. Dictionaries remain available in all zones.

Open a group or search its labels and tags. Large groups display 60 choices per page without restricting the underlying database. Single-choice groups replace their previous choice; multiple-choice groups toggle individual choices. Locks and pinned tags survive randomization and Clear this mode. Full-database randomization limits new details to the chosen budget; existing pinned and locked choices remain intact. Draft changes are undoable.

## Mix

Blend two to six contributions with weights, locks and exclusions. Choose media, styles, lighting, your global sets or the complete artist catalog directly. Artist selections retain their original dataset memberships; artist names escape literal syntax correctly. Style tags and supplied generation styles are available alongside the starter styles.

Reroll weights only changes unlocked weights within the chosen range. Randomize changes unlocked terms. Choose SD or NAI syntax, optionally use artist prefixes, review the result and add it as a prompt chunk. Adding a blend is one undoable operation. Terms, weights, exclusions, filters and format persist after closing Studio or reloading the app.

## Editor

Write into the shared prompt or open Tags from shared databases to insert choices from Character, Wardrobe and Scene. Use Weights to convert explicit SD `(phrase:1.2)` and NAI `1.2::phrase::` syntax. Conversion preserves escaped names and warns about unsupported schedules or ambiguous nesting. Review the converted text before adding a prompt chunk. Returning to the constructor restores the selected tags.

The optional prompt assistant uses Mooshie's configured provider. Its result remains editable and is inserted only by an explicit action. Hidden, cancelled, destroyed or cross-account requests cannot deliver late results. Working input, completed results and converter settings persist per account.

## Draft and chunks

The right-hand draft is shared by all workspaces. Tags and weights is open initially; each selected custom tag shows its contextual modifiers. Toggle a modifier to apply it to that tag, adjust its weight, pin it or exclude it from randomization. Available modifiers and selected modifiers are displayed together, so existing prompt details remain accessible after a dataset edit.

Prompt chunks are named editable fragments of the document. Saved chunks use Mooshie's existing reusable chunk library, not a separate macro database. A stable `@[name]` reference is expanded by the generation engine; multiline chunks follow their configured wildcard mode. Rename, insertion, copy and generation handoff retain the existing engine behavior.

## Library

Compose prompt browses resources and opens global sets in Build, Mix or Editor. Manage sets edits the shared datasets independently of the working prompt. The four sections are Collections, Tag catalog, Saved sets and Import & export.

Global tag sets are reusable datasets. Saved prompts are complete draft snapshots containing tags, details, weights, chunks and literal text. Loading a saved prompt is an explicit undoable replacement of the draft; editing a global set leaves the draft unchanged.

In Manage sets, create a new global set, collect selected draft tags into a set, or create an editable global copy of a built-in collection. The entire set opens in a modal editor:

- Tags and metadata lets you search and page through entries, edit their tag, display name, description, aliases and contextual modifiers, or add/delete entries. Apply to set draft stages the row; Save commits the entire set.
- Bulk JSON editor exposes all entries and preserves source metadata, descriptions, modifiers and previews. JSON can contain an entry array or an exported tag pack with matching subcategory IDs. TXT contains one complete tag per line and preserves metadata for matching entries.
- Zone bindings control availability in Character, Wardrobe and Scene. No selected binding means all three zones. Global sets remain available in Mix and Editor through their shared sources.

IndexedDB stores global datasets. There is no application-imposed file-size or entry-count limit; device memory and storage quotas still apply, and storage errors are shown. JSON tag packs merge definitions and entries without duplicating tags within the same bucket. Export retains bindings and metadata. Prompt snapshot imports are previewed before loading, and importing a same-name snapshot does not overwrite a saved prompt automatically.

Working preferences, sources, searches, pagination and opened groups persist per account. Switching workspace does not reset the document or mixer. Clear, delete, cancel, load and randomize are explicit actions with their own scope.

## Supplied collection data

All 92 uploaded files are audited in `src/lib/prompt-studio/data/coverage.json`, including SHA-256 hashes, duplicate relationships and semantic roles. They contain 39 distinct parsed contents. JSON/CSV exports and repeated copies are cross-checked rather than inflated into duplicate collections. The compiled library contains 5,965 consolidated tags, 1,967 distinct templates, five non-empty style presets, 212 dictionary entries and 364,080 unique artists. The empty style is a no-op and is not emitted as a prompt entry.

Wardrobe world rules and axes, co-occurrence graphs, veto bitmaps and pair scores are stored separately from prompt tags. Dictionaries preserve empty shade choices and escaped literal parentheses. Preview access, extension inventory, status, history and pose identifiers are metadata; supplied blurred thumbnails are included; no remote preview URL or credential is included. Large JSON assets are separate from the startup JavaScript and are fetched from the application's own files when opening collections.

To rebuild supplied data, run `python3 scripts/build-prompt-studio-data.py --manifest <local-manifest.json>` with a private manifest containing `name` and `path` entries. Do not commit local paths or upload identifiers. Optional `--exclude-terms` removes private branding from strings. The original uploads are not required to run the compiled library.

## Validation

The release checks frontend compilation, type errors, localization parity, catalog and account boundaries, atomic history, template expansion, source coverage, artist formatting, bitmap indexing, weight conversion, async assistant guards and release artifacts. Browser checks exercise the actual app, collections, editor, draft handoff and narrow layouts. Windows CI validates Rust desktop and server targets. Local checks do not perform a GPU render or contact a configured assistant model.
