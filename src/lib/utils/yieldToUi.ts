/** A Svelte flush commits DOM changes but does not give the browser a paint.
 * Resume synchronous preparation after a frame, with a timer fallback for
 * background/minimized windows where animation frames can be suspended. */
export function yieldToUi(): Promise<void> {
  return new Promise(resolve => {
    let frame: number | null = null;
    let afterFrame: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (afterFrame !== null) clearTimeout(afterFrame);
      clearTimeout(fallback);
      resolve();
    };
    const fallback = setTimeout(finish, 100);
    frame = requestAnimationFrame(() => {
      frame = null;
      afterFrame = setTimeout(finish, 0);
    });
  });
}
