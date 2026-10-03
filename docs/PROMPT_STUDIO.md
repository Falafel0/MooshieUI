# Prompt Studio

Prompt Studio is a local, user-authored tag constructor. It starts with an empty catalog. It has no built-in categories, subcategories, tag recipes, palettes, clothing rules, dependency tags or Danbooru connection.

## Layout

- Left: a vertical category rail, category search, add/edit/reorder controls, tag-pack import/export.
- Top of the center panel: the active category's own tags, user-defined subcategory tabs, and Add subcategory.
- Center: searchable tag cards with optional local previews. Switch between grid/list, adjust card size or hide images. The plus/check selects or removes a tag; the card opens its inspector.
- Right: the selected card's preview, name, prompt fragment, description, aliases and contextual tags, followed by selected tags. Upload PNG/JPEG/WebP previews, save, duplicate or delete an entry. Choose contextual tags to supplement that entry in the assembled prompt. Weight editing is available for selected entries.
- Bottom: the shared generation prompt editor, copy/send, Save as chunk, and optional user-created prompt blocks/macros. Character and wardrobe are one workspace.

Categories and subcategories can be renamed and reordered. Deleting a subcategory moves its entries into its parent category. Deleting a category removes its catalog entries after an in-app confirmation. These operations keep the assembled prompt. A category can contain tags directly; it does not need any subcategories.

On narrower screens, switch between the catalog and selected tags. Editing a card opens its inspector above the workspace; close it to return to the catalog.

## Tag packs

Export the whole catalog or only the active category. One JSON file carries the category hierarchy, entries, contextual tags, aliases, descriptions and embedded previews. It works without a network connection or an expiring image cache.

The portable format is `kind: "mooshie-tag-pack"`, `version: 1`:

```json
{
  "kind": "mooshie-tag-pack",
  "version": 1,
  "categories": [],
  "entries": []
}
```

Each category has `id`, `name`, `icon` and `subs`. Each subcategory has `id` and `name`. Entries have `id`, `name`, `tag` and `subId`; `subId` refers to either a category or a subcategory. Optional entry fields are `contextualTags` (a list of user-defined prompt fragments), `aliases` (search aliases), `description` and `preview` (embedded PNG/JPEG/WebP data URL). Contextual tags are selected explicitly; aliases and descriptions do not enter the generated prompt.

Import merges a pack into the existing catalog. It preserves existing order and avoids duplicate entries by bucket and tag. Colliding identifiers across unrelated buckets are remapped consistently. Unknown pack versions and invalid hierarchies are rejected before mutation. The file-picker limit is 32 MiB. Previews uploaded through the UI are limited to 8 MiB and reduced to a maximum edge of 320 pixels.

Older `mooshie-custom-catalog` exports (versions 1 and 2) remain importable. Old stored user entries recover their own category buckets using their saved IDs. Built-in catalog data is never restored. Account-scoped IndexedDB storage retains previews and rejects stale account reads/writes.

## Prompt output

Only chosen tags and chosen user contexts enter the constructor output. There are no automatic gender, clothing, fashion or implication tags. Existing auto-added/dependency selections are discarded when loading old drafts; authored tags and saved prompt blocks remain.

Editing the base output keeps a literal override. Return to constructor restores the generated base while keeping user-created prompt blocks. Blocks can be imported, renamed, duplicated, enabled/disabled, reordered and deleted. Macros use the existing chunk library. Save as chunk opens the name/content editor for the current field.

Send selects the generation destination, positive/negative field and append/prepend/replace method. It can also send the draft as additional prompt blocks. Generation prompts no longer display Tag groups or Anima tools panels.

## Removed integration

The old source browser, Danbooru tag/group/post search, automatic preview lookup, upstream catalog/image proxy and their UI components are removed. The corresponding desktop command registrations and browser IPC routes are removed too. Danbooru credentials no longer appear in settings; legacy config fields remain only for migration/redaction. Existing Gelbooru/e621 credential settings and backend support are outside this constructor and remain available.

## Validation

The v2.3.9-fork.1 integration is checked with frontend build/type checks, the pack and account-scoping regressions, Node tests, localization parity, release-artifact checks and Rust desktop/server CI on Windows. A real-checkpoint GPU render and a manual runtime UI walkthrough are not part of these checks.
