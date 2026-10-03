<script lang="ts">
  import { onMount } from "svelte";
  import { locale } from "../../stores/locale.svelte.js";
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { BOORU_SOURCES, BooruSearchPager, booruCategoryKey, loadTagGroup, loadTagGroups, tagEntry,
    type BooruSource, type BooruTag, type TagGroupPage, type TagGroupSection } from "../../utils/booru.js";
  let source = $state<BooruSource>("danbooru");
  let query = $state("");
  let results = $state<BooruTag[]>([]);
  let searching = $state(false);
  let searched = $state(false);
  let hasMore = $state(false);
  let searchError = $state("");
  const pager = new BooruSearchPager();
  let revision = 0;
  let sentinel: HTMLDivElement | undefined = $state();
  let groups = $state<TagGroupSection[]>([]);
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
    openTitle = title; groupLoading = true;
    try { const data = await loadTagGroup(title); if (id === groupRequest) openGroup = data; }
    catch (error) { if (id === groupRequest) groupError = String(error); }
    finally { if (id === groupRequest) groupLoading = false; }
  }
  onMount(() => { void loadGroups(); return () => { revision++; groupRequest++; indexRequest++; pager.reset(source, ""); }; });
  function add(tag: string, category = 0) { studio.addMany([tagEntry({ name: tag, category })]); }
  const chip = "touch-target rounded-lg border px-2.5 py-2 text-left text-xs transition-colors";
</script>

<div class="flex min-w-0 flex-col gap-3">
  <section aria-label={locale.t("settings.sections.booru")} class="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-sm font-semibold text-neutral-200">{locale.t("settings.sections.booru")}</h3>
      <select aria-label={locale.t("settings.sections.booru")} class="min-h-10 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-300" bind:value={source}>
        {#each BOORU_SOURCES as entry (entry.id)}<option value={entry.id}>{entry.label}</option>{/each}
      </select>
    </div>
    <p class="mt-2 text-xs leading-relaxed text-neutral-400">{locale.t("prompt_studio.live_desc")}</p>
    <form class="mt-3 flex gap-2" onsubmit={(event) => { event.preventDefault(); runSearch(); }}>
      <input aria-label={locale.t("prompt_studio.search")} class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-indigo-500" placeholder={locale.t("prompt_studio.search")} bind:value={query} />
      <button type="submit" class="touch-target rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50" disabled={searching || !query.trim()}>{locale.t("prompt_studio.search")}</button>
    </form>
    {#if results.length}
      <div class="mt-3 flex flex-wrap gap-2">
        {#each results as tag (tag.name)}
          <button type="button" aria-pressed={studio.isChosen(tag.name)} disabled={studio.isChosen(tag.name)} class="{chip} {studio.isChosen(tag.name) ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300' : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-indigo-500'}" onclick={() => add(tag.name, tag.category)}>
            {tag.name.replaceAll("_", " ")} <span class="ml-1 text-[10px] text-neutral-400">{tag.post_count.toLocaleString(locale.current)} · {locale.t(booruCategoryKey(tag.category).replace(".cat_", ".category_"))}</span>
          </button>
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
  <section class="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
    <div class="flex items-center justify-between gap-3"><h3 class="text-sm font-semibold text-neutral-200">{locale.t("prompt_studio.live_groups_title")}</h3><button type="button" class="touch-target text-xs text-neutral-400 hover:text-neutral-200" disabled={groupsLoading} onclick={() => void loadGroups()}>{locale.t("prompt_studio.reload")}</button></div>
    {#if groupsLoading}<p role="status" class="mt-3 text-xs text-neutral-400">{locale.t("prompt_studio.loading")}</p>
    {:else if groupsError}<p role="alert" class="mt-3 break-words text-xs text-amber-300">{groupsError}</p>
    {:else if !groups.length}<p role="status" class="mt-3 text-xs text-neutral-400">{locale.t("prompt_studio.nothing_found")}</p>
    {:else}
      <div class="mt-3 flex flex-col gap-3">
        {#each groups as section (section.title)}
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
        {#if openGroup.summary}<p class="mt-1 text-xs leading-relaxed text-neutral-400">{openGroup.summary}</p>{/if}
        {#each openGroup.sections as block (block.title)}
          <p class="mt-3 text-xs text-neutral-400">{block.title}</p><div class="mt-2 flex flex-wrap gap-1.5">
            {#each block.tags as tag (tag)}<button type="button" disabled={studio.isChosen(tag)} aria-pressed={studio.isChosen(tag)} class="{chip} {studio.isChosen(tag) ? 'border-indigo-500/50 text-indigo-300' : 'border-neutral-700 text-neutral-300 hover:border-indigo-500'}" onclick={() => add(tag)}>{tag.replaceAll("_", " ")}</button>{/each}
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>
