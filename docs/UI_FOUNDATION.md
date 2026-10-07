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
