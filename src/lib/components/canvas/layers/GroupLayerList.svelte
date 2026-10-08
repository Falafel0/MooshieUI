<script lang="ts">
  import { tick } from "svelte";
  import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, FolderOpen, TriangleAlert } from "@lucide/svelte";
  import { canvas, type CanvasLayer } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import { editMaskPassOrder } from "../../../utils/inpaintingRegions.js";
  import LayerItem from "./LayerItem.svelte";

  const layerDragType = "application/x-mooshie-layer";
  const roles = [
    { id: "pixels", title: "canvas.pixel_layers" },
    { id: "modifiers", title: "canvas.generation_modifiers" },
  ] as const;

  let list: HTMLDivElement | undefined = $state();
  let dropTarget: string | null = $state(null);
  let lastSelectionKey: string | null = null;

  const groupIds = $derived(new Set(canvas.groups.map((group) => group.id)));
  const ungroupedLayers = $derived(canvas.sortedLayers.filter((layer) => !layer.groupId));
  const missingGroups = $derived([...new Set(canvas.sortedLayers
    .filter((layer) => layer.groupId && !groupIds.has(layer.groupId))
    .map((layer) => layer.groupId!))]);
  const processingOrder = $derived(editMaskPassOrder(canvas.sortedLayers.filter((layer) =>
    !layer.groupId || canvas.groups.some((group) => group.id === layer.groupId && group.visible),
  )));

  function roleLayers(layers: CanvasLayer[], role: typeof roles[number]["id"]): CanvasLayer[] {
    return layers.filter((layer) => role === "pixels"
      ? layer.type === "raster" || layer.type === "mask"
      : layer.type === "region" || layer.type === "controlnet");
  }

  function maskProcessIndex(layer: CanvasLayer): number {
    return layer.type === "mask" ? processingOrder.findIndex((item) => item.id === layer.id) + 1 : 0;
  }

  function hasLayerDrag(event: DragEvent): boolean {
    return !!event.dataTransfer?.types.includes(layerDragType);
  }

  function dragOver(event: DragEvent, target: string) {
    if (!hasLayerDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropTarget = target;
  }

  function dragLeave(event: DragEvent) {
    if (event.relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return;
    dropTarget = null;
  }

  function dropLayer(event: DragEvent, groupId: string | null) {
    if (!hasLayerDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dropTarget = null;
    const layerId = event.dataTransfer?.getData(layerDragType);
    const layer = canvas.layers.find((item) => item.id === layerId);
    if (!layer || layer.locked || (layer.groupId ?? null) === groupId) return;
    // Moving a layer into a folder preserves its explicit mask/source/target links.
    canvas.setLayerRelations(layer.id, { groupId });
    canvas.setActiveLayer(layer.id);
  }

  async function navigateGroup(event: KeyboardEvent, groupId: string) {
    const group = canvas.groups.find((item) => item.id === groupId);
    if (!group) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowLeft" && !group.collapsed || event.key === "ArrowRight" && group.collapsed) {
        canvas.toggleGroupCollapsed(groupId);
      } else if (event.key === "ArrowRight") {
        const child = canvas.sortedLayers.find((layer) => layer.groupId === groupId);
        if (child) {
          canvas.setActiveLayer(child.id);
          await tick();
          Array.from(list?.querySelectorAll<HTMLButtonElement>("[data-layer-id]") ?? [])
            .find((node) => node.dataset.layerId === child.id)?.focus({ preventScroll: true });
        }
      }
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const nodes = Array.from(list?.querySelectorAll<HTMLButtonElement>("[data-group-id], [data-layer-id]") ?? []);
    const index = nodes.findIndex((node) => node.dataset.groupId === groupId);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? nodes.length - 1
      : Math.max(0, Math.min(nodes.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
    const next = nodes[nextIndex];
    if (next?.dataset.groupId) canvas.setActiveGroup(next.dataset.groupId);
    else if (next?.dataset.layerId) canvas.setActiveLayer(next.dataset.layerId);
    next?.focus({ preventScroll: true });
    const scroller = list?.closest<HTMLElement>("[data-document-layer-list]");
    if (!next || !scroller) return;
    const listBounds = scroller.getBoundingClientRect();
    const rowBounds = next.getBoundingClientRect();
    if (rowBounds.top < listBounds.top) scroller.scrollTop += rowBounds.top - listBounds.top - 2;
    else if (rowBounds.bottom > listBounds.bottom) scroller.scrollTop += rowBounds.bottom - listBounds.bottom + 2;
  }

  $effect(() => {
    const layerId = canvas.activeLayerId;
    const groupId = canvas.activeLayer?.groupId;
    const group = canvas.groups.find((item) => item.id === groupId);
    const selectionKey = layerId ? `${layerId}:${groupId ?? ''}` : null;
    // Reveal external canvas/undo selections once. Folding the currently
    // selected folder by hand must not immediately force it open again.
    if (selectionKey && selectionKey !== lastSelectionKey && group?.collapsed) canvas.toggleGroupCollapsed(group.id);
    lastSelectionKey = selectionKey;
  });
</script>

{#snippet layerRole(layers: CanvasLayer[], role: typeof roles[number], groupId: string | null, alwaysVisible = false)}
  {@const children = roleLayers(layers, role.id)}
  {#if children.length || alwaysVisible}
    <div
      class="flex min-h-7 items-center justify-between gap-2 rounded px-2 text-[11px] font-medium {dropTarget === `ungrouped-${role.id}` && !groupId ? 'bg-ui-selected text-ui-accent ring-1 ring-ui-accent' : 'text-neutral-400'}"
      data-layer-role={role.id}
      role="group"
      aria-label={locale.t(role.title)}
      title={!groupId ? locale.t('canvas.group_drop_ungrouped') : undefined}
      ondragover={(event) => { if (!groupId) dragOver(event, `ungrouped-${role.id}`); }}
      ondragleave={dragLeave}
      ondrop={(event) => { if (!groupId) dropLayer(event, null); }}
    >
      <span>{locale.t(role.title)}</span><span class="tabular-nums text-neutral-500">{children.length}</span>
    </div>
    {#each children as layer (layer.id)}
      <LayerItem {layer} processIndex={maskProcessIndex(layer)} />
    {/each}
  {/if}
{/snippet}

<div bind:this={list} class="space-y-1" role="group" aria-label={locale.t('canvas.layers')} ondragend={() => dropTarget = null}>
  {#each canvas.groups as group (group.id)}
    {@const children = canvas.sortedLayers.filter((layer) => layer.groupId === group.id)}
    <section class="rounded-md border {canvas.activeGroupId === group.id ? 'border-ui-accent/60 bg-ui-selected/30' : 'border-neutral-800'}" data-layer-group={group.id} data-group-visible={group.visible}>
      <div class="flex min-h-9 items-center gap-0.5 rounded-t-md px-0.5 {dropTarget === group.id ? 'bg-ui-selected ring-1 ring-ui-accent' : 'bg-neutral-900/60'}">
        <button type="button" class="flex h-8 w-7 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-ui-accent" onclick={() => canvas.toggleGroupCollapsed(group.id)} aria-expanded={!group.collapsed} aria-controls={`layer-group-${group.id}`} aria-label={locale.t(group.collapsed ? 'canvas.group_expand' : 'canvas.group_collapse')} title={locale.t(group.collapsed ? 'canvas.group_expand' : 'canvas.group_collapse')}>
          {#if group.collapsed}<ChevronRight size={15} />{:else}<ChevronDown size={15} />{/if}
        </button>
        <button type="button" class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded px-1 text-left text-xs hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-ui-accent {canvas.activeGroupId === group.id ? 'text-neutral-100' : 'text-neutral-300'}" data-group-id={group.id} onclick={() => canvas.setActiveGroup(group.id)} onkeydown={(event) => navigateGroup(event, group.id)} ondragover={(event) => dragOver(event, group.id)} ondragleave={dragLeave} ondrop={(event) => dropLayer(event, group.id)} aria-pressed={canvas.activeGroupId === group.id} title={dropTarget === group.id ? locale.t('canvas.group_drop', { name: group.name }) : group.name}>
          {#if group.collapsed}<Folder size={15} class="shrink-0 text-neutral-400" />{:else}<FolderOpen size={15} class="shrink-0 text-neutral-400" />{/if}
          <span class="min-w-0 flex-1 truncate {group.visible ? '' : 'opacity-50'}">{group.name}</span>
          <span class="shrink-0 tabular-nums text-neutral-500">{children.length}</span>
        </button>
        <button type="button" class="flex h-8 w-8 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-ui-accent" onclick={() => canvas.toggleGroupVisibility(group.id)} aria-pressed={group.visible} aria-label={locale.t(group.visible ? 'canvas.group_hide' : 'canvas.group_show')} title={locale.t(group.visible ? 'canvas.group_hide' : 'canvas.group_show')}>
          {#if group.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
        </button>
      </div>
      {#if !group.collapsed}
        <div id={`layer-group-${group.id}`} class="ml-4 border-l border-neutral-800 pb-1 pl-1.5 pr-1 {group.visible ? '' : 'opacity-50'}">
          {#each roles as role (role.id)}{@render layerRole(children, role, group.id)}{/each}
          {#if !children.length}<p class="px-2 py-2 text-[11px] leading-relaxed text-neutral-500">{locale.t('canvas.group_empty')}</p>{/if}
        </div>
      {/if}
    </section>
  {/each}

  {#each roles as role (role.id)}{@render layerRole(ungroupedLayers, role, null, true)}{/each}

  {#each missingGroups as groupId (groupId)}
    {@const children = canvas.sortedLayers.filter((layer) => layer.groupId === groupId)}
    <section class="rounded-md border border-amber-500/30 bg-amber-500/5" data-missing-group={groupId}>
      <div class="flex min-h-8 items-center gap-2 px-2 text-xs text-amber-300"><TriangleAlert size={14} /><span>{locale.t('canvas.group_missing')}</span><span class="ml-auto tabular-nums">{children.length}</span></div>
      <p class="px-2 pb-1 text-[11px] leading-relaxed text-amber-200/70">{locale.t('canvas.group_missing_hint')}</p>
      <div class="space-y-0.5 p-1">
        {#each children as layer (layer.id)}<LayerItem {layer} processIndex={0} />{/each}
      </div>
    </section>
  {/each}

  {#if !canvas.layers.length && !canvas.groups.length}<p class="p-3 text-center text-xs text-neutral-500">{locale.t('canvas.no_layers')}</p>{/if}
</div>
