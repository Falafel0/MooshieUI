import { canvas } from "../stores/canvas.svelte.js";
import type { CanvasLayer } from "../stores/canvas.svelte.js";
import { generation } from "../stores/generation.svelte.js";
import { locale } from "../stores/locale.svelte.js";
import type { RegionalPromptSelection } from "../types/index.js";
import type { InpaintSettings } from "./inpaintSettings.js";
import { canvasPngBytes } from "./canvasLayerExport.js";
import { uploadImageBytes } from "./api.js";
import { effectiveVisibility, hasUsableLayerBindings, modifierAppliesToMask, validateLayerRelations, type LayerGroup } from "./layerRelations.js";
import { copyInpaintLayerSnapshot } from './inpaintLayerSnapshot.js';

export type InpaintConditioningRegion = RegionalPromptSelection & {
  negativeText?: string;
  mask_image?: string;
  /** Resolved before uploading pixels; an empty list never means all masks. */
  targetMaskIds?: string[];
};

export interface InpaintLayerSnapshot {
  layers: CanvasLayer[];
  groups: LayerGroup[];
}

/** Retain independent submission metadata without serializing image payloads. */
export function captureInpaintLayerSnapshot(
  layers: readonly CanvasLayer[] = canvas.sortedLayers ?? canvas.layers,
  groups: readonly LayerGroup[] = canvas.groups ?? [],
): InpaintLayerSnapshot {
  return copyInpaintLayerSnapshot(layers, groups);
}

/** Reject active broken connections before an upload or generation can broaden their scope. */
export function assertInpaintLayerRelations(snapshot: InpaintLayerSnapshot): void {
  const issue = validateLayerRelations(snapshot.layers, snapshot.groups).find((candidate) => {
    if (candidate.code === "duplicate_group_id") {
      return snapshot.layers.some(layer => layer.visible && layer.groupId === candidate.layerId);
    }
    const layer = snapshot.layers.find(layer => layer.id === candidate.layerId);
    if (!layer?.visible) return false;
    const group = snapshot.groups.find(group => group.id === layer.groupId);
    if (group?.visible === false) return false;
    if (layer.type === "controlnet" && !layer.controlnet?.enabled) return false;
    if ((layer.type === "controlnet" || layer.type === "region") && candidate.field !== "id" &&
      layer.modifierScope?.mode === "masks" && !layer.modifierScope.maskIds?.length) return false;
    if ((layer.type === "mask" || layer.type === "region") && (layer.coverage ?? 1) <= 0) return false;
    if (layer.type === "region" && (layer.regionalStrength ?? 1) <= 0) return false;
    if (candidate.field === "clippingMaskId" && layer.clippingEnabled === false) return false;
    return true;
  });
  if (!issue) return;
  const layer = snapshot.layers.find(layer => layer.id === issue.layerId);
  const fieldKeys = {
    groupId: "canvas.group",
    targetRasterId: "canvas.target_image_layer",
    clippingMaskId: "canvas.clip_mask_source",
    referenceRasterId: "canvas.reference_image_layer",
    modifierScope: "canvas.modifier_scope",
    clippingEnabled: "canvas.clip_mask_source",
    id: "canvas.layer_properties",
  } as const;
  const target = snapshot.layers.find(layer => layer.id === issue.targetId)?.name
    ?? snapshot.groups.find(group => group.id === issue.targetId)?.name
    ?? locale.t("canvas.missing_target");
  throw new Error(locale.t("canvas.layer_relation_error", {
    name: layer?.name ?? snapshot.groups.find(group => group.id === issue.layerId)?.name ?? locale.t("canvas.layers"),
    field: locale.t(fieldKeys[issue.field]),
    target,
  }));
}

/** The edit passes, in the order they run: visible masks, painted bottom to top.
 *
 * This is the one place that decides it. The layer panel numbers its `#n`
 * badges from here and the chain builds its passes from here, so the badge and
 * the run cannot disagree about which mask goes first. Raster layers are the
 * picture being edited and regions are influence — neither is a pass.
 */
