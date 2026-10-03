# Native Prompt Studio

Prompt Studio assembles prompts in three sections: **Character Forge**, **Wardrobe** and **Tag Browser**. It opens on Character Forge. The assembled tags sit to the right on desktop; on narrow screens, the assembled panel replaces the constructor when opened.

Anima-specific controls live beside the functions they affect: tag groups and Prompt Composer beneath generation prompts, Artist Mixer in Styles, and Multi-LoRA in the LoRA panel. Telegram export import lives in the preset library. These panels preserve the shared generation settings and expose their extension requirements when needed.

## Character and wardrobe constructors

Choose a category and a variant. The assembled panel groups the selected tags by their role. Selecting a row opens its weight and other actions without putting those controls on every tag.

Details belong to the selected item. In categories that allow multiple selections, use the item selector to decide which garment or feature to edit. Color, material, fit and other modifiers remain attached to that item. **Additional contextual details** accepts more tags or a phrase and keeps macro, LoRA and scheduling syntax intact.

Additional details are edited directly in the shared prompt editor and saved with the item. The details panel shows the resulting item phrase, including its weight. **Reset item details** clears only that item's modifiers, colors, quantity and extra text; it keeps the selected item and its weight. Both editing and reset support undo and redo. Tags chosen from local search join the active constructor category so their item controls remain available.

With **Readable** enabled, `shirt`, blue, silk and rolled-up sleeves become `blue silk shirt with rolled-up sleeves`. Tag mode keeps the original tag spelling. Weights apply to the complete contextual phrase. Undo and redo include groups and item details.

**All Danbooru tags & groups** searches beyond the built-in catalog. Search `*` to browse tags by popularity or enter a tag name; results load in pages. Search the Danbooru group index to find thematic collections. A live tag can be selected for the active constructor category or added to **Edit my catalog**. Live and custom garments receive the same contextual controls as built-in choices.

## Custom catalog and chosen previews

Open **Edit my catalog** in the active constructor category to add a tag or prompt fragment and a display name. Existing entries can be edited or removed. Editing a built-in tag preserves its modifiers, quantities and nested parts.

Use the search field to filter the active category by name or tag. Spaces and underscores match interchangeably. Catalog editing and import become available after loading completes. If storage cannot be read, use **Retry**; the existing saved catalog is not overwritten by an empty draft. Switching accounts discards stale load results, and queued saves retain their original account.

Upload a PNG, JPEG or WebP, or choose a general-rated Danbooru example as the entry's preview. Uploaded files are limited to 8 MiB and stored as compact thumbnails. The chosen preview is displayed in the constructor and tag catalog. It can be replaced or removed.

The custom catalog and its images are saved locally for the current account, separately from the expiring source-preview cache. Catalog export and import include those images. Import merges entries by category and tag instead of creating duplicates.

## Prompt groups and macros

The prompt area uses the same editor as generation, including autocomplete, syntax highlighting and weight editing. Keep the constructor output as the base and add named groups for lighting, style, background or other text. Groups can be renamed, enabled or disabled, reordered and deleted. **Prompt helpers** contains group creation, block import and macros; copy and send remain visible. Sending is unavailable until a pending tag conflict is resolved.

New groups receive distinct names. **Duplicate** places an independent copy immediately after the active group and opens it for editing. Copies retain the original text and enabled state. **Enable all groups** and **Disable all groups** each change the complete set in one undoable action without deleting any text.

Editing the constructor output switches it to manual text. **Return to constructor** restores the generated base while keeping the named groups.

**Import prompt blocks** accepts pasted text and `.txt` or `.md` files. Blank lines, individual lines or Markdown headings such as `# Character` define blocks. Headings keep multiline text together. Commas and scheduling expressions are preserved. Import is also available in the positive and negative additional fields on generation tabs.

Macros use the shared prompt-preset library. Search, create, edit, insert and remove macros in the prompt area. References inserted by the macro panel use stable preset IDs and survive a display-name change. Handwritten `@[Name]` and `@preset:slug` remain supported, including exact names in non-Latin alphabets. As in generation, a multiline macro acts as a wildcard: one nonempty line is selected per generation.

Anima tag groups use the generation prompt editor too. Adding or removing a group tag preserves macros, LoRA identifiers, weighted phrases, regional blocks and scheduling expressions, including their internal commas and newlines. Syntax fragments imported into groups retain their original spelling.

## Sending to generation

**Send to generation** opens a destination dialog. Select txt2img, img2img or inpainting, positive or negative, and append, prepend or replace.

For text insertion, the method applies to the main prompt field. Existing additional fields are kept. For named-block insertion, the method applies to the additional fields, and the main field is kept. Enabled Studio groups retain their names and order. The preview includes the main field and all resulting additional blocks.

Prompt alternation `[A|B|C]` is built in **Scheduling**, alongside Swap, From, To and Range. It alternates at each sampling step.

## Tag Browser and saved collections

Browse live booru tags, Anima source recipes, the local tag library and saved collections. Booru cards load thumbnails when they become visible. Danbooru, Gelbooru and e621 keep separate search results and scroll positions while switching sources; Anima source filters and positions are kept too.

**Art sources** provides image references and upstream catalogs. Selected images can be sent to img2img or inserted as raster canvas layers. Tag actions can append to the generation prompt or populate Anima tag groups. These actions return to generation without overwriting the Studio draft.

Closing the reference browser cancels pending image handoffs. Late image decoding or upload results do not insert a layer or replace the img2img input. Changing the general-rated filter clears the old selection and starts a new search.

Open **Save reference to my catalog** on a selected reference to edit its display name and prompt fragment, choose a constructor category, and optionally keep its image as a permanent preview. Saving an existing category/tag pair updates that entry; leaving the image option off preserves its existing preview. An unavailable image prevents saving with the image option selected; turn the option off to save the tags alone. Saving to the catalog leaves the generation prompt and Studio draft in place.

