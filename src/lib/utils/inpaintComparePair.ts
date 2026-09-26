import { canvas } from "../stores/canvas.svelte.js";

/** A verified pair for the inpaint "result vs original" comparison. */
export interface InpaintComparePair {
  /** Side A: the base image the run was submitted from. */
  originalUrl: string;
  /** Side B: the completed inpaint result currently held for preview. */
  resultUrl: string;
}

/**
 * Resolve the pair an inpaint result may be compared against, or null when no
 * genuine original is known.
 *
 * A result is only ever held as the pending preview together with the base it
 * was generated from: `syncToGeneration` builds the run input from
 * `preparedInpaintPreviewUrl ?? referenceImageUrl`, and every path that swaps
 * that base (apply, undo, reset, resize, a new session) clears the pending
 * result first. So a live pending result always sits on top of its own source,
 * and that source is the image to put on side A.
 *
 * On top of that invariant the result must be registered in the canvas store's
 * `completedInpaintResults` (via `pendingResultSourceKey`) — the existing link
 * between a result and the run it came from. Without that link, or without any
 * base at all (a blank-document inpaint has nothing but the base colour), there
 * is no correct original to compare against, so callers must keep the compare
 * affordance hidden rather than fall back to an unrelated image.
 */
export function getInpaintComparePair(): InpaintComparePair | null {
  const resultUrl = canvas.pendingResultPreviewUrl;
  const sourceKey = canvas.pendingResultSourceKey;
  const originalUrl = canvas.preparedInpaintPreviewUrl ?? canvas.referenceImageUrl;
  if (!resultUrl || !sourceKey || !originalUrl) return null;
  if (!canvas.getCompletedInpaintResult(sourceKey)) return null;
  return { originalUrl, resultUrl };
}
