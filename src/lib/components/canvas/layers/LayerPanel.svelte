<script lang="ts">
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import InfoTip from "../../ui/InfoTip.svelte";
  import GroupLayerList from "./GroupLayerList.svelte";
  import LayerProperties from "./LayerProperties.svelte";
  import { generation } from "../../../stores/generation.svelte.js";
  import { tick } from "svelte";
  import { ArrowUp, ArrowDown, Copy, FolderPlus, Trash2 } from "@lucide/svelte";

  let { oneditpatchy }: { oneditpatchy?: () => void } = $props();


  type GroupKey = "mask" | "raster" | "region" | "controlnet";
  let layerList: HTMLDivElement | undefined = $state();
  let addMenu: HTMLDetailsElement | undefined = $state();
  const canMoveUp = $derived(canvas.activeLayerId ? canvas.getLayerMoveTarget(canvas.activeLayerId, "up") !== null : false);
  const canMoveDown = $derived(canvas.activeLayerId ? canvas.getLayerMoveTarget(canvas.activeLayerId, "down") !== null : false);
  const groups = [
    { key: "mask" as GroupKey, addKey: "canvas.add_mask" },
    { key: "region" as GroupKey, addKey: "canvas.add_regions" },
    { key: "controlnet" as GroupKey, addKey: "generation.controlnet.add_layer" },
    { key: "raster" as GroupKey, addKey: "canvas.add_raster" },
  ];

  function addToGroup(key: GroupKey) {
    if (key === "region") canvas.addRegionLayer();
    else canvas.addLayer(key);
    if (addMenu) addMenu.open = false;
  }

  function addGroup() {
    canvas.createGroup();
    if (addMenu) addMenu.open = false;
  }

  $effect(() => {
    const id = canvas.activeLayerId;
    const groupId = canvas.activeGroupId;
    void tick().then(() => {
      if (!layerList || (id !== canvas.activeLayerId || groupId !== canvas.activeGroupId)) return;
      const row = Array.from(layerList.querySelectorAll<HTMLElement>("[data-layer-id], [data-group-id]")).find(node => id ? node.dataset.layerId === id : groupId && node.dataset.groupId === groupId);
      if (!row) return;
      // Reveal external selections without scrolling the inspector or canvas.
      const listBounds = layerList.getBoundingClientRect();
      const rowBounds = row.getBoundingClientRect();
      if (rowBounds.top < listBounds.top) layerList.scrollTop += rowBounds.top - listBounds.top - 2;
      else if (rowBounds.bottom > listBounds.bottom) layerList.scrollTop += rowBounds.bottom - listBounds.bottom + 2;
    });
  });
</script>

<svelte:window onclick={event => { if (addMenu?.open && event.target instanceof Node && !addMenu.contains(event.target)) addMenu.open = false; }} onkeydown={event => { if (event.key === "Escape" && addMenu?.open) addMenu.open = false; }} />

<div class="space-y-1.5">
  <div class="flex h-8 items-center justify-between gap-2">
    <h3 class="flex items-center gap-2 text-xs font-medium text-neutral-300">{locale.t('canvas.layers')}<span class="text-neutral-500 tabular-nums">{canvas.layers.length}</span><InfoTip text={locale.t('canvas.regions_chain_hint')} /></h3>
    <details bind:this={addMenu} class="relative">
      <summary class="ui-control flex cursor-pointer list-none items-center gap-1 rounded-md border border-ui-border px-2 text-xs text-neutral-300 hover:bg-ui-selected">+ {locale.t('common.add')}</summary>
      <div class="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg border border-ui-border bg-neutral-900 p-1 shadow-xl">
        <button type="button" onclick={addGroup} class="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-neutral-300 hover:bg-ui-selected"><FolderPlus size={14} class="shrink-0 text-neutral-400" />{locale.t('canvas.new_group')}</button>
        <div class="my-1 border-t border-neutral-800"></div>
        {#each groups as group (group.key)}
          <button type="button" onclick={() => addToGroup(group.key)} disabled={(group.key === 'region' && !generation.supportsRegionalPrompting) || (group.key === 'controlnet' && generation.isNovelAi)} class="flex min-h-8 w-full items-center rounded px-2 text-left text-xs text-neutral-300 hover:bg-ui-selected disabled:opacity-30" title={group.key === 'controlnet' && generation.isNovelAi ? locale.t('canvas.controlnet_provider_unavailable') : group.key === 'region' && !generation.supportsRegionalPrompting ? locale.t('canvas.regions_supported') : locale.t(group.addKey)}>{locale.t(group.addKey)}</button>
        {/each}
      </div>
    </details>
  </div>
  <div bind:this={layerList} class="max-h-[clamp(13rem,24dvh,22rem)] space-y-0.5 overflow-y-auto overscroll-contain rounded-md border border-ui-border p-1" data-document-layer-list>
    <GroupLayerList />
  </div>
  <div class="flex h-7 items-center justify-end gap-0.5 border-t border-neutral-800 pt-1">
    {#if oneditpatchy}<button type="button" class="mr-auto h-6 rounded px-2 text-[10px] text-violet-200 hover:bg-violet-900/30 disabled:opacity-30" disabled={!canvas.activeLayerId || canvas.activeLayer?.type === "controlnet"} onclick={oneditpatchy}>{locale.t('canvas.open_patchy')}</button>{/if}
    <button type="button" class="h-6 w-7 rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-25" disabled={!canMoveUp || !canvas.activeLayerId} onclick={() => canvas.activeLayerId && canvas.reorderLayer(canvas.activeLayerId, 'up')} aria-label={locale.t('canvas.move_up_title')} title={locale.t('canvas.move_up_title')}><ArrowUp size={14} class="mx-auto" /></button>
    <button type="button" class="h-6 w-7 rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-25" disabled={!canMoveDown || !canvas.activeLayerId} onclick={() => canvas.activeLayerId && canvas.reorderLayer(canvas.activeLayerId, 'down')} aria-label={locale.t('canvas.move_down_title')} title={locale.t('canvas.move_down_title')}><ArrowDown size={14} class="mx-auto" /></button>
    <button type="button" class="h-6 w-7 rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-25" disabled={!canvas.activeLayerId} onclick={() => canvas.activeLayerId && canvas.duplicateLayer(canvas.activeLayerId)} aria-label={locale.t('canvas.duplicate')} title={locale.t('canvas.duplicate')}><Copy size={14} class="mx-auto" /></button>
    <button type="button" class="h-6 w-7 rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-300 disabled:opacity-25" disabled={!canvas.canDeleteActiveLayer} onclick={() => canvas.activeLayerId && canvas.removeLayer(canvas.activeLayerId)} aria-label={locale.t('canvas.delete_layer')} title={locale.t('canvas.delete_layer')}><Trash2 size={14} class="mx-auto" /></button>
  </div>
  <LayerProperties />
</div>
