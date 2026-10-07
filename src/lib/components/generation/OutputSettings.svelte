<script lang="ts">
  import { generation } from "../../stores/generation.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import InfoTip from "../ui/InfoTip.svelte";
  const metadataUpgradedToBoth = $derived(
    generation.outputBitDepth === "16bit" && generation.metadataMode === "stealth"
  );

  const effectiveMetadataMode = $derived(
    metadataUpgradedToBoth ? "both" : generation.metadataMode
  );

</script>
<details class="group rounded-lg border border-ui-border/60 bg-ui-surface/40" data-output-settings>
  <summary class="ui-control flex cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs text-neutral-300 [&::-webkit-details-marker]:hidden">
    <span class="font-medium">{locale.t('generation.workspace.output')}</span>
    <span class="flex items-center gap-2 text-neutral-500"><span>{generation.outputFormat.toUpperCase()} · {locale.t(generation.outputBitDepth === '16bit' ? 'generation.sampler.bit_16' : 'generation.sampler.bit_8')}</span><svg class="size-3.5 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
  </summary>
  <div class="space-y-3 border-t border-ui-border/60 p-3">
  <!-- Bit Depth + Metadata -->
  <div class="grid grid-cols-2 gap-2">
    <div>
      <label class="block text-xs text-neutral-400 mb-1">{locale.t('generation.sampler.bit_depth')}<InfoTip text={locale.t('generation.sampler.bit_depth_tip')} /></label>
      <div class="flex gap-1">
        {#each ["8bit", "16bit"] as depth}
          {@const depthLocked = depth === "16bit" && generation.outputFormat === "webp"}
          <button
            disabled={depthLocked}
            title={depthLocked ? locale.t('generation.sampler.bit_16_webp_disabled') : undefined}
            class="flex-1 py-1 text-[11px] rounded-lg border transition-colors {generation.outputBitDepth === depth
              ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
              : 'bg-neutral-800/50 border-neutral-700 text-neutral-400 hover:border-neutral-600'} {depthLocked ? 'opacity-40 cursor-not-allowed hover:border-neutral-700' : ''}"
            aria-pressed={generation.outputBitDepth === depth} onclick={() => { generation.outputBitDepth = depth as "8bit" | "16bit"; generation.saveSettings(); }}
          >
            {depth === "8bit" ? locale.t('generation.sampler.bit_8') : locale.t('generation.sampler.bit_16')}
          </button>
        {/each}
      </div>
    </div>
    <div>
      <label class="block text-xs text-neutral-400 mb-1">{locale.t('generation.sampler.output_format')}<InfoTip text={locale.t('generation.sampler.output_format_tip')} /></label>
      <div class="flex gap-1">
        {#each ["png", "jxl", "webp"] as fmt}
          <button
            class="flex-1 py-1 text-[11px] rounded-lg border transition-colors {generation.outputFormat === fmt
              ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
              : 'bg-neutral-800/50 border-neutral-700 text-neutral-400 hover:border-neutral-600'}"
            aria-pressed={generation.outputFormat === fmt} onclick={() => {
              generation.outputFormat = fmt as "png" | "jxl" | "webp";
              // Lossless WebP (VP8L) has no 16-bit variant, so keep the pair valid.
              if (fmt === "webp") generation.outputBitDepth = "8bit";
              generation.saveSettings();
            }}
          >
            {fmt === "png"
              ? locale.t('generation.sampler.format_png')
              : fmt === "jxl"
                ? locale.t('generation.sampler.format_jxl')
                : locale.t('generation.sampler.format_webp')}
          </button>
        {/each}
      </div>
    </div>
  </div>
  <div class="grid grid-cols-1 gap-2">
    <div>
      <label class="block text-xs text-neutral-400 mb-1">{locale.t('generation.sampler.metadata')}<InfoTip text={locale.t('generation.sampler.metadata_tip')} /></label>
      <div class="flex gap-1">
        {#each [["text_chunk", locale.t('generation.sampler.metadata_text')], ["stealth", locale.t('generation.sampler.metadata_stealth')], ["both", locale.t('generation.sampler.metadata_both')]] as [value, label]}
          <button
            class="flex-1 py-1 text-[11px] rounded-lg border transition-colors {effectiveMetadataMode === value
              ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
              : 'bg-neutral-800/50 border-neutral-700 text-neutral-400 hover:border-neutral-600'}"
            aria-pressed={effectiveMetadataMode === value} onclick={() => { generation.metadataMode = value as "text_chunk" | "stealth" | "both"; generation.saveSettings(); }}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>
  </div>
  {#if metadataUpgradedToBoth}
    <p class="text-[10px] text-indigo-300 -mt-1">
      {locale.t('generation.sampler.metadata_upgraded')}
    </p>
  {/if}

  </div>
</details>
