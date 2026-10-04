import index from './data/index.json';
export { index as collectionIndex };
export type CollectionEntry = { id: string; tag: string; name: string; group: string; description?: string; context?: string[]; negative?: string[]; meta?: Record<string, unknown>; memberships?: number; count?: number | null };
// JSON assets stay outside the startup bundle, including the large artist lists.
const urls = import.meta.glob('./data/*.json', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const cache = new Map<string, Promise<unknown>>();
export function loadCollectionAsset<T>(file: string): Promise<T> {
  let task = cache.get(file);
  if (!task) {
    const url = urls[`./data/${file}`];
    if (!url) return Promise.reject(new Error('Unknown collection'));
    task = fetch(url).then(response => { if (!response.ok) throw new Error('Collection unavailable'); return response.json(); });
    cache.set(file, task); task.catch(() => cache.delete(file));
  }
  return task as Promise<T>;
}
export async function loadCollection(id: string): Promise<CollectionEntry[]> {
  const collection = index.collections.find(item => item.id === id);
  if (!collection) return [];
  // Limit concurrent disk requests; no data is retrieved from external services.
  const pages: unknown[] = [];
  for (let offset = 0; offset < collection.files.length; offset += 4) pages.push(...await Promise.all(collection.files.slice(offset, offset + 4).map(file => loadCollectionAsset<unknown[]>(file))));
  if (collection.kind === 'artist') return (pages.flat() as [string, number | null, number][]).map(([tag, count, memberships], i) => ({ id: `artist-${i}`, tag, name: tag, group: 'artists', count, memberships }));
  return pages.flat() as CollectionEntry[];
}

/** Intentional placement of supplied resources in the three composing zones. */
export const modeCollections = {
  character: ['characters', 'templates', 'all-tags', 'lexicon'],
  wardrobe: ['wardrobe', 'templates', 'all-tags', 'lexicon'],
  scene: ['composition', 'templates', 'generation-styles', 'artists', 'all-tags', 'lexicon'],
} as const;
export function collectionInMode(row: CollectionEntry, collection: string, mode?: 'character' | 'wardrobe' | 'scene'): boolean {
  if (!mode) return true;
  if (collection === 'all-tags') return row.group.startsWith({ character: 'Персонажи / ', wardrobe: 'Гардероб / ', scene: 'Композиция / ' }[mode]);
  if (collection !== 'templates') return true;
  if (mode === 'character') return row.group === 'poses_and_emotions_mix_and_backgrounds';
  if (mode === 'scene') return ['backgrounds', 'poses_and_emotions_mix_and_backgrounds', 'textures_and_colors'].includes(row.group);
  return !['backgrounds', 'poses_and_emotions_mix_and_backgrounds'].includes(row.group);
}

export function collectionGroupKey(value: string): string {
  const group = value.split(' / ').at(-1)?.trim() || 'misc';
  return `prompt_studio.library.group.${group}`;
}
