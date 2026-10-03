<script lang="ts">
  import { customCatalog } from "../../prompt-studio/custom-catalog.svelte.js";
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { autocomplete } from "../../stores/autocomplete.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { DANBOORU_CATEGORIES } from "../../prompt-studio/artists.js";
  import { classifyTag } from "../../prompt-studio/sources.js";
  import PromptStudioPreview from "./PromptStudioPreview.svelte";
  import PromptStudioTagImage from "./PromptStudioTagImage.svelte";
  import { Search, Tag } from "@lucide/svelte";

  let query = $state("");
  let limit = $state(80);
  let sort = $state("popular");
  let previewTag = $state("");
  $effect(() => { query; filter; sort; limit = 80; });
  let filter = $state<number | null>(null);

  const needle = $derived(query.trim().toLowerCase());

  /** Studio catalogue hits: subcategory variants already authored for the studio. */
  const catalogueHits = $derived.by(() => {
    type Hit = { tag: string; name: string; where: string; subId: string; single: boolean };
    const out: Hit[] = [];
    for (const category of studio.categories) {
      for (const sub of category.subs) {
        const authored = sub.variants ? sub.variants.map((v) => ({ name: v.name, tag: v.tag })) : (sub.sliderSteps ?? []).map((s) => ({ name: s.label, tag: s.tag }));
        const pool = [...authored, ...customCatalog.entries.filter(entry => entry.subId === sub.id && !authored.some(variant => variant.tag === entry.tag))];
        for (const variant of pool) {
          if (!variant.tag) continue;
          if (variant.name.toLowerCase().includes(needle) || variant.tag.includes(needle) || variant.tag.replaceAll('_', ' ').includes(needle)) {
            // Filed under the real subcategory, so a catalogue pick keeps its
            // theme and its single-select behaviour instead of landing in a pile.
            out.push({ tag: variant.tag, name: variant.name, where: `${category.name} · ${sub.name}`, subId: sub.id, single: sub.mode === 'single' });
          }
        }
      }
    }
    return out.filter((hit, index) => out.findIndex((other) => other.tag === hit.tag) === index).sort((a, b) => a.where.localeCompare(b.where, locale.current) || a.name.localeCompare(b.name, locale.current));
  });

  const libraryHits = $derived.by(() => autocomplete.tags.filter(entry =>
    (filter === null || entry.c === filter) && (!needle || entry.n.includes(needle.replaceAll(' ', '_')) || entry.a?.some(alias => alias.toLowerCase().includes(needle))))
    .sort((a, b) => sort === 'az' ? a.n.localeCompare(b.n) : sort === 'za' ? b.n.localeCompare(a.n) : b.p - a.p || a.n.localeCompare(b.n)));

  const counts = $derived.by(() => {
    const map = new Map<number, number>();
    for (const entry of autocomplete.tags) map.set(entry.c, (map.get(entry.c) ?? 0) + 1);
    return map;
  });

  function addCatalogue(hit: { tag: string; name: string; subId: string; single: boolean }) {
    studio.choose(hit.tag, hit.name, hit.subId, hit.single);
  }

  function addLibrary(tag: string, category: number) {
    const { category: target, name } = classifyTag(tag, category);
    studio.choose(tag, name, target);
  }

  const tagName = (tag: string) => (studio.readable ? tag.replaceAll("_", " ") : tag);
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-3">
  <div class="flex flex-wrap items-center gap-2">
    <label class="relative flex min-w-[240px] flex-1 items-center">
      <Search size={14} strokeWidth={1.8} class="absolute left-2.5 text-neutral-500" />
      <input
        class="w-full rounded-lg border border-neutral-800 bg-neutral-950 py-2 pr-2 pl-8 text-xs text-neutral-200 outline-none focus:border-indigo-500"
        aria-label={locale.t("prompt_studio.catalog_search")}
        placeholder={locale.t("prompt_studio.catalog_search")}
        bind:value={query}
      />
    </label>
    <select aria-label={locale.t("prompt_studio.sort_tags")} class="rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" bind:value={sort}><option value="popular">{locale.t("prompt_studio.sort_post_count")}</option><option value="az">{locale.t("prompt_studio.sort_az")}</option><option value="za">{locale.t("prompt_studio.sort_za")}</option></select>
  </div>

  <div class="flex flex-wrap gap-1.5">
    <button
      type="button"
      class="rounded-lg border px-2.5 py-1 text-[11px] {filter === null
        ? 'border-indigo-500 bg-indigo-500/10 text-neutral-100'
        : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}"
      onclick={() => (filter = null)}
    >
      {locale.t("prompt_studio.all_groups")}
    </button>
    {#each DANBOORU_CATEGORIES as category (category.id)}
      <button
        type="button"
        class="rounded-lg border px-2.5 py-1 text-[11px] {filter === category.id
          ? 'border-indigo-500 bg-indigo-500/10 text-neutral-100'
          : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}"
        onclick={() => (filter = filter === category.id ? null : category.id)}
      >
        {locale.t(category.key)}
        <span class="ml-1 font-mono text-[9px] text-neutral-500">{(counts.get(category.id) ?? 0).toLocaleString(locale.current)}</span>
      </button>
    {/each}
  </div>

  <p role="status" class="text-xs text-neutral-400">{locale.t("prompt_studio.catalog_counts", { catalog: locale.formatInteger(catalogueHits.length), library: locale.formatInteger(libraryHits.length) })}</p>
  {#if autocomplete.loading}<p role="status" class="text-xs text-neutral-400">{locale.t("prompt_studio.loading")}</p>{/if}
  {#if autocomplete.error}<p role="alert" class="text-xs text-amber-300">{locale.t("prompt_studio.library_error")}</p>{/if}
  {#if previewTag}<PromptStudioPreview tag={previewTag} onClose={() => previewTag = ''} />{/if}
  {#if (filter === null || filter === 0) && catalogueHits.length}
    <h4 class="text-xs text-neutral-400">{locale.t('prompt_studio.catalog_studio')}</h4>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {#each catalogueHits.slice(0, limit) as hit (hit.tag)}
        <article class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
          <PromptStudioTagImage tag={hit.tag} subId={hit.subId} />
          <div class="flex flex-1 flex-col gap-2 p-3">
            <h4 class="break-words text-xs text-sky-300">{hit.name}</h4><p class="text-[10px] text-neutral-500">{hit.where}</p>
            <button type="button" class="touch-target mt-auto rounded border border-neutral-700 px-2 py-2 text-xs text-neutral-300" aria-pressed={studio.isChosen(hit.tag)} onclick={() => addCatalogue(hit)}>{locale.t(studio.isChosen(hit.tag) ? 'prompt_studio.remove_tag' : 'prompt_studio.add_tag')}</button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
  {#if libraryHits.length}
    <h4 class="text-xs text-neutral-400">{locale.t('prompt_studio.catalog_library')}</h4>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {#each libraryHits.slice(0, limit) as hit (hit.n)}
        <article class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
          <PromptStudioTagImage tag={hit.n} />
          <div class="flex flex-1 flex-col gap-2 p-3">
            <h4 class="break-words text-xs {hit.c === 1 ? 'text-red-300' : hit.c === 4 ? 'text-green-300' : 'text-sky-300'}">{tagName(hit.n)}</h4><p class="text-[10px] text-neutral-500">{hit.p.toLocaleString(locale.current)}</p>
            <button type="button" class="touch-target mt-auto rounded border border-neutral-700 px-2 py-2 text-xs text-neutral-300" aria-pressed={studio.isChosen(hit.n)} onclick={() => addLibrary(hit.n, hit.c)}>{locale.t(studio.isChosen(hit.n) ? 'prompt_studio.remove_tag' : 'prompt_studio.add_tag')}</button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
  {#if !catalogueHits.length && !libraryHits.length}<p role="status" class="text-sm text-neutral-500">{locale.t('prompt_studio.nothing_found')}</p>{/if}
  {#if catalogueHits.length > limit || libraryHits.length > limit}<button type="button" class="touch-target self-center rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => limit += 40}>{locale.t('prompt_studio.show_more')}</button>{/if}
</div>
