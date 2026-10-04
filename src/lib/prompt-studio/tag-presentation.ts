import type { CollectionEntry } from './collections.js';

export type TagLayout = 'chips' | 'cards' | 'list';
export type TagSort = 'source' | 'name' | 'tag';
export type TagFilters = { query: string; group: string; set: number; page: number };
export const emptyTagFilters = (): TagFilters => ({ query: '', group: '', set: -1, page: 0 });

export function restoreTagFilters(value: unknown): TagFilters {
  const raw = value as Partial<TagFilters> | null;
  return { query: typeof raw?.query === 'string' ? raw.query : '', group: typeof raw?.group === 'string' ? raw.group : '', set: Number.isInteger(raw?.set) && raw!.set! >= -1 ? raw!.set! : -1, page: Number.isInteger(raw?.page) && raw!.page! >= 0 ? raw!.page! : 0 };
}

/** Canonical underscore names, human labels and aliases share one search surface. */
export function tagMatches(row: { tag: string; name: string; description?: string; aliases?: string[] }, query: string): boolean {
  const normalize = (text: string) => text.toLocaleLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
  const text = normalize([row.tag, row.name, row.description ?? '', ...(row.aliases ?? [])].join(' '));
  return normalize(query).split(' ').filter(Boolean).every(term => text.includes(term));
}

export function filterCollection(rows: CollectionEntry[], filters: TagFilters, artist: boolean): CollectionEntry[] {
  const group = rows.some(row => row.group === filters.group) ? filters.group : '';
  return rows.filter(row => (!group || row.group === group) && (!artist || filters.set < 0 || !!((row.memberships ?? 0) & (1 << filters.set))) && tagMatches(row, filters.query));
}

export function sortTags<T extends { tag: string; name: string }>(rows: T[], sort: TagSort): T[] {
  return sort === 'source' ? rows : [...rows].sort((a, b) => a[sort].localeCompare(b[sort], undefined, { numeric: true }));
}

const colors: Record<string, string> = { black: '#252525', white: '#f5f5f0', grey: '#93949c', gray: '#93949c', silver: '#b7bdc9', blonde: '#e5c874', blond: '#e5c874', brown: '#825735', red: '#c65b53', orange: '#e19a4e', yellow: '#e9cf5b', green: '#6e9a72', blue: '#648bc6', purple: '#9575bf', violet: '#9575bf', pink: '#d494af', aqua: '#6dbbbd' };
export function tagSwatch(tag: string, group = ''): string | undefined {
  if (!/color|colour|hair_color|eye_color|skin/.test(group)) return;
  const words = tag.toLowerCase().replaceAll('_', ' ').split(/\W+/);
  const matches = [...new Set(words.map(word => colors[word]).filter(Boolean))];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return `linear-gradient(135deg, ${matches.join(', ')})`;
  if (/dark skin/.test(tag.replaceAll('_', ' '))) return '#815a43';
  if (/pale skin/.test(tag.replaceAll('_', ' '))) return '#ebd6c8';
}

const sections: Record<string, string[]> = {
  identity: ['subject', 'archetype', 'race', 'franchise', 'beast', 'pony_type', 'centaur_type'],
  hair: ['hair_length', 'hair_style', 'hair_len', 'hair_color', 'hair_texture', 'haircut', 'bangs', 'braids', 'buns', 'hair_tails', 'hair_top', 'hair_pattern', 'hair_pattern_kind', 'hair_misc'],
  face: ['eyes', 'expression', 'eye_color', 'eye_state', 'eye_misc', 'pupils', 'sclera', 'eyebrows', 'mouth', 'smile', 'expr', 'gaze', 'face_misc', 'makeup', 'makeup_eyes', 'makeup_lips'],
  body: ['body', 'body_type', 'breasts', 'skin', 'skin_extra', 'limb_color', 'legs', 'leg_kind', 'nails', 'marks', 'tattoo', 'piercing', 'extra'],
  fantasy: ['features', 'ears', 'ear_state', 'horns', 'wings', 'tails', 'halo', 'antennae', 'head_object', 'head_swap', 'beast_head', 'mushroom_cap'],
};
export function appearanceSection(groupId: string): string {
  const group = groupId.split(':').at(-1) ?? '';
  return Object.entries(sections).find(([, values]) => values.includes(group))?.[0] ?? 'pose';
}
