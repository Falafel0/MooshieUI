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

## Bottom generation panel

The bottom panel separates navigation, session results, prompt history, and favourite artists into dedicated components. Its local UI store remembers the active tool independently for image generation, NovelAI, and video. Search text survives tab changes and panel collapse. Existing tab and card-size preferences migrate to the new validated settings; unavailable tools fall back without discarding the remembered selection.

Tabs use a single keyboard stop: Left/Right wrap, Home/End jump, and the selected tab scrolls into view. Each tab labels its content panel. Controls follow the interface density and theme.

In Images, click a result to select it. Its actions stay in a toolbar below the scrolling grid. **Open**, double-click, or Enter on an already selected result opens the viewer. Save, copy, refine, image-to-image, inpaint, video-frame/reference actions, and deletion retain their existing behavior and video restrictions. Deleting advances selection to the next result in that slot. The desktop panel starts at 260px and can resize down to 220px to keep navigation, results, and actions usable. Focus the horizontal divider and use Up/Down to resize by 20px, Home/End for the limits. Double-click restores the default height; changes persist.

Prompt history uses a responsive card grid with labelled favourite/remove controls. Favourite artists retain category filters and shared preview variants. Notes flush pending saves when the panel closes. Style Creator now loads its own artist index rather than depending on its parent.

Verify a migrated tab/card-size preference, keyboard tab navigation, result selection and actions, search after switching tabs/collapsing, prompt favourites, notes, and remembered tools after a video/image mode round trip. `tests/bottom-panel.test.mjs` covers capability gates, label selection, and corrupt preferences.
