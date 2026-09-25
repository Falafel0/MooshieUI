<script lang="ts">
  /**
   * The monbooru image gallery: a search over booru query syntax, a sort
   * control, a responsive grid of lazily-loaded thumbnails and an explicit
   * end-of-results state. Every empty/loading/error state says what to do next.
   */
  import { monbooru } from "../store.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { MONBOORU_PAGE_SIZES, MONBOORU_SORT_OPTIONS } from "../types.js";
  import type { MonbooruImage } from "../types.js";
  import {
    MONBOORU_QUERY_FILTERS,
    MONBOORU_QUERY_FILTER_GROUPS,
    appendQueryFragment,
  } from "../queryFilters.js";
  import ImageDetailDrawer from "./ImageDetailDrawer.svelte";

  interface Props {
    /** Integrator hook for "insert tag into prompt". Falls through the drawer. */
    oninsertTag?: (tag: string) => void;
    /** Adopt an image's generation recipe. All three fall through to the drawer, which hides a button when its handler is missing. */
    onuseprompt?: (prompt: string) => void;
    onusenegative?: (prompt: string) => void;
    onuseseed?: (seed: string) => void;
  }

  let { oninsertTag, onuseprompt, onusenegative, onuseseed }: Props = $props();

  let sortedInput = $state(monbooru.sort);

  /**
   * Query helper, closed by default.
   *
   * monbooru owns its query language: this panel never parses, validates or
   * rewrites what is in the box. It only shows the vocabulary and drops a
   * fragment in, so a filter a user types freely still passes through untouched.
   */
  let filtersOpen = $state(false);

  function filtersFor(group: string) {
    return MONBOORU_QUERY_FILTERS.filter((f) => f.group === group);
  }

  function addFragment(fragment: string): void {
    monbooru.query = appendQueryFragment(monbooru.query, fragment);
  }

  /** Lazy thumbnail: fetch the data URL once the tile scrolls into view. */
  function monbooruThumb(node: HTMLImageElement, id: number) {
    let currentId = id;
    let settled = false;

    async function loadInto(element: HTMLImageElement, imageId: number) {
      if (settled) return;
      settled = true;
      try {
        const url = await monbooru.loadThumbnail(imageId);
        if (url && element.src !== url) element.src = url;
        else if (!url) element.dataset.failed = "1";
      } catch {
        element.dataset.failed = "1";
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        void loadInto(node, currentId);
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);

    return {
      update(next: number) {
        if (next === currentId) return;
        currentId = next;
        settled = false;
        node.removeAttribute("src");
        observer.observe(node);
      },
      destroy() {
        observer.disconnect();
      },
    };
  }

  /** Infinite scroll sentinel: ask for the next page when it comes into view. */
  function loadMoreSentinel(node: HTMLElement) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void monbooru.loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return { destroy() { observer.disconnect(); } };
  }

  function runSearch() {
    void monbooru.search(true);
  }

  function onSearchKey(event: KeyboardEvent) {
    if (event.key === "Enter") runSearch();
  }

  function applySort(value: string) {
    sortedInput = value as typeof sortedInput;
    monbooru.sort = sortedInput;
    if (monbooru.searched) runSearch();
  }

  function applyPageSize(size: number) {
    monbooru.pageSize = size;
    if (monbooru.searched) runSearch();
  }

  function openImage(image: MonbooruImage) {
    void monbooru.selectImage(image.id);
  }

  const showDisconnected = $derived(
    monbooru.connection === "disconnected" && monbooru.images.length === 0 && !monbooru.loading,
  );
</script>

