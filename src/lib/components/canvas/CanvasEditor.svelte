<script lang="ts">
  import { untrack } from "svelte";
  import { canvas, isMaskLayer } from "../../stores/canvas.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import CanvasToolbar from "./CanvasToolbar.svelte";
  import CanvasStage from "./CanvasStage.svelte";
  import CanvasStatusBar from "./CanvasStatusBar.svelte";
  import CanvasStagingStrip from "./staging/CanvasStagingStrip.svelte";
  import { Eye, EyeOff, X } from "@lucide/svelte";

  interface Props {
    showInpaintPreviewOverlay?: boolean;
  }

  let { showInpaintPreviewOverlay = true }: Props = $props();

  let stageRef: CanvasStage | undefined = $state();
  const activeContextLayer = $derived(isMaskLayer(canvas.activeLayer) ? canvas.activeLayer : null);
  const activeContextSettings = $derived(activeContextLayer?.inpaintSettings ?? generation.inpaintSettings);
  const activeContextGrow = $derived(activeContextLayer?.maskGrow ?? generation.growMaskBy);

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
</script>

<div class="flex flex-col h-full rounded-xl border border-neutral-800 overflow-hidden">
  <CanvasToolbar />
  <div class="flex-1 min-h-0 relative">
    <CanvasStage bind:this={stageRef} />

    {#if (canvas.selectedWorkspaceSection === 'layers' && activeContextLayer) || canvas.selectedWorkspaceSection === 'control'}
      <div class="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 overflow-hidden rounded-md border border-neutral-700/70 bg-neutral-950/82 p-1 text-[10px] text-neutral-300 shadow-lg backdrop-blur-md">
        {#if activeContextLayer}
          <span class="h-2 w-2 shrink-0 rounded-full {activeContextLayer.type === 'region' ? 'bg-violet-400' : 'bg-rose-400'}"></span>
          <strong class="max-w-32 truncate px-0.5 font-medium text-neutral-100">{activeContextLayer.name}</strong>
          <span class="rounded bg-neutral-800 px-1.5 py-0.5">↗ {activeContextGrow}px</span>
          <span class="rounded bg-neutral-800 px-1.5 py-0.5">◌ {activeContextSettings.mask_blur}px</span>
          {#if activeContextSettings.area === 'masked'}<span class="rounded bg-neutral-800 px-1.5 py-0.5">□ +{activeContextSettings.padding}px</span>{/if}
          <span class="rounded bg-neutral-800 px-1.5 py-0.5">{activeContextLayer.type === 'region' ? (activeContextLayer.regionalStrength ?? 1).toFixed(2) : (activeContextLayer.denoise ?? generation.denoise).toFixed(2)}</span>
        {:else}
          <span class="h-2 w-2 shrink-0 rounded-full bg-cyan-400"></span>
          <strong class="font-medium text-neutral-100">ControlNet</strong>
          <span class="rounded bg-neutral-800 px-1.5 py-0.5">{generation.controlnetStrength.toFixed(2)}</span>
          <span class="relative h-1.5 w-24 overflow-hidden rounded-full bg-neutral-700" title={`${Math.round(generation.controlnetStartPercent * 100)}–${Math.round(generation.controlnetEndPercent * 100)}%`}>
            <span class="absolute inset-y-0 rounded-full bg-cyan-400" style={`left:${generation.controlnetStartPercent * 100}%;right:${100 - generation.controlnetEndPercent * 100}%`}></span>
          </span>
          <span class="tabular-nums text-neutral-400">{Math.round(generation.controlnetStartPercent * 100)}–{Math.round(generation.controlnetEndPercent * 100)}%</span>
        {/if}
        <button type="button" class="pointer-events-auto ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-white" onclick={() => canvas.showLayerContext = !canvas.showLayerContext} title={locale.t(canvas.showLayerContext ? 'canvas.hide_context_preview' : 'canvas.show_context_preview')}>
          {#if canvas.showLayerContext}<Eye size={13} />{:else}<EyeOff size={13} />{/if}
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

    {#if canvas.canApplyInpaintResult && !progress.isGenerating}
      <div class="absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 pointer-events-none">
        <div class="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-lg border border-neutral-700/80 bg-neutral-950/90 p-1.5 pl-3 shadow-2xl backdrop-blur-sm">
          <span class="text-xs text-neutral-300">{locale.t('canvas.inpaint_result_ready')}</span>
          <button
            onclick={() => canvas.applyInpaintResult()}
            class="h-7 rounded-md border border-emerald-500 bg-emerald-600/25 px-3 text-xs font-medium text-emerald-100 hover:border-emerald-400 hover:bg-emerald-600/40"
            title={locale.t('canvas.apply_inpaint_title')}
          >
            {locale.t('canvas.result_base')}
          </button>
          <button type="button" onclick={() => canvas.insertInpaintResult(false)} class="h-7 rounded-md border border-neutral-600 px-2.5 text-xs text-neutral-200 hover:border-neutral-400">{locale.t('canvas.result_full')}</button>
          <button type="button" onclick={() => canvas.insertInpaintResult(true)} class="h-7 rounded-md border border-neutral-600 px-2.5 text-xs text-neutral-200 hover:border-neutral-400">{locale.t('canvas.result_masked')}</button>
          <button type="button" onclick={() => canvas.dismissInpaintResult()} class="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" title={locale.t('canvas.dismiss')}><X size={14} /></button>
        </div>
      </div>
    {/if}
  </div>
  <CanvasStagingStrip />
  <CanvasStatusBar />
</div>