export function editMaskPassOrder(layers: readonly CanvasLayer[], groups: readonly LayerGroup[] = canvas.groups ?? []): CanvasLayer[] {
  return layers
    // A mask with no coverage left has nothing to edit, so it is not a pass.
    // How the overlay is drawn is not consulted: an overlay may be dimmed to
    // nothing on screen and still edit, and the reverse.
    .filter((layer) => layer.type === "mask" && effectiveVisibility(layer, groups) &&
      hasUsableLayerBindings(layer, layers) && (layer.coverage ?? 1) > 0)
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
export async function prepareConditioningRegions(layerSnapshot?: InpaintLayerSnapshot): Promise<InpaintConditioningRegion[]> {
  if (!generation.supportsRegionalConditioning || !canvas.isCanvasMode) return [];
  const snapshot = layerSnapshot
    ? captureInpaintLayerSnapshot(layerSnapshot.layers, layerSnapshot.groups)
    : captureInpaintLayerSnapshot();
  assertInpaintLayerRelations(snapshot);
  const inpainting = generation.mode === "inpainting";
  const masks = editMaskPassOrder(snapshot.layers, snapshot.groups);
  // Only regions carry prompts. A mask defines the denoise and the mask
  // settings, and takes the global prompt — plus the text of any region it
  // overlaps, which arrives through this conditioning rather than through a
  // prompt of its own.
  // A region conditions on being visible. Dimming its overlay is a display
  // choice and must not quietly drop a prompt out of a run.
  const candidates = snapshot.layers.filter(
    (layer) => effectiveVisibility(layer, snapshot.groups) && hasUsableLayerBindings(layer, snapshot.layers) &&
      layer.type === "region" && (layer.coverage ?? 1) > 0 && (layer.regionalStrength ?? 1) > 0,
  ).map(layer => ({ layer, targetMaskIds: masks
    .filter(mask => modifierAppliesToMask(layer, mask.id, snapshot.layers, snapshot.groups))
    .map(mask => mask.id) }))
    .filter(({ targetMaskIds }) => !inpainting || targetMaskIds.length > 0);
  const prepared = candidates.map(({ layer, targetMaskIds }) => {
    const text = layer.regionalPrompt?.trim() ?? "";
    const negativeText = layer.regionalNegativePrompt?.trim() ?? "";
    if (!text) {
      throw new Error(locale.t("canvas.region_prompt_required", { name: layer.name }));
    }
    const pixels = canvas.exportMaskLayer(layer.id);
    if (!pixels) throw new Error(locale.t("canvas.region_mask_required", { name: layer.name }));
    return { layer, text, negativeText, pixels, targetMaskIds };
  });

  return Promise.all(prepared.map(async ({ layer, text, negativeText, pixels, targetMaskIds }, index) => {
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
      ...(inpainting ? { targetMaskIds } : {}),
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
export function getRegionalChainRegions(layerSnapshot?: InpaintLayerSnapshot): RegionalChainRegion[] {
  if (generation.mode !== "inpainting") return [];
  if (!canvas.isCanvasMode || generation.isNovelAi || generation.supportsSequentialEditMasks === false) return [];
  const snapshot = layerSnapshot ?? captureInpaintLayerSnapshot();
  const masks = editMaskPassOrder(snapshot.layers, snapshot.groups);
  // A single pass still needs scoped modifiers filtered. Keeping the ordinary
  // submission path here would accidentally broaden an explicit empty scope.
  const hasConnections = snapshot.groups.length > 0 || snapshot.layers.some(layer =>
    layer.groupId != null || layer.modifierScope !== undefined || layer.targetRasterId != null ||
    layer.referenceRasterId != null || (layer.clippingMaskId != null && layer.clippingEnabled !== false));
  if (masks.length < 2 && !hasConnections && !masks.some((layer) =>
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
    densityDenoise: !!layer.densityDenoise,
    maskGrow: layer.maskGrow,
    inpaintSettings: layer.inpaintSettings ? { ...layer.inpaintSettings } : undefined,
    inpaintWidth: layer.inpaintWidth,
    inpaintHeight: layer.inpaintHeight,
  }));
}