Save individual entries, loaded search results or a complete Danbooru group to a collection. Filter saved collections, add their tags to the draft, remove entries, or export and import the collection as JSON. Saving loaded search results saves the pages already fetched, not the entire remote database. Ordinary source thumbnails use an expiring cache; permanent chosen images belong to the custom catalog described above.

Administrators configure optional credentials in **Settings → Booru**. Credential fields are write-only; saved secrets are not returned to the desktop or browser UI. Use the clear action in Settings to remove them.

## Checks without ComfyUI

Run `node scripts/test-prompt-studio-workspace.mjs` for context, groups, import, macros, persistence and pagination regressions. PR CI runs this check alongside build, i18n and types.

Run `node --test tests/reference-browser.test.mjs` for image handoff cancellation and successful img2img insertion. PR CI runs this check as well.

`studio-probe.html` is a Vite-only manual test page. It is not included in the packaged application. Constructor, group and insertion controls can be exercised without ComfyUI; live remote sources require the backend.

## Development checkpoint history (2026-10-03)

The current UI polish is saved on `release/v2.3.8-fork.5`, based on published `v2.3.8-fork.4` (commit `abb70c8`). This is a development checkpoint, not a released version. Version files still contain `2.3.8-fork.4`; no new release tag has been created.

Implemented in this checkpoint:

- Move assembled tags to the right on desktop and switch between assembled tags and the constructor on mobile.
- Simplify header and navigation styling; keep copy/send visible and collapse group creation, block import and macros under Prompt helpers.
- Distribute Anima controls across generation prompts (`AnimaPromptGroups`, `AnimaComposer`), Styles (`AnimaArtistMixer`), LoRA (`multi_lora_enabled`) and the preset library (`TelegramPromptImport`).
- Add `ReferenceBrowser` to Tag Browser for image references, grouped tags and img2img/raster handoff. Its generation actions do not replace the Studio draft.
- Remove the obsolete Anima modal and Advanced tab. Extension checks/install controls are shared in `AnimaNodeRequirement`; tag classification is shared in `animaIntegration.ts`.
- Preserve fork.4 prompt groups, macros, custom catalog, saved collections, contextual item editing and destination selection.

Validation: frontend production build, i18n parity, Prompt Studio regression script and Svelte type checking passed. Type checking reports 0 errors and 85 existing warnings outside the changed UI. `git diff --check` passed. Visual interaction testing in the running application and a real ComfyUI generation have not been completed.

Release blocker: local Rust compilation/tests fail because the MSVC linker `link.exe` is unavailable; Visual Studio installation discovery returned no installed C++ toolchain. Install/configure Visual Studio C++ Build Tools and the Windows SDK, then repeat desktop/server `cargo check`, `cargo test`, frontend checks and the regular release skill. Do not treat this checkpoint as release-ready or bypass release validation. Release notes, version bump, PR merge, tagging, release CI and wiki updates remain outstanding.

Next development checks: exercise narrow-screen panel switching, the lower prompt area, macro/group workflows, Anima setting persistence, extension availability/install errors, Telegram append/replace confirmation, stale reference requests and image handoff. Clean up unused localization keys only after confirming usage. All backend calls must retain the desktop/browser IPC abstraction.

Local safety backup: a stash named `Prompt Studio polish before integrating fork.4` preserves the earlier fork.3-based UI experiment. It is not published with this checkpoint. Do not apply it wholesale over fork.4: its overlapping Studio components would regress the newer groups/catalog workflows. The integrated branch is the continuation point for other agents.

### Continuation checks (2026-10-03)

The continuation adds searchable custom entries, load/error gating and IndexedDB account-switch regressions; the shared Anima group editor and syntax-preserving tag actions; and cancellation checks during reference decoding, layer insertion and upload. Stored duplicate catalog IDs and category/tag pairs are repaired during loading without losing chosen previews. The Telegram regression loader now resolves the real utility dependencies.

Validation in the Linux workspace: production build passed; Svelte checking reports 0 errors and the same 85 warnings as the checkpoint; i18n parity passed; all 124 existing Node regression tests and 4 new reference-browser tests passed; Prompt Studio, Telegram and Animadex scripts passed; 5 release artifact checks passed. No Rust source or version files changed. Native Windows checks run through PR Guardrails. Interactive visual testing and real ComfyUI generation remain outstanding; this continuation does not establish release readiness.

### Further development without checks (2026-10-03)

At the user's request, the next continuation adds reference-to-catalog saving with chosen previews and category selection; direct contextual-detail editing, item phrase previews and per-item reset; unique group names, duplication and bulk enable/disable. New labels are provided in all supported locales. These changes are saved on the same branch and PR #30.

No build, type, regression, translation or CI checks were run for this continuation. Earlier passing results above apply only to the preceding checkpoint. The commit uses `[skip ci]` to honor the request to continue without checks. The release version remains unchanged.

### Release v2.3.8-fork.5

The continuation is packaged as `2.3.8-fork.5`. Version fields in the frontend, npm lockfile, Rust package/lockfile and Tauri config are updated together. Reference images use backend-loaded blob URLs to work with the desktop CSP; thumbnails reuse the bounded preview cache. Release notes describe the complete fork.5 change set.

Per the user's instructions, this release uses the quick-release path without fresh local validation or a real ComfyUI generation. Earlier passing results remain checkpoint-specific. Merging this fork's release PR starts Windows packaging on the merged commit; publication creates the release tag on that commit and uploads the installer, updater metadata and checksums. The tag-triggered and manual-dispatch release paths remain available for later releases and retries.
