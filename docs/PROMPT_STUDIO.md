# Prompt Studio

Prompt Studio builds and edits prompts inside Mooshie. Open it from the sidebar. All four workspaces use one draft; switching between them preserves unfinished input during the session. The draft and personal catalog are stored separately for each browser user.

## Build

Choose Character, Wardrobe or Scene. Pick only the details you need; None leaves a group open. Lock a group to keep it during randomization. Pin a selected tag to retain it during randomization and reset, or exclude it from random picks. Clear this mode removes only its recipe choices. Undo and redo cover draft changes, including a whole reroll.

## Mix

Blend two to six styles with individual weights, locks and exclusions. Use the curated media, styles and lighting, your own catalog, or artists selected from Library into the draft. Choose SD or NAI syntax, inspect the result and add it as a named block. Randomization refreshes unlocked slots. Adding a blend is one undoable operation.

## Editor

Write directly into the shared draft or use Weights to convert explicit SD `(phrase:1.2)` and NAI `1.2::phrase::` syntax. Conversion preserves escaped names and shows warnings for unsupported schedules or ambiguous nesting. Review the converted text before adding a block. Returning to the constructor restores the underlying selected tags.

The optional prompt assistant uses the existing Mooshie configuration. Its result remains editable and is added only by an explicit action. Results from a request that finishes after leaving the editor, closing the assistant or changing account are discarded. Completed results survive workspace navigation.

## Library

Collections contains offline character, wardrobe, scene, artist, outfit, pose, background, texture, color and generation-style data. Search names and descriptions, choose a category or artist selection, and browse 60 entries at a time. Artist prefixes are explicit; artwork counts never become prompt text. Artist selections distinguish Anima, NoobAI and the supplied curated lists.

Click a tag to add or remove it. Templates open for review and variation before becoming a named block. Dictionary references and nested choices resolve locally; unknown variables require editing. Open Details for accompanying tags, separate negative tags and wardrobe pairing advice. Pairing advice is statistical; it never automatically removes your choices. Preview records describe availability and history, and include supplied blurred thumbnails; original images are absent.

Your catalog retains the editable category rail, subcategories, aliases, context and uploaded previews. Saved sets are snapshots of the complete draft. Import/export accepts portable JSON packs and text lists, as well as explicitly requested HTTPS or loopback HTTP URLs. Imported sets are previewed before loading; they do not replace a same-named saved set. Repeated tag-pack imports merge without duplicating entries. Conflicting renames and category moves leave both entries intact.

## Draft and generation

The draft appears on the right on wide screens. On smaller screens, use the Draft button beside Send to switch between the workspace and draft. Adjust tags and weights exposes pinning, exclusions and individual weights. Prompt helpers contains named blocks and reusable chunks. Combined prompt shows the assembled output.

Send opens a review dialog with replace, append and prepend choices. It uses Mooshie's existing generation prompt and mode; creating a prompt does not start generation. Keyboard shortcuts outside text fields: Ctrl/Cmd+Z for undo, Ctrl/Cmd+Shift+Z for redo and Ctrl/Cmd+Enter for Send. Arrow keys, Home and End navigate the four workspace tabs.

## Supplied collection data

All 92 uploaded files are audited in `src/lib/prompt-studio/data/coverage.json`, including SHA-256 hashes, duplicate relationships and semantic roles. They contain 39 distinct parsed contents. JSON/CSV exports and repeated copies are cross-checked rather than inflated into duplicate collections. The compiled library contains 5,965 consolidated tags, 1,967 distinct templates, five non-empty style presets, 212 dictionary entries and 364,080 unique artists. The empty style is a no-op and is not emitted as a prompt entry.

Wardrobe world rules and axes, co-occurrence graphs, veto bitmaps and pair scores are stored separately from prompt tags. Dictionaries preserve empty shade choices and escaped literal parentheses. Preview access, extension inventory, status, history and pose identifiers are metadata; supplied blurred thumbnails are included; no remote preview URL or credential is included. Large JSON assets are separate from the startup JavaScript and are fetched from the application's own files when opening collections.

To rebuild supplied data, run `python3 scripts/build-prompt-studio-data.py --manifest <local-manifest.json>` with a private manifest containing `name` and `path` entries. Do not commit local paths or upload identifiers. Optional `--exclude-terms` removes private branding from strings. The original uploads are not required to run the compiled library.

## Validation

The release checks frontend compilation, type errors, localization parity, catalog and account boundaries, atomic history, template expansion, source coverage, artist formatting, bitmap indexing, weight conversion, async assistant guards and release artifacts. Browser checks exercise the actual app, collections, editor, draft handoff and narrow layouts. Windows CI validates Rust desktop and server targets. Local checks do not perform a GPU render or contact a configured assistant model.
