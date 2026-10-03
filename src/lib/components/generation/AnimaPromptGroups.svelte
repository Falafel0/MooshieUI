<script lang="ts">
  import { generation } from "../../stores/generation.svelte.js";
  import { autocomplete } from "../../stores/autocomplete.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { ANIMA_PROMPT_GROUPS, ANIMA_GROUP_LABELS, parseTagList, updateTagList, type AnimaPromptGroup } from "../../utils/animaIntegration.js";
  import AnimaNodeRequirement from "./AnimaNodeRequirement.svelte";
  import PromptTextarea from "./PromptTextarea.svelte";
  let opened = $state(false);
  let group = $state<AnimaPromptGroup>("character_tags");
  let query = $state("");
  const hits = $derived(query.trim() ? autocomplete.search(query, 20) : []);
  function add(tag: string) {
    generation.animaTools[group] = updateTagList(generation.animaTools[group], tag.replace(/^@/, '').replaceAll('_', ' '));
    void generation.saveSettings();
  }
  function edit(value: string) {
    generation.animaTools[group] = value;
    void generation.saveSettings();
  }
</script>

<details bind:open={opened} class="border-t border-neutral-800 pt-3">
  <summary class="cursor-pointer text-xs font-medium text-neutral-300">{locale.t("anima_studio.tab.groups")}</summary>
  {#if opened}
    <div class="mt-3 space-y-3" onchange={() => void generation.saveSettings()}>
      <label class="touch-target flex items-center gap-2 text-xs text-neutral-300"><input type="checkbox" bind:checked={generation.animaTools.enabled} />{locale.t("anima_studio.enable")}</label>
      <select aria-label={locale.t("anima_studio.tab.groups")} class="touch-target w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200" bind:value={group}>
        {#each ANIMA_PROMPT_GROUPS as id}<option value={id}>{locale.t(ANIMA_GROUP_LABELS[id])} ({parseTagList(generation.animaTools[id]).length})</option>{/each}
      </select>
      <p class="text-xs text-neutral-400">{locale.t(ANIMA_GROUP_LABELS[group])}</p>
      {#key group}
        <PromptTextarea bind:value={() => generation.animaTools[group], edit} rows={3} minHeight="min-h-24" storageKey={`anima-group-${group}`} placeholder={locale.t("anima_studio.group.placeholder")} />
      {/key}
      {#if parseTagList(generation.animaTools[group]).length}
        <details><summary class="cursor-pointer text-xs text-neutral-500">{locale.t("prompt_studio.remove_tag")}</summary><div class="mt-2 flex flex-wrap gap-1.5">{#each [...new Set(parseTagList(generation.animaTools[group]))] as tag (tag)}<button type="button" class="touch-target rounded-lg bg-neutral-800 px-2 text-xs text-neutral-300" aria-label={`${locale.t("prompt_studio.remove_tag")}: ${tag}`} onclick={() => { generation.animaTools[group] = updateTagList(generation.animaTools[group], tag, true); void generation.saveSettings(); }}>{tag} ×</button>{/each}</div></details>
      {/if}
      <input aria-label={locale.t("anima_studio.catalog.search")} class="touch-target w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200" bind:value={query} placeholder={locale.t("anima_studio.catalog.search")} />
      {#if query.trim() && !hits.length}<p role="status" class="text-xs text-neutral-500">{locale.t("prompt_studio.nothing_found")}</p>{/if}
      <div class="flex flex-wrap gap-1.5">{#each hits as entry (entry.n)}<button type="button" class="touch-target rounded-lg bg-neutral-800 px-2 py-1 text-xs text-neutral-300" onclick={() => add(entry.n)}>{entry.n.replaceAll('_', ' ')}</button>{/each}</div>
      <AnimaNodeRequirement kind="tools" />
    </div>
  {/if}
</details>
