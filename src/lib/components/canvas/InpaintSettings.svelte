<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";
  import type { InpaintSettings } from "../../utils/inpaintSettings.js";
  let { settings, onchange, compact = false }: { settings: InpaintSettings; onchange: (settings: InpaintSettings) => void; compact?: boolean } = $props();
  const numeric = [
    { key: 'schedule_bias', min: 0.1, max: 8, step: 0.1 },
    { key: 'preservation', min: 0, max: 1, step: 0.05 },
    { key: 'transition_contrast', min: 0.1, max: 16, step: 0.1 },
    { key: 'mask_influence', min: 0, max: 1, step: 0.05 },
    { key: 'difference_threshold', min: 0, max: 1, step: 0.05 },
    { key: 'difference_contrast', min: 0.1, max: 16, step: 0.1 },
  ] as const;
  function update(patch: Partial<InpaintSettings>) { onchange({ ...settings, ...patch }); }
</script>

<div class="{compact ? 'space-y-2 text-[10px]' : 'space-y-3 text-xs'} text-neutral-300">
  <label class="block space-y-1">
    <span>{locale.t('canvas.resize_mode')}</span>
    <select value={settings.resize_mode} onchange={(e) => update({ resize_mode: e.currentTarget.value as InpaintSettings['resize_mode'] })} class="w-full rounded border border-neutral-700 bg-neutral-900 {compact ? 'h-7 px-1.5' : 'p-2'}">
      {#each ['resize','crop','fill','latent'] as mode}<option value={mode}>{locale.t('canvas.resize_' + mode)}</option>{/each}
    </select>
  </label>
  <label class="block">
    {locale.t('canvas.mask_blur')} <span class="float-right tabular-nums">{settings.mask_blur}px</span>
    <input type="range" min="0" max="64" step="1" value={settings.mask_blur} oninput={(e) => update({ mask_blur: Number(e.currentTarget.value) })} class="w-full accent-indigo-500" />
  </label>
  <label class="flex items-center gap-2"><input type="checkbox" checked={settings.invert_mask} onchange={(e) => update({ invert_mask: e.currentTarget.checked })} class="accent-indigo-500" />{locale.t('canvas.invert_mask')}</label>
  <label class="block space-y-1">
    <span>{locale.t('canvas.masked_content')}</span>
    <select value={settings.masked_content} onchange={(e) => update({ masked_content: e.currentTarget.value as InpaintSettings['masked_content'] })} class="w-full rounded border border-neutral-700 bg-neutral-900 {compact ? 'h-7 px-1.5' : 'p-2'}">
      {#each ['original','fill','noise','nothing'] as mode}<option value={mode}>{locale.t('canvas.content_' + mode)}</option>{/each}
    </select>
  </label>
  <label class="block space-y-1">
    <span>{locale.t('canvas.inpaint_area')}</span>
    <select value={settings.area} onchange={(e) => update({ area: e.currentTarget.value as InpaintSettings['area'] })} class="w-full rounded border border-neutral-700 bg-neutral-900 {compact ? 'h-7 px-1.5' : 'p-2'}">
      <option value="whole">{locale.t('canvas.area_whole')}</option><option value="masked">{locale.t('canvas.area_masked')}</option>
    </select>
  </label>
  {#if settings.area === 'masked'}
    <label class="block">{locale.t('canvas.padding')} <span class="float-right">{settings.padding}px</span><input type="range" min="0" max="256" step="1" value={settings.padding} oninput={(e) => update({ padding: Number(e.currentTarget.value) })} class="w-full accent-indigo-500" /></label>
  {/if}
  <label class="flex items-center gap-2"><input type="checkbox" checked={settings.soft} onchange={(e) => update({ soft: e.currentTarget.checked })} class="accent-indigo-500" />{locale.t('canvas.soft_inpainting')}</label>
  {#if settings.soft}
    <div class="space-y-2 rounded border border-neutral-700 p-2">
      {#each numeric as field}
        <label class="block text-[11px]">{locale.t('canvas.' + field.key)} <span class="float-right tabular-nums">{settings[field.key].toFixed(2)}</span><input type="range" min={field.min} max={field.max} step={field.step} value={settings[field.key]} oninput={(e) => update({ [field.key]: Number(e.currentTarget.value) })} class="w-full accent-indigo-500" /></label>
      {/each}
    </div>
  {/if}
</div>
