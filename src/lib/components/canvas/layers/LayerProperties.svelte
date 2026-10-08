<script lang="ts">
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { generation } from "../../../stores/generation.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import { canvasHistory } from "../../../stores/canvasHistory.svelte.js";
  import { grayscaleMaskBounds } from "../../../utils/canvasLayerExport.js";
  import { LAYER_TINT_KEYS, LAYER_TINTS, resolveTint, resolveTintKey } from "../../../utils/layerTints.js";
  import ControlNetSettings from "../../generation/ControlNetSettings.svelte";
  import InfoTip from "../../ui/InfoTip.svelte";
  import InpaintSettings from "../InpaintSettings.svelte";
  import GroupProperties from "./GroupProperties.svelte";
  import LayerConnections from "./LayerConnections.svelte";
  import { effectiveLayerVisibility } from "../../../utils/layerRelations.js";
  import type { InpaintSettings as InpaintSettingsValue } from "../../../utils/inpaintSettings.js";

  const layer = $derived(canvas.activeLayer);
  const hasOwnSettings = $derived(!!layer?.inpaintSettings);
  const aspectLocked = $derived(layer?.inpaintAspectLocked !== false);
  /** Masks and regions are drawn as overlays; a raster layer is the picture. */
  const isOverlay = $derived(!!layer && layer.type !== "raster");
  /** The denoise this mask's pass runs with, whichever side provides it. */
  const effectiveDenoise = $derived((layer?.denoise ?? generation.denoise).toFixed(2));
  /** Whether the mask takes the document's denoise instead of its own. */
  const inheritsDenoise = $derived(layer?.denoise === undefined);
  /** How much of the painted area counts as a mask: display opacity plays no part. */
  const coverage = $derived(layer?.coverage ?? 1);
  const participates = $derived(!!layer && effectiveLayerVisibility(layer, canvas.groups));
  const isModifier = $derived(layer?.type === "region" || layer?.type === "controlnet");
  const hiddenGroup = $derived(!!layer?.groupId && !canvas.groups.some((group) => group.id === layer.groupId && group.visible));
  const stateMessage = $derived(locale.t(layer?.locked ? "canvas.state_locked" : hiddenGroup ? "canvas.group_disabled" : isModifier ? "canvas.state_modifier_disabled" : "canvas.state_hidden"));

  let sliderEditLayerId: string | null = null;

  /** One history entry per slider gesture, not one per step of movement. */
  function beginSliderEdit(): boolean {
    if (!layer) return false;
    if (sliderEditLayerId !== layer.id) {
      canvasHistory.snapshotDocument(canvas.layers, canvas.activeLayerId);
      sliderEditLayerId = layer.id;
    }
    return true;
  }

  function finishSliderEdit() {
    sliderEditLayerId = null;
  }

  function setOpacity(value: number) {
    if (!layer || layer.opacity === value || !beginSliderEdit()) return;
    canvas.setLayerOpacity(layer.id, value, false);
  }

  function setCoverage(value: number) {
    if (!layer || coverage === value || !beginSliderEdit()) return;
    canvas.setLayerCoverage(layer.id, value, false);
  }

  function setDenoise(value: number) {
    if (!layer || !beginSliderEdit()) return;
    canvas.updateLayerGeneration(layer.id, { denoise: value });
  }

  function useDocumentDenoise(useDocument: boolean) {
    if (!layer) return;
    canvasHistory.snapshotDocument(canvas.layers, canvas.activeLayerId);
    canvas.updateLayerGeneration(layer.id, { denoise: useDocument ? undefined : generation.denoise });
  }

  function setOwnSettings(enabled: boolean) {
    if (!layer) return;
    canvasHistory.snapshotDocument(canvas.layers, canvas.activeLayerId);
    const layerId = layer.id;
    canvas.setLayerGenerationOverride(layerId, enabled);
    if (!enabled) return;
    const mask = canvas.exportMaskLayer(layerId);
    const bounds = mask ? grayscaleMaskBounds(mask) : null;
    if (!bounds) return;
    const align = (value: number) => Math.max(64, Math.min(16384, Math.ceil(value / 8) * 8));
    canvas.setLayerInpaintSize(layerId, align(bounds.width), align(bounds.height));
  }

  function setWidth(value: number) {
    if (!layer || !Number.isFinite(value)) return;
    const width = layer.inpaintWidth ?? generation.width;
    const height = layer.inpaintHeight ?? generation.height;
    canvas.setLayerInpaintSize(layer.id, value, aspectLocked ? value * height / width : height);
  }

  function setHeight(value: number) {
    if (!layer || !Number.isFinite(value)) return;
    const width = layer.inpaintWidth ?? generation.width;
    const height = layer.inpaintHeight ?? generation.height;
    canvas.setLayerInpaintSize(layer.id, aspectLocked ? value * width / height : width, value);
  }

  function setPreset(longSide: number) {
    if (!layer) return;
    const width = layer.inpaintWidth ?? generation.width;
    const height = layer.inpaintHeight ?? generation.height;
    if (!aspectLocked) canvas.setLayerInpaintSize(layer.id, longSide, longSide);
    else if (width >= height) canvas.setLayerInpaintSize(layer.id, longSide, longSide * height / width);
    else canvas.setLayerInpaintSize(layer.id, longSide * width / height, longSide);
  }

  function setMaskSettings(settings: InpaintSettingsValue) {
    if (!layer) return;
    // Density is a run flag owned by the mask, never a saved processing setting.
    const persisted = { ...settings };
    delete persisted.density_denoise;
    canvas.setLayerInpaintSettings(layer.id, persisted);
  }
