<script lang="ts">
  import ContextMenu from "../../ui/ContextMenu.svelte";
  import { tick } from "svelte";
  import { Eye, EyeOff, Lock, LockOpen, Check, X, Power, Image as ImageIcon, Network, Scan, SquareDashed } from "@lucide/svelte";
  import { canvas, type CanvasLayer } from "../../../stores/canvas.svelte.js";
  import { generation } from "../../../stores/generation.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import { resolveTint } from "../../../utils/layerTints.js";

  let { layer, processIndex = 0 }: { layer: CanvasLayer; processIndex?: number } = $props();
  let isRenaming = $state(false);
  let renameValue = $state("");
  let renameInput: HTMLInputElement | undefined = $state();
  let selectButton: HTMLButtonElement | undefined = $state();

  let menuOpen = $state(false);
  let menuPosition = $state({x:0, y:0});
  let dropEdge = $state<'top' | 'bottom' | null>(null);
  const layerDragType = 'application/x-mooshie-layer';

  function handleLayerDrag(event: DragEvent) {
    if (!event.dataTransfer || layer.locked) { event.preventDefault(); return; }
    canvas.setActiveLayer(layer.id);
    event.stopPropagation();
    event.dataTransfer.setData(layerDragType, layer.id);
    event.dataTransfer.effectAllowed = 'move';
  }
  function handleLayerDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(layerDragType)) return;
    const source = canvas.activeLayer;
    if (!source || source.type !== layer.type || source.id === layer.id || source.locked) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropEdge = event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
  }
  function handleLayerDrop(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(layerDragType)) return;
    event.preventDefault(); event.stopPropagation();
    canvas.moveLayerTo(event.dataTransfer.getData(layerDragType), layer.id, dropEdge === 'bottom');
    dropEdge = null;
  }
  function openMenu(event: MouseEvent | KeyboardEvent) {
    event.preventDefault(); event.stopPropagation();
    canvas.setActiveLayer(layer.id);
    const rect = selectButton?.getBoundingClientRect();
    menuPosition = event instanceof MouseEvent ? {x:event.clientX, y:event.clientY} : {x:rect?.left ?? 0, y:rect?.bottom ?? 0};
    menuOpen = true;
  }
  const menuItems = $derived([
    {label:locale.t('canvas.rename_layer'), action:() => {void startRename();}},
    {label:locale.t('canvas.duplicate'), action:() => {canvas.duplicateLayer(layer.id);}},
    {label:locale.t(layer.type === 'region' || layer.type === 'controlnet' ? layer.visible ? 'canvas.disable_modifier' : 'canvas.enable_modifier' : layer.visible ? 'canvas.hide_layer' : 'canvas.show_layer'), action:() => {if (layer.type === 'controlnet' || layer.type === 'region') canvas.toggleModifier(layer.id); else canvas.toggleLayerVisibility(layer.id);}},
    {label:locale.t(layer.locked ? 'canvas.unlock_layer' : 'canvas.lock_layer'), action:() => {canvas.toggleLayerLock(layer.id);}},
    {label:locale.t('canvas.delete_layer'), disabled:!canvas.canDeleteActiveLayer, destructive:true, separator:true, action:() => {canvas.removeLayer(layer.id);}},
  ]);
  const isModifier = $derived(layer.type === 'controlnet' || layer.type === 'region');
  const participating = $derived(layer.visible && (layer.type !== 'controlnet' || layer.controlnet?.enabled));
  const participationLabel = $derived(locale.t(isModifier ? participating ? 'canvas.disable_modifier' : 'canvas.enable_modifier' : layer.visible ? 'canvas.hide_layer' : 'canvas.show_layer'));
  const isActive = $derived(canvas.activeLayerId === layer.id);
  const thumb = $derived(layer.type === "controlnet" ? layer.controlnetPreviewUrl ?? layer.controlnet?.sourceData ?? null : canvas.layerThumbnails[layer.id]);
  const summary = $derived(layer.type === 'mask'
    ? `${locale.t('generation.image.denoise')} ${locale.formatDecimal(layer.denoise ?? generation.denoise, 2)} · ${locale.formatPercent((layer.coverage ?? 1) * 100, 0)}`
    : layer.type === 'region' ? layer.regionalPrompt?.trim() || locale.t('generation.regional.prompt_placeholder')
    : layer.type === 'controlnet' ? layer.controlnet?.model || locale.t('generation.controlnet.select_model')
    : layer.image ? `${Math.round(layer.image.width)} × ${Math.round(layer.image.height)} · ${locale.formatPercent(layer.opacity * 100, 0)}` : locale.formatPercent(layer.opacity * 100, 0));
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

  async function handleSelectionKeydown(event: KeyboardEvent) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { void openMenu(event); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); canvas.duplicateLayer(layer.id); return; }
    if (event.key === "F2") {
      event.preventDefault();
      void startRename();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const nodes = Array.from(selectButton?.closest('[data-document-layer-list]')?.querySelectorAll<HTMLButtonElement>('[data-layer-id]') ?? []);
    const layers = nodes.map(node => ({id:node.dataset.layerId!}));
    const index = layers.findIndex(item => item.id === layer.id);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? layers.length - 1 : Math.max(0, Math.min(layers.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
    const next = layers[nextIndex];
    if (!next) return;
    canvas.setActiveLayer(next.id);
    const list = selectButton?.closest("[data-document-layer-list]");
    await tick();
    Array.from(list?.querySelectorAll<HTMLButtonElement>("[data-layer-id]") ?? []).find(button => button.dataset.layerId === next.id)?.focus({ preventScroll: true });
  }

  function handleRenameKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      void finishRename(event.key === "Enter", true);
    }
  }
