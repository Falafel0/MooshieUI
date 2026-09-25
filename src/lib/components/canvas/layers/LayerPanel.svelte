<script lang="ts">
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import LayerItem from "./LayerItem.svelte";
  import LayerProperties from "./LayerProperties.svelte";
  import { generation } from "../../../stores/generation.svelte.js";
  import { ArrowUp, ArrowDown, Copy, Trash2 } from "@lucide/svelte";

  let { oneditphotopea }: { oneditphotopea?: () => void } = $props();


  type GroupKey = "mask" | "raster" | "region";

  let collapsed = $state<Record<GroupKey, boolean>>({ mask: false, raster: false, region: false });

  const maskLayers = $derived(canvas.sortedLayers.filter((l) => l.type === "mask"));
  const regionLayers = $derived(canvas.sortedLayers.filter((l) => l.type === "region"));
  const rasterLayers = $derived(canvas.sortedLayers.filter((l) => l.type === "raster"));
  const processingOrder = $derived(canvas.sortedLayers.filter((l) => l.type === 'mask' && l.visible && l.opacity > 0).reverse());
  const activeType = $derived(canvas.activeLayer?.type ?? null);
  const canMoveUp = $derived(canvas.activeLayerId ? canvas.getLayerMoveTarget(canvas.activeLayerId, "up") !== null : false);
  const canMoveDown = $derived(canvas.activeLayerId ? canvas.getLayerMoveTarget(canvas.activeLayerId, "down") !== null : false);

  $effect(() => {
    // Selection can change outside this panel (e.g. deleting or adding a layer).
    const active = canvas.activeLayer;
    if (active) collapsed[active.type] = false;
  });

  const groups = $derived([
    { key: "region" as GroupKey, titleKey: "generation.regional.title", addKey: "canvas.add_regions", layers: regionLayers },
    { key: "mask" as GroupKey, titleKey: "canvas.mask_layers", addKey: "canvas.add_mask", layers: maskLayers },
    { key: "raster" as GroupKey, titleKey: "canvas.raster_layers", addKey: "canvas.add_raster", layers: rasterLayers },
  ]);

  function toggleGroup(key: GroupKey) {
    collapsed = { ...collapsed, [key]: !collapsed[key] };
  }

  function addToGroup(key: GroupKey) {
    if (key === 'region') canvas.addRegionLayer();
    else canvas.addLayer(key);
    // Adding a layer should reveal it, so make sure the group is open.
    collapsed = { ...collapsed, [key]: false };
  }
</script>

<div class="space-y-1.5">
  {#if processingOrder.length > 0}
    <div class="flex h-6 items-center justify-between rounded bg-neutral-950/50 px-2 text-[9px] text-neutral-500" title={locale.t('canvas.processing_order_tip')}>
      <span>{locale.t('canvas.processing_order')}</span>
      <span class="tabular-nums text-neutral-400">#1 → #{processingOrder.length}</span>
    </div>
  {/if}
  {#each groups as group (group.key)}
    <div>
      <!-- Group header -->
      <div class="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={!collapsed[group.key]}
          onclick={() => toggleGroup(group.key)}
          class="h-7 flex-1 flex items-center gap-1.5 px-1 text-left rounded focus-visible:outline-2 focus-visible:outline-indigo-400"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-3 h-3 shrink-0 text-neutral-500 transition-transform {collapsed[group.key] ? '' : 'rotate-90'}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span class="text-[11px] font-medium {activeType === group.key ? group.key === 'region' ? 'text-violet-300' : group.key === 'mask' ? 'text-rose-300' : 'text-sky-300' : 'text-neutral-500'}">
            {locale.t(group.titleKey)}
          </span>
          <span class="px-1.5 rounded-full bg-neutral-800 text-[10px] text-neutral-400 tabular-nums">
            {group.layers.length}
          </span>
        </button>
        <button
          type="button"
          aria-label={locale.t(group.addKey)}
          disabled={group.key === 'region' && !generation.supportsRegionalPrompting}
          onclick={() => addToGroup(group.key)}
          class="h-7 w-7 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:opacity-30"
          title={group.key === 'region' && !generation.supportsRegionalPrompting ? locale.t('canvas.regions_supported') : locale.t(group.addKey)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      <!-- Group body -->
      {#if !collapsed[group.key]}
        <div class="space-y-0.5 mt-1">
          {#if group.layers.length > 0}
            {#each group.layers as layer (layer.id)}
              <LayerItem {layer} processIndex={layer.visible ? processingOrder.findIndex((item) => item.id === layer.id) + 1 : 0} />
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/each}
  <div class="flex h-7 items-center justify-end gap-0.5 border-t border-neutral-800 pt-1">
    {#if oneditphotopea}<button type="button" class="mr-auto h-6 rounded px-2 text-[10px] text-violet-200 hover:bg-violet-900/30 disabled:opacity-30" disabled={!canvas.activeLayerId} onclick={oneditphotopea}>{locale.t('canvas.open_photopea')}</button>{/if}
    <button type="button" class="h-6 w-7 rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-25" disabled={!canMoveUp || !canvas.activeLayerId} onclick={() => canvas.activeLayerId && canvas.reorderLayer(canvas.activeLayerId, 'up')} aria-label={locale.t('canvas.move_up_title')} title={locale.t('canvas.move_up_title')}><ArrowUp size={14} class="mx-auto" /></button>
    <button type="button" class="h-6 w-7 rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-25" disabled={!canMoveDown || !canvas.activeLayerId} onclick={() => canvas.activeLayerId && canvas.reorderLayer(canvas.activeLayerId, 'down')} aria-label={locale.t('canvas.move_down_title')} title={locale.t('canvas.move_down_title')}><ArrowDown size={14} class="mx-auto" /></button>
    <button type="button" class="h-6 w-7 rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-25" disabled={!canvas.activeLayerId} onclick={() => canvas.activeLayerId && canvas.duplicateLayer(canvas.activeLayerId)} aria-label={locale.t('canvas.duplicate')} title={locale.t('canvas.duplicate')}><Copy size={14} class="mx-auto" /></button>
    <button type="button" class="h-6 w-7 rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-300 disabled:opacity-25" disabled={!canvas.activeLayerId || canvas.layers.length <= 1} onclick={() => canvas.activeLayerId && canvas.removeLayer(canvas.activeLayerId)} aria-label={locale.t('canvas.delete_layer')} title={locale.t('canvas.delete_layer')}><Trash2 size={14} class="mx-auto" /></button>
  </div>
  <LayerProperties />
</div>
