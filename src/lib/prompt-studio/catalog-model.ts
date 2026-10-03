/** User-authored catalog. There are no built-in categories or tag recipes. */
export type CatalogCategory = { id: string; name: string; icon: string; subs: { id: string; name: string }[] };
export type CustomCatalogEntry = { id: string; name: string; tag: string; subId: string; preview?: string; description?: string; aliases?: string[]; contextualTags?: string[] };
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
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : tag.replaceAll('_', ' '),
      preview: typeof raw.preview === 'string' && raw.preview.length <= 400000 && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(raw.preview) ? raw.preview : previous?.preview,
      contextualTags: Array.isArray(raw.contextualTags) ? [...new Set<string>(raw.contextualTags.filter((v: unknown): v is string => typeof v === 'string' && !!v.trim()).map((v: string) => v.trim()))] : [],
      description: typeof raw.description === 'string' ? raw.description : '',
      aliases: Array.isArray(raw.aliases) ? [...new Set<string>(raw.aliases.filter((v: unknown): v is string => typeof v === 'string' && !!v.trim()).map((v: string) => v.trim()))] : [],
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
      if (!raw || typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.name !== 'string' || !raw.name.trim() || ids.has(raw.id)) continue;
      ids.add(raw.id);
      categories.push({ id: raw.id, name: raw.name.trim(), icon: typeof raw.icon === 'string' ? raw.icon : 'sparkles', subs: [] });
    }
    for (const category of categories) {
      const raw = data.categories.find(row => row?.id === category.id);
      for (const sub of Array.isArray(raw?.subs) ? raw.subs : []) {
        if (!sub || typeof sub.id !== 'string' || !sub.id.trim() || typeof sub.name !== 'string' || !sub.name.trim() || ids.has(sub.id)) continue;
        ids.add(sub.id); category.subs.push({ id: sub.id, name: sub.name.trim() });
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
