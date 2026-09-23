import { generation } from "../stores/generation.svelte.js";
import { progress } from "../stores/progress.svelte.js";
import { canvas } from "../stores/canvas.svelte.js";
import { locale } from "../stores/locale.svelte.js";
import type { GenerationParams } from "../types/index.js";
import type { RegionalChainRegion } from "./inpaintingRegions.js";
import { buildRegionalContextPrompt, mergeRegionalPromptText } from "./promptSchedule.js";
import { uploadImageBytes } from "./api.js";
import { renderRegionMaskPngBytes, regionStrengthToDenoise } from "./regionalMask.js";
import { canvasPngBytes } from "./canvasLayerExport.js";
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
  // Capture layer pixels and settings before any await: edits during a run must
  // not change later steps. Empty ordinary masks contribute nothing.
  const prepared = regions.filter((r) => (r.maskLayerId || r.text.trim()) && r.width > 0 && r.height > 0).map((region) => {
    if (!region.maskLayerId) return { region: { ...region }, pixels: null };
    const layer = canvas.layers.find((layer) => layer.id === region.maskLayerId);
    if (layer?.type === "region" && !region.text.trim()) throw new Error(locale.t("canvas.region_prompt_required", { name: layer.name }));
    const pixels = canvas.exportMaskLayer(region.maskLayerId);
    if (!pixels && layer?.type === "region") throw new Error(locale.t("canvas.region_mask_required", { name: layer.name }));
    return { region: { ...region, inpaintSettings: region.inpaintSettings ? { ...region.inpaintSettings } : undefined }, pixels };
  }).filter(({ region, pixels }) => !region.maskLayerId || pixels);
  if (!prepared.length) throw new Error(locale.t("generation.error_no_mask"));

  const baseParams = generation.toParams({ includeConditioningRegions: false });
  const facefixOnFinal = baseParams.facefix_enabled;
  const upscaleOnFinal = baseParams.upscale_enabled;
  const segmentsOnFinal = baseParams.detail_segments;
  baseParams.facefix_enabled = false;
  baseParams.upscale_enabled = false;
  baseParams.detail_segments = [];
  const differentialDiffusion = generation.isAnima || generation.differentialDiffusion;
  const regionalContext = buildRegionalContextPrompt(baseParams.positive_prompt, generation.loras.filter((l) => l.enabled && l.name));
  const masks = await Promise.all(prepared.map(({ region, pixels }) => pixels
    ? canvasPngBytes(pixels)
    : renderRegionMaskPngBytes(region, baseParams.width, baseParams.height)));
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
    const params: GenerationParams = {
      ...baseParams,
      mode: "inpainting",
      input_image: inputName,
      mask_image: maskUpload.name,
      positive_prompt: mergeRegionalPromptText(regionalContext, region.text),
      negative_prompt: region.negativePrompt?.trim()
        ? mergeRegionalPromptText(baseParams.negative_prompt, region.negativePrompt)
        : baseParams.negative_prompt,
      positive_regions: [],
      seed: fromInput && i === 0 ? resolvedBaseSeed : regionalChainStepSeed(resolvedBaseSeed, fromInput ? i - 1 : i),
      denoise: region.denoise ?? regionStrengthToDenoise(region.strength),
      inpaint_settings: region.inpaintSettings ?? baseParams.inpaint_settings,
      grow_mask_by: region.maskGrow ?? baseParams.grow_mask_by,
      differential_diffusion: differentialDiffusion,
      facefix_enabled: isFinalOutput && facefixOnFinal,
      upscale_enabled: isFinalOutput && upscaleOnFinal,
      detail_segments: isFinalOutput ? segmentsOnFinal : [],
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
