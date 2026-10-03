/**
 * Live booru tag sources: Danbooru, Gelbooru and e621.
 *
 * Every call goes through `ipcInvoke`, so it works in desktop and browser mode
 * alike. Search calls never receive credentials; the write-only settings call
 * is the only path that accepts them. Browser config responses contain only
 * `*_configured` flags, never the stored values.
 */
import { ipcInvoke } from "./ipc.js";
import { classifyTag } from "../prompt-studio/sources.js";

export type BooruSource = "danbooru" | "gelbooru" | "e621";

/** Danbooru numbering: 0 general, 1 artist, 3 copyright, 4 character, 5 meta. */
export interface BooruTag {
  name: string;
  category: number;
  post_count: number;
}

export interface TagGroupRef {
  /** Wiki page title, e.g. `Tag group:Hair color`. */
  title: string;
  label: string;
  depth: number;
  cluster: string | null;
}

export interface TagGroupSection {
  title: string;
  groups: TagGroupRef[];
}

export interface TagGroupBlock {
  title: string;
  tags: string[];
}

export interface TagGroupPage {
  title: string;
  label: string;
  summary: string;
  sections: TagGroupBlock[];
}

export interface BooruCredentialDraft {
  danbooru_login?: string;
  danbooru_api_key?: string;
  gelbooru_user_id?: string;
  gelbooru_api_key?: string;
  e621_login?: string;
  e621_api_key?: string;
}

export const BOORU_SOURCES: { id: BooruSource; label: string; needsKey: boolean }[] = [
  { id: "danbooru", label: "Danbooru", needsKey: false },
  { id: "gelbooru", label: "Gelbooru", needsKey: true },
  { id: "e621", label: "e621", needsKey: false },
];

/** Category label key for a Danbooru category id, for the result badges. */
export function booruCategoryKey(category: number): string {
  switch (category) {
    case 1:
      return "prompt_studio.cat_artist";
    case 3:
      return "prompt_studio.cat_copyright";
    case 4:
      return "prompt_studio.cat_character";
    case 5:
      return "prompt_studio.cat_meta";
    default:
      return "prompt_studio.cat_general";
  }
}

export async function searchBooruTags(
  source: BooruSource,
  query: string,
  limit = 24,
  page = 1,
): Promise<BooruTag[]> {
  limit = Math.min(50, Math.max(1, Math.floor(limit) || 24));
  page = Math.max(1, Math.floor(page) || 1);
  const result = await ipcInvoke<BooruTag[]>("booru_tag_search", { source, query, limit, page });
  return Array.isArray(result) ? result : [];
}

export interface BooruSearchPage {
  tags: BooruTag[];
  page: number;
  hasMore: boolean;
}

/** One instance per view. Reset immediately when source/query changes, including
 * during an outstanding request. A stale request returns null and cannot change
 * pagination state; concurrent load-more events never issue duplicate requests.
 */
export class BooruSearchPager {
  private generation = 0;
  private source: BooruSource = "danbooru";
  private query = "";
  private limit = 24;
  private nextPage = 1;
  private pending = false;
  private more = false;
  private seen = new Set<string>();

  get loading(): boolean { return this.pending; }
  get hasMore(): boolean { return this.more; }

  reset(source: BooruSource, query: string, limit = 24): void {
    this.generation++;
    this.source = source;
    this.query = query.trim();
    this.limit = Math.min(50, Math.max(1, Math.floor(limit) || 24));
    this.nextPage = 1;
    this.pending = false;
    this.more = !!this.query;
    this.seen = new Set();
  }

  async loadNext(): Promise<BooruSearchPage | null> {
    if (this.pending || !this.more) return null;
    const generation = this.generation;
    const page = this.nextPage;
    this.pending = true;
    try {
      const raw = await searchBooruTags(this.source, this.query, this.limit, page);
      if (generation !== this.generation) return null;
      const tags = raw.filter(tag => {
        if (this.seen.has(tag.name)) return false;
        this.seen.add(tag.name);
        return true;
      });
      // Stop on short or repeated pages, rather than spinning on an API that
      // ignores its offset. Errors leave nextPage unchanged for explicit retry.
      this.more = raw.length === this.limit && tags.length > 0;
      this.nextPage++;
      return { tags, page, hasMore: this.more };
    } catch (error) {
      if (generation !== this.generation) return null;
      throw error;
    } finally {
      if (generation === this.generation) this.pending = false;
    }
  }
}

/** Danbooru's curated `tag_groups` tree — sections of wiki pages that list tags. */
export async function loadTagGroups(): Promise<TagGroupSection[]> {
  const result = await ipcInvoke<TagGroupSection[]>("booru_tag_groups", {});
  return Array.isArray(result) ? result : [];
}

/** The tag list inside one curated group. */
export async function loadTagGroup(title: string): Promise<TagGroupPage> {
  return ipcInvoke<TagGroupPage>("booru_tag_group", { title });
}

/** Save replacements or clear all saved credentials; stored values are never returned. */
export async function updateBooruCredentials(
  credentials: BooruCredentialDraft = {},
  clear = false,
): Promise<void> {
  await ipcInvoke<void>("booru_credentials_update", { credentials, clear });
}

/**
 * Files a live tag into the studio: the Danbooru category decides the theme for
 * artists and franchises, `classifyTag` guesses the rest from the words.
 */
export function tagEntry(tag: BooruTag | { name: string; category?: number }): {
  tag: string;
  name: string;
  category: string;
} {
  const { category, name } = classifyTag(tag.name, tag.category ?? 0);
  return { tag: tag.name, name, category };
}
