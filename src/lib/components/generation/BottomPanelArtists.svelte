<script lang="ts">
  import { generation } from "../../stores/generation.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { connection } from "../../stores/connection.svelte.js";
  import { scrollCapture } from "../../utils/scrollCapture.js";
  import { artistFavourites } from "../../artist-gallery/favourites.svelte.js";
  import { createArtistGalleryStore } from "../../artist-gallery/store.svelte.js";
  import { cachedSrc } from "../../artist-gallery/imageCache.js";
  import { artistInsert } from "../../stores/artistInsert.svelte.js";
  import type { ArtistSearchHit } from "../../artist-gallery/types.js";
  import { detectArtistsInPrompt } from "../../artist-gallery/detection.js";
  import { cdnVariantCountOf, imageExtOf, imageIdForVariant } from "../../artist-gallery/variants.js";
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  // ---------------------------------------------------------------------------
  // Favourite artists tab
  // ---------------------------------------------------------------------------
  const artistStore = $derived(
    connection.artistGalleryManifestUrl
      ? createArtistGalleryStore(connection.artistGalleryManifestUrl)
      : null
  );

  // Ensure the manifest + search index are loaded the first time the tab is
  // viewed so cards can render thumbnails without visiting the gallery page.
  $effect(() => {
    if (!artistStore) return;
    if (connection.artistGalleryManifestUrl) void gallery.loadArtistIndex(connection.artistGalleryManifestUrl);
    if (!artistStore.manifest && !artistStore.manifestLoading) {
      void artistStore.init();
    }
    if (artistStore.allEntries.length === 0 && !artistStore.allEntriesLoading) {
      artistStore.allEntriesLoading = true;
      artistStore.client
        .loadSearchIndex()
        .then((entries) => {
          artistStore.allEntries = entries;
        })
        .catch((err) => {
          artistStore.allEntriesError = err instanceof Error ? err.message : String(err);
        })
        .finally(() => {
          artistStore.allEntriesLoading = false;
        });
    }
  });


  /** Resolve a favourite slug → ArtistSearchHit from the loaded index. */
  const favouriteArtistHits = $derived.by((): ArtistSearchHit[] => {
    const favMap = artistFavourites.favourites;
    const entries = artistStore?.allEntries ?? [];
    const bySlug = new Map<string, ArtistSearchHit>();
    for (const e of entries) bySlug.set(e.slug, e);
    const hits: ArtistSearchHit[] = [];
    // Sort favourites by addedAt desc (most recent first).
    const favs = Object.values(favMap).sort((a, b) => b.addedAt - a.addedAt);
    for (const fav of favs) {
      const hit = bySlug.get(fav.slug);
      if (hit) {
        hits.push(hit);
      } else {
        // Index not yet loaded (or tag gone from index). Provide a stub so
        // the card still renders with a working tag + heart.
        hits.push({
          slug: fav.slug,
          tag: `@${fav.slug}`,
          imageId: "",
          postCount: 0,
          shard: "",
          hasImage: false,
        });
      }
    }
    return hits;
  });

  const filteredFavouriteArtists = $derived.by(() => {
    const q = bottomPanel.artistSearch.toLowerCase().trim();
    let list = favouriteArtistHits;
    if (bottomPanel.artistCategoryFilter !== "all") {
      list = list.filter((hit) => {
        const fav = artistFavourites.favourites[hit.slug];
        if (!fav) return false;
        if (bottomPanel.artistCategoryFilter === "__uncat") return fav.categoryId === null;
        return fav.categoryId === bottomPanel.artistCategoryFilter;
      });
    }
    if (q) {
      list = list.filter(
        (hit) =>
          hit.slug.toLowerCase().includes(q) || hit.tag.toLowerCase().includes(q)
      );
    }
    return list;
  });

  /**
   * Variant a favourite card shows (1-based). The choice lives in the shared
   * artist store, so a card flipped here is flipped on the Artists page too.
   */
  function artistVariantOf(hit: ArtistSearchHit): number {
    return Math.min(artistStore?.resolveVariant(hit.slug) ?? 1, cdnVariantCountOf(hit));
  }

  /** Most variants any favourite ships; drives the toolbar toggle (1 = hide it). */
  const favouriteVariantCount = $derived(
    favouriteArtistHits.reduce((m, hit) => (hit.hasImage ? Math.max(m, cdnVariantCountOf(hit)) : m), 1),
  );

  function flipArtistVariant(hit: ArtistSearchHit, e: MouseEvent) {
    e.stopPropagation();
    const count = cdnVariantCountOf(hit);
    if (!artistStore || count < 2) return;
    artistStore.setVariant(hit.slug, (artistVariantOf(hit) % count) + 1);
  }

  function artistThumbUrl(hit: ArtistSearchHit): string {
    const m = artistStore?.manifest;
    if (!m || !hit.hasImage || !hit.imageId) return "";
    const imageId = imageIdForVariant(hit, artistVariantOf(hit));
    return `${m.imageBaseUrl}/${m.releasePrefix}/images/${imageId}.${imageExtOf(m)}`;
  }

  function applyArtistTag(hit: ArtistSearchHit) {
    // Delegate to the shared store so the same replace/append confirmation
    // modal that the gallery page uses is reused here.
    artistInsert.request(hit.tag);
  }

  function displayArtistTag(tag: string): string {
    return tag.replace(/^@/, "").replace(/\\([()[\]]])/g, "$1").replace(/_/g, " ");
  }

  const detectedArtists = $derived.by(() => {
    if (gallery.artistIndexReady && gallery.artistTagIndex.size > 0) {
      return detectArtistsInPrompt(generation.positivePrompt, gallery.artistTagIndex);
    }
    return [];
  });

  function isArtistInPrompt(tag: string): boolean {
    if (gallery.artistIndexReady && gallery.artistTagIndex.size > 0) {
      const normalizedTag = tag.replace(/^@+/, "").toLowerCase().replace(/\s+/g, "_");
      const targetHit = gallery.artistTagIndex.get(normalizedTag);
      if (targetHit) {
        return detectedArtists.some((d) => d.slug === targetHit.slug);
      }
    }
    // Simple fallback
    const cleanTag = tag.replace(/^@+/, "").toLowerCase().trim();
    if (!cleanTag) return false;
    const promptLower = (generation.positivePrompt || "").toLowerCase();
    return promptLower.includes(cleanTag);
  }


