/**
 * monbooru's search vocabulary, described for the search box.
 *
 * monbooru owns the query language; MooshieUI does not parse it and does not
 * reimplement it. This list exists only so the search box is usable — a user
 * can see what monbooru understands and drop a fragment in. Anything typed
 * that is not here passes through untouched, and nothing about a query is
 * validated or rewritten on the way out.
 *
 * The generation/AI filters and the category-qualified tag filters come first:
 * they are what makes a self-hosted generation library searchable in a way tags
 * alone are not. `system:` is listed because monbooru's own search bar opens
 * its full reference as a live dropdown — pointing at it beats paraphrasing it.
 */
import type { MonbooruQueryFilter, MonbooruQueryFilterGroup } from "./types.js";

/** Groups in display order, each with its locale label key. */
export const MONBOORU_QUERY_FILTER_GROUPS: readonly {
  group: MonbooruQueryFilterGroup;
  labelKey: string;
}[] = [
  { group: "generation", labelKey: "monbooru.filters.group.generation" },
  { group: "category", labelKey: "monbooru.filters.group.category" },
  { group: "rating", labelKey: "monbooru.filters.group.rating" },
  { group: "file", labelKey: "monbooru.filters.group.file" },
  { group: "tags", labelKey: "monbooru.filters.group.tags" },
  { group: "misc", labelKey: "monbooru.filters.group.misc" },
];

/**
 * Every filter the helper offers. `examples[0]` is what a click inserts;
 * the rest are shown as syntax the filter accepts.
 */
export const MONBOORU_QUERY_FILTERS: readonly MonbooruQueryFilter[] = [
  // --- Generation / AI filters --------------------------------------------
  // Read from the generation data monbooru parsed out of each ingested file.
  { group: "generation", name: "ai", hintKey: "monbooru.filters.hint.ai", examples: ["ai:"] },
  {
    group: "generation",
    name: "prompt",
    hintKey: "monbooru.filters.hint.prompt",
    examples: ['prompt:"..."', "negative_prompt:"],
  },
  { group: "generation", name: "model", hintKey: "monbooru.filters.hint.model", examples: ["model:"] },
  { group: "generation", name: "sampler", hintKey: "monbooru.filters.hint.sampler", examples: ["sampler:"] },
  {
    group: "generation",
    name: "seed",
    hintKey: "monbooru.filters.hint.seed",
    examples: ["seed:", "seed:>=100000", "seed:1234..5678"],
  },
  {
    group: "generation",
    name: "generated",
    hintKey: "monbooru.filters.hint.generated",
    examples: ["generated:>=2026-01-01", "generated:..2025-12-31"],
  },

  // --- Category-qualified tags --------------------------------------------
  { group: "category", name: "character", hintKey: "monbooru.filters.hint.character", examples: ["character:"] },
  { group: "category", name: "artist", hintKey: "monbooru.filters.hint.artist", examples: ["artist:"] },
  { group: "category", name: "copyright", hintKey: "monbooru.filters.hint.copyright", examples: ["copyright:"] },
  { group: "category", name: "general", hintKey: "monbooru.filters.hint.general", examples: ["general:"] },
  {
    group: "category",
    name: "cat",
    hintKey: "monbooru.filters.hint.cat",
    examples: ["cat:artist", "cat:character"],
  },

  // --- Rating --------------------------------------------------------------
  {
    group: "rating",
    name: "rating",
    hintKey: "monbooru.filters.hint.rating",
    examples: ["rating:general", "rating:sensitive", "rating:questionable", "rating:explicit"],
  },

  // --- File ----------------------------------------------------------------
  { group: "file", name: "width", hintKey: "monbooru.filters.hint.width", examples: ["width:>=1920", "width:1024..2048"] },
  { group: "file", name: "height", hintKey: "monbooru.filters.hint.height", examples: ["height:>=1080", "height:1024..2048"] },
  { group: "file", name: "ratio", hintKey: "monbooru.filters.hint.ratio", examples: ["ratio:>=1.5", "ratio:2..3"] },
  { group: "file", name: "size", hintKey: "monbooru.filters.hint.size", examples: ["size:>=1MB", "size:1MB..5MB"] },
  { group: "file", name: "mime", hintKey: "monbooru.filters.hint.mime", examples: ["mime:image/png", "mime:video/mp4"] },
  { group: "file", name: "type", hintKey: "monbooru.filters.hint.type", examples: ["type:image", "type:archive", "type:animated"] },
  { group: "file", name: "name", hintKey: "monbooru.filters.hint.name", examples: ["name:"] },
  { group: "file", name: "hash", hintKey: "monbooru.filters.hint.hash", examples: ["hash:"] },
  { group: "file", name: "md5", hintKey: "monbooru.filters.hint.md5", examples: ["md5:"] },

  // --- Tags ----------------------------------------------------------------
  { group: "tags", name: "tagcount", hintKey: "monbooru.filters.hint.tagcount", examples: ["tagcount:>=10", "tagcount:5..20"] },
  { group: "tags", name: "tagged", hintKey: "monbooru.filters.hint.tagged", examples: ["tagged:true", "tagged:false"] },
  { group: "tags", name: "autotagged", hintKey: "monbooru.filters.hint.autotagged", examples: ["autotagged:true"] },

  // --- Operators and cross-cutting syntax ---------------------------------
  { group: "misc", name: "negation", hintKey: "monbooru.filters.hint.negation", examples: ["-", "NOT "] },
  { group: "misc", name: "wildcard", hintKey: "monbooru.filters.hint.wildcard", examples: ["*"] },
  { group: "misc", name: "or", hintKey: "monbooru.filters.hint.or", examples: [" OR "] },
  { group: "misc", name: "range", hintKey: "monbooru.filters.hint.range", examples: ["X..Y", ">=X", "..Y"] },
  { group: "misc", name: "system", hintKey: "monbooru.filters.hint.system", examples: ["system:"] },
];

/**
 * Append a fragment to a query being typed.
 *
 * Deliberately dumb: a space separator, and nothing else. The user is editing
 * monbooru's language, not ours, so we never reorder, quote or rewrite what is
 * already there.
 */
export function appendQueryFragment(query: string, fragment: string): string {
  const trimmed = query.replace(/\s+$/, "");
  if (!trimmed) return fragment;
  // An operator that is itself a space suffix needs no extra separator.
  return fragment.startsWith(" ") ? `${trimmed}${fragment}` : `${trimmed} ${fragment}`;
}
