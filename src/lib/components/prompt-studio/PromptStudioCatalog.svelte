<script lang="ts">
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { autocomplete } from "../../stores/autocomplete.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { DANBOORU_CATEGORIES } from "../../prompt-studio/artists.js";
  import { classifyTag } from "../../prompt-studio/sources.js";
  import { Search, Tag } from "@lucide/svelte";

  let query = $state("");
  let filter = $state<number | null>(null);

  const needle = $derived(query.trim().toLowerCase());

  /** Studio catalogue hits: subcategory variants already authored for the studio. */
  const catalogueHits = $derived.by(() => {
    type Hit = { tag: string; name: string; where: string; subId: string; single: boolean };
    if (needle.length < 2) return [] as Hit[];
    const out: Hit[] = [];
    for (const category of studio.categories) {
      for (const sub of category.subs) {
        const pool = sub.variants ? sub.variants.map((v) => ({ name: v.name, tag: v.tag })) : (sub.sliderSteps ?? []).map((s) => ({ name: s.label, tag: s.tag }));
        for (const variant of pool) {
          if (!variant.tag) continue;
          if (variant.name.toLowerCase().includes(needle) || variant.tag.includes(needle) || variant.tag.replaceAll('_', ' ').includes(needle)) {
            // Filed under the real subcategory, so a catalogue pick keeps its
            // theme and its single-select behaviour instead of landing in a pile.
            out.push({ tag: variant.tag, name: variant.name, where: `${category.name} · ${sub.name}`, subId: sub.id, single: sub.mode === 'single' });
            break;
          }
        }
        if (out.length >= 24) break;
      }
      if (out.length >= 24) break;
    }
    return out;
  });

  const libraryHits = $derived(needle.length >= 2 ? autocomplete.search(query, 40, filter) : []);

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
        placeholder={locale.t("prompt_studio.catalog_search")}
        bind:value={query}
      />
    </label>
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

  {#if needle.length < 2}
    <div class="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-xs leading-relaxed text-neutral-400">
      <p class="font-mono text-[11px] tracking-[0.16em] text-indigo-400 uppercase">catalog_ready</p>
      <p class="mt-2">{locale.t("prompt_studio.catalog_hint")}</p>
      <p class="mt-1 text-neutral-500">
        {locale.t("prompt_studio.library_size")}: <span class="text-neutral-300">{autocomplete.tags.length.toLocaleString(locale.current)}</span>
      </p>
    </div>
  {:else}
    {#if catalogueHits.length}
      <section class="flex flex-col gap-1.5">
        <p class="font-mono text-[10px] tracking-[0.16em] text-indigo-400 uppercase">{locale.t("prompt_studio.catalog_studio")}</p>
        <div class="flex flex-wrap gap-1.5">
          {#each catalogueHits as hit (hit.tag)}
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] {studio.isChosen(hit.tag)
                ? 'border-indigo-500 bg-indigo-500/15 text-neutral-100'
                : 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-indigo-500/60'}"
              title={hit.where}
              onclick={() => addCatalogue(hit)}
            >
              {hit.name}
              <span class="font-mono text-[9px] text-neutral-500">{hit.where.split(" · ")[0]}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <section class="flex flex-col gap-1.5">
      <p class="font-mono text-[10px] tracking-[0.16em] text-fuchsia-400/80 uppercase">{locale.t("prompt_studio.catalog_library")}</p>
      {#if !libraryHits.length}
        <p class="text-[11px] text-neutral-500">{locale.t("prompt_studio.nothing_found")}</p>
      {:else}
        <div class="flex flex-wrap gap-1.5">
          {#each libraryHits as entry (entry.n)}
            {@const target = classifyTag(entry.n, entry.c)}
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] {studio.isChosen(entry.n)
                ? 'border-indigo-500 bg-indigo-500/15 text-neutral-100'
                : 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-indigo-500/60'}"
              title={`${target.category.replace('source:', '')} · ${entry.p.toLocaleString(locale.current)} posts`}
              onclick={() => addLibrary(entry.n, entry.c)}
            >
              <Tag size={10} strokeWidth={2} class="text-neutral-500" />
              {tagName(entry.n)}
              <span class="font-mono text-[9px] text-neutral-500">{locale.t(`prompt_studio.theme_${target.category.replace("source:", "")}`)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>
