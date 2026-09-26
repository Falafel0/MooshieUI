/**
 * monbooru browse state.
 *
 * One store for the whole tab: connection, the image search, the artist list
 * derived from monbooru's artist tag category, the selected image and its tags.
 * It is a singleton cached by nothing in particular — there is only ever one
 * monbooru instance — so components share query, results and selection the way
 * the artist gallery's singleton store does.
 *
 * The store never writes prompt text. `insertTag()` delegates to
 * `artistInsert.request()`, the app's shared "insert a tag" path, which owns
 * the prompt mutation, the duplicate/toggle handling and the confirmation
 * modal. Swapping that one call is all it takes to point monbooru at a
 * different insert route.
 */
import { getConfig } from "../utils/api.js";
import { createMonbooruClient, type MonbooruClient } from "./client.js";
import { artistInsert } from "../stores/artistInsert.svelte.js";
import { locale } from "../stores/locale.svelte.js";
import {
  MONBOORU_ARTIST_LIMITS,
  MONBOORU_PAGE_SIZES,
  type MonbooruArtist,
  type MonbooruCategory,
  type MonbooruConnectionState,
  type MonbooruGenerationData,
  type MonbooruImage,
  type MonbooruRawJson,
  type MonbooruSearchResult,
  type MonbooruSort,
  type MonbooruTag,
  type MonbooruTagGroup,
  type MonbooruView,
} from "./types.js";

/** Category tints, keyed by category name. Theme variables, so both themes work. */
const CATEGORY_TINTS: Record<string, string> = {
  general: "var(--color-neutral-400)",
  artist: "var(--theme-accent-400)",
  character: "var(--color-emerald-400)",
  copyright: "var(--color-sky-400)",
  meta: "var(--color-rose-400)",
  species: "var(--color-violet-400)",
  lore: "var(--color-teal-400)",
  medium: "var(--color-amber-400)",
};

/**
 * A category's tint: monbooru's own colour when it publishes one, otherwise a
 * theme variable chosen for the category. Returned as a CSS colour string, so
 * callers can drop it straight into a custom property.
 */
export function monbooruCategoryTint(
  category: string | null | undefined,
  explicitColor?: string | null,
): string {
  if (explicitColor) return explicitColor;
  const key = (category ?? "").trim().toLowerCase();
  return CATEGORY_TINTS[key] ?? "var(--color-neutral-400)";
}

/** Danbooru's fixed category ids, used when `/categories` has not answered yet. */
const DANBOORU_CATEGORY_IDS: Record<number, string> = {
  0: "general",
  1: "artist",
  3: "copyright",
  4: "character",
  5: "meta",
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Unwrap a response that may be a bare array, or an array under a known key. */
function asArray(raw: MonbooruRawJson, keys: readonly string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const key of keys) {
      const value = (raw as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Normalize a raw search hit. Returns null for entries with no usable id. */
export function normalizeMonbooruImage(raw: unknown): MonbooruImage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = asNumber(record.id);
  if (id === null) return null;
  const tags = Array.isArray(record.tags)
    ? record.tags
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : asString((entry as Record<string, unknown> | null)?.name),
        )
        .filter((name): name is string => !!name)
    : undefined;
  return { ...record, id, tags };
}

/** Normalize a search envelope. Missing fields fall back to what we requested. */
export function normalizeMonbooruSearch(
  raw: MonbooruSearchResult | null | undefined,
  fallback: { page: number; perPage: number },
): MonbooruSearchResult {
  const record = (raw ?? {}) as Record<string, unknown>;
  const images = (Array.isArray(record.images) ? record.images : [])
    .map(normalizeMonbooruImage)
    .filter((image): image is MonbooruImage => image !== null);
  const total = asNumber(record.total) ?? images.length;
  const page = asNumber(record.page) ?? fallback.page;
  const perPage = asNumber(record.per_page) ?? fallback.perPage;
  const hasMore = typeof record.has_more === "boolean" ? record.has_more : page * perPage < total;
  return { images, page, per_page: perPage, total, has_more: hasMore };
}

/** Normalize `/categories`. */
export function normalizeMonbooruCategories(raw: MonbooruRawJson): MonbooruCategory[] {
  const result: MonbooruCategory[] = [];
  for (const entry of asArray(raw, ["categories", "items", "data"])) {
    if (typeof entry === "string") {
      result.push({ id: null, name: entry, color: null });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = asString(record.name) ?? asString(record.category);
    if (!name) continue;
    const id = record.id;
    result.push({
      id: typeof id === "number" || typeof id === "string" ? id : null,
      name,
      color: asString(record.color),
    });
  }
  return result;
}

/** Resolve a raw tag's category name. */
function resolveCategoryKey(
  record: Record<string, unknown>,
  categories: MonbooruCategory[],
): string {
  const named = asString(record.category_name);
  if (named) return named.toLowerCase();
  const category = record.category;
  if (typeof category === "string" && category.trim() !== "") return category.toLowerCase();
  const numeric = asNumber(category);
  if (numeric !== null) {
    const match = categories.find((c) => asNumber(c.id) === numeric);
    if (match) return match.name.toLowerCase();
    return DANBOORU_CATEGORY_IDS[numeric] ?? "general";
  }
  return "general";
}

function categoryColor(categories: MonbooruCategory[], key: string): string | null {
  const match = categories.find((c) => c.name.toLowerCase() === key);
  return match?.color ?? null;
}

/** Normalize a tag list (`/images/{id}/tags`, `/tags`) against the categories. */
export function normalizeMonbooruTags(
  raw: MonbooruRawJson,
  categories: MonbooruCategory[],
): MonbooruTag[] {
  const result: MonbooruTag[] = [];
  for (const entry of asArray(raw, ["tags", "items", "data"])) {
    if (typeof entry === "string") {
      result.push({ id: null, name: entry, category: "general", color: null });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = asString(record.name) ?? asString(record.tag);
    if (!name) continue;
    const category = resolveCategoryKey(record, categories);
    result.push({
      id: asNumber(record.id),
      name,
      category,
      color: asString(record.color) ?? categoryColor(categories, category),
    });
  }
  return result;
}

/** First defined, non-empty value among `keys`. */
function pick(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function numbersToStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        return asString(record.name) ?? asString(record.lora) ?? asString(record.model);
      }
      return null;
    })
    .filter((name): name is string => !!name);
}

