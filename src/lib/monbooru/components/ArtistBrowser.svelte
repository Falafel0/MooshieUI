<script lang="ts">
  /**
   * Artists, derived from monbooru's artist tag category.
   *
   * Searches the tag list by name prefix and lays the artist tags out as cards,
   * thumbnails included: an artist's representative image is the first hit its
   * own tag returns, fetched lazily as the card scrolls into view. Clicking a
   * card seeds the image search with that artist and switches to the gallery.
   */
  import { monbooru } from "../store.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { MONBOORU_ARTIST_LIMITS } from "../types.js";

  /** Lazy artist preview: one thumbnail, fetched once the card is on screen. */
  function artistPreview(node: HTMLImageElement, name: string) {
    let currentName = name;
    let settled = false;

    async function loadInto(element: HTMLImageElement, artist: string) {
      if (settled) return;
      settled = true;
      try {
        const url = await monbooru.loadArtistPreview(artist);
        if (url && element.src !== url) element.src = url;
        else element.dataset.failed = "1";
      } catch {
        element.dataset.failed = "1";
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        void loadInto(node, currentName);
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);

    return {
      update(next: string) {
        if (next === currentName) return;
        currentName = next;
        settled = false;
        node.removeAttribute("src");
        observer.observe(node);
      },
      destroy() {
        observer.disconnect();
      },
    };
  }

  function runSearch() {
    void monbooru.loadArtists();
  }

  function onSearchKey(event: KeyboardEvent) {
    if (event.key === "Enter") runSearch();
  }

  function applyLimit(limit: number) {
    monbooru.artistLimit = limit;
    runSearch();
  }

  function displayName(name: string): string {
    return name.replace(/^@/, "").replace(/_/g, " ");
  }

  function openArtist(name: string) {
    void monbooru.searchArtist(name);
  }
</script>

<section class="flex h-full min-h-0 flex-col">
  <div class="flex flex-wrap items-center gap-2 border-b border-neutral-800/60 px-2 py-2">
    <div class="flex min-w-56 flex-1 items-center gap-2">
      <input
        type="search"
        class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
        placeholder={locale.t("monbooru.artists.placeholder")}
        bind:value={monbooru.artistQuery}
        onkeydown={onSearchKey}
        enterkeyhint="search"
      />
      <button
        type="button"
        class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={monbooru.artistsLoading}
        aria-busy={monbooru.artistsLoading}
        onclick={runSearch}
      >
        {locale.t("monbooru.search.action")}
      </button>
    </div>

    <div class="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
      <span class="px-1 text-xs text-neutral-500">{locale.t("monbooru.per_page")}</span>
      {#each MONBOORU_ARTIST_LIMITS as limit}
        <button
          type="button"
          class="rounded px-2 py-0.5 text-xs transition-colors {monbooru.artistLimit === limit ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
          onclick={() => applyLimit(limit)}
        >
          {limit}
        </button>
      {/each}
    </div>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if monbooru.artistsLoading && monbooru.artists.length === 0}
      <div class="p-8 text-center text-sm text-neutral-500">{locale.t("monbooru.artists.loading")}</div>
    {:else if monbooru.artistsError}
      <div class="p-8 text-center">
        <p class="text-sm font-medium text-red-400">{locale.t("monbooru.state.error_title")}</p>
        <p class="mt-1 text-xs text-neutral-500">{monbooru.artistsError}</p>
        <button
          type="button"
          class="mt-3 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500"
          onclick={runSearch}
        >
          {locale.t("common.retry")}
        </button>
      </div>
    {:else if monbooru.connection === "disconnected" && monbooru.artists.length === 0}
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
    {:else if monbooru.artists.length === 0}
      <div class="p-8 text-center">
        <p class="text-sm font-medium text-neutral-300">{locale.t("monbooru.artists.empty_title")}</p>
        <p class="mt-1 text-xs text-neutral-500">{locale.t("monbooru.artists.empty_hint")}</p>
      </div>
    {:else}
      <p class="px-4 pt-3 text-xs text-neutral-500">
        {locale.t("monbooru.artists.count", {
          count: locale.formatInteger(monbooru.artists.length),
          query: monbooru.artistQuery.trim() || locale.t("monbooru.artists.all"),
        })}
      </p>

      <div
        class="grid gap-3 p-4"
        style="grid-template-columns: repeat(auto-fill, minmax(132px, 1fr))"
      >
        {#each monbooru.artists as artist (artist.name)}
          <button
            type="button"
            class="group relative flex flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-left transition-colors hover:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onclick={() => openArtist(artist.name)}
            title={artist.name}
          >
            <div class="relative aspect-3/4 w-full overflow-hidden bg-neutral-800">
              <img
                use:artistPreview={artist.name}
                alt={artist.name}
                class="h-full w-full object-cover"
              />
            </div>
            <div class="flex items-center justify-between gap-1 px-2 py-1.5">
              <span class="min-w-0 truncate text-sm text-[var(--monbooru-artist-tint)]" style="--monbooru-artist-tint: {artist.color ?? 'var(--theme-accent-400)'}">
                {displayName(artist.name)}
              </span>
            </div>
          </button>
        {/each}
      </div>

      {#if monbooru.artistsHasMore}
        <div class="flex justify-center pb-6">
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={monbooru.artistsLoading}
            onclick={() => monbooru.loadMoreArtists()}
          >
            {monbooru.artistsLoading ? locale.t("monbooru.loading_more") : locale.t("monbooru.load_more")}
          </button>
        </div>
      {:else}
        <div class="pb-6 text-center text-xs text-neutral-600">{locale.t("monbooru.end_of_results")}</div>
      {/if}
    {/if}
  </div>
</section>