</script>

{#if canvas.activeGroup}
  <GroupProperties />
{:else if layer?.type === 'controlnet'}
  <section class="overflow-hidden rounded-md border border-ui-border bg-ui-surface" aria-label={layer.name}>
    <header class="flex min-h-8 items-center justify-between gap-2 border-b border-ui-border px-2">
      <h3 class="min-w-0 truncate text-xs font-medium text-neutral-200">{layer.name}</h3>
      <span class="shrink-0 text-[11px]" style="color: {resolveTint(layer)}">{locale.t('generation.controlnet.title')}</span>
    </header>
    <fieldset disabled={layer.locked} class="min-w-0 space-y-2 p-2 disabled:opacity-50">
      {#if layer.locked || !participates}<p role="status" class="rounded bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-300">{stateMessage}</p>{/if}
      <LayerConnections />
      <label class="flex items-center gap-2 text-[11px] text-neutral-400">
        <span class="shrink-0">{locale.t('generation.controlnet.guide_opacity')}</span>
        <input aria-label={locale.t('generation.controlnet.guide_opacity')} type="range" value={layer.opacity} oninput={(event) => setOpacity(Number(event.currentTarget.value))} onpointerup={finishSliderEdit} onpointercancel={finishSliderEdit} onkeyup={finishSliderEdit} onblur={finishSliderEdit} min="0" max="1" step="0.01" class="min-w-0 flex-1 accent-indigo-500" />
        <span class="w-8 shrink-0 text-right tabular-nums text-neutral-300">{Math.round(layer.opacity * 100)}%</span>
      </label>
      <p class="text-[11px] leading-relaxed text-neutral-500">{locale.t('canvas.display_note')}</p>
      {#if generation.isNovelAi}
        <p role="status" class="rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">{locale.t('canvas.controlnet_provider_unavailable')}</p>
      {:else}<ControlNetSettings />{/if}
    </fieldset>
  </section>
{:else if layer}
  <section class="overflow-hidden rounded-md border border-neutral-800 bg-neutral-900/60" aria-label={locale.t('canvas.properties')}>
    <header class="flex h-8 items-center justify-between gap-2 border-b border-neutral-800 px-2">
      <span class="truncate text-xs font-medium text-neutral-200" title={layer.name}>{layer.name}</span>
      <div class="flex shrink-0 items-center gap-1">
        <span class="rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide" style="color: {resolveTint(layer)}; background: color-mix(in srgb, {resolveTint(layer)} 15%, transparent)">
          {locale.t(layer.type === 'region' ? 'canvas.type_region' : layer.type === 'mask' ? 'canvas.type_mask' : 'canvas.type_raster')}
        </span>
      </div>
    </header>

    <fieldset disabled={layer.locked} class="min-w-0 space-y-2 p-2 disabled:opacity-60">
      {#if layer.locked || !participates}
        <p role="status" class="rounded bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-300">{stateMessage}</p>
      {/if}

      <LayerConnections />

      {#if layer.type === 'mask'}
        <!-- What a run reads comes first, in that order: how strong the edit
             is, how much of the painted area counts, and whether the edges
             fade. The sliders that only change the look live further down,
             under a heading that says so. -->
        <div class="space-y-2 border-t border-neutral-800 pt-2">
          <span class="text-[11px] font-medium text-neutral-300">{locale.t('canvas.effect_group')}</span>
          <div class="space-y-1">
            <label class="flex items-center gap-2 text-[11px] text-neutral-400">
              <span class="shrink-0">{locale.t('generation.image.denoise')}<InfoTip text={locale.t('canvas.denoise_hint')} /></span>
              <input
                aria-label={locale.t('generation.image.denoise')} type="range" min="0" max="1" step="0.01" value={layer.denoise ?? generation.denoise}
                oninput={(event) => setDenoise(Number(event.currentTarget.value))}
                onpointerup={finishSliderEdit} onpointercancel={finishSliderEdit} onkeyup={finishSliderEdit} onblur={finishSliderEdit}
                class="min-w-0 flex-1 accent-indigo-500 disabled:opacity-40"
              />
              <span class="w-8 shrink-0 text-right tabular-nums text-neutral-300">{effectiveDenoise}</span>
            </label>
            <label class="flex items-center gap-2 text-[11px] text-neutral-400">
              <input type="checkbox" checked={inheritsDenoise} onchange={(event) => useDocumentDenoise(event.currentTarget.checked)} class="accent-indigo-500" />
              <span>{locale.t('canvas.denoise_inherit', { value: generation.denoise.toFixed(2) })}</span>
            </label>

          </div>

          <div class="space-y-1">
            <label class="flex items-center gap-2 text-[11px] text-neutral-400">
              <span class="shrink-0" title={locale.t('canvas.density_title')}>{locale.t('canvas.density')}<InfoTip text={locale.t('canvas.coverage_hint')} /></span>
              <input aria-label={locale.t('canvas.density')} type="range" min="0" max="1" step="0.01" value={coverage} oninput={(event) => setCoverage(Number(event.currentTarget.value))} onpointerup={finishSliderEdit} onkeyup={finishSliderEdit} onblur={finishSliderEdit} class="min-w-0 flex-1 accent-indigo-500" />
              <span class="w-8 shrink-0 text-right tabular-nums text-neutral-300">{Math.round(coverage * 100)}%</span>
            </label>

          </div>

          <details class="space-y-1" open={!!layer.densityDenoise}>
            <summary class="cursor-pointer text-[11px] text-neutral-400">{locale.t("canvas.mask_density_denoise")}</summary>
            <label class="flex items-center justify-between gap-2 text-[11px] text-neutral-400">
              <span class="leading-tight">{locale.t('canvas.mask_density_denoise')}</span>
              <input type="checkbox" checked={!!layer.densityDenoise} onchange={(event) => canvas.setLayerDensityDenoise(layer.id, event.currentTarget.checked)} class="accent-indigo-500" />
            </label>
            <p class="text-[11px] leading-relaxed text-neutral-500">{locale.t(layer.densityDenoise ? 'canvas.mask_density_on_note' : 'canvas.mask_density_off_note')}</p>
            <p class="rounded px-2 py-1 text-[11px] leading-relaxed {layer.densityDenoise ? 'bg-indigo-500/10 text-indigo-200/80' : 'bg-neutral-800/60 text-neutral-400'}">
              {locale.t(layer.densityDenoise ? 'canvas.mask_density_range' : 'canvas.mask_density_flat', { value: effectiveDenoise })}
            </p>
          </details>

          <label class="block text-[11px] text-neutral-400">
            {locale.t('generation.inpaint.grow_mask')} <span class="float-right tabular-nums text-neutral-300">{layer.maskGrow ?? generation.growMaskBy}px</span>
            <input aria-label={locale.t('generation.inpaint.grow_mask')} type="range" min="0" max="64" step="1" value={layer.maskGrow ?? generation.growMaskBy} oninput={(event) => canvas.updateLayerGeneration(layer.id, { maskGrow: Number(event.currentTarget.value) })} class="w-full accent-indigo-500" />
          </label>

        </div>
      {/if}

      {#if layer.type === 'region'}
        <!-- A region's influence is its text: the prompt, the negative prompt
             and how loud it speaks against the rest of the prompt. -->
        <div class="space-y-1.5 border-t border-neutral-800 pt-2">
          <span class="text-[11px] font-medium text-neutral-300">{locale.t('canvas.effect_group')}</span>
          {#if !layer.regionalPrompt?.trim()}<p role="status" class="rounded bg-amber-500/10 p-2 text-xs text-amber-300">{locale.t('canvas.region_prompt_required', { name: layer.name })}</p>{/if}

          <label class="block text-[11px] text-neutral-400">
            {locale.t('generation.regional.prompt_text')}<InfoTip text={locale.t('canvas.region_conditioning_hint')} />
            <textarea aria-label={locale.t('generation.regional.prompt_text')} rows="3" value={layer.regionalPrompt ?? ''} oninput={(event) => canvas.updateLayerRegion(layer.id, { regionalPrompt: event.currentTarget.value })} placeholder={locale.t('generation.regional.prompt_placeholder')} class="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-1.5 text-xs text-neutral-200 outline-none focus:border-violet-500"></textarea>
          </label>
          <label class="block text-[11px] text-neutral-400">
            {locale.t('canvas.layer_negative_prompt')}
            <textarea rows="1" value={layer.regionalNegativePrompt ?? ''} oninput={(event) => canvas.updateLayerRegion(layer.id, { regionalNegativePrompt: event.currentTarget.value })} placeholder={locale.t('canvas.layer_prompt_optional')} class="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-1.5 text-xs text-neutral-200 outline-none focus:border-violet-500"></textarea>
          </label>
          <label class="block text-[11px] text-neutral-400">
            {locale.t('generation.regional.strength', { value: (layer.regionalStrength ?? 1).toFixed(2) })}
            <input type="range" min="0" max="2" step="0.05" value={layer.regionalStrength ?? 1} oninput={(event) => canvas.updateLayerRegion(layer.id, { regionalStrength: Number(event.currentTarget.value) })} class="w-full accent-violet-500" />
          </label>

        </div>
      {/if}

      {#if layer.type === 'mask' && generation.mode === 'inpainting' && !generation.isNovelAi}
        <details class="space-y-2 border-t border-neutral-800 pt-2" open={hasOwnSettings}>
          <summary class="cursor-pointer text-xs text-neutral-400">{locale.t('canvas.mask_settings')}</summary>
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] text-neutral-500">{locale.t('canvas.mask_settings')}</span>
            <div class="flex rounded bg-neutral-950 p-0.5">
              <button type="button" onclick={() => setOwnSettings(false)} class="h-6 rounded px-2 text-[11px] {hasOwnSettings ? 'text-neutral-500 hover:text-neutral-300' : 'bg-neutral-700 text-neutral-100'}">{locale.t('canvas.use_document_settings')}</button>
              <button type="button" onclick={() => setOwnSettings(true)} class="h-6 rounded px-2 text-[11px] {hasOwnSettings ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:text-neutral-300'}">{locale.t('canvas.use_layer_settings')}</button>
            </div>
          </div>

          {#if hasOwnSettings}
            <div class="rounded border border-neutral-800 bg-neutral-950/40 p-1.5">
              <div class="mb-1.5 flex items-center justify-between gap-2">
                <span class="text-[11px] font-medium text-neutral-300">{locale.t('canvas.layer_generation_size')}</span>
                <span class="text-[11px] tabular-nums text-neutral-500">{layer.inpaintWidth ?? generation.width} × {layer.inpaintHeight ?? generation.height}</span>
              </div>
              <div class="grid grid-cols-[1fr_auto_1fr] items-end gap-1">
                <label class="text-[11px] text-neutral-500">{locale.t('generation.dimensions.width')}<input aria-label={locale.t('generation.dimensions.width')} type="number" min="64" max="16384" step="8" value={layer.inpaintWidth ?? generation.width} onchange={(event) => setWidth(Number(event.currentTarget.value))} class="mt-0.5 h-7 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 text-[11px] text-neutral-200 outline-none focus:border-indigo-500" /></label>
                <button type="button" onclick={() => canvas.setLayerInpaintAspectLocked(layer.id, !aspectLocked)} class="mb-0.5 flex h-7 w-6 items-center justify-center rounded text-xs {aspectLocked ? 'bg-indigo-500/15 text-indigo-300' : 'text-neutral-600 hover:bg-neutral-800'}" title={locale.t(aspectLocked ? 'canvas.unlock_aspect' : 'canvas.lock_aspect')} aria-label={locale.t(aspectLocked ? 'canvas.unlock_aspect' : 'canvas.lock_aspect')}>{aspectLocked ? '⛓' : '×'}</button>
                <label class="text-[11px] text-neutral-500">{locale.t('generation.dimensions.height')}<input aria-label={locale.t('generation.dimensions.height')} type="number" min="64" max="16384" step="8" value={layer.inpaintHeight ?? generation.height} onchange={(event) => setHeight(Number(event.currentTarget.value))} class="mt-0.5 h-7 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 text-[11px] text-neutral-200 outline-none focus:border-indigo-500" /></label>
              </div>
              <div class="mt-1 grid grid-cols-4 gap-1">
                {#each [512, 768, 1024, 1536] as size}
                  <button type="button" onclick={() => setPreset(size)} class="h-5 rounded text-[11px] tabular-nums {Math.max(layer.inpaintWidth ?? generation.width, layer.inpaintHeight ?? generation.height) === size ? 'bg-indigo-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}">{size}</button>
                {/each}
              </div>
              <p class="mt-1 text-[11px] leading-snug text-neutral-600">{locale.t('canvas.layer_generation_size_hint')}</p>
            </div>
            <details class="rounded border border-neutral-800 bg-neutral-950/40 p-1.5">
              <summary class="cursor-pointer text-[11px] text-neutral-300">
                {locale.t('canvas.mask_settings')} · {locale.t('canvas.mask_processing_summary', { blur: String(layer.inpaintSettings?.mask_blur ?? 0) })}
              </summary>
              <div class="mt-2">
                <InpaintSettings compact settings={{ ...layer.inpaintSettings!, density_denoise: !!layer.densityDenoise }} onchange={setMaskSettings} />
              </div>
            </details>
          {:else}
            <p class="text-[11px] leading-relaxed text-neutral-500">{locale.t('canvas.inherits_document_settings')}</p>
          {/if}
        </details>
      {/if}

      {#if isOverlay}
        <div class="flex gap-1">
          <button type="button" title={locale.t('canvas.clear_pixels')} onclick={() => canvas.clearLayer(layer.id)} class="flex h-8 min-w-0 flex-1 items-center justify-center truncate whitespace-nowrap rounded-md border border-ui-border px-2 text-xs text-neutral-400 hover:bg-ui-selected">{locale.t('canvas.clear_pixels')}</button>
          <button type="button" title={locale.t(layer.type === 'mask' ? 'canvas.copy_as_region' : 'canvas.copy_as_mask')} onclick={() => canvas.duplicateSpatialLayerAs(layer.id, layer.type === 'mask' ? 'region' : 'mask')} disabled={layer.type === 'mask' && !generation.supportsRegionalPrompting} class="flex h-8 min-w-0 flex-1 items-center justify-center truncate whitespace-nowrap rounded-md border border-ui-border px-2 text-xs text-neutral-300 hover:bg-ui-selected disabled:opacity-40">{locale.t(layer.type === 'mask' ? 'canvas.copy_as_region' : 'canvas.copy_as_mask')}</button>
        </div>
      {/if}
      <!-- Everything below changes how the layer looks and nothing else. -->
      <details class="space-y-2 border-t border-neutral-800 pt-2">
        <summary class="cursor-pointer text-[11px] font-medium text-neutral-400">{locale.t('canvas.display_group')}</summary>
        <label class="flex h-6 items-center gap-2 text-[11px] text-neutral-400">
          <span class="shrink-0" title={locale.t(isOverlay ? 'canvas.opacity_display_hint' : 'canvas.raster_opacity_hint')}>{locale.t('canvas.opacity')}</span>
          <input aria-label={locale.t('canvas.opacity')} type="range" value={layer.opacity} oninput={(event) => setOpacity(Number(event.currentTarget.value))} onpointerup={finishSliderEdit} onkeyup={finishSliderEdit} onblur={finishSliderEdit} min="0" max="1" step="0.01" class="min-w-0 flex-1 accent-indigo-500" />
          <span class="w-8 shrink-0 text-right tabular-nums text-neutral-300">{Math.round(layer.opacity * 100)}%</span>
        </label>
        <p class="text-[11px] leading-relaxed text-neutral-500">{locale.t(isOverlay ? 'canvas.display_note' : 'canvas.raster_opacity_hint')}</p>

        {#if isOverlay}
          <label class="flex items-center gap-2 text-[11px] text-neutral-400" title={locale.t('canvas.overlay_strength_tip')}>
            <span>{locale.t('canvas.overlay_strength')}</span>
            <input aria-label={locale.t('canvas.overlay_strength')} type="range" min="0.1" max="1" step="0.05" value={canvas.maskOverlayOpacity} oninput={(event) => (canvas.maskOverlayOpacity = Number(event.currentTarget.value))} class="min-w-0 flex-1 accent-indigo-500" />
            <span class="tabular-nums">{Math.round(canvas.maskOverlayOpacity * 100)}%</span>
          </label>
        {/if}
        {#if isOverlay}
          <div class="flex items-center gap-1.5">
            <span class="shrink-0 text-[11px] text-neutral-400">{locale.t('canvas.tint_label')}</span>
            {#each LAYER_TINT_KEYS as key}
              <button
                type="button"
                class="h-4 w-4 shrink-0 rounded-full {resolveTintKey(layer) === key ? 'ring-2 ring-neutral-300' : 'hover:ring-1 hover:ring-neutral-500'}"
                style="background: {LAYER_TINTS[key]}"
                aria-label={locale.t('canvas.tint_swatch', { name: key })}
                aria-pressed={resolveTintKey(layer) === key}
                title={key}
                onclick={() => canvas.setLayerTint(layer.id, key)}
              ></button>
            {/each}
          </div>
          <p class="text-[11px] leading-relaxed text-neutral-500">{locale.t('canvas.tint_note')}</p>
        {/if}
      </details>

      {#if layer.image && layer.type === 'raster'}
        <fieldset disabled={layer.locked} class="border-t border-neutral-800 pt-2 disabled:opacity-50">
          <legend class="mb-1 text-[11px] font-medium text-neutral-300">{locale.t('canvas.transform')}</legend>
          <div class="grid grid-cols-3 gap-1.5 text-[11px] text-neutral-500">
            {#each ['x', 'y', 'width', 'height', 'rotation'] as key}
              <label>{locale.t('canvas.image_' + key)}<input type="number" step="1" min={key === 'width' || key === 'height' ? 1 : undefined} value={layer.image[key as 'x']} onchange={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value)) canvas.updateLayerImage(layer.id, { [key]: key === 'width' || key === 'height' ? Math.max(1, value) : value }); }} class="mt-0.5 h-7 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 text-[11px] text-neutral-200" /></label>
            {/each}
          </div>
          <div class="mt-1.5 grid grid-cols-2 gap-1.5">
            <button type="button" class="h-7 rounded border border-neutral-700 text-[11px] text-neutral-300 hover:border-sky-500" onclick={() => canvas.updateLayerImage(layer.id, { flipX: !layer.image!.flipX })}>{locale.t('canvas.flip_x')}</button>
            <button type="button" class="h-7 rounded border border-neutral-700 text-[11px] text-neutral-300 hover:border-sky-500" onclick={() => canvas.updateLayerImage(layer.id, { flipY: !layer.image!.flipY })}>{locale.t('canvas.flip_y')}</button>
          </div>
        </fieldset>
      {/if}
    </fieldset>
  </section>
{/if}