/** Seeds run past 32 bits, so they travel as strings rather than numbers. */
function stringifySeed(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

function workflowToString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Normalize the generation data monbooru parsed out of a file.
 *
 * monbooru reads A1111/Forge parameters and ComfyUI workflows out of the images
 * it ingests and publishes prompt, negative prompt, model, sampler, seed,
 * steps, CFG, LoRAs and the raw workflow. The exact field names depend on the
 * generator and on monbooru's version, so the block is read under several
 * spellings, and under a container key as well as at the top level. Returns
 * null when nothing generation-shaped is present.
 */
export function normalizeGenerationData(raw: unknown): MonbooruGenerationData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const top = raw as Record<string, unknown>;

  // The data may be inline or nested under a container monbooru chose.
  const CONTAINERS = ["generation", "generation_data", "generated", "metadata", "parameters", "params"];
  let source: Record<string, unknown> = top;
  for (const key of CONTAINERS) {
    const value = top[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      source = { ...top, ...(value as Record<string, unknown>) };
      break;
    }
  }

  const data: MonbooruGenerationData = {
    prompt: asString(pick(source, ["prompt", "positive_prompt", "positive", "prompt_text"])),
    negativePrompt: asString(pick(source, ["negative_prompt", "negative", "negative_prompt_text"])),
    model: asString(pick(source, ["model", "checkpoint", "model_name", "ckpt"])),
    sampler: asString(pick(source, ["sampler", "sampler_name"])),
    scheduler: asString(pick(source, ["scheduler", "schedule"])),
    seed: stringifySeed(pick(source, ["seed"])),
    steps: asNumber(pick(source, ["steps", "step"])),
    cfg: asNumber(pick(source, ["cfg", "cfg_scale", "guidance", "guidance_scale"])),
    loras: numbersToStringList(pick(source, ["loras", "lora", "lora_names"])),
    generationHash: asString(pick(source, ["generation_hash", "gen_hash", "recipe_hash"])),
    workflow: workflowToString(pick(source, ["workflow", "workflow_json", "comfy_workflow"])),
  };

  return hasGenerationData(data) ? data : null;
}

/** Whether anything in the block is worth showing. */
export function hasGenerationData(data: MonbooruGenerationData | null): boolean {
  if (!data) return false;
  return Boolean(
    data.prompt
      || data.negativePrompt
      || data.model
      || data.sampler
      || data.scheduler
      || data.seed
      || data.steps !== null
      || data.cfg !== null
      || data.loras.length > 0
      || data.generationHash
      || data.workflow,
  );
}

