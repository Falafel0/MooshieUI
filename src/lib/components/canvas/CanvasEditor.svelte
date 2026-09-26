<script lang="ts">
  import { untrack } from "svelte";
  import { canvas, isMaskLayer } from "../../stores/canvas.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import type { GenerationMode, OutputImage } from "../../types/index.js";
  import { resolveTint } from "../../utils/layerTints.js";
  import { formatGenerationTime } from "../../utils/localeFormat.js";
  import CanvasToolbar from "./CanvasToolbar.svelte";
  import ProjectBar from "./ProjectBar.svelte";
  import CanvasStage from "./CanvasStage.svelte";
  import CanvasStatusBar from "./CanvasStatusBar.svelte";
  import CanvasStagingStrip from "./staging/CanvasStagingStrip.svelte";
  import { inpaintResultStatus } from "./staging/inpaintResultStatus.svelte.js";
  import InpaintCompareDialog from "./InpaintCompareDialog.svelte";
  import { getInpaintComparePair } from "../../utils/inpaintComparePair.js";
  import { Eye, EyeOff } from "@lucide/svelte";

  interface Props {
    showInpaintPreviewOverlay?: boolean;
    oneditpatchy?: (image: OutputImage) => void;
  }

  let { showInpaintPreviewOverlay = true, oneditpatchy }: Props = $props();

  let stageRef: CanvasStage | undefined = $state();

  // Result-vs-original comparison, shown next to the result actions. The pair
  // is resolved through the canvas store's registry link (see
  // getInpaintComparePair), so the button only exists when a genuine
  // original/result pair is known — never a comparison against anything else.
  const comparePair = $derived(getInpaintComparePair());
  let compareOpen = $state(false);
  // The pair changes whenever the result is dismissed, applied or replaced by
  // a newer run. Close then: the dialog must never keep showing a pair the user
  // did not open, and reopening for the new result is one click away.
  $effect(() => {
    void comparePair;
    compareOpen = false;
  });

  // --- result card ----------------------------------------------------------
  // The pending result is held for display only: the canvas shows it as a
  // preview while the base underneath is untouched, so the card has to say so
  // before offering to apply, insert or drop it.
  //
  // Its run is described by the store's link to the session image it came from
  // (`pendingResultSourceKey` = "prompt_id:filename"), which carries the exact
  // completion clock and run time. A result whose session image is gone falls
  // back to when it arrived here rather than claiming a time it does not know.
  const resultImage = $derived(
    canvas.pendingResultSourceKey
      ? (gallery.sessionImages.find(
          (image) => `${image.prompt_id}:${image.filename}` === canvas.pendingResultSourceKey,
        ) ?? null)
      : null,
  );
  let resultArrivedAtMs = $state<number | null>(null);
  let seenResultUrl: string | null = null;
  $effect(() => {
    const url = canvas.pendingResultPreviewUrl;
    if (!url) {
      resultArrivedAtMs = null;
      return;
    }
    if (seenResultUrl === url) return;
    seenResultUrl = url;
    resultArrivedAtMs = Date.now();
  });
  const resultAt = $derived(resultImage?.generated_at_ms ?? resultArrivedAtMs);

  function modeLabel(mode: GenerationMode): string {
    const key = `generation.mode.${mode}`;
    const label = locale.t(key);
    return label === key ? mode : label;
  }

  const resultModeLabel = $derived(modeLabel(generation.mode));
  const resultSize = $derived(
    canvas.pendingResultWidth != null && canvas.pendingResultHeight != null
      ? locale.t("compare.summary.dimensions", {
          width: canvas.pendingResultWidth,
          height: canvas.pendingResultHeight,
        })
      : "",
  );
  // Which raster layers this run was composited from, by the same ids the store
  // captured at submission. `pendingResultRasterLayerIds` is a plain field, so
  // the read hangs off the pending URL — the one signal that changes with each
  // result — instead of outliving the result it describes.
  const resultLayerNames = $derived.by(() => {
    if (!canvas.pendingResultPreviewUrl) return [];
    const baked = new Set(canvas.pendingResultRasterLayerIds);
    if (baked.size === 0) return [];
    return canvas.layers.filter((layer) => baked.has(layer.id)).map((layer) => layer.name);
  });
  const resultLayerSummary = $derived(
    resultLayerNames.length > 2
      ? `${resultLayerNames.slice(0, 2).join(", ")} +${resultLayerNames.length - 2}`
      : resultLayerNames.join(", "),
  );
  const resultProvenance = $derived.by(() => {
    const parts = [resultModeLabel];
    if (resultSize) parts.push(resultSize);
    if (resultAt) parts.push(locale.formatDateTime(resultAt, { hour: "2-digit", minute: "2-digit" }));
    if (resultImage?.generationTimeMs != null) {
      parts.push(formatGenerationTime(resultImage.generationTimeMs, locale.current));
    }
    if (resultLayerSummary) parts.push(`${locale.t("canvas.layers")}: ${resultLayerSummary}`);
    return parts.join(" · ");
  });
  // Applying fits the document to the result (the store resizes the canvas to
  // the result's own size), so name that consequence before the click, not
  // after the layers have moved.
  const resultResizesDocument = $derived(
    canvas.pendingResultWidth != null &&
      canvas.pendingResultHeight != null &&
      (canvas.pendingResultWidth !== canvas.canvasWidth ||
        canvas.pendingResultHeight !== canvas.canvasHeight),
  );
  const canvasSize = $derived(
    locale.t("compare.summary.dimensions", {
      width: canvas.canvasWidth,
      height: canvas.canvasHeight,
    }),
  );
  const showResultCard = $derived(
    !progress.isGenerating && (canvas.canApplyInpaintResult || inpaintResultStatus.visible),
  );

  const activeContextLayer = $derived(isMaskLayer(canvas.activeLayer) ? canvas.activeLayer : null);
  const activeContextSettings = $derived(activeContextLayer?.inpaintSettings ?? generation.inpaintSettings);
  const activeContextGrow = $derived(activeContextLayer?.maskGrow ?? generation.growMaskBy);
  const contextPreviewVisible = $derived(activeContextLayer ? activeContextLayer.showContext !== false : canvas.showLayerContext);

  untrack(() => {
    // Initialize before CanvasStage mounts and calculates its initial fit.
    if (canvas.layers.length === 0) {
      canvas.initCanvas(generation.width, generation.height);
    }
  });

  $effect(() => {
    if (!canvas.isCanvasMode) return;

    const width = generation.width;
    const height = generation.height;

    if (canvas.layers.length === 0) {
      canvas.initCanvas(width, height);
      return;
    }

    if (canvas.canvasWidth !== width || canvas.canvasHeight !== height) {
      canvas.resizeCanvas(width, height);
    }
  });

  // Expose export functions for generation integration
  export function getRasterComposite(): HTMLCanvasElement | null {
    return stageRef?.getRasterComposite() ?? null;
  }

  export function getMaskCanvas(): HTMLCanvasElement | null {
    return stageRef?.getMaskCanvas() ?? null;
  }

  async function editPendingInPatchy() {
    const url = canvas.pendingResultPreviewUrl;
    if (!url || !oneditpatchy) return;
    const response = await fetch(url);
    const sessionBlob = await response.blob();
    oneditpatchy({ filename: `inpaint_${Date.now()}.png`, subfolder: "", type: "output", prompt_id: "inpaint-result", generation_mode: "inpainting", url, sessionBlob });
  }
