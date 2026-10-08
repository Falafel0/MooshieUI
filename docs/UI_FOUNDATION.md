# Interface comfort

Open **Settings → Appearance → Interface comfort** in the desktop or mobile interface.

- **Compact**, **Comfortable** (default), and **Touch** set the size of generation section headers, mode controls, panel swap buttons, and context menu actions. This first stage does not resize every legacy control.
- Touch input keeps these controls at least 48 CSS pixels tall, including when Compact is selected.
- **Reduce motion** shortens CSS transitions and animations. The operating system's reduced motion setting also applies automatically. Canvas drawing and generation progress continue normally.

These preferences persist under the existing accessibility settings key and participate in preference sync. Older saved settings use Comfortable and the system motion preference. Invalid density or motion values are ignored.

Generation section headers expose their expanded state to assistive technology. Keyboard focus uses the active theme's accent color.

## Context menus

Opening a menu focuses its first enabled action. Arrow keys move between enabled actions and wrap at the ends; Home and End jump to the first and last action. Typing selects a matching label. Enter or Space activates the focused button.

Escape closes the menu and restores the previous focus. Tab dismisses it and continues normal navigation. Outside clicks dismiss it without taking focus from the clicked control. Menus stay within the viewport and can scroll without closing; scrolling the surrounding page dismisses them.

## Verification

Run `npm run build`, `npm run check:i18n`, and `npx --no-install svelte-check`.

In a desktop browser, select each density, return to Generate, and inspect section headers and mode controls. Reload and verify the selected density persists. Open a context menu and check the keyboard actions above, focus after Escape, and scrolling in a long menu. Repeat near each viewport edge and at a narrow window size.

On a touch device, select Compact and verify controls remain easy to tap. With the system's reduced motion setting enabled, animations should shorten even when the application checkbox is off. Check both built-in palettes and a custom theme.

## Quick navigation

Open **Search commands** from the desktop rail or the mobile header. The shortcuts are **Ctrl/Cmd+K** and **Ctrl/Cmd+Shift+P**. Search matches translated names and English aliases, without requiring exact case or accents.

Use Up/Down to select a result, Home/End to jump to the first/last result, and Enter to open it. Escape closes the palette and returns focus to its trigger. Tab stays within the dialog. Clicking the backdrop also closes it. Keyboard input in the palette does not reach underlying editors or generation shortcuts.

The first command set opens workspaces and Appearance settings. Projects is a desktop-only shortcut. Model Hub follows the user's permission, and hidden video/music workspaces stay hidden. The palette can be extended through the command registry in `src/lib/stores/commands.svelte.ts`.

Desktop and mobile share workspace state. Prompt Studio is available in the mobile tab bar, including its existing draft and send controls. Tab bars scroll the active item into view. Gallery actions and generation completion notifications return to Generate through this same state, preserving the mode those actions selected.

For verification, open Prompt Studio from a mobile tab and from the palette, move to Gallery and back, and check the active tab. Use the Appearance command, select another settings category manually, then use Appearance again. A normal return to Settings should retain the last manually selected category. Check the palette with an empty result, an alternate locale, a narrow viewport, and an account without Model Hub permission.

## Desktop generation controls

The desktop generation workspace has one toolbar above its panels and canvas. It contains the generation modes, **Find a setting**, **Collapse sections**, **Expand sections**, and **Swap left/right panels**. Mode selection remains available when a side panel is collapsed.

**Find a setting** searches only the sections available in the current generation mode. Choosing a result opens its accordion, restores its side panel if hidden, scrolls to the section, and focuses its header. It follows a section after panels are swapped. The normal command palette also includes these destinations while Generate is mounted; leaving Generate removes them.

Collapse/Expand affects the available top-level sections, preserving the separate state of sections hidden by the current mode. The Prompts section now persists its collapsed state alongside the other sections. Existing saved layouts and section ordering remain supported. This toolbar and its section commands are added to the desktop layout.

Check a setting after collapsing its accordion and its side panel, then repeat after swapping panels. Switch between Txt2Img, Img2Img, and Inpainting and verify that search only offers applicable sections. Collapse sections, reload, and check that their state persists. Check both full-size and smaller desktop windows.

`npm run check:types` now returns Svelte's actual exit status, so a type error fails the check.

## Universal generation Shelf

The bottom Shelf supports the prompt and canvas without competing with them. It stays in the same place in Create, Transform, Inpaint and Image Edit. Navigation has three groups: Resources (LoRAs, References, Prompts, Styles), Results (Variants, Compare), and Workflow (Jobs, Notes). The `+` dialog lets users pin optional Models, Artists, Style Creator, Scheduling and supported video tools, reorder pins within their group, or open a tool without pinning it. Order is shared across modes; unsupported tools are filtered without deleting preferences.

The current Inspector model and LoRA controls open their Shelf browsers through Browse models and Add LoRA. Styles contains saved styles, favourite artists and a Create action. References combines saved gallery images and session results, while Variants retains the session result list. Reference and result searches are independent. Jobs embeds the existing running/pending generation queue; Scheduling remains the separate prompt-step tool.

The desktop Shelf has three sizes: collapsed navigation at 34px, Browse at 220px, and Expanded up to 45% of the workspace (maximum 500px). Tabs remain accessible while collapsed; selecting one opens its panel. Dragging the divider or using Up/Down changes height, Home selects the 180px minimum, End the expanded limit, and double-click restores Browse. Active panel, height and collapse state are remembered per mode. Search survives tab switches and collapse. Legacy tab/card-size preferences migrate with validation.

