<script lang="ts">
  import { Link2, AlertTriangle } from "@lucide/svelte";
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import InfoTip from "../../ui/InfoTip.svelte";

  const layer = $derived(canvas.activeLayer);
  const imageLayers = $derived(canvas.sortedLayers.filter((item) => item.type === "raster"));
  const editMasks = $derived(canvas.sortedLayers.filter((item) => item.type === "mask"));
  const isModifier = $derived(layer?.type === "region" || layer?.type === "controlnet");
  const scopeMode = $derived(layer?.modifierScope?.mode ?? "auto");
  const scopedMaskIds = $derived(layer?.modifierScope?.maskIds ?? []);
  const missingMaskIds = $derived(scopedMaskIds.filter((id) => !editMasks.some((item) => item.id === id)));
  const group = $derived(canvas.groups.find((item) => item.id === layer?.groupId));
  const clippingMask = $derived(editMasks.find((item) => item.id === layer?.clippingMaskId));
  const targetImage = $derived(imageLayers.find((item) => item.id === layer?.targetRasterId));
  const referenceImage = $derived(imageLayers.find((item) => item.id === layer?.referenceRasterId));
  const missingConnection = $derived(!!layer && (
    !!layer.groupId && !group ||
    layer.type === "raster" && !!layer.clippingMaskId && !clippingMask ||
    (layer.type === "mask" || layer.type === "region") && !!layer.targetRasterId && !targetImage ||
    layer.type === "controlnet" && !!layer.referenceRasterId && !referenceImage ||
    isModifier && scopeMode === "masks" && missingMaskIds.length > 0
  ));
  const missingClippingMask = $derived(layer?.type === "raster" && !!layer.clippingEnabled && !clippingMask);
  const noModifierTargets = $derived(isModifier && scopeMode === "masks" && !scopedMaskIds.length);

  const summary = $derived.by(() => {
    if (!layer) return "";
    const connections: string[] = [];
    if (layer.groupId) connections.push(group?.name ?? locale.t("canvas.missing_target"));
    if (layer.type === "raster" && layer.clippingEnabled) {
      connections.push(`${locale.t("canvas.clip_to_mask")}: ${clippingMask?.name ?? locale.t("canvas.no_clipping_mask")}`);
    }
    if ((layer.type === "mask" || layer.type === "region") && layer.targetRasterId) {
      connections.push(`${locale.t("canvas.target_image_layer")}: ${targetImage?.name ?? locale.t("canvas.missing_target")}`);
    }
    if (layer.type === "controlnet" && layer.referenceRasterId) {
      connections.push(`${locale.t("canvas.reference_image_layer")}: ${referenceImage?.name ?? locale.t("canvas.missing_target")}`);
    }
    if (isModifier) {
      if (scopeMode === "masks") {
        const names = scopedMaskIds.map((id) => editMasks.find((item) => item.id === id)?.name ?? locale.t("canvas.missing_target"));
        connections.push(names.length === 1 ? names[0] : locale.t("canvas.scope_masks_count", { count: names.length }));
      } else if (scopeMode === "document") connections.push(locale.t("canvas.scope_document"));
      else connections.push(locale.t("canvas.scope_auto"));
    }
    return connections.join(" · ") || locale.t("canvas.no_connections");
  });

  function setGroup(id: string) {
    if (layer && !layer.locked) canvas.setLayerRelations(layer.id, { groupId: id || null });
  }
  function setClipping(enabled: boolean) {
    if (layer && !layer.locked) canvas.setLayerRelations(layer.id, { clippingEnabled: enabled });
  }
  function setClippingMask(id: string) {
    if (layer && !layer.locked) canvas.setLayerRelations(layer.id, { clippingMaskId: id || null });
  }
  function setTargetImage(id: string) {
    if (layer && !layer.locked) canvas.setLayerRelations(layer.id, { targetRasterId: id || null });
  }
  function setReferenceImage(id: string) {
    if (layer && !layer.locked) canvas.setLayerRelations(layer.id, { referenceRasterId: id || null });
  }
  function setScope(mode: "auto" | "document" | "masks") {
    if (layer && !layer.locked) {
      canvas.setLayerRelations(layer.id, { modifierScope: { mode, maskIds: [...scopedMaskIds] } });
    }
  }
  function toggleScopeMask(id: string, checked: boolean) {
    if (!layer || layer.locked) return;
    const maskIds = checked ? [...new Set([...scopedMaskIds, id])] : scopedMaskIds.filter((item) => item !== id);
    canvas.setLayerRelations(layer.id, { modifierScope: { mode: "masks", maskIds } });
  }

  const selectClass = "ui-control mt-1 w-full min-w-0 rounded border border-ui-border bg-neutral-950 px-2 text-xs text-neutral-200 disabled:opacity-50";
