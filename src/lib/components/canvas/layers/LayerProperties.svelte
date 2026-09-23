<script lang="ts">
  import { canvas, isMaskLayer } from "../../../stores/canvas.svelte.js";
  import { generation } from "../../../stores/generation.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import InpaintSettings from "../InpaintSettings.svelte";

  const layer = $derived(canvas.activeLayer);
  const hasOwnSettings = $derived(!!layer?.inpaintSettings);

  function setOwnSettings(enabled: boolean) {
    if (layer) canvas.setLayerGenerationOverride(layer.id, enabled);
  }
</script>

{#if layer}
  <section class="overflow-hidden rounded-md border border-neutral-800 bg-neutral-900/60" aria-label={locale.t('canvas.properties')}>
    <header class="flex h-8 items-center justify-between gap-2 border-b border-neutral-800 px-2">
      <span class="truncate text-xs font-medium text-neutral-200" title={layer.name}>{layer.name}</span>
      <span class="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide {layer.type === 'region' ? 'bg-violet-500/15 text-violet-300' : layer.type === 'mask' ? 'bg-rose-500/15 text-rose-300' : 'bg-sky-500/15 text-sky-300'}">
        {locale.t(layer.type === 'region' ? 'canvas.type_region' : layer.type === 'mask' ? 'canvas.type_mask' : 'canvas.type_raster')}
      </span>
    </header>

    <div class="space-y-2 p-2">
      <label class="flex h-6 items-center gap-2 text-[10px] text-neutral-400">
        <span class="shrink-0">{locale.t('canvas.opacity')}</span>
        <input type="range" value={layer.opacity} oninput={(event) => canvas.setLayerOpacity(layer.id, Number(event.currentTarget.value))} min="0" max="1" step="0.01" class="min-w-0 flex-1 accent-indigo-500" />
        <span class="w-8 shrink-0 text-right tabular-nums text-neutral-300">{Math.round(layer.opacity * 100)}%</span>
      </label>

      {#if layer.locked || !layer.visible}
        <p class="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">{locale.t(layer.locked ? 'canvas.state_locked' : 'canvas.state_hidden')}</p>
      {/if}

      {#if layer.type === 'region'}
        <div class="space-y-1.5 border-t border-neutral-800 pt-2">
          <label class="block text-[10px] text-neutral-400">
            {locale.t('generation.regional.prompt_text')}
            <textarea rows="2" value={layer.regionalPrompt ?? ''} oninput={(event) => canvas.updateLayerRegion(layer.id, { regionalPrompt: event.currentTarget.value })} placeholder={locale.t('generation.regional.prompt_placeholder')} class="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-1.5 text-xs text-neutral-200 outline-none focus:border-violet-500"></textarea>
          </label>
          <label class="block text-[10px] text-neutral-400">
            {locale.t('canvas.layer_negative_prompt')}
            <textarea rows="1" value={layer.regionalNegativePrompt ?? ''} oninput={(event) => canvas.updateLayerRegion(layer.id, { regionalNegativePrompt: event.currentTarget.value })} placeholder={locale.t('canvas.layer_prompt_optional')} class="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-1.5 text-xs text-neutral-200 outline-none focus:border-violet-500"></textarea>
          </label>
          <label class="block text-[10px] text-neutral-400">
            {locale.t('generation.regional.strength', { value: (layer.regionalStrength ?? 1).toFixed(2) })}
            <input type="range" min="0" max="2" step="0.05" value={layer.regionalStrength ?? 1} oninput={(event) => canvas.updateLayerRegion(layer.id, { regionalStrength: Number(event.currentTarget.value) })} class="w-full accent-violet-500" />
          </label>
        </div>
      {/if}

      {#if isMaskLayer(layer) && generation.mode === 'inpainting' && !generation.isNovelAi}
        <div class="space-y-2 border-t border-neutral-800 pt-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-medium text-neutral-300">{locale.t('canvas.layer_generation_settings')}</span>
            <div class="flex rounded bg-neutral-950 p-0.5">
              <button type="button" onclick={() => setOwnSettings(false)} class="h-6 rounded px-2 text-[9px] {hasOwnSettings ? 'text-neutral-500 hover:text-neutral-300' : 'bg-neutral-700 text-neutral-100'}">{locale.t('canvas.use_document_settings')}</button>
              <button type="button" onclick={() => setOwnSettings(true)} class="h-6 rounded px-2 text-[9px] {hasOwnSettings ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:text-neutral-300'}">{locale.t('canvas.use_layer_settings')}</button>
            </div>
          </div>

          {#if hasOwnSettings}
            <label class="block text-[10px] text-neutral-400">
              {locale.t('generation.inpaint.grow_mask')} <span class="float-right tabular-nums text-neutral-300">{layer.maskGrow ?? generation.growMaskBy}px</span>
              <input type="range" min="0" max="64" step="1" value={layer.maskGrow ?? generation.growMaskBy} oninput={(event) => canvas.updateLayerGeneration(layer.id, { maskGrow: Number(event.currentTarget.value) })} class="w-full accent-indigo-500" />
            </label>
            {#if layer.type === 'mask'}
              <label class="block text-[10px] text-neutral-400">
                {locale.t('canvas.layer_prompt')}
                <textarea rows="2" value={layer.positivePrompt ?? ''} oninput={(event) => canvas.updateLayerGeneration(layer.id, { positivePrompt: event.currentTarget.value })} placeholder={locale.t('canvas.layer_prompt_optional')} class="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-1.5 text-xs text-neutral-200 outline-none focus:border-indigo-500"></textarea>
              </label>
              <label class="block text-[10px] text-neutral-400">
                {locale.t('canvas.layer_negative_prompt')}
                <textarea rows="1" value={layer.negativePrompt ?? ''} oninput={(event) => canvas.updateLayerGeneration(layer.id, { negativePrompt: event.currentTarget.value })} placeholder={locale.t('canvas.layer_prompt_optional')} class="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-1.5 text-xs text-neutral-200 outline-none focus:border-indigo-500"></textarea>
              </label>
              <label class="block text-[10px] text-neutral-400">
                {locale.t('generation.image.denoise')} <span class="float-right tabular-nums text-neutral-300">{(layer.denoise ?? generation.denoise).toFixed(2)}</span>
                <input type="range" min="0" max="1" step="0.01" value={layer.denoise ?? generation.denoise} oninput={(event) => canvas.updateLayerGeneration(layer.id, { denoise: Number(event.currentTarget.value) })} class="w-full accent-indigo-500" />
              </label>
            {/if}
            <details class="rounded border border-neutral-800 bg-neutral-950/40 p-1.5">
              <summary class="cursor-pointer text-[10px] text-neutral-300">
                {locale.t('canvas.mask_settings')} · {locale.t('canvas.mask_processing_summary', { blur: String(layer.inpaintSettings?.mask_blur ?? 0) })}
              </summary>
              <div class="mt-2">
                <InpaintSettings compact settings={layer.inpaintSettings!} onchange={(settings) => canvas.setLayerInpaintSettings(layer.id, settings)} />
              </div>
            </details>
          {:else}
            <p class="text-[9px] leading-relaxed text-neutral-500">{locale.t('canvas.inherits_document_settings')}</p>
          {/if}
        </div>
      {/if}

      {#if layer.image && layer.type === 'raster'}
        <fieldset disabled={layer.locked} class="border-t border-neutral-800 pt-2 disabled:opacity-50">
          <legend class="mb-1 text-[10px] font-medium text-neutral-300">{locale.t('canvas.transform')}</legend>
          <div class="grid grid-cols-3 gap-1.5 text-[9px] text-neutral-500">
            {#each ['x', 'y', 'width', 'height', 'rotation'] as key}
              <label>{locale.t('canvas.image_' + key)}<input type="number" step="1" min={key === 'width' || key === 'height' ? 1 : undefined} value={layer.image[key as 'x']} onchange={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value)) canvas.updateLayerImage(layer.id, { [key]: key === 'width' || key === 'height' ? Math.max(1, value) : value }); }} class="mt-0.5 h-7 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 text-[10px] text-neutral-200" /></label>
            {/each}
          </div>
          <div class="mt-1.5 grid grid-cols-2 gap-1.5">
            <button type="button" class="h-7 rounded border border-neutral-700 text-[10px] text-neutral-300 hover:border-sky-500" onclick={() => canvas.updateLayerImage(layer.id, { flipX: !layer.image!.flipX })}>{locale.t('canvas.flip_x')}</button>
            <button type="button" class="h-7 rounded border border-neutral-700 text-[10px] text-neutral-300 hover:border-sky-500" onclick={() => canvas.updateLayerImage(layer.id, { flipY: !layer.image!.flipY })}>{locale.t('canvas.flip_y')}</button>
          </div>
        </fieldset>
      {/if}
    </div>
  </section>
{/if}
