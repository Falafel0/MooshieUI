# Native Prompt Studio

Prompt Studio assembles prompts in four sections: **Character Forge**, **Wardrobe**, **Tag Browser** and **Anima Tools**. It opens on Character Forge. Anima Tools is available when an Anima model is selected.

## Character and wardrobe constructors

Choose a category and a variant. The assembled panel groups the selected tags by their role. Selecting a row opens its weight and other actions without putting those controls on every tag.

Details belong to the selected item. In categories that allow multiple selections, use the item selector to decide which garment or feature to edit. Color, material, fit and other modifiers remain attached to that item. **Additional contextual details** accepts more tags or a phrase and keeps macro, LoRA and scheduling syntax intact.

With **Readable** enabled, `shirt`, blue, silk and rolled-up sleeves become `blue silk shirt with rolled-up sleeves`. Tag mode keeps the original tag spelling. Weights apply to the complete contextual phrase. Undo and redo include groups and item details.

**All Danbooru tags & groups** searches beyond the built-in catalog. Search `*` to browse tags by popularity or enter a tag name; results load in pages. Search the Danbooru group index to find thematic collections. A live tag can be selected for the active constructor category or added to **Edit my catalog**. Live and custom garments receive the same contextual controls as built-in choices.

## Custom catalog and chosen previews

Open **Edit my catalog** in the active constructor category to add a tag or prompt fragment and a display name. Existing entries can be edited or removed. Editing a built-in tag preserves its modifiers, quantities and nested parts.

Upload a PNG, JPEG or WebP, or choose a general-rated Danbooru example as the entry's preview. Uploaded files are limited to 8 MiB and stored as compact thumbnails. The chosen preview is displayed in the constructor and tag catalog. It can be replaced or removed.

The custom catalog and its images are saved locally for the current account, separately from the expiring source-preview cache. Catalog export and import include those images. Import merges entries by category and tag instead of creating duplicates.

## Prompt groups and macros

The prompt area uses the same editor as generation, including autocomplete, syntax highlighting and weight editing. Keep the constructor output as the base and add named groups for lighting, style, background or other text. Groups can be renamed, enabled or disabled, reordered and deleted.

Editing the constructor output switches it to manual text. **Return to constructor** restores the generated base while keeping the named groups.

**Import prompt blocks** accepts pasted text and `.txt` or `.md` files. Blank lines, individual lines or Markdown headings such as `# Character` define blocks. Headings keep multiline text together. Commas and scheduling expressions are preserved. Import is also available in the positive and negative additional fields on generation tabs.

Macros use the shared prompt-preset library. Search, create, edit, insert and remove macros in the prompt area. References inserted by the macro panel use stable preset IDs and survive a display-name change. Handwritten `@[Name]` and `@preset:slug` remain supported, including exact names in non-Latin alphabets. As in generation, a multiline macro acts as a wildcard: one nonempty line is selected per generation.

## Sending to generation

**Send to generation** opens a destination dialog. Select txt2img, img2img or inpainting, positive or negative, and append, prepend or replace.

For text insertion, the method applies to the main prompt field. Existing additional fields are kept. For named-block insertion, the method applies to the additional fields, and the main field is kept. Enabled Studio groups retain their names and order. The preview includes the main field and all resulting additional blocks.

Prompt alternation `[A|B|C]` is built in **Scheduling**, alongside Swap, From, To and Range. It alternates at each sampling step.

## Tag Browser and saved collections

Browse live booru tags, Anima source recipes, the local tag library and saved collections. Booru cards load thumbnails when they become visible. Danbooru, Gelbooru and e621 keep separate search results and scroll positions while switching sources; Anima source filters and positions are kept too.

Save individual entries, loaded search results or a complete Danbooru group to a collection. Filter saved collections, add their tags to the draft, remove entries, or export and import the collection as JSON. Saving loaded search results saves the pages already fetched, not the entire remote database. Ordinary source thumbnails use an expiring cache; permanent chosen images belong to the custom catalog described above.

Administrators configure optional credentials in **Settings → Booru**. Credential fields are write-only; saved secrets are not returned to the desktop or browser UI. Use the clear action in Settings to remove them.

## Checks without ComfyUI

Run `node scripts/test-prompt-studio-workspace.mjs` for context, groups, import, macros, persistence and pagination regressions. PR CI runs this check alongside build, i18n and types.

`studio-probe.html` is a Vite-only manual test page. It is not included in the packaged application. Constructor, group and insertion controls can be exercised without ComfyUI; live remote sources require the backend.
