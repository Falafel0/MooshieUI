<script lang="ts">
  /**
   * Live tag sources: a cross-site search (Danbooru / Gelbooru / e621) and
   * Danbooru's curated `tag_groups` tree. Both feed the same `studio` store as
   * the offline catalogues, so a live tag behaves exactly like a catalog pick.
   */
  import { locale } from "../../stores/locale.svelte.js";
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import {
    BOORU_SOURCES,
    booruCategoryKey,
    loadTagGroup,
    loadTagGroups,
    searchBooruTags,
    tagEntry,
    type BooruSource,
    type BooruTag,
    type TagGroupPage,
    type TagGroupSection,
  } from "../../utils/booru.js";

  let source = $state<BooruSource>("danbooru");
  let query = $state("");
  let results = $state<BooruTag[]>([]);
  let searching = $state(false);
  let searchError = $state("");

  let groups = $state<TagGroupSection[]>([]);
  let groupsLoading = $state(true);
  let groupsError = $state("");
  let openTitle = $state("");
  let openGroup = $state<TagGroupPage | null>(null);
  let groupLoading = $state(false);

  async function runSearch() {
    const needle = query.trim();
    if (!needle || searching) return;
    searching = true;
    searchError = "";
    try {
      results = await searchBooruTags(source, needle, 24);
    } catch (error) {
      results = [];
      searchError = String(error);
    } finally {
      searching = false;
    }
  }

  async function loadGroups() {
    groupsLoading = true;
    groupsError = "";
    try {
      groups = await loadTagGroups();
    } catch (error) {
      groups = [];
      groupsError = String(error);
    } finally {
      groupsLoading = false;
    }
  }

  async function openCurated(title: string) {
    if (openTitle === title) {
      openTitle = "";
      openGroup = null;
      return;
    }
    openTitle = title;
    openGroup = null;
    groupLoading = true;
    try {
      openGroup = await loadTagGroup(title);
    } catch (error) {
      groupsError = String(error);
      openTitle = "";
    } finally {
      groupLoading = false;
    }
  }

  function add(tag: string, category = 0) {
    studio.addMany([tagEntry({ name: tag, category })]);
  }

  function pickGroupSource(event: Event) {
    source = (event.currentTarget as HTMLSelectElement).value as BooruSource;
    results = [];
    searchError = "";
  }

  const chip =
    "rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-left text-xs text-neutral-300 transition-colors hover:border-indigo-500 hover:text-white";
</script>

<div class="flex flex-col gap-3">
  <div class="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
    <div class="flex items-baseline justify-between gap-3">
      <p class="font-mono text-[11px] tracking-[0.16em] text-indigo-400 uppercase">
        {locale.t("prompt_studio.live_title")}
      </p>
      <select
        class="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300"
        value={source}
        onchange={pickGroupSource}
      >
        {#each BOORU_SOURCES as entry (entry.id)}
          <option value={entry.id}>{entry.label}</option>
        {/each}
      </select>
    </div>
    <p class="mt-2 text-xs leading-relaxed text-neutral-500">{locale.t("prompt_studio.live_desc")}</p>

    <form
      class="mt-3 flex gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        void runSearch();
      }}
    >
      <input
        class="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600"
        placeholder={locale.t("prompt_studio.live_search_placeholder")}
        bind:value={query}
      />
      <button
        type="submit"
        class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        disabled={searching || !query.trim()}
      >
        {searching ? locale.t("prompt_studio.live_loading") : locale.t("prompt_studio.live_search")}
      </button>
    </form>

    {#if searchError}
      <p class="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
        {searchError}
      </p>
    {:else if results.length}
      <div class="mt-3 flex flex-wrap gap-2">
        {#each results as tag (tag.name)}
          <button class={chip} onclick={() => add(tag.name, tag.category)}>
            <span class="text-neutral-200">{tag.name.replaceAll("_", " ")}</span>
            <span class="ml-2 text-[10px] text-neutral-500">{tag.post_count.toLocaleString()}</span>
            <span class="ml-2 rounded bg-neutral-800 px-1 text-[10px] text-neutral-400">
              {locale.t(booruCategoryKey(tag.category))}
            </span>
          </button>
        {/each}
      </div>
    {:else if !searching && query.trim()}
      <p class="mt-3 text-xs text-neutral-500">{locale.t("prompt_studio.live_empty")}</p>
    {/if}
  </div>

  <div class="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
    <div class="flex items-baseline justify-between gap-3">
      <p class="font-mono text-[11px] tracking-[0.16em] text-indigo-400 uppercase">
        {locale.t("prompt_studio.live_groups_title")}
      </p>
      <button class="text-[11px] text-neutral-500 hover:text-neutral-300" onclick={() => void loadGroups()}>
        {locale.t("prompt_studio.live_reload")}
      </button>
    </div>
    <p class="mt-2 text-xs leading-relaxed text-neutral-500">{locale.t("prompt_studio.live_groups_desc")}</p>

    {#if groupsLoading}
      <p class="mt-3 text-xs text-neutral-500">{locale.t("prompt_studio.live_loading")}</p>
    {:else if groupsError}
      <div class="mt-3 flex items-center gap-3">
        <p class="text-xs text-amber-300">{groupsError}</p>
        <button
          class="rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:border-indigo-500"
          onclick={() => void loadGroups()}
        >
          {locale.t("prompt_studio.live_retry")}
        </button>
      </div>
    {:else}
      <div class="mt-3 flex flex-col gap-3">
        {#each groups as section (section.title)}
          <div>
            <p class="text-[11px] font-medium tracking-wide text-neutral-400">{section.title}</p>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              {#each section.groups as group (group.title)}
                <button
                  class="rounded-lg border px-2 py-1 text-xs transition-colors {openTitle === group.title
                    ? 'border-indigo-500 bg-indigo-950/40 text-white'
                    : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-indigo-500 hover:text-neutral-200'}"
                  style="margin-left: {(group.depth - 1) * 8}px"
                  title={group.cluster ?? section.title}
                  onclick={() => void openCurated(group.title)}
                >
                  {group.label}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if groupLoading}
      <p class="mt-3 text-xs text-neutral-500">{locale.t("prompt_studio.live_loading")}</p>
    {:else if openGroup}
      <div class="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
        <p class="text-xs font-medium text-neutral-200">{openGroup.label}</p>
        {#if openGroup.summary}
          <p class="mt-1 text-[11px] leading-relaxed text-neutral-500">{openGroup.summary}</p>
        {/if}
        <div class="mt-2 flex flex-col gap-2">
          {#each openGroup.sections as block (block.title)}
            <div>
              <p class="text-[11px] text-neutral-500">{block.title}</p>
              <div class="mt-1 flex flex-wrap gap-1.5">
                {#each block.tags as tag (tag)}
                  <button class={chip} onclick={() => add(tag)}>
                    <span class="text-neutral-200">{tag.replaceAll("_", " ")}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
