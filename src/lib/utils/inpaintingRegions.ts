import { canvas } from "../stores/canvas.svelte.js";
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

/** Upload prompt-influence masks without adding them to the pixel-edit mask. */
export async function prepareInpaintConditioningRegions(): Promise<InpaintConditioningRegion[]> {
  if (generation.mode !== "inpainting" || !generation.supportsRegionalConditioning || !canvas.isCanvasMode) return [];
  const candidates = canvas.sortedLayers.filter((layer) =>
    layer.visible && layer.opacity > 0 && (
      layer.type === "region" ||
      (layer.type === "mask" && (!!layer.positivePrompt?.trim() || !!layer.negativePrompt?.trim()))
    ),
  );
  const prepared = candidates.map((layer) => {
    const text = layer.type === "region" ? layer.regionalPrompt?.trim() ?? "" : layer.positivePrompt?.trim() ?? "";
    const negativeText = layer.type === "region" ? layer.regionalNegativePrompt?.trim() ?? "" : layer.negativePrompt?.trim() ?? "";
    if (layer.type === "region" && !text) {
      throw new Error(locale.t("canvas.region_prompt_required", { name: layer.name }));
    }
    const pixels = canvas.exportMaskLayer(layer.id);
    if (!pixels) {
      if (layer.type === "region") throw new Error(locale.t("canvas.region_mask_required", { name: layer.name }));
      return null;
    }
    return { layer, text, negativeText, pixels };
  }).filter((item): item is NonNullable<typeof item> => item !== null);

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
      strength: layer.type === "region" ? layer.regionalStrength ?? 1 : 1,
      mask_image: upload.name,
    };
  }));
}

export interface RegionalChainRegion extends RegionalPromptSelection {
  maskLayerId?: string;
  denoise?: number;
  maskGrow?: number;
  negativePrompt?: string;
  inpaintSettings?: InpaintSettings;
  inpaintWidth?: number;
  inpaintHeight?: number;
}

/** Return sequential edit masks in visual stack order.
 * SDXL prompt regions stay conditioning-only; Anima uses true sequential masks.
 */
export function getRegionalChainRegions(): RegionalChainRegion[] {
  if (generation.mode !== "inpainting") return generation.getValidRegionalSelectionsForInpaint();
  if (!canvas.isCanvasMode) return [];
  const masks = canvas.sortedLayers.filter((layer) =>
    (layer.type === "mask" || (generation.isAnima && layer.type === "region")) &&
    layer.visible && layer.opacity > 0,
  ).reverse();
  if (masks.length < 2 && !masks.some((layer) =>
    layer.type === "region" || layer.inpaintSettings || layer.maskGrow !== undefined ||
    layer.denoise !== undefined || layer.positivePrompt || layer.negativePrompt
  )) return [];
  return masks.map((layer) => ({
    id: layer.id,
    maskLayerId: layer.id,
    shape: "box",
    x: 0, y: 0, width: 1, height: 1,
    text: layer.type === "region" ? layer.regionalPrompt?.trim() ?? "" : layer.positivePrompt?.trim() ?? "",
    negativePrompt: layer.type === "region" ? layer.regionalNegativePrompt?.trim() ?? "" : layer.negativePrompt?.trim() ?? "",
    strength: layer.type === "region" ? layer.regionalStrength ?? 1 : 1,
    denoise: layer.type === "region" ? layer.denoise : layer.denoise ?? generation.denoise,
    maskGrow: layer.maskGrow,
    inpaintSettings: layer.inpaintSettings ? { ...layer.inpaintSettings } : undefined,
    inpaintWidth: layer.inpaintWidth,
    inpaintHeight: layer.inpaintHeight,
  }));
}

/** Anima uses a painted prompt region as the mask for its own sequential pass. */
export function hasSequentialInpaintRegionMask(): boolean {
  return generation.mode === "inpainting" && generation.isAnima &&
    getRegionalChainRegions().some((region) =>
      canvas.layers.some((layer) => layer.id === region.maskLayerId && layer.type === "region"));
}
