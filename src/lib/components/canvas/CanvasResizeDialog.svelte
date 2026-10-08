<script lang="ts">
  import { canvas } from '../../stores/canvas.svelte.js';
  import { progress } from '../../stores/progress.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { documentResizeTransform, resizedPlacement, type CanvasResizeOptions } from '../../utils/canvasResize.js';
  import { Lock, LockOpen, X } from '@lucide/svelte';

  const originalWidth = canvas.canvasWidth, originalHeight = canvas.canvasHeight;
  const originalRatio = originalWidth / originalHeight;
  let width = $state(originalWidth), height = $state(originalHeight);
  let mode = $state<CanvasResizeOptions['mode']>('bounds');
  let locked = $state(true);
  let anchor = $state<NonNullable<CanvasResizeOptions['anchor']>>({ x: 0.5, y: 0.5 });
  let busy = $state(false), error = $state('');
  const anchors = [
    { x: 0, y: 0, key: 'top_left' }, { x: 0.5, y: 0, key: 'top' }, { x: 1, y: 0, key: 'top_right' },
    { x: 0, y: 0.5, key: 'left' }, { x: 0.5, y: 0.5, key: 'center' }, { x: 1, y: 0.5, key: 'right' },
    { x: 0, y: 1, key: 'bottom_left' }, { x: 0.5, y: 1, key: 'bottom' }, { x: 1, y: 1, key: 'bottom_right' },
  ] as const;
  const valid = $derived([width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 16384));
  const changed = $derived(width !== originalWidth || height !== originalHeight);
  const canApply = $derived(valid && changed && !busy && !progress.isGenerating);
  const preview = $derived(valid ? resizedPlacement({ x: 0, y: 0, width: originalWidth, height: originalHeight }, documentResizeTransform(originalWidth, originalHeight, width, height, { mode, anchor })) : null);

  function setSize(side: 'width' | 'height', value: number) {
    error = '';
    if (side === 'width') {
      width = value;
      if (mode === 'scale' && locked) height = Math.round(value / originalRatio);
    } else {
      height = value;
      if (mode === 'scale' && locked) width = Math.round(value * originalRatio);
    }
  }
  function setMode(next: CanvasResizeOptions['mode']) {
    mode = next; error = '';
    if (mode === 'scale' && locked) height = Math.round(width / originalRatio);
  }
  function toggleLock() {
    locked = !locked;
    if (locked) height = Math.round(width / originalRatio);
  }
  function close() { if (!busy) canvas.resizeDialogOpen = false; }
  async function apply() {
    if (!canApply) return;
    busy = true; error = '';
    try {
      const result = await canvas.resizeDocument(width, height, { mode, anchor });
      if (result.error) error = result.error;
      else canvas.resizeDialogOpen = false;
    } finally { busy = false; }
  }
  function openDialog(node: HTMLDialogElement) {
    const previous = document.activeElement;
    node.showModal();
    return { destroy() { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); } };
  }
</script>