Tabs use a single keyboard stop: Left/Right wrap, Home/End jump, and the selected tab scrolls into view. Overflow controls expose tabs in smaller desktop windows. Each tab labels its content panel. The customization dialog supports Escape and restores focus. Controls follow interface density and theme.

Visual libraries share a persisted horizontal-card/grid toggle. Result thumbnails preserve the whole image and show filenames and selection state. Click a result to select it; actions stay below the scrolling grid. Open, double-click, or Enter on the selected result opens the viewer. Save, copy, refine, image-to-image, inpaint, video-frame/reference actions, and deletion retain their existing behavior and video restrictions. Bulk deletion is confined to session results. Model preset and metadata management opens inside its browser rather than occupying a permanent secondary toolbar.

Prompt history uses readable cards with labelled favourite/remove controls. Favourite artists retain category filters and shared preview variants. Notes flush pending saves on collapse or unmount. Style Creator owns its artist-index loading.

This stage preserves the existing Compare parameter-grid tool. Central viewport comparison of generated variants, project-local Notes, mode-specific Prompt/Instruction layouts and the full Current-versus-Library Inspector redesign are subsequent work; the Shelf does not pretend these features already exist.

Verify pin/reorder/open behavior, migrated preferences, keyboard navigation, horizontal/grid views, reference search, result actions, Styles subviews, Jobs, notes, and per-mode state across collapse/reload. `tests/bottom-panel.test.mjs` covers groups, capability gates, labels, default/invalid pins, transient panels and mode keys.

## Intent and composition hierarchy

The default generation order follows source → intent → composition. Create places Prompt first; Transform places its source above Prompt; Image Edit keeps its reference controls above the Instruction block. The untouched legacy default order migrates, while explicit custom arrangements, section sides and collapse preferences are preserved. Section ordering and validation live in `generationLayout.ts` rather than the page component.

Prompt defaults to a Positive/Negative switcher with a 180px text area; existing split-view preferences and taller saved heights remain supported. Add block and Import block actions share one row. The intent section has a subtle accent border. Image Edit changes its section label to Instruction without creating a second prompt field.

Composition defaults to five common ratio shortcuts plus a pixel-size summary and resolution lock. Opening the summary reveals all ratio shortcuts, custom aspect fields, swap, resolution presets, model guidance and reset. That disclosure preference persists. Existing local/NovelAI dimension calculations and Opus area limits are unchanged. Inpaint displays a compact document-size summary with detailed controls on demand. Transform/Edit label their dimensions Output; automatic source-size overrides remain subsequent work.

A loaded Transform source is a compact 64px thumbnail with its filename and explicit Replace/Remove actions. Drop replacement, paste, staging and upload behavior stay available. Output format, bit depth and metadata are a dedicated disclosure inside sampling settings; its summary shows the current format/depth. Output controls save changes explicitly, retain WebP/16-bit restrictions and show effective metadata upgrades. Advanced sampling controls have their own disclosure; Flux guidance and active advanced settings expand it automatically so enabled processing stays visible.

Verify fresh/legacy/custom order, Positive/Negative editing, retained split preference, ratio and resolution controls, collapsed detail persistence, source import/replacement/removal, output compatibility and smaller desktop layouts. `tests/generation-layout.test.mjs` covers default hierarchy, migration, explicit arrangements and corrupt preferences.

## Upstream integration

This branch merges upstream `main` at `14a7ca6` (v2.3.16), including Krea 2 GGUF compatibility, stale ComfyUI restart after app updates, and optional Krea 2 encoder selection. Fork package identity, updater destination and Windows packaging remain intact. Encoder selection combines upstream's installed Krea 2 preference with the fork's family-only loader detection and inventory guards; regression checks exercise both paths.


## Inpainting tools and native editor panel

The canvas toolbar groups filled shapes behind one menu. Freeform fill paints
coverage; it is not a selection lasso. Move handles transform layer content;
Resize canvas changes the document frame. Fill layer and Clear pixels share a
layer-action menu, while Delete layer remains a separate document action.
Brush/eraser size appears only for strokes; Paint opacity controls painted alpha.
Mask overlay opacity, raster opacity and generation coverage have separate roles.
A fill creates one undo entry. The toolbar and menus support arrow-key navigation.

Groups show pixel layers separately from modifiers. Selecting a linked layer
highlights its connected rows; its inspector names reference targets and scope.
Mask, region and ControlNet controls operate on the same canvas coordinates.
ControlNets and regions condition edit masks; they do not add generation passes.

The Patchy panel can be pinned without blocking the canvas and collapsed without
resetting its session. It reads the real hierarchy and edits visibility/opacity
through native MCP with a state guard. Read-back imports the composite. See
[Patchy integration](PATCHY_INTEGRATION.md) for the v1.07 host contracts and limits.


ControlNet custom selection uses ComfyUI's exact model names. A saved selection
missing from the current inventory remains visible with an explanation, including
a family change between `controlnet` and Anima's `model_patches`. NovelAI keeps
saved document controls but replaces their editor with an availability note.
Changing the checkpoint or family during asynchronous input preparation cancels
that submission rather than mixing the old reference and the new pipeline.
