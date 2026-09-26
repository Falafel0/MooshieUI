/**
 * How a run handles prompt regions and edit masks — one rule per mode.
 *
 * Two mechanisms exist, and they must stay independent of each other:
 *
 * - A **prompt region** is an area of influence. It shapes the conditioning
 *   within its own geometry and never becomes a generation pass of its own. The
 *   interface already promises this to the user in the canvas
 *   (`canvas.regions_chain_hint`, `canvas.region_conditioning_hint`).
 * - A **mask layer** in the inpaint workspace is an edit, and a stack of masks is
 *   a stack of edits: successive masks run as successive inpaint passes, each
 *   with its own denoise, grow and sampling size.
 *
 * The modes must not decide for each other either. Text-to-image regions are
 * conditioning, img2img has no region support at all, and the inpaint workspace
 * conditions on regions while running passes per mask. Nothing here is persisted
 * or user-selectable: a strategy saved in one mode would let that mode change how
 * another one behaves, which is exactly the coupling this module exists to
 * prevent.
 */

/** What the decision needs to know about the active mode and model. */
export interface RegionalRunFacts {
  mode: string;
  isAnima: boolean;
  isSdxlLike: boolean;
  isNovelAi: boolean;
}

/**
 * True when this run can place prompt regions as areas of influence.
 *
 * Anima and the SDXL family both take region conditioning: text-to-image masks
 * the region against the latent, and the inpaint workspace aligns the region
 * mask through the same crop and sampling size as the edit itself. NovelAI
 * receives a finished prompt over HTTP, so no graph rewrite can apply there.
 */
export function supportsRegionalConditioning(run: RegionalRunFacts): boolean {
  if (run.mode !== "txt2img" && run.mode !== "inpainting") return false;
  if (run.isNovelAi) return false;
  return run.isAnima || run.isSdxlLike;
}

/**
 * True when this run can take sequential edit passes, one per visible mask
 * layer. This is the inpaint workspace's own mechanism and has nothing to do
 * with prompt regions: the ComfyUI graphs build a pass per mask regardless of
 * family, so any model that can inpaint at all can inpaint mask by mask.
 */
export function supportsSequentialEditMasks(run: RegionalRunFacts): boolean {
  return !run.isNovelAi && run.mode === "inpainting";
}

/**
 * True when painted regions do anything at all in this run. Where they do not,
 * the interface warns that they are being dropped instead of ignoring them
 * silently.
 */
export function supportsRegionalPrompting(run: RegionalRunFacts): boolean {
  return supportsRegionalConditioning(run);
}
