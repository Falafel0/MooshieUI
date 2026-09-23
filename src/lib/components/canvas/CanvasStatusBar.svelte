<script lang="ts">
  import { canvas } from "../../stores/canvas.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  const maskCount = $derived(canvas.layers.filter((layer) => layer.type === 'mask').length);
  const regionCount = $derived(canvas.layers.filter((layer) => layer.type === 'region').length);
</script>

<div class="flex h-7 items-center justify-between gap-2 border-t border-neutral-800 bg-neutral-900 px-2 text-[10px] text-neutral-500">
  <div class="flex min-w-0 items-center gap-2.5 overflow-hidden">
    <span class="shrink-0 tabular-nums">{canvas.canvasWidth} × {canvas.canvasHeight}</span>
    {#if canvas.cursorPos}
      <span class="hidden shrink-0 tabular-nums sm:inline">X {Math.round(canvas.cursorPos.x)} · Y {Math.round(canvas.cursorPos.y)}</span>
    {/if}
    <span class="shrink-0 text-rose-300/80">M {maskCount}</span>
    <span class="shrink-0 text-violet-300/80">R {regionCount}</span>
    {#if canvas.activeLayer}
      <span class="h-1.5 w-1.5 shrink-0 rounded-full {canvas.activeLayer.type === 'region' ? 'bg-violet-400' : canvas.activeLayer.type === 'mask' ? 'bg-rose-400' : 'bg-sky-400'}"></span>
      <span class="truncate text-neutral-400">{canvas.activeLayer.name}</span>
    {/if}
  </div>
  <div class="flex shrink-0 items-center gap-0.5 border-l border-neutral-800 pl-1.5">
    <button type="button" onclick={() => canvas.zoomOut()} class="flex h-5 w-5 items-center justify-center rounded text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white" title={locale.t('canvas.zoom_out')}>−</button>
    <span class="w-10 text-center tabular-nums text-neutral-300">{canvas.zoomPercent}%</span>
    <button type="button" onclick={() => canvas.zoomIn()} class="flex h-5 w-5 items-center justify-center rounded text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white" title={locale.t('canvas.zoom_in')}>+</button>
    <button type="button" onclick={() => canvas.resetZoom()} class="h-5 rounded px-1 text-[9px] text-neutral-500 hover:bg-neutral-800 hover:text-white" title={locale.t('canvas.reset_zoom')}>1:1</button>
  </div>
</div>
