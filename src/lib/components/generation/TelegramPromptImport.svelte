<script lang="ts">
  import { generation } from "../../stores/generation.svelte.js";
  import { autocomplete } from "../../stores/autocomplete.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { parseTelegramExport, type TelegramPromptRecipe } from "../../utils/telegramPromptImport.js";
  import { groupAnimaTags, parseTagList, updateTagList, type AnimaPromptGroup } from "../../utils/animaIntegration.js";
  let recipes = $state<TelegramPromptRecipe[]>([]);
  let error = $state("");
  let busy = $state(false);
  let pending = $state<TelegramPromptRecipe | null>(null);
  let status = $state("");
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    busy = true; error = ''; status = ''; pending = null;
    try {
      recipes = parseTelegramExport(file.name, await file.text());
      if (!recipes.length) error = locale.t("anima_studio.telegram.empty");
    } catch (cause) { recipes = []; error = `${locale.t("anima_studio.telegram.error")}: ${String(cause)}`; }
    finally { busy = false; }
  }
  function apply(recipe: TelegramPromptRecipe, mode: "replace" | "append" | "groups") {
    if (mode === 'groups') {
      const groups = groupAnimaTags(parseTagList(recipe.positive), autocomplete.tags);
      for (const [key, tags] of Object.entries(groups)) {
        const group = key as AnimaPromptGroup;
        for (const tag of tags) generation.animaTools[group] = updateTagList(generation.animaTools[group], tag);
      }
      generation.animaTools.enabled = true;
    } else if (mode === 'replace') {
      generation.positivePrompt = recipe.positive;
      if (recipe.negative) generation.negativePrompt = recipe.negative;
    } else {
      generation.positivePrompt = [generation.positivePrompt.trim(), recipe.positive].filter(Boolean).join(', ');
      if (recipe.negative) generation.negativePrompt = [generation.negativePrompt.trim(), recipe.negative].filter(Boolean).join(', ');
    }
    pending = null; status = locale.t("anima_sources.imported");
    void generation.saveSettings();
  }
</script>

<details class="mt-4 border-t border-neutral-800 pt-3">
  <summary class="cursor-pointer text-sm font-medium text-neutral-300">{locale.t("anima_studio.telegram.title")}</summary>
  <div class="mt-3 space-y-3">
    <p class="text-xs leading-relaxed text-neutral-400">{locale.t("anima_studio.telegram.desc")}</p>
    <label class="touch-target inline-flex cursor-pointer items-center rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200">
      {locale.t("anima_studio.telegram.choose")}<input type="file" accept=".json,.html,.htm,application/json,text/html" class="hidden" disabled={busy} onchange={importFile} />
    </label>
    {#if busy}<p role="status" class="text-xs text-neutral-400">{locale.t("prompt_studio.loading")}</p>{/if}
    {#if error}<p role="alert" class="break-words text-xs text-amber-300">{error}</p>{/if}
    {#if status}<p role="status" class="text-xs text-neutral-300">{status}</p>{/if}
    {#if pending}
      <div role="alert" class="rounded-lg border border-neutral-700 p-3 text-xs text-neutral-300"><p>{locale.t("prompt_studio.replace_prompt_confirm")}</p><div class="mt-2 flex gap-2"><button type="button" class="touch-target rounded-lg bg-indigo-600 px-3 text-white" onclick={() => pending && apply(pending, 'replace')}>{locale.t("common.confirm")}</button><button type="button" class="touch-target rounded-lg border border-neutral-700 px-3" onclick={() => pending = null}>{locale.t("common.cancel")}</button></div></div>
    {/if}
    {#each recipes as recipe (recipe.id)}
      <article class="rounded-lg bg-neutral-900 p-3">
        <div class="flex items-center justify-between gap-2 text-xs"><span class="truncate text-neutral-200">{recipe.chat}</span><span class="text-neutral-500">{recipe.date}</span></div>
        <p class="mt-2 line-clamp-3 text-xs leading-relaxed text-neutral-400">{recipe.positive}</p>
        {#if recipe.negative}<p class="mt-1 line-clamp-2 text-xs text-neutral-500">− {recipe.negative}</p>{/if}
        <div class="mt-3 flex flex-wrap gap-2">
          {#if generation.isAnima}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300" onclick={() => apply(recipe, 'groups')}>{locale.t("anima_studio.telegram.to_groups")}</button>{/if}
          <button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300" onclick={() => apply(recipe, 'append')}>{locale.t("prompt_assistant.append")}</button>
          <button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300" onclick={() => { if (generation.positivePrompt.trim() || generation.negativePrompt.trim()) pending = recipe; else apply(recipe, 'replace'); }}>{locale.t("prompt_assistant.replace")}</button>
        </div>
      </article>
    {/each}
  </div>
</details>
