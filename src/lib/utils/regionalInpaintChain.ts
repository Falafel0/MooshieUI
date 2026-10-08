import { generation } from "../stores/generation.svelte.js";
import { progress } from "../stores/progress.svelte.js";
import { canvas } from "../stores/canvas.svelte.js";
import { locale } from "../stores/locale.svelte.js";
import type { GenerationParams } from "../types/index.js";
import { assertInpaintLayerRelations, captureInpaintLayerSnapshot, type InpaintConditioningRegion, type InpaintLayerSnapshot, type RegionalChainRegion } from "./inpaintingRegions.js";
import { effectiveVisibility, hasUsableLayerBindings, modifierAppliesToMask } from "./layerRelations.js";
import { buildRegionalContextPrompt, mergeRegionalPromptText } from "./promptSchedule.js";
import { uploadImageBytes } from "./api.js";
import { renderRegionMaskPngBytes, regionStrengthToDenoise } from "./regionalMask.js";
import { canvasPngBytes, maskToGrayscale } from "./canvasLayerExport.js";
import { DEFAULT_INPAINT_SETTINGS } from "./inpaintSettings.js";
import { regionalChainStepSeed } from "./regionalChainSeed.js";
import { tempOutputToUploadBytes, waitForPromptCompletion, waitForPromptOutput } from "./waitForPrompt.js";

export interface RegionalInpaintChainStepContext {
  phase: "base" | "region";
  /** Zero-based job index, including the optional txt2img base pass. */
  index: number;
  total: number;
  isFinalOutput: boolean;
}

export interface RegionalInpaintChainCallbacks {
  submit: (params: GenerationParams, ctx: RegionalInpaintChainStepContext) => Promise<{ promptId: string; seed: string }>;
  onStep?: (info: { phase: "base" | "region"; index: number; total: number }) => void;
  onWaitingForOutput?: () => void;
  shouldCancel?: () => boolean;
  conditioningRegions?: InpaintConditioningRegion[];
  /** An optional snapshot shared with preparation before its first await. */
  layerSnapshot?: InpaintLayerSnapshot;
}

export interface RegionalInpaintChainResult {
  lastPromptId: string;
  regionCount: number;
}

