import { canvas } from "../../../stores/canvas.svelte.js";

/**
 * Where the last applied inpaint result went.
 *
 * Applying promotes the pending result to the canvas base, and the store then
 * drops every trace of the result itself: `pendingResultPreviewUrl` is cleared
 * and the base history is the only witness left. Both surfaces that can apply
 * a result (the result card and the staging strip) go through here, and the
 * base history length at the moment of the click says whether the claim is
 * still true — stepping the base back, or clearing the session, pops that
 * entry, so the "applied" status disappears exactly when the applied base
 * does instead of claiming a base that is no longer there.
 */
class InpaintResultStatus {
  /** Base-history length right after the apply this status describes. */
  private appliedHistoryLength = $state<number | null>(null);
  /** When the result became the base, for the "applied at" clock. */
  appliedAt = $state<number | null>(null);

  /**
   * Promote the pending result to the base. The single entry point for both
   * surfaces, so neither can apply a result without the other saying so.
   */
  applyToBase(): void {
    const before = canvas.inpaintBaseHistory.length;
    canvas.applyInpaintResult();
    // The store refuses an apply with no usable geometry; only report an apply
    // that actually happened.
    if (canvas.inpaintBaseHistory.length > before) {
      this.appliedAt = Date.now();
      this.appliedHistoryLength = canvas.inpaintBaseHistory.length;
    }
  }

  /** True while the base really is the last applied result. */
  get visible(): boolean {
    return (
      this.appliedHistoryLength !== null &&
      canvas.inpaintBaseHistory.length === this.appliedHistoryLength
    );
  }
}

export const inpaintResultStatus = new InpaintResultStatus();