</script>
      {#if artistFavourites.count === 0}
        <div class="flex items-center justify-center h-full text-neutral-500 text-xs px-4 text-center">
          <p>{locale.t('bottom_panel.no_favourite_artists')}</p>
        </div>
      {:else}
        <div class="flex flex-col h-full">
          <div class="px-3 py-2 border-b border-ui-border shrink-0 flex items-center gap-2">
            <input
              type="text"
              name="artist-favourite-search"
              bind:value={bottomPanel.artistSearch}
              aria-label={locale.t('bottom_panel.artist_search_placeholder')} placeholder={locale.t('bottom_panel.artist_search_placeholder')}
              class="flex-1 ui-control px-3 min-w-0 bg-ui-surface border border-ui-border rounded-md text-xs text-neutral-100 placeholder-neutral-500 focus:border-ui-accent transition-colors"
            />
            {#if artistStore && favouriteVariantCount >= 2}
              <div
                class="flex shrink-0 items-center gap-0.5 rounded border border-neutral-800 bg-neutral-900/50 p-0.5"
                role="group"
                aria-label={locale.t('artist_gallery.variant_label')}
              >
                {#each Array(favouriteVariantCount) as _, idx}
                  {@const n = idx + 1}
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 text-[10px] transition-colors {artistStore.globalVariant === n ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
                    onclick={() => artistStore.setGlobalVariant(n)}
                  >{locale.t('artist_gallery.variant_n', { n })}</button>
                {/each}
              </div>
            {/if}
            <div use:scrollCapture>
              <input
                type="range"
                min="72"
                max="200"
                value={bottomPanel.artistCardSize} oninput={(e) => bottomPanel.setCardSize("artist", e.currentTarget.valueAsNumber)}
                class="w-16 h-4 accent-ui-accent cursor-pointer"
                aria-label={locale.t('bottom_panel.card_size')} title={locale.t('bottom_panel.card_size')}
              />
            </div>
          </div>
          <!-- Category filter chips -->
          {#if artistFavourites.categories.length > 0}
            {@const counts = artistFavourites.countsByCategory}
            <div class="mx-2 mb-1 flex flex-wrap items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900/50 p-1 shrink-0">
              <button
                type="button"
                class="rounded px-2 py-0.5 text-[10px] transition-colors {bottomPanel.artistCategoryFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
                onclick={() => bottomPanel.artistCategoryFilter = 'all'}
              >{locale.t("artist_gallery.category_all_short", { count: String(artistFavourites.count) })}</button>
              <button
                type="button"
                class="rounded px-2 py-0.5 text-[10px] transition-colors {bottomPanel.artistCategoryFilter === '__uncat' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
                onclick={() => bottomPanel.artistCategoryFilter = '__uncat'}
              >{locale.t("artist_gallery.category_uncat_short", { count: String(counts[''] ?? 0) })}</button>
              {#each artistFavourites.categories as cat (cat.id)}
                <button
                  type="button"
                  class="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors {bottomPanel.artistCategoryFilter === cat.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
                  onclick={() => bottomPanel.artistCategoryFilter = cat.id}
                  title={cat.name}
                >
                  <span class="h-2 w-2 rounded-full border border-neutral-700" style="background-color: {cat.color}" aria-hidden="true"></span>
                  <span class="max-w-24 truncate">{cat.name}</span>
                  <span class="text-neutral-500">({counts[cat.id] ?? 0})</span>
                </button>
              {/each}
            </div>
          {/if}
          {#if filteredFavouriteArtists.length === 0}
            <div class="flex items-center justify-center flex-1 text-neutral-500 text-xs">
              <p>{locale.t('bottom_panel.no_artist_results')}</p>
            </div>
          {:else}
            <div class="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable] px-2 py-2">
              <div
                class="grid gap-2"
                style="grid-template-columns: repeat(auto-fill, minmax(min({bottomPanel.artistCardSize}px, 100%), 1fr)); align-content: start;"
              >
              {#each filteredFavouriteArtists as hit (hit.slug)}
                {@const thumb = artistThumbUrl(hit)}
                {@const favCat = artistFavourites.categoryOf(hit.slug)}
                <div
                  role="button"
                  tabindex="0"
                  class="group relative flex flex-col rounded-lg border bg-neutral-900 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 {isArtistInPrompt(hit.tag) ? 'border-amber-500/60 ring-1 ring-amber-500/20' : 'border-neutral-800 hover:border-indigo-500'}"
                  onclick={() => applyArtistTag(hit)}
                  onkeydown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyArtistTag(hit); } }}
                  title={locale.t('bottom_panel.apply_artist_tag', { tag: hit.tag })}
                >
                  <div class="relative aspect-3/4 w-full overflow-hidden rounded-t-lg bg-neutral-800">
                    {#if thumb}
                      <img use:cachedSrc={thumb} alt={hit.tag} loading="lazy" decoding="async" class="h-full w-full object-cover" />
                    {:else}
                      <div class="flex h-full w-full items-center justify-center text-[10px] text-neutral-500">{locale.t("gallery.no_preview")}</div>
                    {/if}
                    <button
                      type="button"
                      class="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/90 text-sm leading-none text-red-400 transition-colors hover:bg-neutral-800"
                      onclick={(e) => { e.stopPropagation(); artistFavourites.toggle(hit.slug); }}
                      aria-label={locale.t('bottom_panel.unfavorite')}
                      title={locale.t('bottom_panel.unfavorite')}
                    >♥</button>
                    {#if thumb && cdnVariantCountOf(hit) >= 2}
                      <button
                        type="button"
                        class="absolute bottom-1 left-1 rounded border border-neutral-700 bg-neutral-900/90 px-1.5 py-0.5 text-[10px] text-neutral-200 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:border-indigo-500"
                        onclick={(e) => flipArtistVariant(hit, e)}
                        aria-label={locale.t('artist_gallery.flip_variant_aria')}
                        title={locale.t('artist_gallery.flip_variant_aria')}
                      >⇄ {artistVariantOf(hit)}</button>
                    {/if}
                    {#if favCat}
                      <span
                        class="absolute left-1 top-1 h-3 w-3 rounded-full border border-black/40"
                        style="background-color: {favCat.color}"
                        title={favCat.name}
                        aria-label={locale.t("artist_gallery.category_aria", { name: favCat.name })}
                      ></span>
                    {/if}
                  </div>
                  <div class="px-2 py-1.5">
                    <div class="truncate text-xs text-red-400">{displayArtistTag(hit.tag)}</div>
                    {#if hit.postCount > 0}
                      <div class="text-[10px] text-neutral-500">{locale.formatInteger(hit.postCount)} {locale.t("artist_gallery.posts_suffix")}</div>
                    {/if}
                  </div>
                </div>
              {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