<dialog use:openDialog oncancel={event => { event.preventDefault(); close(); }} onkeydown={event => event.stopPropagation()} aria-modal="true" aria-labelledby="canvas-resize-title" class="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-ui-border bg-ui-surface p-0 text-neutral-200 shadow-2xl backdrop:bg-black/75">
  <form onsubmit={event => { event.preventDefault(); void apply(); }}>
    <header class="flex items-center justify-between border-b border-ui-border px-5 py-4">
      <div><h2 id="canvas-resize-title" class="text-sm font-semibold text-neutral-100">{locale.t('canvas.resize_document')}</h2><p class="mt-1 text-xs tabular-nums text-neutral-500">{originalWidth} × {originalHeight} px</p></div>
      <button type="button" onclick={close} disabled={busy} aria-label={locale.t('common.close')} class="ui-focus flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-ui-hover"><X size={17}/></button>
    </header>
    <div class="space-y-4 px-5 py-4">
      <div class="grid grid-cols-2 gap-2">
        {#each ['bounds', 'scale'] as option}
          <button type="button" aria-label={locale.t('canvas.resize_mode_' + option)} aria-pressed={mode === option} onclick={() => setMode(option as CanvasResizeOptions['mode'])} disabled={busy} class="ui-focus rounded-lg border p-3 text-left {mode === option ? 'border-ui-accent bg-ui-selected' : 'border-ui-border hover:bg-ui-hover'}">
            <span class="block text-xs font-medium {mode === option ? 'text-ui-accent' : 'text-neutral-200'}">{locale.t('canvas.resize_mode_' + option)}</span>
            <span class="mt-1 block text-[11px] leading-snug text-neutral-400">{locale.t('canvas.resize_mode_' + option + '_hint')}</span>
          </button>
        {/each}
      </div>
      <div class="flex items-end gap-3">
        <label class="min-w-0 flex-1 text-xs text-neutral-400">{locale.t('generation.dimensions.width')}
          <input aria-label={locale.t('generation.dimensions.width')} type="number" min="64" max="16384" step="1" value={width} oninput={event => setSize('width', event.currentTarget.valueAsNumber)} disabled={busy} class="ui-control ui-focus mt-1 w-full rounded-md border border-ui-border bg-neutral-950 px-3 tabular-nums text-neutral-100"/>
        </label>
        <span class="pb-2 text-neutral-500" aria-hidden="true">×</span>
        <label class="min-w-0 flex-1 text-xs text-neutral-400">{locale.t('generation.dimensions.height')}
          <input aria-label={locale.t('generation.dimensions.height')} type="number" min="64" max="16384" step="1" value={height} oninput={event => setSize('height', event.currentTarget.valueAsNumber)} disabled={busy} class="ui-control ui-focus mt-1 w-full rounded-md border border-ui-border bg-neutral-950 px-3 tabular-nums text-neutral-100"/>
        </label>
        <span class="pb-2 text-xs text-neutral-500">px</span>
        {#if mode === 'scale'}<button type="button" aria-label={locale.t('canvas.resize_lock_aspect')} title={locale.t('canvas.resize_lock_aspect')} aria-pressed={locked} onclick={toggleLock} disabled={busy} class="ui-control ui-focus flex w-9 shrink-0 items-center justify-center rounded-md border border-ui-border {locked ? 'bg-ui-selected text-ui-accent' : 'text-neutral-400 hover:bg-ui-hover'}">{#if locked}<Lock size={16}/>{:else}<LockOpen size={16}/>{/if}</button>{/if}
      </div>
      <div class="flex items-center gap-5 rounded-lg border border-ui-border bg-neutral-950/40 p-3">
        <div class="flex h-28 min-w-0 flex-1 items-center justify-center overflow-hidden">
          {#if preview}
            <svg aria-label={locale.t('canvas.resize_preview')} role="img" viewBox="0 0 {width} {height}" class="h-full max-w-full border border-neutral-500 bg-neutral-800" preserveAspectRatio="xMidYMid meet" style="aspect-ratio: {width}/{height}">
              <rect x={preview.x} y={preview.y} width={preview.width} height={preview.height} fill="currentColor" class="text-ui-accent" opacity="0.25"/>
              <rect x={preview.x} y={preview.y} width={preview.width} height={preview.height} fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" class="text-ui-accent"/>
            </svg>
          {/if}
        </div>
        {#if mode === 'bounds'}
          <div><p class="mb-2 text-[11px] text-neutral-400">{locale.t('canvas.resize_anchor')}</p><div class="grid grid-cols-3 gap-1" role="group" aria-label={locale.t('canvas.resize_anchor')}>
            {#each anchors as item}
              <button type="button" aria-label={locale.t('canvas.resize_anchor_' + item.key)} title={locale.t('canvas.resize_anchor_' + item.key)} aria-pressed={anchor.x === item.x && anchor.y === item.y} onclick={() => anchor = { x: item.x, y: item.y }} disabled={busy} class="ui-focus flex h-7 w-7 items-center justify-center rounded border {anchor.x === item.x && anchor.y === item.y ? 'border-ui-accent bg-ui-selected text-ui-accent' : 'border-ui-border text-neutral-500 hover:bg-ui-hover'}"><span class="h-1.5 w-1.5 rounded-sm bg-current" aria-hidden="true"></span></button>
            {/each}
          </div></div>
        {:else}<div class="min-w-24 text-xs tabular-nums text-neutral-300"><p>{Number.isFinite(width) ? Math.round(width / originalWidth * 100) : '—'}% × {Number.isFinite(height) ? Math.round(height / originalHeight * 100) : '—'}%</p><p class="mt-2 text-[11px] text-neutral-500">{locale.t('canvas.resize_all_layers')}</p></div>{/if}
      </div>
      <p class="text-[11px] leading-relaxed text-neutral-500">{locale.t(mode === 'bounds' ? 'canvas.resize_bounds_note' : 'canvas.resize_scale_note')}</p>
      {#if error}<p role="alert" class="rounded-md border border-red-900/60 bg-red-950/20 p-2 text-xs text-red-300">{error}</p>{:else if !valid}<p role="alert" class="text-xs text-red-300">{locale.t('canvas.resize_invalid_size')}</p>{/if}
    </div>
    <footer class="flex items-center justify-end gap-2 border-t border-ui-border px-5 py-3">
      <button type="button" onclick={close} disabled={busy} class="ui-control ui-focus rounded-md px-3 text-xs text-neutral-400 hover:bg-ui-hover">{locale.t('common.cancel')}</button>
      <button type="submit" disabled={!canApply} class="ui-control ui-focus rounded-md bg-indigo-600 px-4 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40">{busy ? locale.t('common.loading') : locale.t('common.apply')}</button>
    </footer>
  </form>
</dialog>
