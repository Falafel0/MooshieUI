import { canvas } from "../stores/canvas.svelte.js";
import { generation } from "../stores/generation.svelte.js";
import type { RegionalPromptSelection } from "../types/index.js";
import type { InpaintSettings } from "./inpaintSettings.js";

export interface RegionalChainRegion extends RegionalPromptSelection {
  maskLayerId?: string;
  denoise?: number;
  maskGrow?: number;
  negativePrompt?: string;
  inpaintSettings?: InpaintSettings;
}

/** Inpainting uses the visible layer stack, processed from bottom to top. */
export function getRegionalChainRegions(): RegionalChainRegion[] {
  if (generation.mode !== "inpainting") return generation.getValidRegionalSelectionsForInpaint();
  if (!canvas.isCanvasMode) return [];
  const masks = canvas.sortedLayers.filter((layer) => (layer.type === "mask" || layer.type === "region") && layer.visible && layer.opacity > 0).reverse();
  if (masks.length < 2 && !masks.some((layer) => layer.type === "region" || layer.inpaintSettings || layer.maskGrow !== undefined || layer.denoise !== undefined || layer.positivePrompt || layer.negativePrompt)) return [];
  return masks.map((layer) => ({
    id: layer.id,
    maskLayerId: layer.id,
    shape: "box",
    x: 0, y: 0, width: 1, height: 1,
    text: layer.type === "region" ? layer.regionalPrompt?.trim() ?? "" : layer.positivePrompt?.trim() ?? "",
    negativePrompt: layer.type === "region" ? layer.regionalNegativePrompt?.trim() ?? "" : layer.negativePrompt?.trim() ?? "",
    strength: layer.regionalStrength ?? 1,
    denoise: layer.type === "region" ? layer.denoise : layer.denoise ?? generation.denoise,
    maskGrow: layer.maskGrow,
    inpaintSettings: layer.inpaintSettings ? { ...layer.inpaintSettings } : undefined,
  }));
}
