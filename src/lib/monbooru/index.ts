/**
 * monbooru module
 * ===============
 *
 * Presents a self-hosted monbooru library as an artist and image gallery:
 * artists come from monbooru's artist tag category, images from its search API.
 * Both views share one store, and tags insert into the prompt through the app's
 * shared insert path.
 *
 * The HTTP client lives in Rust, so nothing here talks to the monbooru host
 * directly — every call is an `ipcInvoke()` command wrapped by `client.ts`.
 *
 * ```svelte
 * <script lang="ts">
 *   import { MonbooruPage } from "$lib/monbooru";
 * </script>
 *
 * <MonbooruPage oninsertTag={insertTagIntoPrompt} />
 * ```
 */
export type {
  MonbooruArtist,
  MonbooruCategory,
  MonbooruConnectionState,
  MonbooruImage,
  MonbooruRawJson,
  MonbooruSearchResult,
  MonbooruSort,
  MonbooruStatus,
  MonbooruTag,
  MonbooruTagGroup,
  MonbooruView,
} from "./types.js";
export {
  MONBOORU_ARTIST_LIMITS,
  MONBOORU_PAGE_SIZES,
  MONBOORU_SORT_OPTIONS,
} from "./types.js";
export { createMonbooruClient } from "./client.js";
export type { MonbooruClient } from "./client.js";
export {
  MonbooruStore,
  monbooru,
  monbooruCategoryTint,
  isArtistCategory,
  normalizeMonbooruCategories,
  normalizeMonbooruImage,
  normalizeMonbooruSearch,
  normalizeMonbooruTags,
} from "./store.svelte.js";
export { default as MonbooruPage } from "./components/MonbooruPage.svelte";
export { default as ArtistBrowser } from "./components/ArtistBrowser.svelte";
export { default as ImageGrid } from "./components/ImageGrid.svelte";
export { default as ImageDetailDrawer } from "./components/ImageDetailDrawer.svelte";
