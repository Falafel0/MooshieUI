import type { TagEntry } from '../stores/autocomplete.svelte.js';

/** Danbooru tag categories, as the local library stores them. */
export const DANBOORU_CATEGORIES: { id: number; key: string }[] = [
  { id: 0, key: 'prompt_studio.category_general' },
  { id: 1, key: 'prompt_studio.category_artist' },
  { id: 3, key: 'prompt_studio.category_copyright' },
  { id: 4, key: 'prompt_studio.category_character' },
  { id: 5, key: 'prompt_studio.category_meta' },
];

export const ARTIST_CATEGORY = 1;

/**
 * Artists available for randomisation. The local library ships post counts, so
 * picks are popularity weighted: a random artist should still be one that
 * actually appears in prompts, without collapsing onto the top handful.
 */
export function pickArtists(tags: TagEntry[], count: number, banned: string[] = []): string[] {
  const pool = tags.filter((entry) => entry.c === ARTIST_CATEGORY && entry.n && !banned.includes(entry.n));
  if (!pool.length || count <= 0) return [];
  const picked: string[] = [];
  const taken = new Set<string>();
  const weightOf = (entry: TagEntry) => Math.max(1, entry.p || 1);
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const total = pool.reduce((sum, entry) => (taken.has(entry.n) ? sum : sum + weightOf(entry)), 0);
    if (total <= 0) break;
    let roll = Math.random() * total;
    for (const entry of pool) {
      if (taken.has(entry.n)) continue;
      roll -= weightOf(entry);
      if (roll <= 0) { picked.push(entry.n); taken.add(entry.n); break; }
    }
  }
  return picked;
}
