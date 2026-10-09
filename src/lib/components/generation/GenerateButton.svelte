<script lang="ts">
  import { tick } from "svelte";
  import { yieldToUi } from '../../utils/yieldToUi.js';
  import { generationModelContextKey } from "../../utils/controlnetState.js";
  import { effectiveLayerVisibility } from "../../utils/layerRelations.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { canvas } from "../../stores/canvas.svelte.js";
  import { compare } from "../../stores/compare.svelte.js";
  import {
    generate,
    interruptGeneration,
    deleteQueueItem,
    installPipPackage,
    downloadModel,
    checkPythonImport,
  } from "../../utils/api.js";
  import { models } from "../../stores/models.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import NovelAiUsage from "./NovelAiUsage.svelte";
  import { novelai } from "../../stores/novelai.svelte.js";
  import { estimateCurrentNovelAiCost } from "../../utils/novelaiCurrentCost.js";
  import { promptPresets } from "../../stores/promptPresets.svelte.js";
  import { isBrowserMode } from "../../utils/ipc.js";
  import type { GenerationParams, RegionalPromptSelection } from "../../types/index.js";
  import { runRegionalInpaintChain } from "../../utils/regionalInpaintChain.js";
  import { prepareControlnetLayers } from "../../utils/prepareControlnetLayers.js";
  import { sameInpaintPreparationSnapshot } from "../../utils/inpaintLayerSnapshot.js";
  import { createGenerationPreparation, GenerationPreparationCancelled, onceWithinGenerationRun, type GenerationPreparationPhase } from "../../utils/generationPreparation.js";
  import { getRegionalChainRegions, prepareConditioningRegions, captureInpaintLayerSnapshot, assertInpaintLayerRelations, type InpaintConditioningRegion } from "../../utils/inpaintingRegions.js";
  import {
    suppressRegionalChainGallerySave,
    clearAllRegionalChainGallerySuppress,
  } from "../../utils/regionalChainGallery.js";
  import { checkStyleTransferNodesReady } from "../../utils/styleTransferNodes.js";
  import { classifyGenerationError } from "../../utils/generationErrors.js";
  import { parseSegmentDetailPrompt, yoloTargetFilename } from "../../utils/promptSegmentDetail.js";
  import { requestGeneration, trackGeneration, submitGeneration } from "../../utils/generationSubmit.js";
  import { beginPausedEdit, uploadPausedEditImage } from "../../utils/pausedEdit.js";
  import { queue } from "../../stores/queue.svelte.js";
  import QueuePanel from "../ui/QueuePanel.svelte";

  interface Props {
    canvasEditorRef?: { getRasterComposite: () => HTMLCanvasElement | null; getMaskCanvas: () => HTMLCanvasElement | null };
  }

  let { canvasEditorRef }: Props = $props();
  let errorMsg = $state<string | null>(null);
  let isSubmitting = $state(false);
  let preparationPhase = $state<GenerationPreparationPhase | null>(null);
  let orderedRunPromptIds = $state<string[]>([]);
  let orderedRunCancelRequested = $state(false);
  let regionalChainCancelRequested = $state(false);
  let submitRunToken = 0;
  let orderedRunToken = 0;
  let regionalChainToken = 0;
  let cancellationEpoch = 0;
  const orderedWildcardRun = $derived(promptPresets.orderedWildcardRun);
  const orderedWildcardRunCount = $derived(compare.active && compare.cellCount > 1 ? 0 : (orderedWildcardRun?.count ?? 0));
  const pendingOrderedRunIds = $derived(orderedRunPromptIds.filter((id) => progress.pendingPrompts.some((prompt) => prompt.promptId === id)));

  const generateButtonTitle = $derived.by(() => {
    if (orderedWildcardRunCount > 1) {
      return locale.t("generation.generate_ordered_tip", {
        count: orderedWildcardRunCount,
        name: orderedWildcardRun?.presetName ?? "",
      });
    }
    if (progress.isGenerating) {
      return locale.t("generation.generate_queue_tip", { count: progress.queueCount });
    }
    return locale.t("generation.generate_tip");
  });

  async function ensureFacefixPythonDependency(assertActive: () => void) {
    assertActive();
    if (isBrowserMode) return;
    const installed = await checkPythonImport("ultralytics");
    assertActive();
    if (installed) return;
    await installPipPackage("ultralytics==8.4.34");
    assertActive();
    const importOk = await checkPythonImport("ultralytics");
    assertActive();
    if (!importOk) {
      throw new Error(locale.t("generation.facefix.dep_check_failed"));
    }
  }

  const DETECTOR_META: Record<string, { url: string; sha256?: string }> = {
    "Anzhc Face seg 640 v4 y11n.pt": {
      url: "https://huggingface.co/Anzhc/Anzhcs_YOLOs/resolve/0319daeae9ae40752c2fb3904069cb35cc61d2ec/Anzhc%20Face%20seg%20640%20v4%20y11n.pt",
      sha256: "1e77ad7bd349babd8a4a90478bfc965348642b63a8d95d3b43ee13db42fd0a64",
    },
  };

  /** Download a YOLO detector into models/ultralytics if missing, then ensure the python dep. */
  async function ensureUltralyticsDetector(detector: string, toastKey: string, ensurePython: () => Promise<void>, assertActive: () => void): Promise<void> {
    assertActive();
    if (!models.ultralyticsModels.includes(detector)) {
      gallery.showToast(locale.t(toastKey), "info");
      const meta = DETECTOR_META[detector];
      const url = meta?.url ?? `https://huggingface.co/Bingsu/adetailer/resolve/main/${detector}`;
      await downloadModel(url, "ultralytics", detector, undefined, meta?.sha256);
      assertActive();
      await models.refresh();
      assertActive();
    }
    await ensurePython();
  }

  function finishSubmitRun(runToken: number) {
    if (runToken === submitRunToken) {
      isSubmitting = false;
      preparationPhase = null;
      progress.setRegionalChainStatus(null);
    }
  }

  function setRegionalChainStep(phase: "base" | "region" | "wait", index: number, total: number) {
    if (phase === "wait") {
      progress.setRegionalChainStatus(locale.t("generation.regional.inpaint_chain_waiting"));
      return;
    }
    const key =
      phase === "base"
        ? "generation.regional.inpaint_chain_base"
        : "generation.regional.inpaint_chain_region";
    progress.setRegionalChainStatus(
      locale.t(key, {
        current: String(index + 1),
        total: String(total),
      }),
    );
  }

  /** Sequential edit passes: the inpaint workspace's own mechanism, driven by
   * mask layers. A prompt region is influence, not an edit, so it never starts
   * a run of passes — for any mode. */
  function usesSequentialEditMasks(): boolean {
    return generation.supportsSequentialEditMasks && getRegionalChainRegions().length > 0;
  }

  async function handleEditPausedImage() {
    errorMsg = null;
    try {
      if (!(await beginPausedEdit())) {
        gallery.showToast(locale.t("generation.pause.edit_unavailable"), "error");
      }
    } catch (e) {
      console.error("Edit paused image failed:", e);
      gallery.showToast(locale.t("gallery.toast.failed_load"), "error");
    }
  }

  async function handleGenerate() {
    const initialCancellationEpoch = cancellationEpoch;
    const initialMode = generation.mode;
    const initialModelContext = generationModelContextKey(generation);
    const initialSourceVersion = canvas.inpaintSourceVersion;
    const initialCanvasMode = canvas.isCanvasMode;
    // Keyboard shortcuts reach this handler even when the button is disabled.
    if (generation.mode === "video" && !generation.canGenerate) return;

    // Queueing another job is available as soon as this request is accepted,
    // but clicks/shortcuts during preparation must not duplicate downloads or submissions.
    if (isSubmitting) return;
    const runToken = ++submitRunToken;
    isSubmitting = true;
    errorMsg = null;
    const preparation = createGenerationPreparation(
      () => initialCancellationEpoch !== cancellationEpoch,
      phase => { if (runToken === submitRunToken) preparationPhase = phase; },
    );
    const ensurePython = onceWithinGenerationRun(() => ensureFacefixPythonDependency(preparation.assertActive));
    const submitPrepared = async (params: GenerationParams, options?: Parameters<typeof submitGeneration>[1]) => {
      const promptId = await preparation.wait("submitting", () => submitGeneration(params, {
        ...options,
        isCancelled: () => initialCancellationEpoch !== cancellationEpoch || (options?.isCancelled?.() ?? false),
      }));
      preparation.phase(null);
      return promptId;
    };

    try {
      preparation.phase("inputs");
      // Commit and paint the busy label before synchronous canvas/prompt work.
      await tick();
      await yieldToUi();
      preparation.assertActive();
      if (generation.mode !== "video" && !generation.checkpoint) {
        errorMsg = locale.t('generation.error_no_checkpoint');
        return;
      }

      // Check style transfer only when it will actually be sent: an armed or
      // paused run clears it in toParams(), except the regional inpaint chain,
      // which builds its params outside the paused run and keeps it on the base
      // pass (a paused run is continued instead, so the chain never runs then).
      const styleTransferWillRun =
        generation.styleTransferEnabled &&
        (!generation.pauseResumeActive || (!generation.isPaused && usesSequentialEditMasks()));
      if (styleTransferWillRun) {
        if (!generation.styleReferenceImage?.trim()) {
          errorMsg = locale.t("generation.style_transfer.no_reference");
          gallery.showToast(locale.t("generation.style_transfer.no_reference"), "error");
          return;
        }
        const nodesReady = await preparation.wait("style_nodes", checkStyleTransferNodesReady);
        if (!nodesReady) {
          errorMsg = locale.t("generation.style_transfer.nodes_missing_generate");
          gallery.showToast(locale.t("generation.style_transfer.nodes_missing_generate"), "error");
          return;
        }
      }

      preparation.phase("inputs");
      let inpaintConditioningRegions: InpaintConditioningRegion[] = [];
      if (canvas.isCanvasMode !== initialCanvasMode) throw new Error(locale.t('generation.controlnet.reference_changed'));
      const preparationCanvasMode = initialCanvasMode;
      const layerSnapshot = preparationCanvasMode ? captureInpaintLayerSnapshot() : { layers: [], groups: [] };
      const preparationPaintRevision = canvas.paintRevision;
      const assertDocumentUnchanged = () => {
        if (generationModelContextKey(generation) !== initialModelContext)
          throw new Error(locale.t('generation.preparation_changed'));
        if (canvas.isCanvasMode !== preparationCanvasMode || (preparationCanvasMode &&
            (canvas.paintRevision !== preparationPaintRevision || !sameInpaintPreparationSnapshot(layerSnapshot, canvas.sortedLayers ?? canvas.layers, canvas.groups))))
          throw new Error(locale.t('generation.controlnet.reference_changed'));
      };
      // Continuing a paused run: the remaining steps sample from the paused
      // latent with the current prompt, CFG, sampler and LoRAs. Grid, ordered
      // wildcard and regional chains all start fresh images, so they do not
      // apply here.
      if (generation.resumeAppliesToMode && generation.isPaused && generation.mode === "txt2img") {
        generation.saveCurrentPromptToHistory();
        await submitPrepared(generation.toParams());
        generation.saveSettings();
        return;
      }

      // Continuing a paused run with a painted correction: the inpaint canvas
      // holds the paused preview, the user's paint and a mask. The paint is
      // composited onto the preview and blended into the paused latent under
      // the mask before the remaining steps run.
      if (generation.resumeAppliesToMode && generation.isPaused && generation.pausedEditArmed && generation.mode === "inpainting") {
        if (!canvasEditorRef) {
          throw new Error(locale.t("canvas.editor_not_ready"));
        }
        await preparation.wait("inputs", () => canvas.syncToGeneration(
          () => canvasEditorRef.getRasterComposite(),
          () => canvasEditorRef.getMaskCanvas()
        ));
        if (!generation.maskImage) {
          errorMsg = locale.t("generation.pause.edit_needs_mask");
          return;
        }
        const editImage = await preparation.wait("inputs", () => uploadPausedEditImage(canvasEditorRef.getRasterComposite()));
        if (!editImage) {
          errorMsg = locale.t("generation.error_no_image");
          return;
        }
        generation.saveCurrentPromptToHistory();
        await submitPrepared(
          generation.toParams({
            overrides: {
              mode: "txt2img",
              resume_edit_image: editImage,
              resume_edit_mask: generation.maskImage,
            },
          }),
        );
        generation.saveSettings();
        // Back to the text-to-image view; the paused run stays until discarded.
        generation.pausedEditArmed = false;
        generation.mode = "txt2img";
        canvas.isCanvasMode = false;
        return;
      }

      // If compare grid has multiple cells, generate all cells
      if (compare.active && compare.cellCount > 1) {
        await handleGridGenerate(preparation);
        return;
      }

      const hasSpatialPromptLayers = canvas.layers.some((layer) => effectiveLayerVisibility(layer, canvas.groups) && layer.type === "region" && (layer.coverage ?? 1) > 0 && (layer.regionalStrength ?? 1) > 0);
      if (generation.mode === "inpainting" &&
          !generation.supportsRegionalConditioning &&
          !generation.supportsSequentialEditMasks &&
          hasSpatialPromptLayers) {
        throw new Error(locale.t("canvas.regions_supported"));
      }
      if (generation.mode === 'inpainting' && canvas.isCanvasMode && !generation.isNovelAi) assertInpaintLayerRelations(layerSnapshot);
      if (generation.mode === "inpainting" && !generation.isNovelAi) await preparation.wait("inputs", prepareControlnetLayers);
      // If canvas mode is active, export canvas content before generating
      if (canvas.isCanvasMode) {
        if (!canvasEditorRef) {
          throw new Error(locale.t("canvas.editor_not_ready"));
        }
        await preparation.wait("inputs", () => canvas.syncToGeneration(
          () => canvasEditorRef.getRasterComposite(),
          () => canvasEditorRef.getMaskCanvas()
        ));
        if (generation.supportsRegionalConditioning && canvas.isCanvasMode) {
          // Painted regions condition this run the same way they condition an
          // inpaint pass; in text-to-image they join the regions written in the
          // prompt bar instead of replacing them.
          const paintedRegions = await preparation.wait("inputs", () => prepareConditioningRegions(layerSnapshot));
          inpaintConditioningRegions = generation.mode === "inpainting"
            ? paintedRegions
            : [...paintedRegions, ...generation.regionalPrompts];
        }
      }

      if (generation.mode === "img2img" && !generation.inputImage) {
        errorMsg = locale.t('generation.error_no_image');
        return;
      }

      if (generation.mode === "inpainting") {
        if (!generation.inputImage) {
          errorMsg = locale.t('generation.error_no_image');
          return;
        }
        // A prompt region is influence only — it does not permit pixel edits —
        // so an inpaint run still needs a mask layer of its own.
        if (!generation.maskImage) {
          errorMsg = locale.t('generation.error_no_mask');
          return;
        }
      }

      // Ensure face fix dependencies are ready when enabled
      if (generation.facefixEnabled) {
        const detector = generation.facefixDetector || "Anzhc Face seg 640 v4 y11n.pt";
        await preparation.wait("dependencies", () => ensureUltralyticsDetector(detector, "generation.downloading_facefix", ensurePython, preparation.assertActive));
        generation.facefixDetector = detector;
      }

      // Ensure YOLO detectors referenced by <segment:yolo-...> tags are ready
      // (deduplicated so each detector is checked once). Unknown models that
      // fail to download are skipped with a warning — the segment node passes
      // through unchanged when its model is missing.
      const segmentDetectors = new Set(
        parseSegmentDetailPrompt(generation.positivePrompt)
          .segments.map((s) => yoloTargetFilename(s.target))
          .filter((name): name is string => name !== null),
      );
      for (const detector of segmentDetectors) {
        try {
          await preparation.wait("dependencies", () => ensureUltralyticsDetector(detector, "generation.segment.downloading_detector", ensurePython, preparation.assertActive));
        } catch (e) {
          if (e instanceof GenerationPreparationCancelled) throw e;
          console.warn("[segment] detector unavailable:", detector, e);
          gallery.showToast(
            locale.t("generation.segment.detector_unavailable", { name: detector }),
            "warning",
          );
        }
      }
      preparation.phase("inputs");

      // Anima models produce poor results below 1024 — clamp to 1024² area preserving aspect ratio
      if (generation.mode === "txt2img" && generation.isAnima && (generation.width < 1024 || generation.height < 1024)) {
        const ratio = generation.width / generation.height;
        const area = 1024 * 1024;
        generation.width = Math.round(Math.sqrt(area * ratio) / 8) * 8;
        generation.height = Math.round(Math.sqrt(area / ratio) / 8) * 8;
      }

      if (orderedWildcardRunCount > 1) {
        await handleOrderedWildcardGenerate(orderedWildcardRunCount, preparation);
        return;
      }

      const regionalPromptingSupported = generation.supportsRegionalPrompting;
      if (generationModelContextKey(generation) !== initialModelContext) throw new Error(locale.t('generation.preparation_changed'));
      if (initialCancellationEpoch !== cancellationEpoch || generation.mode !== initialMode ||
          (initialMode === 'inpainting' && canvas.inpaintSourceVersion !== initialSourceVersion)) return;
      if (canvas.isCanvasMode !== preparationCanvasMode) return;
      if (generation.mode === 'inpainting' && canvas.isCanvasMode && !generation.isNovelAi) assertDocumentUnchanged();
      // Preparation only changes server upload names; all durable inputs/scopes remain frozen.
      for (const layer of layerSnapshot.layers) {
        if (layer.controlnet) layer.controlnet.image = canvas.layers.find(current => current.id === layer.id)?.controlnet?.image ?? layer.controlnet.image;
      }
      const useRegionalInpaintChain = generation.supportsSequentialEditMasks && getRegionalChainRegions(layerSnapshot).length > 0;
      const validRegions = useRegionalInpaintChain
        ? getRegionalChainRegions(layerSnapshot)
        : (generation.mode === "inpainting" ? [] : generation.regionalPrompts).filter(
            (r) => r.text.trim() && r.width > 0 && r.height > 0,
          );
      const configuredRegions = validRegions.length;

      if (configuredRegions > 0 && !regionalPromptingSupported) {
        gallery.showToast(locale.t("generation.regional.dropped_warning"), "warning");
        console.warn(
          "[regional] Generate skipped",
          configuredRegions,
          "GUI region(s); architecture=",
          generation.modelFamily,
        );
      }

      const skippedEmpty = generation.mode === "inpainting" ? 0 : generation.regionalPrompts.length - configuredRegions;
      if (skippedEmpty > 0 && configuredRegions > 0) {
        gallery.showToast(
          locale.t("generation.regional.empty_skipped_warning", { count: String(skippedEmpty) }),
          "warning",
        );
      }

      console.log(
        "[generate] output_format:",
        generation.outputFormat,
        "output_bit_depth:",
        generation.outputBitDepth,
        "regional_conditioning:",
        generation.supportsRegionalConditioning,
        "sequential_edit_masks:",
        generation.supportsSequentialEditMasks,
      );
      generation.saveCurrentPromptToHistory();

      if (useRegionalInpaintChain && configuredRegions > 0) {
        const inpaintSnapshot = generation.mode === 'inpainting' ? canvas.captureInpaintSubmission() : null;
        const chainToken = ++regionalChainToken;
        regionalChainCancelRequested = false;
        gallery.showToast(locale.t("generation.regional.inpaint_chain_started"), "info");
        clearAllRegionalChainGallerySuppress();
        try {
          const chainResult = await runRegionalInpaintChain(validRegions, {
            conditioningRegions: inpaintConditioningRegions,
            layerSnapshot,
            submit: async (chainParams, ctx) => {
              preparation.assertActive();
              preparation.phase("submitting");
              const result = await requestGeneration(chainParams);
              if (initialCancellationEpoch !== cancellationEpoch || regionalChainCancelRequested || chainToken !== regionalChainToken || (inpaintSnapshot && !inpaintSnapshot.valid)) {
                await interruptGeneration(result.prompt_id);
                throw new Error("Regional inpaint chain cancelled");
              }
              preparation.phase(null);
              if (!ctx.isFinalOutput) {
                suppressRegionalChainGallerySave(result.prompt_id);
              } else if (inpaintSnapshot) {
                canvas.registerInpaintPrompt(result.prompt_id, inpaintSnapshot);
              }
              trackGeneration(chainParams, result);
              return { promptId: result.prompt_id, seed: result.seed };
            },
            onStep: ({ phase, index, total }) => {
              setRegionalChainStep(phase, index, total);
              if (phase === "base") {
                gallery.showToast(
                  locale.t("generation.regional.inpaint_chain_base", {
                    current: "1",
                    total: String(total),
                  }),
                  "info",
                );
              } else {
                gallery.showToast(
                  locale.t("generation.regional.inpaint_chain_region", {
                    current: String(index + 1),
                    total: String(total),
                  }),
                  "info",
                );
              }
            },
            onWaitingForOutput: () => setRegionalChainStep("wait", 0, 0),
            shouldCancel: () =>
              regionalChainCancelRequested || chainToken !== regionalChainToken ||
              (!!inpaintSnapshot && ((!inpaintSnapshot.valid && !inpaintSnapshot.accepted) || canvas.inpaintSourceVersion !== inpaintSnapshot.sourceVersion)),
          });
          console.log(
            "[regional] Inpaint chain finished:",
            chainResult.regionCount,
            "region(s)",
          );
        } catch (chainError) {
          if (inpaintSnapshot) canvas.finishInpaintResult(inpaintSnapshot);
          if (regionalChainCancelRequested || chainToken !== regionalChainToken) {
            console.log("[regional] Inpaint chain cancelled");
          } else {
            throw chainError;
          }
        } finally {
          clearAllRegionalChainGallerySuppress();
        }
      } else {
        const params = generation.toParams({
          // Painted regions condition text-to-image as well; the list already
          // carries the prompt bar's own regions alongside them.
          regionalSelectionsOverride: inpaintConditioningRegions.length > 0
            ? inpaintConditioningRegions
            : undefined,
        });
        if (params.mode === 'inpainting' && canvas.isCanvasMode && !generation.isNovelAi) {
          params.inpaint_settings = { ...generation.inpaintSettings, density_denoise: false };
        }
        const sentRegions = params.positive_regions?.length ?? 0;
        if (sentRegions > 0) {
          console.log("[regional] Sending", sentRegions, "region(s) via conditioning");
        }
        const snapshot = params.mode === 'inpainting' ? canvas.captureInpaintSubmission() : null;
        try {
          await submitPrepared(params, {
            isCancelled: () => initialCancellationEpoch !== cancellationEpoch || (!!snapshot && !snapshot.valid),
            beforeTrack: promptId => { if (snapshot) canvas.registerInpaintPrompt(promptId, snapshot); },
          });
        } catch (error) {
          if (snapshot) canvas.finishInpaintResult(snapshot);
          throw error;
        }
      }
      generation.saveSettings();
    } catch (e) {
      if (initialCancellationEpoch !== cancellationEpoch) return;
      if (runToken === submitRunToken) {
        console.error("Generation failed:", e);
        const message = e instanceof Error ? e.message : String(e);
        // Classify submission failures (stale model cache, incompatible VAE,
        // OOM, missing node, etc.) into actionable guidance. Fall back to the
        // raw message only when nothing matched.
        const classified = classifyGenerationError(message);
        errorMsg =
          classified.messageKey === "generation.toast.failed"
            ? locale.t("generation.error_failed_message", { message })
            : locale.t(classified.messageKey, classified.params);
      }
    } finally {
      preparation.finish();
      finishSubmitRun(runToken);
    }
  }

  async function handleOrderedWildcardGenerate(count: number, preparation: ReturnType<typeof createGenerationPreparation>) {
    preparation.assertActive();
    const run = orderedWildcardRun;
    if (!run) return;
    const choices = promptPresets.wildcardChoices(run.presetId);
    if (choices.length === 0) return;

    generation.saveCurrentPromptToHistory();
    const runToken = ++orderedRunToken;
    orderedRunPromptIds = [];
    orderedRunCancelRequested = false;
    for (let i = 0; i < count; i++) {
      if (preparation.isCancelled() || orderedRunCancelRequested || runToken !== orderedRunToken) break;
      const choiceIndex = (run.nextIndex + i) % choices.length;
      const fixedPresetChoices = new Map([[run.presetId, choices[choiceIndex]]]);
      const params = generation.toParams({ fixedPresetChoices });
      console.log(
        "[generate] ordered_wildcard:",
        `${i + 1}/${count}`,
        "output_format:",
        params.output_format,
        "output_bit_depth:",
        params.output_bit_depth,
      );
      let result: Awaited<ReturnType<typeof requestGeneration>>;
      try {
        preparation.phase("submitting");
        result = await requestGeneration(params);
      } catch (e) {
        if (preparation.isCancelled() || orderedRunCancelRequested || runToken !== orderedRunToken) break;
        throw e;
      }
      if (preparation.isCancelled() || orderedRunCancelRequested || runToken !== orderedRunToken) {
        try { await interruptGeneration(result.prompt_id); } catch { /* already gone */ }
        break;
      }
      const promptId = trackGeneration(params, result);
      preparation.phase(null);
      orderedRunPromptIds = [...orderedRunPromptIds, promptId];
      if (orderedRunCancelRequested || runToken !== orderedRunToken) {
        await cancelPromptIds([promptId], true);
        break;
      }
      promptPresets.setOrderedWildcardIndex(run.presetId, choiceIndex + 1);
    }
    if (runToken === orderedRunToken) {
      generation.saveSettings();
    }
  }

  /** Left-click: skip the current ordered item, otherwise cancel the current generation. */
  async function handleCancelCurrent() {
    // This request has not been accepted yet. Cancel only its continuation;
    // a response arriving later is cancelled by its actual prompt ID.
    if (preparationPhase !== null) {
      cancellationEpoch++;
      submitRunToken++;
      regionalChainCancelRequested = true;
      regionalChainToken++;
      orderedRunCancelRequested = true;
      orderedRunToken++;
      isSubmitting = false;
      preparationPhase = null;
      return;
    }
    if (pendingOrderedRunIds.length > 0) {
      await handleSkipOrderedPrompt();
      return;
    }
    const promptId = progress.activePromptId ?? progress.pendingPrompts[0]?.promptId;
    cancellationEpoch++;
    regionalChainCancelRequested = true;
    regionalChainToken++;
    if (promptId) canvas.invalidateInpaintPrompts([promptId]);
    await interruptGeneration(promptId ?? undefined);
    if (promptId) {
      progress.removePrompt(promptId);
    }
  }

  async function handleSkipOrderedPrompt() {
    const promptId = progress.activePromptId && pendingOrderedRunIds.includes(progress.activePromptId)
      ? progress.activePromptId
      : pendingOrderedRunIds[0];
    if (!promptId) return;
    await cancelPromptIds([promptId], true);
  }

  async function cancelPromptIds(idsToCancel: string[], interruptActive = false) {
    if (idsToCancel.length === 0) return;
    canvas.invalidateInpaintPrompts(idsToCancel);
    const activePromptId = progress.activePromptId && idsToCancel.includes(progress.activePromptId)
      ? progress.activePromptId
      : null;

    if (interruptActive && activePromptId) {
      await interruptGeneration(activePromptId);
    }
    for (const promptId of idsToCancel) {
      if (promptId === activePromptId) continue;
      try { await deleteQueueItem(promptId); } catch { /* already removed */ }
    }
    for (const promptId of idsToCancel) {
      progress.removePrompt(promptId);
    }
    orderedRunPromptIds = orderedRunPromptIds.filter((id) => !idsToCancel.includes(id));
  }

  /** Right-click: cancel current + clear the entire queue. */
  async function handleCancelAll(e: MouseEvent) {
    e.preventDefault();
    cancellationEpoch++;
    regionalChainCancelRequested = true;
    regionalChainToken++;
    orderedRunCancelRequested = true;
    submitRunToken++;
    orderedRunToken++;
    progress.cancelAll();
    canvas.invalidateInpaintPrompts();
    orderedRunPromptIds = [];
    compare.clearGridBatch();
    try {
      await interruptGeneration();
    } catch (e) {
      console.error("Failed to cancel queued generations:", e);
    } finally {
      isSubmitting = false;
      preparationPhase = null;
    }
  }

  /** Generate all grid cells sequentially with a shared seed, then stitch into a grid. */
  async function handleGridGenerate(preparation: ReturnType<typeof createGenerationPreparation>) {
    compare.saveActiveCell();
    const savedIndex = compare.activeIndex;

    // Resolve one seed for all cells that have random (-1) seed
    const sharedSeed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const failedCells: number[] = [];

    // Sort cells by model to minimize expensive ComfyUI model swaps
    const cellOrder = compare.cells.map((cell, i) => ({ cell, index: i }));
    cellOrder.sort((a, b) => {
      const modelA = a.cell.diffusionModel ?? a.cell.checkpoint;
      const modelB = b.cell.diffusionModel ?? b.cell.checkpoint;
      return modelA.localeCompare(modelB);
    });

    // Track results by original cell index so the grid stitches in the right order
    const resultsByIndex = new Map<number, { promptId: string; cell: typeof compare.cells[0] }>();

    for (const { cell, index } of cellOrder) {
      if (preparation.isCancelled()) break;
      compare.applyToGeneration(cell);

      const params = generation.toParams();

      // Anima models produce poor results below 1024 — clamp to 1024² area
      // preserving aspect ratio. The single-image path does this on the store;
      // the grid path builds params per cell, so mirror it here.
      if (generation.isAnima && (params.width < 1024 || params.height < 1024)) {
        const ratio = params.width / params.height;
        const area = 1024 * 1024;
        params.width = Math.round(Math.sqrt(area * ratio) / 8) * 8;
        params.height = Math.round(Math.sqrt(area / ratio) / 8) * 8;
      }

      // Use shared seed for random seeds so the grid is consistent
      if (params.seed === "-1") {
        params.seed = String(sharedSeed);
      }

      try {
        preparation.phase("submitting");
        const result = await generate(params);
        if (preparation.isCancelled()) {
          try { await interruptGeneration(result.prompt_id); } catch { /* already gone */ }
          break;
        }
        preparation.phase(null);
        params.seed = result.seed;
        progress.enqueue(result.prompt_id, params.upscale_enabled, params.mode, params);
        resultsByIndex.set(index, { promptId: result.prompt_id, cell });
      } catch (e) {
        if (preparation.isCancelled()) break;
        console.error(`Grid cell ${index + 1} failed:`, e);
        failedCells.push(index);
      }
    }

    if (preparation.isCancelled()) return;
    // Build arrays in original cell order for correct grid stitching
    const promptIds: string[] = [];
    const successSnapshots: typeof compare.cells = [];
    for (let i = 0; i < compare.cellCount; i++) {
      const entry = resultsByIndex.get(i);
      if (entry) {
        promptIds.push(entry.promptId);
        successSnapshots.push(entry.cell);
      }
    }

    if (promptIds.length >= 2) {
      compare.startGridBatch(promptIds, compare.rows, compare.cols, successSnapshots, failedCells);
    }

    // Restore active cell params
    const activeSnap = compare.cells[savedIndex];
    if (activeSnap) compare.applyToGeneration(activeSnap);

    if (failedCells.length > 0) {
      errorMsg = locale.t('compare.grid_cells_failed', { cells: failedCells.map(i => i + 1).join(', ') });
    }

    generation.saveSettings();
  }

  const canGenerate = $derived(generation.canGenerate && !isSubmitting);
  const preparationLabel = $derived(preparationPhase === "inputs"
    ? locale.t("progress.preparing")
    : preparationPhase ? locale.t(`generation.preparation.${preparationPhase}`) : "");

  /**
   * Anlas the pending request is expected to cost, or null outside NovelAI mode.
   *
   * Computed here rather than in the generation store because the estimate
   * needs the Opus flag from the NovelAI store, and the hub store may not
   * import a feature store. The number is an estimate, hence the leading `~`.
   */
  // The estimate needs the Opus flag, and the account record it comes from is
  // only fetched on demand. The usage readout fetches it too, but that readout
  // sits behind a display toggle, so without this the badge quotes the full
  // price of a generation Opus covers whenever the toggle is off.
  $effect(() => {
    if (generation.isNovelAi && novelai.apiKeyConfigured) void novelai.ensureSubscription();
  });

  const anlasEstimate = $derived(estimateCurrentNovelAiCost());

  /**
   * Ctrl+Enter generates -- but only when nothing is sitting on top of the
   * panel.
   *
   * The listener is on the window, so it hears the press even while a modal
   * has focus, and a modal's own Ctrl+Enter (confirm the enhance, run the
   * tool) used to fire a background generation alongside it.  Two guards,
   * because they catch different cases: `defaultPrevented` covers a handler
   * closer to the target that already claimed the press, and the overlay
   * check covers a modal whose own listener is on the window too, where which
   * of the two runs first is decided by mount order rather than by what is on
   * top.
   *
   * `[data-modal-open]` is the opt-in: a modal that owns the keyboard while it
   * is up marks its overlay with it.
   */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    if (e.defaultPrevented) return;
    if (document.querySelector("[data-modal-open]")) return;
    e.preventDefault();
    handleGenerate();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if generation.showNovelaiUsage}
  <NovelAiUsage />
{/if}

