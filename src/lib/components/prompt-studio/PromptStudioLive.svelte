<script lang="ts">
  import { customCatalog } from "../../prompt-studio/custom-catalog.svelte.js";
  import { savedSources, type SavedSourceEntry } from "../../prompt-studio/saved-sources.svelte.js";
  import PromptStudioTagImage from "./PromptStudioTagImage.svelte";
  import { onMount } from "svelte";
  import { locale } from "../../stores/locale.svelte.js";
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { BOORU_SOURCES, BooruSearchPager, booruCategoryKey, loadTagGroup, loadTagGroups, tagEntry,
    type BooruSource, type BooruTag, type TagGroupPage, type TagGroupSection } from "../../utils/booru.js";
  let { constructorMode = false, initialSource = 'danbooru', fixedSource = false }: { constructorMode?: boolean; initialSource?: BooruSource; fixedSource?: boolean } = $props();
  let groupLimit = $state(24);
  // svelte-ignore state_referenced_locally
  let source = $state<BooruSource>(initialSource);
  let query = $state("*");
  let results = $state<BooruTag[]>([]);
  let searching = $state(false);
  let searched = $state(false);
  let hasMore = $state(false);
  let searchError = $state("");
  const pager = new BooruSearchPager();
  let revision = 0;
  let sentinel: HTMLDivElement | undefined = $state();
  let groupQuery = $state('');
  let groups = $state<TagGroupSection[]>([]);
  const filteredGroups = $derived.by(() => {
    const needle = groupQuery.trim().toLowerCase();
    return groups.map(section => ({ ...section, groups: section.groups.filter(group =>
      `${section.title} ${group.title} ${group.label} ${group.cluster ?? ''}`.toLowerCase().includes(needle)) })).filter(section => section.groups.length);
  });
  let groupsLoading = $state(false);
  let groupsError = $state("");
  let openTitle = $state("");
  let openGroup = $state<TagGroupPage | null>(null);
  let groupLoading = $state(false);
  let groupError = $state("");
  let groupRequest = 0;
  let indexRequest = 0;

  // Input changes invalidate in-flight work immediately, not just on submit.
  $effect(() => {
    pager.reset(source, query, 24);
    revision++;
    results = []; searched = false; searching = false; searchError = ""; hasMore = false;
  });
  async function nextPage() {
    if (searching || !query.trim()) return;
    const id = revision;
    searching = true; searchError = "";
    try {
      const page = await pager.loadNext();
      if (!page || id !== revision) return;
      results = [...results, ...page.tags];
      hasMore = page.hasMore;
      searched = true;
    } catch (error) {
      if (id === revision) searchError = String(error);
    } finally { if (id === revision) searching = false; }
  }
  function runSearch() {
    pager.reset(source, query, 24);
    revision++; results = []; hasMore = false; searched = false; searching = false;
    void nextPage();
  }
  $effect(() => {
    if (!sentinel || !hasMore || searching || searchError) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void nextPage(); }, { rootMargin: "120px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });
  async function loadGroups() {
    const id = ++indexRequest;
    groupsLoading = true; groupsError = "";
    try { const data = await loadTagGroups(); if (id === indexRequest) groups = data; }
    catch (error) { if (id === indexRequest) groupsError = String(error); }
    finally { if (id === indexRequest) groupsLoading = false; }
  }
  async function openCurated(title: string, retry = false) {
    const id = ++groupRequest;
    groupError = ""; openGroup = null;
    if (openTitle === title && !retry) { openTitle = ""; groupLoading = false; return; }
    openTitle = title; groupLoading = true; groupLimit = 24;
    try { const data = await loadTagGroup(title); if (id === groupRequest) openGroup = data; }
    catch (error) { if (id === groupRequest) groupError = String(error); }
    finally { if (id === groupRequest) groupLoading = false; }
  }
  onMount(() => { savedSources.load(); if (source === "danbooru") void loadGroups(); runSearch(); return () => { revision++; groupRequest++; indexRequest++; pager.reset(source, ""); }; });
  function add(tag: string, category = 0) {
    if (constructorMode && category === 0 && studio.currentSub) studio.choose(tag, tag.replaceAll('_', ' '), studio.currentSub.id, studio.currentSub.mode === 'single');
    else studio.addMany([tagEntry({ name: tag, category })]);
  }
  function bookmark(tag: BooruTag): SavedSourceEntry { return { id: tag.name, name: tag.name, source, tags: [tag.name], category: tag.category }; }
  const chip = "touch-target rounded-lg border px-2.5 py-2 text-left text-xs transition-colors";
</script>

<div class="flex min-w-0 flex-col gap-3">
  <section aria-label={locale.t("settings.sections.booru")} class="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-sm font-semibold text-neutral-200">{locale.t("settings.sections.booru")}</h3>
      {#if !constructorMode && !fixedSource}<select aria-label={locale.t("settings.sections.booru")} class="min-h-10 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-300" bind:value={source}>
        {#each BOORU_SOURCES as entry (entry.id)}<option value={entry.id}>{entry.label}</option>{/each}
      </select>{/if}
    </div>
    <p class="mt-2 text-xs leading-relaxed text-neutral-400">{locale.t("prompt_studio.live_desc")}</p>
    <form class="mt-3 flex gap-2" onsubmit={(event) => { event.preventDefault(); runSearch(); }}>
      <input aria-label={locale.t("prompt_studio.search")} class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-indigo-500" placeholder={locale.t("prompt_studio.search")} bind:value={query} />
      <button type="submit" class="touch-target rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50" disabled={searching || !query.trim()}>{locale.t("prompt_studio.search")}</button>
    </form>
    {#if results.length}
      <div class="sticky top-0 z-10 mt-3 flex flex-wrap gap-2 rounded border border-neutral-800 bg-neutral-900 p-2 text-xs">
        <span class="mr-auto self-center text-neutral-400">{results.length} {locale.t('prompt_studio.tags_word')}</span>
        <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-neutral-300" onclick={() => savedSources.add(results.map(bookmark))}>{locale.t('prompt_studio.save_results')}</button>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {#each results as tag (tag.name)}
          <article class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
            <PromptStudioTagImage tag={tag.name} />
            <div class="flex flex-1 flex-col gap-2 p-3">
              <h4 class="break-words text-xs font-medium {tag.category === 1 ? 'text-red-300' : tag.category === 4 ? 'text-green-300' : tag.category === 3 ? 'text-purple-300' : 'text-sky-300'}">{tag.name.replaceAll('_', ' ')}</h4>
              <p class="text-[10px] text-neutral-500">{tag.post_count.toLocaleString(locale.current)} · {locale.t(booruCategoryKey(tag.category).replace('.cat_', '.category_'))}</p>
              <button type="button" aria-pressed={studio.isChosen(tag.name)} disabled={studio.isChosen(tag.name)} class="touch-target mt-auto rounded border border-neutral-700 px-2 py-2 text-xs text-neutral-200 disabled:border-indigo-500/50 disabled:text-indigo-300" onclick={() => add(tag.name, tag.category)}>{locale.t(studio.isChosen(tag.name) ? 'prompt_studio.added' : 'prompt_studio.add_tag')}</button>
              {#if constructorMode && tag.category === 0 && studio.currentSub}
                <button type="button" disabled={customCatalog.entries.some(entry => entry.tag === tag.name && entry.subId === studio.currentSub?.id)} class="touch-target rounded border border-neutral-700 px-2 py-2 text-xs text-neutral-400 disabled:opacity-40" onclick={() => customCatalog.add({ name: tag.name.replaceAll('_', ' '), tag: tag.name, subId: studio.currentSub!.id })}>{locale.t('prompt_studio.custom_catalog')}</button>
              {/if}
              <button type="button" aria-pressed={savedSources.has(tag.name, source)} class="touch-target rounded px-2 py-1 text-xs text-neutral-400" onclick={() => savedSources.has(tag.name, source) ? savedSources.remove(tag.name, source) : savedSources.add([bookmark(tag)])}>{locale.t(savedSources.has(tag.name, source) ? 'prompt_studio.bookmarked' : 'prompt_studio.bookmark')}</button>
            </div>
          </article>
        {/each}
      </div>
    {/if}
    {#if searchError}
      <div role="alert" class="mt-3 rounded-lg border border-amber-700/40 p-3 text-xs text-amber-300"><p class="break-words">{searchError}</p><button type="button" class="{chip} mt-2 border-neutral-700" onclick={() => void nextPage()}>{locale.t("prompt_studio.retry")}</button></div>
    {:else if searching}
      <p role="status" class="mt-3 text-xs text-neutral-400">{locale.t("prompt_studio.loading")}</p>
    {:else if searched && !results.length}
      <p role="status" class="mt-3 text-xs text-neutral-400">{locale.t("prompt_studio.nothing_found")}</p>
    {/if}
    {#if hasMore && !searchError}
      <div bind:this={sentinel} class="mt-3 flex justify-center"><button type="button" class="{chip} border-neutral-700 text-neutral-300 hover:border-indigo-500 disabled:opacity-50" disabled={searching} onclick={() => void nextPage()}>{locale.t("prompt_studio.show_more")}</button></div>
    {/if}
  </section>
  {#if source === "danbooru"}
  <details open={constructorMode} class="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
    <summary class="cursor-pointer text-sm text-neutral-300">{locale.t("prompt_studio.live_groups_title")}</summary>
    <div class="flex items-center justify-between gap-3"><h3 class="text-sm font-semibold text-neutral-200">{locale.t("prompt_studio.live_groups_title")}</h3><button type="button" class="touch-target text-xs text-neutral-400 hover:text-neutral-200" disabled={groupsLoading} onclick={() => void loadGroups()}>{locale.t("prompt_studio.reload")}</button></div>
    <input aria-label={locale.t('prompt_studio.search_groups')} bind:value={groupQuery} placeholder={locale.t('prompt_studio.search_groups')} class="mt-3 w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-200" />
    {#if groupsLoading}<p role="status" class="mt-3 text-xs text-neutral-400">{locale.t("prompt_studio.loading")}</p>
    {:else if groupsError}<p role="alert" class="mt-3 break-words text-xs text-amber-300">{groupsError}</p>
    {:else if !filteredGroups.length}<p role="status" class="mt-3 text-xs text-neutral-400">{locale.t("prompt_studio.nothing_found")}</p>
    {:else}
      <div class="mt-3 flex flex-col gap-3">
        {#each filteredGroups as section (section.title)}
          <div><p class="text-xs font-medium text-neutral-400">{section.title}</p><div class="mt-2 flex flex-wrap gap-1.5">
            {#each section.groups as group (group.title)}
              <button type="button" aria-expanded={openTitle === group.title} class="{chip} {openTitle === group.title ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-indigo-500'}" title={group.cluster ?? section.title} onclick={() => void openCurated(group.title)}>{group.label}</button>
            {/each}
          </div></div>
        {/each}
      </div>
    {/if}
    {#if groupLoading}<p role="status" class="mt-3 text-xs text-neutral-400">{locale.t("prompt_studio.loading")}</p>
    {:else if groupError}<div role="alert" class="mt-3 text-xs text-amber-300"><p class="break-words">{groupError}</p><button type="button" class="{chip} mt-2 border-neutral-700" onclick={() => void openCurated(openTitle, true)}>{locale.t("prompt_studio.retry")}</button></div>
    {:else if openGroup}
      <div class="mt-4 rounded-lg border border-neutral-700 bg-neutral-950 p-3"><h4 class="text-sm font-medium text-neutral-200">{openGroup.label}</h4>
        <button type="button" class="touch-target mt-2 rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => savedSources.add([{ id: openGroup!.title, name: openGroup!.label, source: 'danbooru:group', tags: openGroup!.sections.flatMap(block => block.tags) }])}>{locale.t('prompt_studio.save_catalogue')}</button>
        {#if openGroup.summary}<p class="mt-1 text-xs leading-relaxed text-neutral-400">{openGroup.summary}</p>{/if}
        {#each openGroup.sections as block (block.title)}
          <p class="mt-3 text-xs text-neutral-400">{block.title}</p>
          <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {#each block.tags.slice(0, groupLimit) as tag (tag)}
              <article class="overflow-hidden rounded border border-neutral-800">
                <PromptStudioTagImage {tag} />
                <button type="button" disabled={studio.isChosen(tag)} aria-pressed={studio.isChosen(tag)} class="touch-target w-full break-words p-3 text-left text-xs text-sky-300 disabled:text-indigo-300" onclick={() => add(tag)}>{tag.replaceAll('_', ' ')} {studio.isChosen(tag) ? '✓' : '+'}</button>
              </article>
            {/each}
          </div>
          {#if block.tags.length > groupLimit}<button type="button" class="touch-target mt-2 rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => groupLimit += 24}>{locale.t('prompt_studio.show_more')}</button>{/if}
        {/each}
      </div>
    {/if}
  </details>
  {/if}
</div>
