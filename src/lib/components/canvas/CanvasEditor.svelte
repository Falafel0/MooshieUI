<script lang="ts">
  import { untrack } from "svelte";
  import { canvas, isMaskLayer } from "../../stores/canvas.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import type { OutputImage } from "../../types/index.js";
  import CanvasToolbar from "./CanvasToolbar.svelte";
  import CanvasStage from "./CanvasStage.svelte";
  import CanvasStatusBar from "./CanvasStatusBar.svelte";
  import CanvasStagingStrip from "./staging/CanvasStagingStrip.svelte";
  import { Eye, EyeOff, X } from "@lucide/svelte";

  interface Props {
    showInpaintPreviewOverlay?: boolean;
    oneditphotopea?: (image: OutputImage) => void;
  }

  let { showInpaintPreviewOverlay = true, oneditphotopea }: Props = $props();

  let stageRef: CanvasStage | undefined = $state();
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

  async function editPendingInPhotopea() {
    const url = canvas.pendingResultPreviewUrl;
    if (!url || !oneditphotopea) return;
    const response = await fetch(url);
    const sessionBlob = await response.blob();
    oneditphotopea({ filename: `inpaint_${Date.now()}.png`, subfolder: "", type: "output", prompt_id: "inpaint-result", generation_mode: "inpainting", url, sessionBlob });
  }
</script>

<div class="flex flex-col h-full rounded-xl border border-neutral-800 overflow-hidden">
  <CanvasToolbar />
  <div class="flex-1 min-h-0 relative">
    <CanvasStage bind:this={stageRef} showLivePreview={showInpaintPreviewOverlay} />

    {#if (canvas.selectedWorkspaceSection === 'layers' && activeContextLayer) || canvas.selectedWorkspaceSection === 'control'}
      <div class="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-md border border-neutral-700/70 bg-neutral-950/82 p-1 text-[10px] text-neutral-300 shadow-lg backdrop-blur-md">
        {#if activeContextLayer}
          <span class="h-2 w-2 shrink-0 rounded-full {activeContextLayer.type === 'region' ? 'bg-violet-400' : 'bg-rose-400'}"></span>
          <strong class="max-w-32 truncate px-0.5 font-medium text-neutral-100">{activeContextLayer.name}</strong>
          {#if activeContextLayer.type === 'region'}
            <span class="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-200">{locale.t('generation.regional.strategy_conditioning')}</span>
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
      <div class="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2 rounded-md border border-indigo-500/40 bg-neutral-950/82 px-2 py-1.5 text-[10px] shadow-lg backdrop-blur-md">
        <span class="h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent"></span>
        <span class="max-w-44 truncate text-neutral-200">{progress.phaseLabel || locale.t("progress.generating")}</span>
        <span class="relative h-1.5 w-20 overflow-hidden rounded-full bg-neutral-700"><span class="absolute inset-y-0 left-0 rounded-full bg-indigo-400 transition-[width]" style={`width:${Math.max(2, progress.percentage)}%`}></span></span>
        <span class="tabular-nums text-neutral-400">{progress.currentStep}/{progress.totalSteps || "?"}</span>
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
          <span class="mx-0.5 h-5 w-px bg-neutral-700"></span>
          <button type="button" disabled={gallery.saving} onclick={() => canvas.pendingResultPreviewUrl && gallery.saveBlobAs(canvas.pendingResultPreviewUrl, `inpaint_${Date.now()}.png`)} class="h-7 rounded-md border border-sky-600/70 bg-sky-500/10 px-2.5 text-xs font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-50">{locale.t('canvas.save_result')}</button>
          {#if oneditphotopea}<button type="button" onclick={editPendingInPhotopea} class="h-7 rounded-md border border-violet-600/70 bg-violet-500/10 px-2.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20">{locale.t('canvas.open_photopea')}</button>{/if}
          <button type="button" onclick={() => canvas.dismissInpaintResult()} class="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" title={locale.t('canvas.dismiss')}><X size={14} /></button>
        </div>
      </div>
    {/if}
  </div>
  <CanvasStagingStrip />
  <CanvasStatusBar />
</div>
