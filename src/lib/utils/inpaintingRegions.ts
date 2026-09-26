import { canvas } from "../stores/canvas.svelte.js";
import type { CanvasLayer } from "../stores/canvas.svelte.js";
import { generation } from "../stores/generation.svelte.js";
import { locale } from "../stores/locale.svelte.js";
import type { RegionalPromptSelection } from "../types/index.js";
import type { InpaintSettings } from "./inpaintSettings.js";
import { canvasPngBytes } from "./canvasLayerExport.js";
import { uploadImageBytes } from "./api.js";

export type InpaintConditioningRegion = RegionalPromptSelection & {
  negativeText?: string;
  mask_image?: string;
};

/** The edit passes, in the order they run: visible masks, painted bottom to top.
 *
 * This is the one place that decides it. The layer panel numbers its `#n`
 * badges from here and the chain builds its passes from here, so the badge and
 * the run cannot disagree about which mask goes first. Raster layers are the
 * picture being edited and regions are influence — neither is a pass.
 */
export function editMaskPassOrder(layers: CanvasLayer[]): CanvasLayer[] {
  return layers
    .filter((layer) => layer.type === "mask" && layer.visible && layer.opacity > 0)
    .reverse();
}

/** Upload prompt-influence masks without adding them to the pixel-edit mask.
 *
 * Painted prompt regions, ready to condition a run. A region layer is influence
 * in every mode that supports it: text-to-image conditions on it, and the
 * inpaint workspace hands the same list to its base pass and to every mask pass.
 * The mode rule itself lives in one place, so this asks it rather than repeating
 * it.
 */
export async function prepareConditioningRegions(): Promise<InpaintConditioningRegion[]> {
  if (!generation.supportsRegionalConditioning || !canvas.isCanvasMode) return [];
  // Only regions carry prompts. A mask defines the denoise and the mask
  // settings, and takes the global prompt — plus the text of any region it
  // overlaps, which arrives through this conditioning rather than through a
  // prompt of its own.
  const candidates = canvas.sortedLayers.filter(
    (layer) => layer.visible && layer.opacity > 0 && layer.type === "region",
  );
  const prepared = candidates.map((layer) => {
    const text = layer.regionalPrompt?.trim() ?? "";
    const negativeText = layer.regionalNegativePrompt?.trim() ?? "";
    if (!text) {
      throw new Error(locale.t("canvas.region_prompt_required", { name: layer.name }));
    }
    const pixels = canvas.exportMaskLayer(layer.id);
    if (!pixels) throw new Error(locale.t("canvas.region_mask_required", { name: layer.name }));
    return { layer, text, negativeText, pixels };
  });

  return Promise.all(prepared.map(async ({ layer, text, negativeText, pixels }, index) => {
    const bytes = await canvasPngBytes(pixels);
    const upload = await uploadImageBytes(bytes, `conditioning_mask_${index}_${Date.now()}.png`);
    return {
      id: layer.id,
      shape: "lasso" as const,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      text,
      negativeText: negativeText || undefined,
      strength: layer.regionalStrength ?? 1,
      mask_image: upload.name,
    };
  }));
}

export interface RegionalChainRegion extends RegionalPromptSelection {
  maskLayerId?: string;
  denoise?: number;
  /** This mask's density decides its own denoise, per pixel. */
  densityDenoise?: boolean;
  maskGrow?: number;
  negativePrompt?: string;
  inpaintSettings?: InpaintSettings;
  inpaintWidth?: number;
  inpaintHeight?: number;
}

/** Sequential edit masks in visual stack order.
 *
 * Only mask layers are edits. A stack of masks is a stack of passes, and a mask
 * carrying its own prompt, denoise or grow settings is a pass in its own right.
 * Prompt regions are influence rather than edits — the canvas says exactly that
 * to the user — so this returns nothing outside the inpaint workspace and never
 * hands back a region layer.
 */
export function getRegionalChainRegions(): RegionalChainRegion[] {
  if (generation.mode !== "inpainting") return [];
  if (!canvas.isCanvasMode) return [];
  const masks = editMaskPassOrder(canvas.sortedLayers);
  if (masks.length < 2 && !masks.some((layer) =>
    layer.inpaintSettings || layer.maskGrow !== undefined || layer.denoise !== undefined ||
    layer.densityDenoise
  )) return [];
  return masks.map((layer) => ({
    id: layer.id,
    maskLayerId: layer.id,
    shape: "box",
    x: 0, y: 0, width: 1, height: 1,
    // A mask has no prompt of its own: the pass runs the global prompt, and the
    // text of any region it overlaps reaches the conditioning instead.
    text: "",
    negativePrompt: "",
    strength: 1,
    denoise: layer.denoise ?? generation.denoise,
    densityDenoise: layer.densityDenoise,
    maskGrow: layer.maskGrow,
    inpaintSettings: layer.inpaintSettings ? { ...layer.inpaintSettings } : undefined,
    inpaintWidth: layer.inpaintWidth,
    inpaintHeight: layer.inpaintHeight,
  }));
}
