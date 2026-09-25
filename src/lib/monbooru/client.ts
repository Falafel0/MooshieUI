/**
 * monbooru data client.
 *
 * Every call goes through the command wrappers in `utils/api.ts`, which are
 * themselves `ipcInvoke()` — the webview never talks to monbooru directly, so
 * CORS and the bearer token stay in Rust. This client exists so components and
 * the store depend on one small interface instead of the whole api module.
 */
import {
  monbooruCategories,
  monbooruGalleries,
  monbooruImage,
  monbooruImageTags,
  monbooruSearch,
  monbooruStatus,
  monbooruTags,
  monbooruThumbnail,
} from "../utils/api.js";
import type { MonbooruRawJson, MonbooruSearchResult, MonbooruStatus } from "./types.js";

export interface MonbooruClient {
  /** API info — the connection test. */
  status(): Promise<MonbooruStatus>;
  /** Search images. `query` is booru syntax and passes through untouched. */
  search(query: string, page: number, perPage: number, sort: string): Promise<MonbooruSearchResult>;
  /** Configured galleries (raw monbooru JSON). */
  galleries(): Promise<MonbooruRawJson>;
  /** Tags attached to one image (raw monbooru JSON). */
  imageTags(id: number): Promise<MonbooruRawJson>;
  /** Metadata for one image, including parsed generation data (raw monbooru JSON). */
  image(id: number): Promise<MonbooruRawJson>;
  /** Tag names matching a prefix (raw monbooru JSON). */
  tags(prefix: string, limit: number): Promise<MonbooruRawJson>;
  /** Tag categories (raw monbooru JSON). */
  categories(): Promise<MonbooruRawJson>;
  /** A thumbnail as a `data:` URL, for `<img src>`. */
  thumbnail(id: number): Promise<string>;
}

export function createMonbooruClient(): MonbooruClient {
  return {
    status: monbooruStatus,
    search: monbooruSearch,
    galleries: monbooruGalleries,
    imageTags: monbooruImageTags,
    image: monbooruImage,
    tags: monbooruTags,
    categories: monbooruCategories,
    thumbnail: monbooruThumbnail,
  };
}