</script>

<div class="relative rounded-md border transition-colors {dropEdge === 'top' ? 'border-t-ui-accent' : dropEdge === 'bottom' ? 'border-b-ui-accent' : ''} {isActive ? 'bg-neutral-800/60 border-indigo-500/60' : 'border-transparent hover:bg-neutral-800/40'}">
  <div class="flex items-center gap-1 px-1 {isModifier ? 'h-11' : 'h-12'}">
    <button
      type="button"
      onclick={() => isModifier ? canvas.toggleModifier(layer.id) : canvas.toggleLayerVisibility(layer.id)}
      class="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-indigo-400 {participating ? 'text-neutral-300' : 'text-neutral-500'}"
      aria-label={participationLabel}
      aria-pressed={participating}
      title={participationLabel}
    >
      {#if isModifier}<Power size={15} class={participating ? 'text-ui-accent' : ''} />{:else if layer.visible}<Eye size={16} />{:else}<EyeOff size={16} />{/if}
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
        onkeydown={handleSelectionKeydown}
        data-layer-id={layer.id}
        draggable={!layer.locked}
        ondragstart={handleLayerDrag}
        ondragover={handleLayerDragOver}
        ondragleave={() => dropEdge = null}
        ondrop={handleLayerDrop}
        ondragend={() => dropEdge = null}
        oncontextmenu={openMenu}
        aria-pressed={isActive}
        title={layer.name}
        class="h-11 flex flex-1 min-w-0 items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-indigo-400 {participating ? '' : 'opacity-50'}"
      >
        <span
          class="relative shrink-0 w-8 h-8 overflow-hidden border {isModifier ? 'rounded-lg border-dashed' : 'rounded'}"
          style="border-color: {resolveTint(layer)}; background-color:#262626; background-image:linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%); background-size:8px 8px; background-position:0 0,0 4px,4px -4px,-4px 0;"
        >
          {#if thumb}<img src={thumb} alt="" class="absolute inset-0 w-full h-full object-contain" />{/if}
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5 text-xs {isActive ? 'text-neutral-100' : 'text-neutral-300'}">
            <span class="shrink-0" style="color: {resolveTint(layer)}" aria-hidden="true">{#if layer.type === 'controlnet'}<Network size={12} />{:else if layer.type === 'mask'}<SquareDashed size={12} />{:else if layer.type === 'region'}<Scan size={12} />{:else}<ImageIcon size={12} />{/if}</span>
            <span class="truncate">{layer.name}</span>
          </span>
          <span class="mt-0.5 flex items-center gap-1 text-[10px] text-neutral-500"><span class="min-w-0 flex-1 truncate" title={summary}>{summary}</span>{#if layer.type === 'controlnet' || layer.type === 'region'}<span class="shrink-0 tabular-nums">×{locale.formatDecimal(layer.type === 'controlnet' ? layer.controlnet?.strength ?? 1 : layer.regionalStrength ?? 1, 2)}</span>{/if}</span>
        </span>
        {#if processIndex > 0 && layer.type === 'mask'}
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

<ContextMenu items={menuItems} x={menuPosition.x} y={menuPosition.y} visible={menuOpen} onclose={() => menuOpen = false} />
