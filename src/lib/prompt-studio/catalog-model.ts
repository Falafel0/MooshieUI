import type { CollectionEntry } from './collections.js';
/** User-authored catalog. There are no built-in categories or tag recipes. */
export type CatalogDomain = 'character' | 'wardrobe' | 'scene';
export type CatalogCategory = { domains?: CatalogDomain[]; id: string; name: string; icon: string; subs: { id: string; name: string }[] };
export type CustomCatalogEntry = { collectionData?: CollectionEntry; id: string; name: string; tag: string; subId: string; preview?: string; description?: string; aliases?: string[]; contextualTags?: string[] };
export type CatalogData = { categories: CatalogCategory[]; entries: CustomCatalogEntry[] };

export function normalizeEntries(value: unknown): CustomCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  const rows = new Map<string, CustomCatalogEntry>();
  const ids = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw.tag !== 'string' || !raw.tag.trim() || typeof raw.subId !== 'string' || !raw.subId.trim()) continue;
    const tag = raw.tag.trim(), subId = raw.subId.trim();
    const key = JSON.stringify([subId, tag]);
    const previous = rows.get(key);
    let id = previous?.id ?? (typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : crypto.randomUUID());
    if (!previous && ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    rows.set(key, {
      id, tag, subId,
      collectionData: raw.collectionData && typeof raw.collectionData === 'object' && typeof raw.collectionData.tag === 'string' ? raw.collectionData : previous?.collectionData,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : tag.replaceAll('_', ' '),
      preview: typeof raw.preview === 'string' && raw.preview.length <= 400000 && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(raw.preview) ? raw.preview : previous?.preview,
      contextualTags: Array.isArray(raw.contextualTags) ? [...new Set<string>(raw.contextualTags.filter((v: unknown): v is string => typeof v === 'string' && !!v.trim()).map((v: string) => v.trim()))] : previous?.contextualTags,
      description: typeof raw.description === 'string' ? raw.description : previous?.description,
      aliases: Array.isArray(raw.aliases) ? [...new Set<string>(raw.aliases.filter((v: unknown): v is string => typeof v === 'string' && !!v.trim()).map((v: string) => v.trim()))] : previous?.aliases,
    });
  }
  return [...rows.values()];
}

export function normalizeCatalog(value: unknown): CatalogData {
  const data = value as Partial<CatalogData> | null;
  const entries = normalizeEntries(Array.isArray(value) ? value : data?.entries);
  const categories: CatalogCategory[] = [];
  const ids = new Set<string>();
  if (Array.isArray(data?.categories)) {
    for (const raw of data.categories) {
      if (!raw || typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.name !== 'string' || !raw.name.trim() || ids.has(raw.id.trim())) continue;
      ids.add(raw.id.trim());
      categories.push({ id: raw.id.trim(), name: raw.name.trim(), icon: typeof raw.icon === 'string' ? raw.icon : 'sparkles', domains: Array.isArray(raw.domains) ? [...new Set(raw.domains.filter(domain => ['character', 'wardrobe', 'scene'].includes(domain)))] : undefined, subs: [] });
    }
    for (const category of categories) {
      const raw = data.categories.find(row => typeof row?.id === 'string' && row.id.trim() === category.id);
      for (const sub of Array.isArray(raw?.subs) ? raw.subs : []) {
        if (!sub || typeof sub.id !== 'string' || !sub.id.trim() || typeof sub.name !== 'string' || !sub.name.trim() || ids.has(sub.id.trim())) continue;
        ids.add(sub.id.trim()); category.subs.push({ id: sub.id.trim(), name: sub.name.trim() });
      }
    }
  }
  // v1 stored only user entries. Recover their own buckets, never the old seed catalog.
  for (const entry of entries) {
    if (ids.has(entry.subId)) continue;
    ids.add(entry.subId);
    categories.push({ id: entry.subId, name: entry.subId.replaceAll('_', ' '), icon: 'sparkles', subs: [] });
  }
  return { categories, entries };
}

/** JSON preserves all metadata; TXT is one complete tag per line. No data-size cap. */
export function parseGlobalSet(text: string, format: 'json' | 'txt', subId: string, baseline: CustomCatalogEntry[] = []): CustomCatalogEntry[] {
  if (format === 'json') {
    const data = JSON.parse(text);
    const rows: unknown = Array.isArray(data) ? data : data?.entries;
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.tag !== 'string' || !row.tag.trim())) throw new Error('Invalid set entries');
    const fallback = subId || '__new_set__';
    return normalizeEntries(rows.map(row => ({ ...row, subId: typeof row.subId === 'string' && row.subId.trim() ? row.subId : fallback })))
      .map(row => !subId && row.subId === fallback ? { ...row, subId: '' } : row);
  }
  const existing = new Map(baseline.map(row => [row.tag, row]));
  const tags = [...new Set(text.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
  return tags.map(tag => existing.get(tag) ?? { id: crypto.randomUUID(), tag, name: tag.replaceAll('_', ' '), subId });
}
