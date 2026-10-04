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
