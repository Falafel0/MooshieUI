/** True when a keystroke belongs to a field rather than to the canvas.
 *
 * Canvas shortcuts live on the window, so every one of them has to ask this
 * first: typing a prompt used to switch tools and clear layers, because the
 * letters were also hotkeys. A field keeps its own keys — including the
 * browser's own undo inside a text box, which must not also undo the document.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { closest?: (selector: string) => Element | null }) | null;
  if (!element || typeof element.closest !== "function") return false;
  if (element.isContentEditable) return true;
  return !!element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}
