<script lang="ts">
  import { generation } from "../../stores/generation.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import AnimaNodeRequirement from "./AnimaNodeRequirement.svelte";
  let opened = $state(false);
</script>

<details bind:open={opened} class="border-t border-neutral-800 pt-3">
  <summary class="touch-target flex items-center cursor-pointer text-xs font-medium text-neutral-300">{locale.t("anima_studio.composer.title")}</summary>
  {#if opened}
<div class="mt-3 space-y-4" onchange={() => { if (generation.animaTools.composer_enabled) generation.animaTools.enabled = true; void generation.saveSettings(); }}>
          <div class="flex items-start justify-between gap-3 border-b border-neutral-800 pb-3">
            <div><h3 class="text-sm font-medium text-neutral-100">{locale.t("anima_studio.composer.title")}</h3><p class="mt-1 text-xs text-neutral-500">{locale.t("anima_studio.composer.desc")}</p></div>
            <input type="checkbox" aria-label={locale.t("anima_studio.composer.title")} bind:checked={generation.animaTools.composer_enabled} />
          </div>
          <div class="flex flex-wrap gap-2">
            {#each [["enable_artist", "artist"], ["enable_character", "character"], ["enable_clothing", "clothing"], ["enable_background", "background"], ["enable_pose", "pose"]] as item}
              <label class="flex items-center gap-2 touch-target rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-300"><input type="checkbox" bind:checked={generation.animaTools[item[0] as "enable_artist"]} />{locale.t(`anima_studio.group.${item[1]}`)}</label>
            {/each}
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.composer.seed")}<input type="number" min="-1" max="2147483647" bind:value={generation.animaTools.seed} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-neutral-200" /></label>
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.composer.artists")}<input type="number" min="0" max="20" bind:value={generation.animaTools.artist_count} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-neutral-200" /></label>
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.composer.character_detail")}<select bind:value={generation.animaTools.character_detail} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="trigger">trigger</option><option value="trigger_tags">trigger + tags</option><option value="trigger_random_tags">trigger + random tags</option></select></label>
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.composer.clothing_source")}<select bind:value={generation.animaTools.clothing_source} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="author">author</option><option value="danbooru">danbooru</option><option value="character_tags">character tags</option><option value="random">random</option></select></label>
          </div>
          <AnimaNodeRequirement kind="tools" />
        </div>
      
  {/if}
</details>
