<script lang="ts">
  import { canvas } from '../../stores/canvas.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import InfoTip from '../ui/InfoTip.svelte';
  import { editMaskPassOrder } from '../../utils/inpaintingRegions.js';
  const masks = $derived(editMaskPassOrder(canvas.sortedLayers));
</script>
<section aria-label={locale.t('canvas.mask_layers')} class="rounded-lg border border-ui-border bg-ui-surface p-3 space-y-2">
  <div class="flex items-center justify-between gap-2">
    <h3 class="text-xs font-medium text-neutral-200">{locale.t('canvas.mask_layers')}<InfoTip text={locale.t('canvas.regions_chain_hint')} /></h3>
    <span class="text-xs tabular-nums text-neutral-500">{masks.length}</span>
  </div>
  <div class="flex items-center justify-between gap-2">
    <span class="min-w-0 truncate text-xs text-neutral-300" title={masks.map(mask => mask.name).join(' → ')}>{masks.map(mask => mask.name).join(' → ') || locale.t('canvas.no_layers')}</span>
    <button type="button" onclick={() => canvas.addLayer('mask')} aria-label={locale.t('canvas.add_mask')} title={locale.t('canvas.add_mask')} class="ui-icon-button flex shrink-0 items-center justify-center rounded-md border border-ui-border text-ui-accent hover:bg-ui-selected">+</button>
  </div>
  <p class="text-[11px] leading-snug text-neutral-500">{locale.t('canvas.mask_run_hint')}</p>
</section>
