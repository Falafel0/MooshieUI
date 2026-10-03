<script lang="ts">
  import { generation } from "../../stores/generation.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import AnimaNodeRequirement from "./AnimaNodeRequirement.svelte";
  let opened = $state(false);
  import { styles } from "../../stores/styles.svelte.js";
  let advancedMixer = $state(false);
  const activeArtistCount = $derived(styles.activeStyles.reduce((sum, style) => sum + style.artists.length, 0));
</script>

<details bind:open={opened} class="mb-4 border-b border-neutral-800 pb-3">
  <summary class="touch-target flex items-center cursor-pointer text-sm font-medium text-neutral-300">{locale.t("anima_studio.tab.mixer")}</summary>
  {#if opened}
<div class="mt-3 space-y-4" onchange={() => void generation.saveSettings()}>
          <div class="flex items-start justify-between gap-3 border-b border-neutral-800 pb-3">
            <div><h3 class="text-sm font-medium text-neutral-100">{locale.t("anima_studio.tab.mixer")}</h3><p class="mt-1 text-xs text-neutral-500">{locale.t("anima_studio.mixer.desc", { count: activeArtistCount })}</p></div>
            <input type="checkbox" aria-label={locale.t("anima_studio.tab.mixer")} bind:checked={generation.animaArtistMixer.enabled} disabled={activeArtistCount === 0} />
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.method")}<select bind:value={generation.animaArtistMixer.method} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="adapter">Adapter Mixer</option><option value="cross_attention">Cross Attention</option></select></label>
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.strength")} <span class="float-right font-mono text-amber-300">{generation.animaArtistMixer.strength.toFixed(2)}</span><input type="range" min="0" max="4" step="0.05" bind:value={generation.animaArtistMixer.strength} class="mt-2 w-full" /></label>
            {#if generation.animaArtistMixer.method === "adapter"}
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.alignment")}<select bind:value={generation.animaArtistMixer.alignment_mode} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="base_anchored">base anchored</option><option value="shared_base_ids">shared base ids</option></select></label>
              <label class="touch-target flex items-center justify-between gap-3 rounded-lg bg-neutral-900 p-3 text-xs text-neutral-300">{locale.t("anima_studio.mixer.normalize_weights")}<input type="checkbox" bind:checked={generation.animaArtistMixer.normalize_weights} /></label>
            {:else}
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.combine")}<select bind:value={generation.animaArtistMixer.combine_mode} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="concat">concat</option><option value="output_avg">output avg</option><option value="lowrank_avg">lowrank avg</option></select></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.fusion")}<select bind:value={generation.animaArtistMixer.fusion_mode} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="interpolate">interpolate</option><option value="concat_with_base">concat with base</option><option value="base_preserve">base preserve</option></select></label>
            {/if}
          </div>
          <button type="button" aria-expanded={advancedMixer} class="touch-target text-xs text-neutral-400 hover:text-neutral-100" onclick={() => (advancedMixer = !advancedMixer)}>{advancedMixer ? "▾" : "▸"} {locale.t("anima_studio.mixer.advanced")}</button>
          {#if advancedMixer}
            <div class="grid gap-3 border-t border-neutral-800 pt-3 sm:grid-cols-2 ">
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.start_end_percent")}<div class="mt-1 flex gap-2"><input type="number" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.start_percent} class="touch-target min-w-0 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /><input type="number" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.end_percent} class="touch-target min-w-0 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /></div></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.start_end_block")}<div class="mt-1 flex gap-2"><input type="number" min="0" max="63" bind:value={generation.animaArtistMixer.start_block} class="touch-target min-w-0 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /><input type="number" min="-1" max="63" bind:value={generation.animaArtistMixer.end_block} class="touch-target min-w-0 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /></div></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.style_balance")} <span class="float-right font-mono text-neutral-200">{generation.animaArtistMixer.style_balance.toFixed(2)}</span><input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.style_balance} class="touch-target mt-2 w-full" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.structure_preserve")} <span class="float-right font-mono text-neutral-200">{generation.animaArtistMixer.structure_preserve.toFixed(2)}</span><input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.structure_preserve} class="touch-target mt-2 w-full" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.delta_norm_cap")}<input type="number" min="0" max="4" step="0.1" bind:value={generation.animaArtistMixer.delta_norm_cap} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.ema_alpha")}<input type="number" min="0" max="0.95" step="0.05" bind:value={generation.animaArtistMixer.artist_ema_alpha} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.lowrank_k")}<input type="number" min="1" max="32" bind:value={generation.animaArtistMixer.lowrank_k} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.uncond_strength")} <span class="float-right font-mono text-neutral-200">{generation.animaArtistMixer.uncond_strength.toFixed(2)}</span><input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.uncond_strength} class="touch-target mt-2 w-full" /></label>
              <label class="touch-target flex items-center justify-between gap-3 rounded-lg bg-neutral-900 p-3 text-xs text-neutral-300">{locale.t("anima_studio.mixer.apply_uncond")}<input type="checkbox" bind:checked={generation.animaArtistMixer.apply_to_uncond} /></label>
              <label class="touch-target flex items-center justify-between gap-3 rounded-lg bg-neutral-900 p-3 text-xs text-neutral-300">{locale.t("anima_studio.mixer.static_capture")}<input type="checkbox" bind:checked={generation.animaArtistMixer.artist_static_capture} /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.capture_k")}<input type="number" min="1" max="12" bind:value={generation.animaArtistMixer.static_capture_k} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="touch-target flex items-center justify-between gap-3 rounded-lg bg-neutral-900 p-3 text-xs text-neutral-300">{locale.t("anima_studio.mixer.anchor_enabled")}<input type="checkbox" bind:checked={generation.animaArtistMixer.artist_anchor_q} /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_seeds")}<input bind:value={generation.animaArtistMixer.anchor_seed_list} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" placeholder="12, 42" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_seed_count")}<input type="number" min="1" max="4" bind:value={generation.animaArtistMixer.anchor_seeds_count} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_user_blend")} <span class="float-right font-mono text-neutral-200">{generation.animaArtistMixer.anchor_user_blend.toFixed(2)}</span><input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.anchor_user_blend} class="touch-target mt-2 w-full" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_deep_layer")}<input type="number" min="-1" max="64" bind:value={generation.animaArtistMixer.anchor_deep_layer_threshold} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.stabilizer_end")} <span class="float-right font-mono text-neutral-200">{generation.animaArtistMixer.stabilizer_end_percent.toFixed(2)}</span><input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.stabilizer_end_percent} class="touch-target mt-2 w-full" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_refresh")}<select bind:value={generation.animaArtistMixer.anchor_refresh_mode} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2"><option value="once">once</option><option value="warm_cache">warm cache</option></select></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_cache_points")}<input type="number" min="2" max="12" bind:value={generation.animaArtistMixer.anchor_cache_points} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_keyframe")}<select bind:value={generation.animaArtistMixer.anchor_keyframe_mode} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2"><option value="uniform_sigma">uniform sigma</option><option value="adaptive_q">adaptive Q</option></select></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.layer_filter")}<input bind:value={generation.animaArtistMixer.layer_filter} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2" placeholder="0, 3, 5-10, -1" /></label>
            </div>
          {/if}
          <AnimaNodeRequirement kind="mixer" />
        </div>

  {/if}
</details>