</script>

<div class="flex flex-col h-full rounded-xl border border-neutral-800 overflow-hidden">
  <ProjectBar />
  <CanvasToolbar />
  <div class="flex-1 min-h-0 relative">
    <CanvasStage bind:this={stageRef} showLivePreview={false} />

    {#if (canvas.selectedWorkspaceSection === 'layers' && activeContextLayer) || canvas.selectedWorkspaceSection === 'control'}
      <div class="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-md border border-neutral-700/70 bg-neutral-950/82 p-1 text-[10px] text-neutral-300 shadow-lg backdrop-blur-md">
        {#if activeContextLayer}
          <span class="h-2 w-2 shrink-0 rounded-full" style="background: {resolveTint(activeContextLayer)}"></span>
          <strong class="max-w-32 truncate px-0.5 font-medium text-neutral-100">{activeContextLayer.name}</strong>
          {#if activeContextLayer.type === 'region'}
            <span class="rounded px-1.5 py-0.5" style="background: color-mix(in srgb, {resolveTint(activeContextLayer)} 18%, transparent); color: {resolveTint(activeContextLayer)}">{locale.t('canvas.type_region')}</span>
            <span class="rounded bg-neutral-800 px-1.5 py-0.5 tabular-nums">{(activeContextLayer.regionalStrength ?? 1).toFixed(2)}×</span>
          {:else}
            <span class="rounded bg-neutral-800 px-1.5 py-0.5 tabular-nums">{activeContextLayer.inpaintWidth ?? generation.width}×{activeContextLayer.inpaintHeight ?? generation.height}</span>
            <span class="rounded bg-neutral-800 px-1.5 py-0.5">↗ {activeContextGrow}px</span>
            <span class="rounded bg-neutral-800 px-1.5 py-0.5">◌ {activeContextSettings.mask_blur}px</span>
            {#if activeContextSettings.area === 'masked'}<span class="rounded bg-neutral-800 px-1.5 py-0.5 tabular-nums">↔ {activeContextSettings.context_padding_x ?? activeContextSettings.padding}px · ↕ {activeContextSettings.context_padding_y ?? activeContextSettings.padding}px</span>{/if}
          {/if}
          {#if activeContextLayer.type === 'mask'}<span class="rounded bg-neutral-800 px-1.5 py-0.5" title={locale.t('generation.image.denoise')}>{(activeContextLayer.denoise ?? generation.denoise).toFixed(2)}</span>{/if}
        {:else}
          <span class="h-2 w-2 shrink-0 rounded-full bg-cyan-400"></span>
          <strong class="font-medium text-neutral-100">ControlNet</strong>
          <span class="rounded bg-neutral-800 px-1.5 py-0.5">{generation.controlnetStrength.toFixed(2)}</span>
          <span class="relative h-1.5 w-24 overflow-hidden rounded-full bg-neutral-700" title={`${Math.round(generation.controlnetStartPercent * 100)}–${Math.round(generation.controlnetEndPercent * 100)}%`}>
            <span class="absolute inset-y-0 rounded-full bg-cyan-400" style={`left:${generation.controlnetStartPercent * 100}%;right:${100 - generation.controlnetEndPercent * 100}%`}></span>
          </span>
          <span class="tabular-nums text-neutral-400">{Math.round(generation.controlnetStartPercent * 100)}–{Math.round(generation.controlnetEndPercent * 100)}%</span>
        {/if}
        <button type="button" class="pointer-events-auto ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-white" onclick={() => activeContextLayer ? canvas.toggleLayerContext(activeContextLayer.id) : canvas.showLayerContext = !canvas.showLayerContext} title={locale.t(contextPreviewVisible ? 'canvas.hide_context_preview' : 'canvas.show_context_preview')}>
          {#if contextPreviewVisible}<Eye size={13} />{:else}<EyeOff size={13} />{/if}
        </button>
      </div>
    {/if}

    {#if showInpaintPreviewOverlay && generation.mode === "inpainting" && progress.isGenerating}
      <div class="absolute inset-0 z-20 pointer-events-none">
        <div class="absolute inset-0 bg-black/15"></div>

        <div class="absolute right-4 top-4 w-full max-w-md rounded-xl border border-neutral-700/80 bg-neutral-950/88 shadow-2xl backdrop-blur-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-neutral-800 flex items-center justify-between gap-3">
            <div class="text-sm font-medium text-neutral-100">{locale.t('canvas.inpainting_preview')}</div>
            <div class="text-xs text-neutral-400 text-right">{progress.phaseLabel || locale.t("progress.generating")}</div>
          </div>

          <div class="p-3">
            <div class="aspect-video rounded-lg border border-neutral-800 bg-neutral-900 flex items-center justify-center overflow-hidden">
              {#if progress.displayImage}
                <img
                  src={progress.displayImage}
                  alt={locale.t("canvas.inpaint_preview_alt")}
                  class="w-full h-full object-contain"
                />
              {:else}
                <div class="flex flex-col items-center gap-2 text-neutral-400">
                  <div class="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <span class="text-xs">{locale.t('canvas.waiting_preview')}</span>
                </div>
              {/if}
            </div>

            <div class="mt-3">
              <div class="h-2 rounded-full bg-neutral-800 overflow-hidden">
                <div
                  class="h-full bg-indigo-500 transition-[width] duration-200"
                  style="width: {Math.max(2, progress.percentage)}%"
                ></div>
              </div>
              <div class="mt-1 text-[11px] text-neutral-500 text-right">
                {progress.currentStep} / {progress.totalSteps || "?"} {locale.t("progress.steps_suffix")}
              </div>
            </div>
          </div>
        </div>
      </div>
    {/if}

    {#if showResultCard}
      <div class="absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 pointer-events-none">
        <div class="pointer-events-auto w-full max-w-xl overflow-hidden rounded-xl bg-neutral-950/92 shadow-2xl backdrop-blur-sm {canvas.canApplyInpaintResult ? 'border border-neutral-700/80' : 'border border-emerald-800/70'}">
          {#if canvas.canApplyInpaintResult}
            <!-- What this result is, which run it belongs to, and what each
                 action does. The card is the one place a finished run explains
                 itself; the staging strip below only tracks which result is in
                 hand. -->
            <div class="flex items-start gap-2.5 px-3 py-2">
              {#if canvas.pendingResultPreviewUrl}
                <img
                  src={canvas.pendingResultPreviewUrl}
                  alt={locale.t("canvas.result_layer")}
                  class="h-11 w-11 shrink-0 rounded border border-indigo-500/60 object-cover"
                />
              {/if}
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="text-xs font-semibold text-neutral-100">{locale.t("canvas.result_title")}</span>
                  <span
                    class="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-200"
                    title={locale.t("canvas.result_preview_note")}
                  >{locale.t("canvas.result_status_preview")}</span>
                </div>
                <p class="mt-0.5 truncate text-[10px] text-neutral-400" title={resultProvenance}>{resultProvenance}</p>
              </div>
            </div>

            {#if resultResizesDocument}
              <!-- Applying a differently sized result reshapes the document
                   underneath the layers the user already painted. -->
              <p class="border-t border-amber-800/50 bg-amber-950/40 px-3 py-1.5 text-[10px] text-amber-200">
                {locale.t("canvas.result_size_note", { result: resultSize, canvas: canvasSize })}
              </p>
            {/if}

            <div class="grid gap-x-3 gap-y-2 border-t border-neutral-800 px-3 py-2 sm:grid-cols-2">
              <div class="min-w-0">
                <button
                  type="button"
                  onclick={() => inpaintResultStatus.applyToBase()}
                  class="h-8 w-full rounded-md border border-emerald-500 bg-emerald-600/25 px-3 text-xs font-medium text-emerald-100 hover:border-emerald-400 hover:bg-emerald-600/40 focus-visible:outline-2 focus-visible:outline-emerald-400"
                  title={locale.t("canvas.apply_inpaint_title")}
                >
                  {locale.t("canvas.result_base")}
                </button>
                <p class="mt-1 text-[10px] leading-snug text-neutral-500">{locale.t("canvas.result_base_hint")}</p>
              </div>
              <div class="min-w-0">
                <div class="flex gap-1.5">
                  <button
                    type="button"
                    onclick={() => canvas.insertInpaintResult(false)}
                    class="h-8 min-w-0 flex-1 truncate rounded-md border border-neutral-600 px-2 text-xs text-neutral-200 hover:border-neutral-400 hover:bg-neutral-800/60 focus-visible:outline-2 focus-visible:outline-neutral-400"
                    title={locale.t("canvas.result_full_hint")}
                  >
                    {locale.t("canvas.result_full")}
                  </button>
                  <button
                    type="button"
                    onclick={() => canvas.insertInpaintResult(true)}
                    class="h-8 min-w-0 flex-1 truncate rounded-md border border-neutral-600 px-2 text-xs text-neutral-200 hover:border-neutral-400 hover:bg-neutral-800/60 focus-visible:outline-2 focus-visible:outline-neutral-400"
                    title={locale.t("canvas.result_masked_hint")}
                  >
                    {locale.t("canvas.result_masked")}
                  </button>
                </div>
                <p class="mt-1 text-[10px] leading-snug text-neutral-500">{locale.t("canvas.result_insert_hint")}</p>
              </div>
            </div>

            <!-- Reviewing, saving and dropping the result. The base-changing
                 actions above stay apart from these. -->
            <div class="flex flex-wrap items-center gap-1.5 border-t border-neutral-800 px-3 py-2">
              {#if comparePair}
                <!-- Only rendered while a genuine original/result pair exists: the
                     button never leads to a comparison against anything else. -->
                <button
                  type="button"
                  aria-expanded={compareOpen}
                  class="h-7 rounded-md border border-indigo-500/60 bg-indigo-500/10 px-2.5 text-xs font-medium text-indigo-200 hover:border-indigo-400 hover:bg-indigo-500/20 focus-visible:outline-2 focus-visible:outline-indigo-400"
                  title={locale.t("canvas.compare_with_original")}
                  onclick={() => (compareOpen = true)}
                >
                  {locale.t("canvas.compare_with_original")}
                </button>
              {/if}
              <span class="flex-1"></span>
              <button
                type="button"
                disabled={gallery.saving}
                onclick={() => canvas.pendingResultPreviewUrl && gallery.saveBlobAs(canvas.pendingResultPreviewUrl, `inpaint_${Date.now()}.png`)}
                class="h-7 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 disabled:opacity-50"
              >
                {locale.t("canvas.save_result")}
              </button>
              {#if oneditpatchy}
                <button
                  type="button"
                  onclick={editPendingInPatchy}
                  class="h-7 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:border-violet-500 hover:text-violet-200"
                >
                  {locale.t("canvas.open_patchy")}
                </button>
              {/if}
              <button
                type="button"
                onclick={() => canvas.dismissInpaintResult()}
                class="h-7 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:border-red-500 hover:text-red-300"
                title={locale.t("canvas.result_discard_hint")}
              >
                {locale.t("canvas.discard")}
              </button>
            </div>
          {:else}
            <!-- Where an applied result went, kept standing until the base is
                 stepped back (stepping it back makes the line untrue). -->
            <div class="flex items-center gap-2 px-3 py-2">
              <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"></span>
              <p class="min-w-0 flex-1 truncate text-xs text-neutral-200">
                {locale.t("canvas.result_applied")}
                {#if inpaintResultStatus.appliedAt}
                  <span class="text-neutral-500">· {locale.formatDateTime(inpaintResultStatus.appliedAt, { hour: "2-digit", minute: "2-digit" })}</span>
                {/if}
              </p>
              <button
                type="button"
                onclick={() => canvas.undoInpaintBase()}
                class="h-7 shrink-0 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:border-indigo-500 hover:text-indigo-300"
                title={locale.t("canvas.undo_inpaint")}
              >
                {locale.t("canvas.undo_inpaint")}
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
  <CanvasStagingStrip />
  <CanvasStatusBar />

  {#if compareOpen && comparePair}
    <InpaintCompareDialog
      originalUrl={comparePair.originalUrl}
      resultUrl={comparePair.resultUrl}
      onclose={() => (compareOpen = false)}
    />
  {/if}
</div>