async function waitForChainStepOutput(promptId: string, isFinalOutput: boolean, shouldCancel?: () => boolean): Promise<string> {
  const temp = await waitForPromptOutput(promptId, undefined, shouldCancel);
  if (isFinalOutput) {
    await waitForPromptCompletion(promptId, undefined, shouldCancel);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return temp;
}

/** txt2img starts with a base pass; inpainting starts with the user's input image. */
export async function runRegionalInpaintChain(
  regions: RegionalChainRegion[],
  callbacks: RegionalInpaintChainCallbacks,
): Promise<RegionalInpaintChainResult> {
  const checkCancelled = () => {
    if (callbacks.shouldCancel?.()) throw new Error("Regional inpaint chain cancelled");
  };
  checkCancelled();
  const fromInput = generation.mode === "inpainting";
  if (fromInput && (generation.isNovelAi || generation.supportsSequentialEditMasks === false)) {
    throw new Error(locale.t("canvas.regions_supported"));
  }
  const layerSnapshot = callbacks.layerSnapshot
    ? captureInpaintLayerSnapshot(callbacks.layerSnapshot.layers, callbacks.layerSnapshot.groups)
    : captureInpaintLayerSnapshot();
  if (fromInput) assertInpaintLayerRelations(layerSnapshot);
  const conditioningRegions: InpaintConditioningRegion[] = JSON.parse(JSON.stringify(callbacks.conditioningRegions ?? []));
  // Capture layer pixels and settings before any await: edits during a run must
  // not change later steps. Empty ordinary masks contribute nothing.
  const prepared = regions.filter((r) => {
    if (r.width <= 0 || r.height <= 0) return false;
    if (!fromInput) return !!r.maskLayerId || !!r.text.trim();
    const layer = layerSnapshot.layers.find(layer => layer.id === r.maskLayerId);
    // Modifier geometry never grants permission to edit pixels or adds a pass.
    return layer?.type === "mask" && effectiveVisibility(layer, layerSnapshot.groups) &&
      hasUsableLayerBindings(layer, layerSnapshot.layers) && (layer.coverage ?? 1) > 0;
  }).map((region) => {
    if (!region.maskLayerId) return { region: { ...region }, pixels: null, areaLimit: null };
    const layer = layerSnapshot.layers.find((layer) => layer.id === region.maskLayerId);
    if (layer?.type === "region" && !region.text.trim()) throw new Error(locale.t("canvas.region_prompt_required", { name: layer.name }));
    const pixels = canvas.exportMaskLayer(region.maskLayerId);
    if (!pixels && layer?.type === "region") throw new Error(locale.t("canvas.region_mask_required", { name: layer.name }));
    let areaLimit: HTMLCanvasElement | null = null;
    if (layer?.type === 'mask' && layer.targetRasterId) {
      const intrinsic = canvas.exportRasterLayer(layer.targetRasterId, { raw: true });
      if (!intrinsic) throw new Error(locale.t('canvas.missing_connection'));
      areaLimit = maskToGrayscale(intrinsic);
      if (!areaLimit) {
        areaLimit = document.createElement('canvas');
        areaLimit.width = intrinsic.width; areaLimit.height = intrinsic.height;
        const ctx = areaLimit.getContext('2d')!;
        ctx.fillStyle = 'black'; ctx.fillRect(0, 0, areaLimit.width, areaLimit.height);
      }
    }
    return { region: { ...region, inpaintSettings: region.inpaintSettings ? { ...region.inpaintSettings } : undefined }, pixels, areaLimit };
  }).filter(({ region, pixels }) => !region.maskLayerId || pixels);
  if (!prepared.length) throw new Error(locale.t("generation.error_no_mask"));

  const usesSpatialConditioning = fromInput && generation.supportsRegionalConditioning;
  const baseParams: GenerationParams = JSON.parse(JSON.stringify(generation.toParams({
    includeConditioningRegions: usesSpatialConditioning,
    regionalSelectionsOverride: usesSpatialConditioning ? conditioningRegions : undefined,
    outsidePausedRun: true,
  })));
  // toParams intentionally strips UI identity from prompt regions, but retains
  // their uploaded mask filename. It is the stable link to prepared region ids.
  const preparedRegionByImage = new Map(conditioningRegions.filter(region => region.mask_image)
    .map(region => [region.mask_image!, region]));
  const scopes = prepared.map(({ region }) => {
    const maskId = region.maskLayerId;
    const positiveRegions = (baseParams.positive_regions ?? []).filter(payload => {
      if (!payload.mask_image) return true; // Inline geometric prompt regions stay document-wide.
      const preparedRegion = preparedRegionByImage.get(payload.mask_image);
      if (!preparedRegion || !maskId) return false;
      const modifier = layerSnapshot.layers.find(layer => layer.id === preparedRegion.id);
      if (!modifier || !modifierAppliesToMask(modifier, maskId, layerSnapshot.layers, layerSnapshot.groups)) return false;
      return preparedRegion.targetMaskIds === undefined || preparedRegion.targetMaskIds.includes(maskId);
    });
    const controlnets = (baseParams.controlnet_layers ?? []).filter(payload => {
      if (!maskId || !payload.layer_id) return false;
      const modifier = layerSnapshot.layers.find(layer => layer.id === payload.layer_id);
      return modifier?.type === "controlnet" && modifierAppliesToMask(modifier, maskId, layerSnapshot.layers, layerSnapshot.groups);
    });
    return { positiveRegions, controlnets };
  });
  const facefixOnFinal = baseParams.facefix_enabled;
  // Upscale runs once, on the final image. Running it on every step would
  // compound the scale and hand the next inpaint an image larger than its mask.
  const upscaleOnFinal = baseParams.upscale_enabled;
  const savePreUpscaleOnFinal = baseParams.save_pre_upscale_image;
  const segmentsOnFinal = baseParams.detail_segments;
  baseParams.facefix_enabled = false;
  baseParams.upscale_enabled = false;
  baseParams.save_pre_upscale_image = false;
  baseParams.detail_segments = [];
  const differentialDiffusion = generation.isAnima || generation.differentialDiffusion;
  const regionalContext = buildRegionalContextPrompt(baseParams.positive_prompt, generation.loras.filter((l) => l.enabled && l.name));
  const masks = await Promise.all(prepared.map(({ region, pixels }) => pixels
    ? canvasPngBytes(pixels)
    : renderRegionMaskPngBytes(region, baseParams.width, baseParams.height)));
  const areaLimits = await Promise.all(prepared.map(({ areaLimit }) => areaLimit ? canvasPngBytes(areaLimit) : null));
  const total = (fromInput ? 0 : 1) + prepared.length;
  let inputName = fromInput ? baseParams.input_image : null;
  let inputTemp: string | null = null;
  let lastPromptId = "";
  let resolvedBaseSeed = baseParams.seed;
  if (fromInput && !inputName) throw new Error(locale.t("generation.error_no_image"));
  checkCancelled();

  if (!fromInput) {
    callbacks.onStep?.({ phase: "base", index: 0, total });
    const result = await callbacks.submit(baseParams, { phase: "base", index: 0, total, isFinalOutput: false });
    callbacks.onWaitingForOutput?.();
    inputTemp = await waitForChainStepOutput(result.promptId, false, callbacks.shouldCancel);
    progress.clearPromptOutput(result.promptId);
    lastPromptId = result.promptId;
    resolvedBaseSeed = result.seed;
    checkCancelled();
  }
  for (let i = 0; i < prepared.length; i++) {
    const region = prepared[i].region;
    const isFinalOutput = i === prepared.length - 1;
    const index = i + (fromInput ? 0 : 1);
    callbacks.onStep?.({ phase: "region", index, total });
    checkCancelled();
    if (inputTemp) {
      const bytes = await tempOutputToUploadBytes(inputTemp);
      checkCancelled();
      const upload = await uploadImageBytes(bytes, `regional_chain_input_${i}_${Date.now()}.png`);
      inputName = upload.name;
    }
    checkCancelled();
    const maskUpload = await uploadImageBytes(masks[i], `regional_chain_mask_${i}_${Date.now()}.png`);
    checkCancelled();
    const areaLimitName = areaLimits[i]
      ? (await uploadImageBytes(areaLimits[i]!, `inpaint_area_limit_${i}_${Date.now()}.png`)).name : null;
    checkCancelled();
    const params: GenerationParams = {
      ...baseParams,
      mode: "inpainting",
      input_image: inputName,
      mask_image: maskUpload.name,
      positive_prompt: usesSpatialConditioning ? baseParams.positive_prompt : mergeRegionalPromptText(regionalContext, region.text),
      negative_prompt: !usesSpatialConditioning && region.negativePrompt?.trim()
        ? mergeRegionalPromptText(baseParams.negative_prompt, region.negativePrompt)
        : baseParams.negative_prompt,
      positive_regions: usesSpatialConditioning ? scopes[i].positiveRegions.map(payload => ({ ...payload })) : [],
      controlnet_layers: fromInput ? scopes[i].controlnets.map(payload => ({ ...payload })) : baseParams.controlnet_layers,
      seed: fromInput && i === 0 ? resolvedBaseSeed : regionalChainStepSeed(resolvedBaseSeed, fromInput ? i - 1 : i),
      denoise: region.denoise ?? (region.maskLayerId ? baseParams.denoise : regionStrengthToDenoise(region.strength)),
      inpaint_settings: {
        ...DEFAULT_INPAINT_SETTINGS,
        ...(region.inpaintSettings ?? baseParams.inpaint_settings),
        ...(region.maskLayerId || region.densityDenoise !== undefined ? { density_denoise: !!region.densityDenoise } : {}),
        ...(areaLimitName ? { area_limit_image: areaLimitName } : {}),
      },
      inpaint_target_width: region.inpaintWidth ?? baseParams.width,
      inpaint_target_height: region.inpaintHeight ?? baseParams.height,
      grow_mask_by: region.maskGrow ?? baseParams.grow_mask_by,
      differential_diffusion: differentialDiffusion || !!region.densityDenoise,
      // Style transfer is txt2img-only: it shapes the base pass, and the
      // inpaints would fail validation carrying it.
      style_transfer_enabled: false,
      facefix_enabled: isFinalOutput && facefixOnFinal,
      upscale_enabled: isFinalOutput && upscaleOnFinal,
      detail_segments: isFinalOutput ? segmentsOnFinal : [],
      save_pre_upscale_image: isFinalOutput && savePreUpscaleOnFinal,
    };
    const result = await callbacks.submit(params, { phase: "region", index, total, isFinalOutput });
    if (fromInput && i === 0) resolvedBaseSeed = result.seed;
    callbacks.onWaitingForOutput?.();
    inputTemp = await waitForChainStepOutput(result.promptId, isFinalOutput, callbacks.shouldCancel);
    progress.clearPromptOutput(result.promptId);
    lastPromptId = result.promptId;
    checkCancelled();
  }
  return { lastPromptId, regionCount: prepared.length };
}