<section class="flex h-full min-h-0 flex-col">
  <!-- Search + sort -->
  <div class="flex flex-wrap items-center gap-2 border-b border-neutral-800/60 px-2 py-2">
    <div class="flex min-w-56 flex-1 items-center gap-2">
      <input
        type="search"
        class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
        placeholder={locale.t("monbooru.search.placeholder")}
        bind:value={monbooru.query}
        onkeydown={onSearchKey}
        enterkeyhint="search"
      />
      <button
        type="button"
        class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={monbooru.loading}
        aria-busy={monbooru.loading}
        onclick={runSearch}
      >
        {locale.t("monbooru.search.action")}
      </button>
    </div>

    <label class="flex items-center gap-1.5 text-xs text-neutral-500">
      <span>{locale.t("monbooru.sort.label")}</span>
      <select
        class="rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200"
        value={sortedInput}
        onchange={(e) => applySort(e.currentTarget.value)}
      >
        {#each MONBOORU_SORT_OPTIONS as option}
          <option value={option}>{locale.t(`monbooru.sort.${option}`)}</option>
        {/each}
      </select>
    </label>

    <div class="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
      <span class="px-1 text-xs text-neutral-500">{locale.t("monbooru.per_page")}</span>
      {#each MONBOORU_PAGE_SIZES as size}
        <button
          type="button"
          class="rounded px-2 py-0.5 text-xs transition-colors {monbooru.pageSize === size ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
          onclick={() => applyPageSize(size)}
        >
          {size}
        </button>
      {/each}
    </div>

    <!-- Opens the filter vocabulary. Labelled with monbooru's own `system:`
         keyword, which is what its own search bar uses for the same purpose. -->
    <button
      type="button"
      class="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 font-mono text-xs text-neutral-300 transition-colors hover:border-indigo-500 hover:text-indigo-200"
      aria-expanded={filtersOpen}
      title={locale.t("monbooru.filters.hint.system")}
      onclick={() => (filtersOpen = !filtersOpen)}
    >
      system:
    </button>
  </div>

  {#if filtersOpen}
    <!-- The vocabulary, not a parser: clicking a chip drops that fragment into
         the query untouched, and anything typed by hand still passes through. -->
    <div class="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5">
      {#each MONBOORU_QUERY_FILTER_GROUPS as group (group.group)}
        <div>
          <div class="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            {locale.t(group.labelKey)}
          </div>
          <div class="flex flex-wrap gap-1">
            {#each filtersFor(group.group) as filter (filter.name)}
              <button
                type="button"
                class="rounded border border-neutral-700 bg-neutral-800/70 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300 transition-colors hover:border-indigo-500 hover:text-indigo-200"
                title={locale.t(filter.hintKey)}
                onclick={() => addFragment(filter.examples[0])}
              >
                {filter.name}
              </button>
            {/each}
          </div>
        </div>
      {/each}
      <p class="text-[10px] text-neutral-600">{locale.t("monbooru.filters.hint.range")}</p>
    </div>
  {/if}

  <!-- Results -->
  <div class="flex-1 overflow-y-auto">
    {#if monbooru.loading && monbooru.images.length === 0}
      <div class="p-8 text-center text-sm text-neutral-500">{locale.t("monbooru.state.loading")}</div>
    {:else if monbooru.error && monbooru.images.length === 0}
      <div class="p-8 text-center">
        <p class="text-sm font-medium text-red-400">{locale.t("monbooru.state.error_title")}</p>
        <p class="mt-1 text-xs text-neutral-500">{monbooru.error}</p>
        <button
          type="button"
          class="mt-3 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500"
          onclick={runSearch}
        >
          {locale.t("common.retry")}
        </button>
      </div>
    {:else if showDisconnected}
      <div class="p-8 text-center">
        <p class="text-sm font-medium text-neutral-300">{locale.t("monbooru.state.disconnected_title")}</p>
        <p class="mt-1 text-xs text-neutral-500">
          {monbooru.connectionError || locale.t("monbooru.state.disconnected_hint")}
        </p>
        <button
          type="button"
          class="mt-3 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500"
          onclick={() => monbooru.testConnection()}
        >
          {locale.t("monbooru.test_connection")}
        </button>
      </div>
    {:else if monbooru.images.length === 0}
      <div class="p-8 text-center">
        <p class="text-sm font-medium text-neutral-300">{locale.t("monbooru.state.empty_title")}</p>
        <p class="mt-1 text-xs text-neutral-500">{locale.t("monbooru.state.empty_hint")}</p>
      </div>
    {:else}
      <p class="px-4 pt-3 text-xs text-neutral-500">
        {monbooru.lastQuery
          ? locale.t("monbooru.results_count", {
              count: locale.formatInteger(monbooru.images.length),
              total: locale.formatInteger(monbooru.total),
              query: monbooru.lastQuery,
            })
          : locale.t("monbooru.results_count_all", {
              count: locale.formatInteger(monbooru.images.length),
              total: locale.formatInteger(monbooru.total),
            })}
      </p>

      <div
        class="grid gap-3 p-4"
        style="grid-template-columns: repeat(auto-fill, minmax(148px, 1fr))"
      >
        {#each monbooru.images as image (image.id)}
          <div class="group relative flex flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 transition-colors hover:border-indigo-500">
            <button
              type="button"
              class="relative aspect-square w-full overflow-hidden bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onclick={() => openImage(image)}
              title={`#${image.id}`}
              aria-label={locale.t("monbooru.open_image", { id: image.id })}
            >
              <img
                use:monbooruThumb={image.id}
                alt={`#${image.id}`}
                class="h-full w-full object-cover"
              />
              {#if image.rating}
                <span class="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-mono uppercase text-neutral-200">
                  {image.rating}
                </span>
              {/if}
            </button>
            <div class="flex items-center justify-between gap-1 px-2 py-1.5">
              <span class="truncate text-xs text-neutral-400">#{image.id}</span>
              {#if typeof image.width === "number" && typeof image.height === "number"}
                <span class="shrink-0 text-[10px] text-neutral-600">{image.width}×{image.height}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if monbooru.loadingMore}
        <div class="pb-6 text-center text-xs text-neutral-500">{locale.t("monbooru.loading_more")}</div>
      {:else if monbooru.hasMore}
        <div class="flex justify-center pb-6">
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500"
            onclick={() => monbooru.loadMore()}
          >
            {locale.t("monbooru.load_more")}
          </button>
          <div use:loadMoreSentinel class="h-1 w-1"></div>
        </div>
      {:else}
        <div class="pb-6 text-center text-xs text-neutral-600">{locale.t("monbooru.end_of_results")}</div>
      {/if}
    {/if}
  </div>

  <ImageDetailDrawer {oninsertTag} {onuseprompt} {onusenegative} {onuseseed} />
</section>
