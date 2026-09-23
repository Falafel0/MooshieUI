<script lang="ts">
  import { tick } from "svelte";
  import { Eye, EyeOff, Lock, LockOpen, Check, X } from "@lucide/svelte";
  import { canvas, type CanvasLayer } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";

  let { layer, processIndex = 0 }: { layer: CanvasLayer; processIndex?: number } = $props();
  let isRenaming = $state(false);
  let renameValue = $state("");
  let renameInput: HTMLInputElement | undefined = $state();
  let selectButton: HTMLButtonElement | undefined = $state();

  const isActive = $derived(canvas.activeLayerId === layer.id);
  const thumb = $derived(canvas.layerThumbnails[layer.id]);
  const actionClass = "h-7 flex flex-1 items-center justify-center rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent";

  async function startRename() {
    canvas.setActiveLayer(layer.id);
    renameValue = layer.name;
    isRenaming = true;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }

  async function finishRename(save: boolean, restoreFocus = false) {
    // Escape closes the editor before blur; a subsequent blur must not save it.
    if (!isRenaming) return;
    isRenaming = false;
    if (save && renameValue.trim()) canvas.renameLayer(layer.id, renameValue.trim());
    if (restoreFocus) {
      await tick();
      selectButton?.focus();
    }
  }

  function handleRenameKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      void finishRename(event.key === "Enter", true);
    }
  }
</script>

<div class="rounded-md overflow-hidden border transition-colors {isActive ? 'bg-neutral-800/60 border-indigo-500/60' : 'border-transparent hover:bg-neutral-800/40'}">
  <div class="flex h-10 items-center gap-1 px-1">
    <button
      type="button"
      onclick={() => canvas.toggleLayerVisibility(layer.id)}
      class="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-indigo-400 {layer.visible ? 'text-neutral-300' : 'text-neutral-500'}"
      aria-label={layer.visible ? locale.t('canvas.hide_layer') : locale.t('canvas.show_layer')}
      aria-pressed={layer.visible}
      title={layer.visible ? locale.t('canvas.hide_layer') : locale.t('canvas.show_layer')}
    >
      {#if layer.visible}<Eye size={16} />{:else}<EyeOff size={16} />{/if}
    </button>

    {#if isRenaming}
      <input
        bind:this={renameInput}
        type="text"
        bind:value={renameValue}
        aria-label={locale.t('canvas.rename_layer')}
        onblur={(event) => {
          if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute('data-rename-action'))) void finishRename(true);
        }}
        onkeydown={handleRenameKeydown}
        class="h-7 min-w-0 flex-1 bg-neutral-800 border border-indigo-500 rounded px-2 text-xs text-neutral-200 outline-none"
      />
      <button data-rename-action type="button" class={actionClass} aria-label={locale.t('common.save')} title={locale.t('common.save')} onpointerdown={(event) => event.preventDefault()} onclick={() => finishRename(true, true)}><Check size={16} /></button>
      <button data-rename-action type="button" class={actionClass} aria-label={locale.t('common.cancel')} title={locale.t('common.cancel')} onpointerdown={(event) => event.preventDefault()} onclick={() => finishRename(false, true)}><X size={16} /></button>
    {:else}
      <button
        bind:this={selectButton}
        type="button"
        onclick={() => canvas.setActiveLayer(layer.id)}
        ondblclick={startRename}
        onkeydown={(event) => { if (event.key === 'F2') { event.preventDefault(); void startRename(); } }}
        aria-pressed={isActive}
        title={layer.name}
        class="h-9 flex flex-1 min-w-0 items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-indigo-400 {layer.visible ? '' : 'opacity-50'}"
      >
        <span
          class="relative shrink-0 w-7 h-7 rounded overflow-hidden border {layer.type === 'region' ? 'border-violet-500/50' : layer.type === 'mask' ? 'border-rose-500/50' : 'border-sky-500/40'}"
          style="background-color:#262626;background-image:linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%);background-size:8px 8px;background-position:0 0,0 4px,4px -4px,-4px 0;"
        >
          {#if thumb}<img src={thumb} alt="" class="absolute inset-0 w-full h-full object-contain" />{/if}
        </span>
        <span class="block truncate text-xs {isActive ? 'text-neutral-200' : 'text-neutral-400'}">{layer.name}</span>
        {#if processIndex > 0 && layer.type !== 'raster'}
          <span class="shrink-0 rounded bg-neutral-950/70 px-1 text-[9px] tabular-nums text-neutral-500" title={locale.t('canvas.generation_order', { n: processIndex })}>#{processIndex}</span>
        {/if}
      </button>
      <button
        type="button"
        onclick={() => canvas.toggleLayerLock(layer.id)}
        class="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-indigo-400 {layer.locked ? 'text-indigo-400' : 'text-neutral-500'}"
        aria-label={layer.locked ? locale.t('canvas.unlock_layer') : locale.t('canvas.lock_layer')}
        aria-pressed={layer.locked}
        title={layer.locked ? locale.t('canvas.unlock_layer') : locale.t('canvas.lock_layer')}
      >
        {#if layer.locked}<Lock size={15} />{:else}<LockOpen size={15} />{/if}
      </button>
    {/if}
  </div>
</div>
