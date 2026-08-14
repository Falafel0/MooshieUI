import { generation } from "../stores/generation.svelte.js";
import { progress } from "../stores/progress.svelte.js";
import type { GenerationParams } from "../types/index.js";
import { uploadImageBytes } from "./api.js";
import { tempOutputToUploadBytes, waitForPromptCompletion, waitForPromptOutput } from "./waitForPrompt.js";

/**
 * A single canvas mask layer ready for inpaint: its white-on-black mask pixels
 * plus the per-mask denoise and prompt the user configured in the layer panel.
 */
export interface MaskInpaintStep {
  id: string;
  name: string;
  maskBytes: number[];
  denoise: number;
  prompt: string;
  promptAddToBase?: boolean;
  growMaskBy?: number;
  inpaintArea?: "whole" | "mask_only";
  inpaintMaskWidth?: number;
  inpaintMaskHeight?: number;
  inpaintMaskBlend?: number;
  inpaintMaskHipass?: number;
  inpaintContextFactor?: number;
  inpaintDeviceMode?: "cpu (compatible)" | "gpu (much faster)";
  differentialDiffusion?: boolean;
}

export interface MaskInpaintChainContext {
  index: number;
  total: number;
  isFinalOutput: boolean;
}

export interface MaskInpaintChainCallbacks {
  submit: (
    params: GenerationParams,
    ctx: MaskInpaintChainContext,
  ) => Promise<{ promptId: string; seed: string }>;
  onStep?: (info: { index: number; total: number }) => void;
  onWaitingForOutput?: () => void;
  shouldCancel?: () => boolean;
}

export interface MaskInpaintChainResult {
  lastPromptId: string;
  maskCount: number;
}

/**
 * Sequential per-mask inpaint on an existing image. Each mask layer is inpainted
 * in order, chaining the previous step's output as the next step's input. Unlike
 * the regional prompt chain (which starts from a txt2img base), this starts from
 * the already-loaded input image and uses the mask layer's own denoise + prompt.
 */
export async function runMaskInpaintChain(
  steps: MaskInpaintStep[],
  callbacks: MaskInpaintChainCallbacks,
): Promise<MaskInpaintChainResult> {
  const valid = steps.filter((s) => s.maskBytes.length > 0);
  if (valid.length === 0) {
    throw new Error("No valid mask layers for inpaint chain");
  }

  const baseName = generation.inputImage;
  if (!baseName) {
    throw new Error("No input image for mask inpaint chain");
  }

  const baseParams = generation.toParams();
  const total = valid.length;
  let chainInput = baseName;
  let lastPromptId = "";

  for (let i = 0; i < valid.length; i++) {
    const step = valid[i];
    const isFinal = i === valid.length - 1;
    callbacks.onStep?.({ index: i + 1, total });
    if (callbacks.shouldCancel?.()) throw new Error("Mask inpaint chain cancelled");

    const maskUpload = await uploadImageBytes(
      step.maskBytes,
      `canvas_mask_layer_${i}_${Date.now()}.png`,
    );

    const basePrompt = baseParams.positive_prompt?.trim() ?? "";
    const localPrompt = step.prompt?.trim() ?? "";
    let prompt: string;
    if (!localPrompt) {
      prompt = basePrompt;
    } else if (step.promptAddToBase && basePrompt) {
      prompt = `${basePrompt}, ${localPrompt}`;
    } else {
      prompt = localPrompt;
    }
    const growMaskBy = step.growMaskBy ?? baseParams.grow_mask_by;
    const inpaintArea = step.inpaintArea ?? baseParams.inpaint_area;
    const regionParams: GenerationParams = {
      ...baseParams,
      mode: "inpainting",
      input_image: chainInput,
      mask_image: maskUpload.name,
      positive_prompt: prompt,
      positive_regions: [],
      denoise: step.denoise,
      grow_mask_by: growMaskBy,
      inpaint_area: inpaintArea,
      inpaint_mask_width: inpaintArea === "mask_only" ? (step.inpaintMaskWidth ?? baseParams.inpaint_mask_width) : null,
      inpaint_mask_height: inpaintArea === "mask_only" ? (step.inpaintMaskHeight ?? baseParams.inpaint_mask_height) : null,
      inpaint_mask_blend: inpaintArea === "mask_only" ? (step.inpaintMaskBlend ?? baseParams.inpaint_mask_blend) : 0,
      inpaint_mask_hipass: step.inpaintMaskHipass ?? baseParams.inpaint_mask_hipass,
      inpaint_context_factor: step.inpaintContextFactor ?? baseParams.inpaint_context_factor,
      inpaint_device_mode: step.inpaintDeviceMode ?? baseParams.inpaint_device_mode,
      differential_diffusion: step.differentialDiffusion ?? baseParams.differential_diffusion,
    };

    const result = await callbacks.submit(regionParams, {
      index: i,
      total,
      isFinalOutput: isFinal,
    });
    callbacks.onWaitingForOutput?.();
    const temp = await waitForPromptOutput(result.promptId);
    if (isFinal) {
      await waitForPromptCompletion(result.promptId);
    } else {
      // Chain the output into the next mask step's input.
      const inputBytes = await tempOutputToUploadBytes(temp);
      const inputUpload = await uploadImageBytes(
        inputBytes,
        `canvas_mask_chain_input_${i}_${Date.now()}.png`,
      );
      chainInput = inputUpload.name;
    }
    progress.clearPromptOutput(result.promptId);
    lastPromptId = result.promptId;
  }

  return { lastPromptId, maskCount: valid.length };
}
