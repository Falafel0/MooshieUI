/**
 * Types for the monbooru module.
 *
 * monbooru is a self-hosted booru library with a versioned REST API. Its JSON
 * is read defensively: only the fields the UI cannot do without are required,
 * everything else is optional and normalized in `store.svelte.ts`. The fields
 * named exactly `monbooru_status` and `monbooru_search` are documented shapes;
 * the rest are pass-through and survive a version bump.
 */

/** Connection state from `monbooru_status`. */
export interface MonbooruStatus {
  /** True once a base URL is configured. */
  configured: boolean;
  /** True when the last request to `/` succeeded. */
  connected: boolean;
  /** API version reported by `/`. */
  version: string | null;
  /** Why the last request failed, or null while connected. */
  error: string | null;
}

/** monbooru JSON as returned by the backend: an object, or a bare array. */
export type MonbooruRawJson = Record<string, unknown> | unknown[];

/** One search hit. Only `id` is guaranteed to exist. */
export interface MonbooruImage {
  id: number;
  width?: number;
  height?: number;
  file_size?: number;
  mime_type?: string;
  created_at?: string;
  source?: string;
  rating?: string;
  score?: number;
  /** Tag names the search endpoint attached to this hit. */
  tags?: string[];
  [key: string]: unknown;
}

/** Page envelope returned by `monbooru_search`. */
export interface MonbooruSearchResult {
  images: MonbooruImage[];
  page: number;
  per_page: number;
  total: number;
  has_more: boolean;
}

/** A tag category from `/categories`. `color` is monbooru's own hex, when set. */
export interface MonbooruCategory {
  id: number | string | null;
  name: string;
  color: string | null;
}

/** One tag of one image, resolved against the category list. */
export interface MonbooruTag {
  id: number | null;
  name: string;
  /** Category name, lower-cased (e.g. "general", "artist", "character"). */
  category: string;
  /** Tint for this tag: its own colour, else its category's, else null. */
  color: string | null;
}

/** Tags of one image, grouped by category, in the order `/categories` lists them. */
export interface MonbooruTagGroup {
  /** Category name, lower-cased. */
  key: string;
  /** Display name, as monbooru spells it. */
  name: string;
  color: string | null;
  tags: MonbooruTag[];
}

/** An artist derived from monbooru's artist tag category. */
export interface MonbooruArtist {
  name: string;
  postCount: number | null;
  color: string | null;
}

/** Connection states the pane can render. */
export type MonbooruConnectionState = "unknown" | "testing" | "connected" | "disconnected";

/** Which half of the tab is showing. */
export type MonbooruView = "artists" | "images" | "arena";

/** Sort values understood by the image search. Passed straight to monbooru. */
export type MonbooruSort = "newest" | "oldest" | "score" | "random";

/** The page sizes the grid offers. */
export const MONBOORU_PAGE_SIZES = [24, 48, 96] as const;

/** The sort control's options, in display order. */
export const MONBOORU_SORT_OPTIONS: readonly MonbooruSort[] = [
  "newest",
  "oldest",
  "score",
  "random",
];

/** The artist list's page sizes. */
export const MONBOORU_ARTIST_LIMITS = [60, 120, 300] as const;

/**
 * Generation data monbooru parsed out of an ingested file (A1111/Forge
 * parameters or a ComfyUI workflow). Every field is optional: monbooru only
 * publishes what the file actually carried, and the shape varies by generator.
 *
 * `seed` is a string because seeds run to 64 bits and would not survive a
 * JavaScript number. `generationHash` fingerprints the recipe *without* the
 * seed, so a re-roll of one recipe shares it.
 */
export interface MonbooruGenerationData {
  prompt: string | null;
  negativePrompt: string | null;
  /** Checkpoint / model name, when the file named one. */
  model: string | null;
  sampler: string | null;
  scheduler: string | null;
  seed: string | null;
  steps: number | null;
  cfg: number | null;
  loras: string[];
  generationHash: string | null;
  /** Raw workflow JSON as monbooru stored it. */
  workflow: string | null;
}

/**
 * One token of monbooru's search vocabulary.
 *
 * monbooru owns the query language; this only *describes* it so the search box
 * is usable. The parser is never reimplemented and nothing is validated — a
 * token a user types that is not in this list passes through untouched.
 */
export interface MonbooruQueryFilter {
  /** Which part of the vocabulary this belongs to. */
  group: MonbooruQueryFilterGroup;
  /** The filter's name, exactly as monbooru spells it (e.g. "rating", "ai"). */
  name: string;
  /** Locale key for what the filter does and its syntax. */
  hintKey: string;
  /** Example fragments for this filter; the first one is inserted on click. */
  examples: string[];
}

/** Filter families, in the order the helper presents them. */
export type MonbooruQueryFilterGroup =
  | "generation"
  | "category"
  | "rating"
  | "file"
  | "tags"
  | "misc";