/** Settle a promise without throwing, for independent parallel requests. */
async function settle<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** An artist is a tag in a category whose name contains "artist". */
export function isArtistCategory(category: string): boolean {
  return category.trim().toLowerCase().includes("artist");
}

export class MonbooruStore {
  readonly client: MonbooruClient = createMonbooruClient();

  // --- Connection ------------------------------------------------------------
  connection = $state<MonbooruConnectionState>("unknown");
  configured = $state(false);
  baseUrl = $state("");
  version = $state<string | null>(null);
  connectionError = $state<string | null>(null);

  // --- Which half of the tab is showing -------------------------------------
  view = $state<MonbooruView>("artists");

  // --- Image search ----------------------------------------------------------
  query = $state("");
  lastQuery = $state("");
  page = $state(1);
  pageSize = $state<number>(MONBOORU_PAGE_SIZES[1]);
  sort = $state<MonbooruSort>("newest");
  images = $state<MonbooruImage[]>([]);
  total = $state(0);
  hasMore = $state(false);
  loading = $state(false);
  loadingMore = $state(false);
  error = $state<string | null>(null);
  /** True once a search has run, so "no results" is distinguishable from "not searched". */
  searched = $state(false);

  // --- Selection -------------------------------------------------------------
  selectedImage = $state<MonbooruImage | null>(null);
  selectedTags = $state<MonbooruTag[]>([]);
  selectedTagsLoading = $state(false);
  selectedTagsError = $state<string | null>(null);
  /** Generation data monbooru parsed out of the file, if any. */
  selectedGeneration = $state<MonbooruGenerationData | null>(null);
  selectedMetaLoading = $state(false);
  selectedMetaError = $state<string | null>(null);

  // --- Categories ------------------------------------------------------------
  categories = $state<MonbooruCategory[]>([]);
  categoriesLoaded = $state(false);

  // --- Artists (the artist tag category) -------------------------------------
  artistQuery = $state("");
  artists = $state<MonbooruArtist[]>([]);
  artistsLoading = $state(false);
  artistsError = $state<string | null>(null);
  artistsLoaded = $state(false);
  artistLimit = $state<number>(MONBOORU_ARTIST_LIMITS[0]);
  artistsHasMore = $state(false);

  private _searchSeq = 0;
  private _selectionSeq = 0;
  private _artistSeq = 0;
  private _categoriesPromise: Promise<MonbooruCategory[]> | null = null;
  private _thumbnails = new Map<number, Promise<string>>();
  private _artistPreviews = new Map<string, Promise<string | null>>();

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /** Read the configured base URL out of app config. */
  async refreshBaseUrl(): Promise<void> {
    try {
      const config = await getConfig();
      this.baseUrl = config.monbooru_base_url ?? "";
    } catch (e) {
      console.warn("monbooru: could not read base URL from config:", e);
    }
  }

  /** Ping monbooru and update the connection row. */
  async testConnection(): Promise<void> {
    this.connection = "testing";
    this.connectionError = null;
    await this.refreshBaseUrl();
    try {
      const status = await this.client.status();
      this.configured = status.configured;
      this.version = status.version ?? null;
      if (!status.configured) {
        this.connection = "disconnected";
        this.connectionError = locale.t("monbooru.error.not_configured");
      } else if (status.connected) {
        this.connection = "connected";
      } else {
        this.connection = "disconnected";
        this.connectionError = status.error || locale.t("monbooru.error.unreachable");
      }
    } catch (e) {
      this.connection = "disconnected";
      this.connectionError = errorMessage(e);
    }
  }