</script>

{#if layer}
  <details class="rounded-md border border-ui-border bg-ui-surface" data-layer-connections>
    <summary class="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 text-xs text-neutral-300 focus-visible:outline-2 focus-visible:outline-ui-accent" title={summary}>
      <Link2 size={13} class="shrink-0 text-neutral-500" aria-hidden="true" />
      <span class="shrink-0 font-medium">{locale.t("canvas.connections")}</span>
      <span class="min-w-0 flex-1 truncate text-[10px] text-neutral-500">{summary}</span>
      {#if missingConnection || missingClippingMask || noModifierTargets}<AlertTriangle size={13} class="shrink-0 text-amber-300" aria-label={locale.t("canvas.missing_connection")} />{/if}
      <span class="shrink-0 text-neutral-500" aria-hidden="true">▾</span>
    </summary>

    <fieldset disabled={layer.locked} class="min-w-0 space-y-2 border-t border-ui-border p-2 disabled:opacity-50">
      {#if canvas.groups.length || layer.groupId}
        <label class="block text-[10px] text-neutral-400">
          {locale.t("canvas.group")}
          <select aria-label={locale.t("canvas.group")} value={layer.groupId ?? ""} onchange={(event) => setGroup(event.currentTarget.value)} class={selectClass}>
            <option value="">{locale.t("canvas.ungrouped")}</option>
            {#if layer.groupId && !group}<option value={layer.groupId} disabled>{locale.t("canvas.missing_target")}</option>{/if}
            {#each canvas.groups as item (item.id)}<option value={item.id}>{item.name}{item.visible ? "" : ` · ${locale.t("canvas.group_disabled")}`}</option>{/each}
          </select>
        </label>
      {/if}

      {#if layer.type === "raster"}
        <label class="flex items-center justify-between gap-2 text-[11px] text-neutral-300">
          <span>{locale.t("canvas.clip_to_mask")}<InfoTip text={locale.t("canvas.clip_mask_hint")} /></span>
          <input type="checkbox" role="switch" aria-label={locale.t("canvas.clip_to_mask")} checked={!!layer.clippingEnabled} onchange={(event) => setClipping(event.currentTarget.checked)} class="accent-ui-accent" />
        </label>
        <label class="block text-[10px] text-neutral-400">
          {locale.t("canvas.clip_mask_source")}
          <select aria-label={locale.t("canvas.clip_mask_source")} value={layer.clippingMaskId ?? ""} onchange={(event) => setClippingMask(event.currentTarget.value)} class={selectClass}>
            <option value="">{locale.t("canvas.no_clipping_mask")}</option>
            {#if layer.clippingMaskId && !clippingMask}<option value={layer.clippingMaskId} disabled>{locale.t("canvas.missing_target")}</option>{/if}
            {#each editMasks as mask (mask.id)}<option value={mask.id}>{mask.name}</option>{/each}
          </select>
        </label>
      {/if}

      {#if layer.type === "mask" || layer.type === "region"}
        <label class="block text-[10px] text-neutral-400">
          {locale.t("canvas.target_image_layer")}<InfoTip text={locale.t("canvas.target_alpha_hint")} />
          <select aria-label={locale.t("canvas.target_image_layer")} value={layer.targetRasterId ?? ""} onchange={(event) => setTargetImage(event.currentTarget.value)} class={selectClass}>
            <option value="">{locale.t("canvas.entire_canvas")}</option>
            {#if layer.targetRasterId && !targetImage}<option value={layer.targetRasterId} disabled>{locale.t("canvas.missing_target")}</option>{/if}
            {#each imageLayers as image (image.id)}<option value={image.id}>{image.name}</option>{/each}
          </select>
        </label>
      {/if}

      {#if layer.type === "controlnet"}
        <label class="block text-[10px] text-neutral-400">
          {locale.t("canvas.reference_image_layer")}<InfoTip text={locale.t("canvas.reference_layer_hint")} />
          <select aria-label={locale.t("canvas.reference_image_layer")} value={layer.referenceRasterId ?? ""} onchange={(event) => setReferenceImage(event.currentTarget.value)} class={selectClass}>
            <option value="">{locale.t("canvas.own_reference_image")}</option>
            {#if layer.referenceRasterId && !referenceImage}<option value={layer.referenceRasterId} disabled>{locale.t("canvas.missing_target")}</option>{/if}
            {#each imageLayers as image (image.id)}<option value={image.id}>{image.name}</option>{/each}
          </select>
        </label>
      {/if}

      {#if isModifier}
        <label class="block text-[10px] text-neutral-400">
          {locale.t("canvas.modifier_scope")}<InfoTip text={locale.t("canvas.scope_auto_hint")} />
          <select aria-label={locale.t("canvas.modifier_scope")} value={scopeMode} onchange={(event) => setScope(event.currentTarget.value as "auto" | "document" | "masks")} class={selectClass}>
            <option value="auto">{locale.t("canvas.scope_auto")}</option>
            <option value="document">{locale.t("canvas.scope_document")}</option>
            <option value="masks">{locale.t("canvas.scope_masks")}</option>
          </select>
        </label>
        {#if scopeMode === "masks"}
          <div class="max-h-32 space-y-1 overflow-y-auto overscroll-contain rounded border border-ui-border p-1" role="group" aria-label={locale.t("canvas.scope_masks")}>
            {#each editMasks as mask (mask.id)}
              <label class="flex min-h-7 cursor-pointer items-center gap-2 rounded px-1 text-xs text-neutral-300 hover:bg-ui-selected">
                <input type="checkbox" aria-label={mask.name} checked={scopedMaskIds.includes(mask.id)} onchange={(event) => toggleScopeMask(mask.id, event.currentTarget.checked)} class="shrink-0 accent-ui-accent" />
                <span class="min-w-0 truncate" title={mask.name}>{mask.name}</span>
              </label>
            {/each}
            {#each missingMaskIds as id (id)}
              <label class="flex min-h-7 cursor-pointer items-center gap-2 rounded px-1 text-xs text-amber-300">
                <input type="checkbox" aria-label={locale.t("canvas.missing_target")} checked onchange={(event) => toggleScopeMask(id, event.currentTarget.checked)} class="shrink-0 accent-ui-accent" />
                <span>{locale.t("canvas.missing_target")}</span>
              </label>
            {/each}
          </div>
        {/if}
      {/if}

      {#if group && !group.visible}<p role="status" class="rounded bg-neutral-800 px-2 py-1 text-[10px] text-neutral-400">{locale.t("canvas.group_disabled")}</p>{/if}
      {#if missingConnection}<p role="status" class="rounded bg-amber-500/10 px-2 py-1 text-[10px] leading-relaxed text-amber-300">{locale.t("canvas.missing_connection")}</p>{/if}
      {#if missingClippingMask}<p role="status" class="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">{locale.t("canvas.no_clipping_mask")}</p>{/if}
      {#if noModifierTargets}<p role="status" class="rounded bg-amber-500/10 px-2 py-1 text-[10px] leading-relaxed text-amber-300">{locale.t("canvas.scope_no_masks")}</p>{/if}
    </fieldset>
  </details>
{/if}