<div class="relative flex gap-3">
  <button
    onclick={handleGenerate}
    disabled={!canGenerate}
    aria-busy={preparationPhase !== null}
    title={generateButtonTitle}
    class="flex-1 py-3 rounded-xl font-semibold text-sm transition-colors
      {canGenerate
        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
        : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}"
  >
    {#if preparationPhase !== null}
      {preparationLabel}
    {:else if progress.queueCount > 0}
      {locale.t('generation.generate_queue', { count: progress.queueCount })}
    {:else if generation.resumeAppliesToMode && generation.isPaused && generation.mode === "txt2img"}
      {locale.t('generation.pause.continue', { step: String(generation.pausedEndStep), total: String(generation.steps) })}
    {:else if generation.resumeAppliesToMode && generation.isPaused && generation.pausedEditArmed && generation.mode === "inpainting"}
      {locale.t('generation.pause.continue_edit', { step: String(generation.pausedEndStep), total: String(generation.steps) })}
    {:else if orderedWildcardRunCount > 1}
      {locale.t('generation.generate_ordered', { count: orderedWildcardRunCount })}
    {:else}
      {locale.t(generation.mode === 'inpainting' ? 'generation.inpaint.generate' : 'generation.generate')}
    {/if}
    {#if anlasEstimate !== null}
      <span class="ml-2 text-[11px] font-normal opacity-80" title={locale.t('generation.novelai.cost_tip')}>
        {locale.t('generation.novelai.cost_badge', { anlas: anlasEstimate })}
      </span>
    {/if}
  </button>

  {#if progress.queueCount > 0}
    <button
      onclick={() => queue.togglePanel()}
      title={locale.t("queue.panel.title")}
      aria-label={locale.t("queue.panel.title")}
      class="px-3 py-3 rounded-xl font-semibold text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-neutral-100 transition-colors relative"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
      {#if progress.queueCount > 1}
        <span class="absolute -top-1.5 -right-1.5 min-w-4 h-4 rounded-full bg-indigo-600 text-[9px] font-bold text-white flex items-center justify-center px-0.5 pointer-events-none">
          {progress.queueCount}
        </span>
      {/if}
    </button>
    <QueuePanel />
  {/if}

  {#if progress.isGenerating || preparationPhase !== null}
    <button
      onclick={handleCancelCurrent}
      oncontextmenu={handleCancelAll}
      class="px-5 py-3 rounded-xl font-semibold text-sm bg-red-700 hover:bg-red-600 text-white transition-colors"
      aria-label={locale.t('common.cancel')}
      title={locale.t(preparationPhase !== null ? 'generation.preparation.cancel_hint' : 'generation.cancel_hint')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  {:else}
    <button
      disabled
      title={locale.t('generation.cancel_hint')}
      class="px-5 py-3 rounded-xl font-semibold text-sm bg-neutral-800 text-neutral-600 cursor-not-allowed transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  {/if}
</div>

{#if preparationPhase !== null}
  <p role="status" aria-live="polite" class="mt-1 text-center text-xs text-neutral-400">{preparationLabel}</p>
{/if}

{#if generation.isPaused && !generation.isNovelAi}
  <div class="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
    <p class="font-medium">
      {locale.t('generation.pause.banner', { step: String(generation.pausedEndStep), total: String(generation.steps) })}
    </p>
    <p class="mt-0.5 text-amber-200/70">{locale.t('generation.pause.locked_hint')}</p>
    <p class="mt-0.5 text-amber-200/70">{locale.t('generation.pause.retry_hint')}</p>
    {#if generation.pausedEditArmed && generation.mode === "inpainting"}
      <p class="mt-0.5 text-amber-100">{locale.t('generation.pause.edit_hint')}</p>
    {/if}
    <div class="mt-1 flex flex-wrap gap-3">
      {#if !(generation.pausedEditArmed && generation.mode === "inpainting")}
        <button
          type="button"
          onclick={handleEditPausedImage}
          class="underline underline-offset-2 hover:text-white transition-colors"
          title={locale.t('generation.pause.edit_tip')}
        >
          {locale.t('generation.pause.edit')}
        </button>
      {/if}
      <button
        type="button"
        onclick={() => generation.discardPausedRun()}
        class="underline underline-offset-2 hover:text-white transition-colors"
        title={locale.t('generation.pause.discard_tip')}
      >
        {locale.t('generation.pause.discard')}
      </button>
    </div>
  </div>
{/if}

{#if errorMsg}
  <p class="text-xs text-red-400 text-center mt-1">{errorMsg}</p>
{/if}