  /** First load: config, connection and the category list. */
  async init(): Promise<void> {
    await this.refreshBaseUrl();
    void this.loadCategories();
    if (this.connection === "unknown") await this.testConnection();
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  /** Fetch and cache the tag categories. Safe to call more than once. */
  loadCategories(): Promise<MonbooruCategory[]> {
    if (this.categoriesLoaded) return Promise.resolve(this.categories);
    if (this._categoriesPromise) return this._categoriesPromise;
    this._categoriesPromise = (async () => {
      try {
        const raw = await this.client.categories();
        this.categories = normalizeMonbooruCategories(raw);
        this.categoriesLoaded = true;
        return this.categories;
      } catch (e) {
        // Non-fatal: tags fall back to the Danbooru category ids and default tints.
        console.warn("monbooru: categories unavailable:", e);
        this._categoriesPromise = null;
        return this.categories;
      }
    })();
    return this._categoriesPromise;
  }

  /** The tint for a category key, preferring monbooru's own colour. */
  tintFor(category: string | null | undefined): string {
    return monbooruCategoryTint(category, categoryColor(this.categories, (category ?? "").toLowerCase()));
  }

  // ---------------------------------------------------------------------------
  // Image search
  // ---------------------------------------------------------------------------

  /**
   * Run a search. `reset` (the default) starts from page 1 and replaces the
   * grid; `reset = false` fetches the next page and appends.
   */
  async search(reset = true): Promise<void> {
    if (!reset && (this.loading || this.loadingMore || !this.hasMore)) return;
    const seq = ++this._searchSeq;
    const nextPage = reset ? 1 : this.page + 1;
    if (reset) this.loading = true;
    else this.loadingMore = true;
    this.error = null;
    const query = this.query.trim();
    try {
      const raw = await this.client.search(query, nextPage, this.pageSize, this.sort);
      if (seq !== this._searchSeq) return;
      const result = normalizeMonbooruSearch(raw, { page: nextPage, perPage: this.pageSize });
      const incoming = result.images;
      this.images = reset ? incoming : dedupeImages([...this.images, ...incoming]);
      this.page = result.page || nextPage;
      this.total = result.total;
      this.hasMore = result.has_more;
      this.lastQuery = query;
      this.searched = true;
      this.connection = "connected";
      this.connectionError = null;
    } catch (e) {
      if (seq !== this._searchSeq) return;
      this.error = errorMessage(e);
      if (reset) {
        this.images = [];
        this.total = 0;
        this.hasMore = false;
      }
      this.searched = true;
      // A failed request is the strongest signal we get that the host is not
      // answering, so reflect it in the connection row rather than leaving a
      // green dot above a red error.
      if (this.connection === "connected") this.connection = "disconnected";
    } finally {
      if (seq === this._searchSeq) {
        this.loading = false;
        this.loadingMore = false;
      }
    }
  }

  /** Fetch the next page. No-op at the end of the results. */
  async loadMore(): Promise<void> {
    if (!this.hasMore) return;
    await this.search(false);
  }

  /** Seed the search from an artist tag and switch to the images view. */
  async searchArtist(name: string): Promise<void> {
    this.query = name;
    this.view = "images";
    this.page = 1;
    await this.search(true);
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /**
   * Select an image: load its metadata (the detail endpoint, which carries the
   * generation data monbooru parsed out of the file) and its tags, grouped by
   * category. The two requests fail independently — a host that answers tags
   * but not metadata still shows something useful.
   */
  async selectImage(id: number): Promise<void> {
    const fromGrid = this.images.find((entry) => entry.id === id) ?? null;
    this.selectedImage = fromGrid ?? { id };
    this.selectedTags = [];
    this.selectedTagsError = null;
    this.selectedMetaError = null;
    this.selectedGeneration = normalizeGenerationData(fromGrid);
    const seq = ++this._selectionSeq;
    this.selectedMetaLoading = true;
    this.selectedTagsLoading = true;
    try {
      const [meta, tags, categories] = await Promise.all([
        settle(() => this.client.image(id)),
        settle(() => this.client.imageTags(id)),
        this.loadCategories(),
      ]);
      if (seq !== this._selectionSeq) return;

      if (meta.ok) {
        const record = normalizeMonbooruImage(meta.value);
        this.selectedImage = record ? { ...(fromGrid ?? {}), ...record, id } : fromGrid ?? { id };
        this.selectedGeneration = normalizeGenerationData(meta.value) ?? normalizeGenerationData(record);
      } else {
        this.selectedMetaError = errorMessage(meta.error);
      }

      if (tags.ok) {
        this.selectedTags = normalizeMonbooruTags(tags.value, categories);
      } else {
        this.selectedTagsError = errorMessage(tags.error);
      }
    } finally {
      if (seq === this._selectionSeq) {
        this.selectedMetaLoading = false;
        this.selectedTagsLoading = false;
      }
    }
  }

  clearSelection(): void {
    this._selectionSeq++;
    this.selectedImage = null;
    this.selectedTags = [];
    this.selectedTagsError = null;
    this.selectedMetaError = null;
    this.selectedGeneration = null;
    this.selectedTagsLoading = false;
    this.selectedMetaLoading = false;
  }

  /** The selection's tags grouped by category, in `/categories` order. */
  get selectedTagGroups(): MonbooruTagGroup[] {
    const groups = new Map<string, MonbooruTagGroup>();
    for (const tag of this.selectedTags) {
      const key = tag.category || "general";
      let group = groups.get(key);
      if (!group) {
        const known = this.categories.find((c) => c.name.toLowerCase() === key);
        group = {
          key,
          name: known?.name ?? key,
          color: tag.color ?? this.tintFor(key),
          tags: [],
        };
        groups.set(key, group);
      }
      group.tags.push(tag);
    }
    const order = new Map(this.categories.map((c, index) => [c.name.toLowerCase(), index] as const));
    return [...groups.values()].sort(
      (a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  /**
   * Insert a tag into the prompt.
   *
   * Delegates to the app's shared insert path (`artistInsert.request`), which
   * owns the prompt mutation, the duplicate/toggle handling and the
   * confirmation modal — the store never writes prompt text itself.
   */
  insertTag(tag: string): void {
    const trimmed = tag.trim();
    if (!trimmed) return;
    artistInsert.request(trimmed);
  }

  // ---------------------------------------------------------------------------
  // Artists
  // ---------------------------------------------------------------------------

  /** Load artist tags (the artist category) matching the current prefix. */
  async loadArtists(): Promise<void> {
    const seq = ++this._artistSeq;
    this.artistsLoading = true;
    this.artistsError = null;
    try {
      const [raw, categories] = await Promise.all([
        this.client.tags(this.artistQuery.trim(), this.artistLimit),
        this.loadCategories(),
      ]);
      if (seq !== this._artistSeq) return;
      const tags = normalizeMonbooruTags(raw, categories);
      const artistTags = tags.filter((tag) => isArtistCategory(tag.category));
      this.artists = artistTags.map((tag) => ({
        name: tag.name,
        postCount: null,
        color: tag.color ?? this.tintFor(tag.category),
      }));
      this.artistsHasMore = tags.length >= this.artistLimit;
      this.artistsLoaded = true;
    } catch (e) {
      if (seq !== this._artistSeq) return;
      this.artistsError = errorMessage(e);
    } finally {
      if (seq === this._artistSeq) this.artistsLoading = false;
    }
  }

  /** Raise the artist limit and reload — `/tags` pages by limit, not by page. */
  async loadMoreArtists(): Promise<void> {
    if (this.artistsLoading) return;
    const next = MONBOORU_ARTIST_LIMITS.find((limit) => limit > this.artistLimit);
    if (!next) return;
    this.artistLimit = next;
    await this.loadArtists();
  }

  /** One representative thumbnail for an artist, or null when none exists. */
  loadArtistPreview(name: string): Promise<string | null> {
    const cached = this._artistPreviews.get(name);
    if (cached) return cached;
    const pending = (async () => {
      try {
        const raw = await this.client.search(name, 1, 1, this.sort);
        const first = normalizeMonbooruSearch(raw, { page: 1, perPage: 1 }).images[0];
        if (!first) return null;
        return await this.client.thumbnail(first.id);
      } catch {
        return null;
      }
    })();
    this._artistPreviews.set(name, pending);
    return pending;
  }

  /** A thumbnail `data:` URL for an image, cached for the session. */
  loadThumbnail(id: number): Promise<string> {
    const cached = this._thumbnails.get(id);
    if (cached) return cached;
    const pending = this.client.thumbnail(id).catch((e) => {
      this._thumbnails.delete(id);
      throw e;
    });
    this._thumbnails.set(id, pending);
    return pending;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Ask the app to open the monbooru settings section.
   *
   * The tab is wired by App.svelte, which owns page switching, so the request
   * travels as the same kind of window event other cross-tree actions use.
   */
  openSettings(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("mooshie:open-settings", { detail: { section: "monbooru" } }),
    );
  }
}

function dedupeImages(images: MonbooruImage[]): MonbooruImage[] {
  const seen = new Set<number>();
  const result: MonbooruImage[] = [];
  for (const image of images) {
    if (seen.has(image.id)) continue;
    seen.add(image.id);
    result.push(image);
  }
  return result;
}

/** The tab is a singleton, so the store is too. */
export const monbooru = new MonbooruStore();
