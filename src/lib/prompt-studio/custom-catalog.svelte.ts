import { userScopedKey } from '../utils/ipc.js';
import { normalizeCatalog, normalizeEntries, type CatalogCategory, type CatalogDomain, type CustomCatalogEntry } from './catalog-model.js';
export type { CustomCatalogEntry } from './catalog-model.js';
const scopedKey = () => userScopedKey('mooshie.studio.custom-catalog.v1');
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mooshie-studio-custom-catalog', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('catalogs');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Catalogue storage blocked'));
  });
}
class CustomCatalog {
  categories = $state<CatalogCategory[]>([]);
  entries = $state<CustomCatalogEntry[]>([]);
  storageError = $state(false);
  ready = $state(false);
  get scope() { return scopedKey(); }
  get current() { return this.ready && this.loadedKey === scopedKey(); }
  private loadedKey = '';
  private revision = 0;
  private saveQueue = Promise.resolve();
  private loading: { key: string; promise: Promise<void> } | undefined;
  load(): Promise<void> {
    const key = scopedKey();
    if (this.loading?.key === key) return this.loading.promise;
    if (this.ready && this.loadedKey === key) return Promise.resolve();
    const revision = ++this.revision;
    this.ready = false; this.loadedKey = ''; this.entries = []; this.categories = []; this.storageError = false;
    const promise = this.loadEntries(key, revision);
    this.loading = { key, promise };
    void promise.finally(() => { if (this.loading?.promise === promise) this.loading = undefined; });
    return promise;
  }
  private async loadEntries(key: string, revision: number) {
    await this.saveQueue;
    if (revision !== this.revision || key !== scopedKey()) return;
    try {
      let rows: unknown;
      if (typeof indexedDB === 'undefined') rows = JSON.parse(localStorage.getItem(key) || '[]');
      else {
        const db = await database();
        try { rows = await new Promise((resolve, reject) => { const request = db.transaction('catalogs').objectStore('catalogs').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
        finally { db.close(); }
      }
      if (revision === this.revision && key === scopedKey()) {
        const data = normalizeCatalog(rows);
        this.categories = data.categories; this.entries = data.entries; this.loadedKey = key; this.ready = true;
      }
    } catch (error) { if (revision === this.revision && key === scopedKey()) this.storageError = true; console.warn('Custom catalogue load:', error); }
  }
  add(entry: Omit<CustomCatalogEntry, 'id'> & { id?: string }) {
    if (!this.ready || this.loadedKey !== scopedKey() || !this.hasBucket(entry.subId)) return false;
    const editing = this.entries.find(row => entry.id && row.id === entry.id);
    if (editing && this.entries.some(row => row.id !== editing.id && row.tag === entry.tag.trim() && row.subId === entry.subId.trim())) return false;
    const existing = editing
      ?? this.entries.find(row => row.tag === entry.tag.trim() && row.subId === entry.subId.trim());
    const rows = normalizeEntries([{ ...existing, ...entry, id: existing?.id ?? crypto.randomUUID(), preview: entry.preview === undefined ? existing?.preview : entry.preview }]);
    if (entry.preview === '') rows.forEach(row => { row.preview = undefined; });
    if (!rows.length) return false;
    this.entries = [...this.entries.filter(row => row.id !== rows[0].id && !(row.tag === rows[0].tag && row.subId === rows[0].subId)), ...rows]; this.save();
    return true;
  }
  remove(id: string) {
    if (!this.ready || this.loadedKey !== scopedKey()) return;
    this.entries = this.entries.filter(row => row.id !== id); this.save();
  }
  private save() {
    const key = this.loadedKey; const rows = JSON.parse(JSON.stringify({ categories: this.categories, entries: this.entries }));
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        if (typeof indexedDB === 'undefined') localStorage.setItem(key, JSON.stringify(rows));
        else {
          const db = await database();
          try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('catalogs', 'readwrite'); tx.objectStore('catalogs').put(rows, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
          finally { db.close(); }
        }
        if (key === this.loadedKey) this.storageError = false;
      } catch (error) { if (key === this.loadedKey) this.storageError = true; console.warn('Custom catalogue save:', error); }
    });
  }
  /** Atomically replace a global set, preserving identity and all entry metadata. */
  replaceSet(categoryId: string, name: string, domains: CatalogDomain[], entries: CustomCatalogEntry[]): boolean {
    if (!this.writable() || !name.trim()) return false;
    const category = this.categories.find(row => row.id === categoryId);
    if (!category) return false;
    const buckets = new Set([category.id, ...category.subs.map(row => row.id)]);
    if (entries.some(row => !row || !row.tag?.trim() || !buckets.has(row.subId))) return false;
    const normalized = normalizeEntries(entries);
    if (normalized.length !== entries.length) return false;
    const untouched = this.entries.filter(row => !buckets.has(row.subId));
    const used = new Set(untouched.map(row => row.id));
    const rows = normalized.map(row => {
      const id = used.has(row.id) ? crypto.randomUUID() : row.id;
      used.add(id); return { ...row, id };
    });
    this.categories = this.categories.map(row => row.id === categoryId ? { ...row, name: name.trim(), domains: [...new Set(domains.filter(domain => ['character', 'wardrobe', 'scene'].includes(domain)))] } : row);
    this.entries = [...untouched, ...rows]; this.save(); return true;
  }
  async flushed(): Promise<boolean> {
    const owner = this.loadedKey;
    await this.saveQueue;
    return owner === scopedKey() && !this.storageError;
  }
  export(categoryId?: string) {
    if (!this.ready || this.loadedKey !== scopedKey()) return;
    const categories = categoryId ? this.categories.filter(category => category.id === categoryId) : this.categories;
    const buckets = new Set(categories.flatMap(category => [category.id, ...category.subs.map(sub => sub.id)]));
    const entries = this.entries.filter(entry => buckets.has(entry.subId));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ kind: 'mooshie-tag-pack', version: 1, categories, entries }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'prompt-studio-tag-pack.json'; link.click(); URL.revokeObjectURL(url);
  }
  hasBucket(id: string) { return this.categories.some(category => category.id === id || category.subs.some(sub => sub.id === id)); }
  private writable() { return this.ready && this.loadedKey === scopedKey(); }
  addCategory(name: string): string | undefined {
    if (!this.writable() || !name.trim()) return;
    const id = crypto.randomUUID();
    this.categories = [...this.categories, { id, name: name.trim(), icon: 'sparkles', subs: [] }];
    this.save(); return id;
  }
  addSub(categoryId: string, name: string): string | undefined {
    if (!this.writable() || !name.trim() || !this.categories.some(category => category.id === categoryId)) return;
    const id = crypto.randomUUID();
    this.categories = this.categories.map(category => category.id === categoryId ? { ...category, subs: [...category.subs, { id, name: name.trim() }] } : category);
    this.save(); return id;
  }
  rename(id: string, name: string) {
    if (!this.writable() || !name.trim()) return;
    this.categories = this.categories.map(category => ({ ...category, name: category.id === id ? name.trim() : category.name, subs: category.subs.map(sub => sub.id === id ? { ...sub, name: name.trim() } : sub) }));
    this.save();
  }
  removeCategory(id: string) {
    if (!this.writable()) return;
    const category = this.categories.find(category => category.id === id);
    if (!category) return;
    const buckets = new Set([id, ...category.subs.map(sub => sub.id)]);
    this.entries = this.entries.filter(entry => !buckets.has(entry.subId));
    this.categories = this.categories.filter(category => category.id !== id);
    this.save();
  }
  removeSub(id: string) {
    if (!this.writable()) return false;
    const parent = this.categories.find(category => category.subs.some(sub => sub.id === id));
    if (!parent) return false;
    const targetTags = new Set(this.entries.filter(entry => entry.subId === parent.id).map(entry => entry.tag));
    if (this.entries.some(entry => entry.subId === id && targetTags.has(entry.tag))) return false;
    this.categories = this.categories.map(category => category.id === parent.id ? { ...category, subs: category.subs.filter(sub => sub.id !== id) } : category);
    this.entries = normalizeEntries(this.entries.map(entry => entry.subId === id ? { ...entry, subId: parent.id } : entry));
    this.save();
    return true;
  }
  move(id: string, direction: number) {
    if (!this.writable()) return;
    const parent = this.categories.find(category => category.subs.some(sub => sub.id === id));
    const items = [...(parent ? parent.subs : this.categories)];
    const index = items.findIndex(item => item.id === id), target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    if (parent) this.categories = this.categories.map(category => category.id === parent.id ? { ...category, subs: items as CatalogCategory['subs'] } : category);
    else this.categories = items as CatalogCategory[];
    this.save();
  }
  duplicate(id: string): string | undefined {
    const entry = this.entries.find(entry => entry.id === id);
    if (!this.writable() || !entry) return;
    let number = 2;
    let tag = `${entry.tag} (${number})`;
    while (this.entries.some(row => row.subId === entry.subId && row.tag === tag)) tag = `${entry.tag} (${++number})`;
    const newId = crypto.randomUUID();
    this.add({ ...entry, id: newId, tag, name: `${entry.name} (${number})` });
    return this.entries.find(row => row.subId === entry.subId && row.tag === tag)?.id;
  }
  import(value: unknown): boolean {
    if (!this.writable()) return false;
    const data = value as { kind?: string; version?: number; entries?: unknown; categories?: unknown } | null;
    if (!data || !Array.isArray(data.entries)) return false;
    if (!(data.kind === 'mooshie-tag-pack' && data.version === 1 && Array.isArray(data.categories)) && !(data.kind === 'mooshie-custom-catalog' && [1, 2].includes(data.version ?? 0))) return false;
    if (data.kind === 'mooshie-tag-pack') {
      const declared = new Set<string>();
      for (const category of data.categories as any[]) {
        if (!category || typeof category.id !== 'string' || !category.id.trim() || typeof category.name !== 'string' || !category.name.trim() || !Array.isArray(category.subs) || declared.has(category.id.trim())) return false;
        declared.add(category.id.trim());
      }
      for (const category of data.categories as any[]) for (const sub of category.subs) {
        if (!sub || typeof sub.id !== 'string' || !sub.id.trim() || typeof sub.name !== 'string' || !sub.name.trim() || declared.has(sub.id.trim())) return false;
        declared.add(sub.id.trim());
      }
      if (data.entries.some(row => !row || typeof row.tag !== 'string' || !row.tag.trim() || typeof row.subId !== 'string' || !declared.has(row.subId.trim()))) return false;
    }
    const imported = normalizeCatalog(data);
    if (data.entries.length && !imported.entries.length) return false;
    // Merge definitions and entries atomically; preserve user order and existing IDs.
    const categories = this.categories.map(category => ({ ...category, subs: [...category.subs] }));
    const usedBuckets = new Set(categories.flatMap(category => [category.id, ...category.subs.map(sub => sub.id)]));
    const mapping = new Map<string, string>();
    for (const category of imported.categories) {
      if (data.kind === 'mooshie-custom-catalog' && data.version === 1 && usedBuckets.has(category.id)) { mapping.set(category.id, category.id); continue; }
      let target = categories.find(row => row.id === category.id);
      if (!target) {
        let id = category.id;
        while (usedBuckets.has(id) && !categories.some(row => row.id === id)) id = `pack-category:${id}`;
        target = categories.find(row => row.id === id);
        if (!target) { target = { ...category, id, subs: [] }; categories.push(target); usedBuckets.add(id); }
      }
      if (category.domains !== undefined) target.domains = category.domains;
      mapping.set(category.id, target.id);
      for (const sub of category.subs) {
        let id = sub.id;
        while (usedBuckets.has(id) && !target.subs.some(row => row.id === id)) id = `pack-sub:${target.id}:${id}`;
        if (!target.subs.some(row => row.id === id)) target.subs.push({ ...sub, id });
        usedBuckets.add(id); mapping.set(sub.id, id);
      }
    }
    const merged = new Map(this.entries.map(entry => [JSON.stringify([entry.subId, entry.tag]), entry]));
    const usedIds = new Set(this.entries.map(entry => entry.id));
    for (const row of imported.entries) {
      const subId = mapping.get(row.subId) ?? row.subId;
      const key = JSON.stringify([subId, row.tag]); const existing = merged.get(key);
      const id = existing?.id ?? (usedIds.has(row.id) ? crypto.randomUUID() : row.id);
      usedIds.add(id); merged.set(key, { ...row, id, subId, preview: row.preview ?? existing?.preview, description: row.description ?? existing?.description, aliases: row.aliases ?? existing?.aliases, contextualTags: row.contextualTags ?? existing?.contextualTags, collectionData: row.collectionData ?? existing?.collectionData });
    }
    this.categories = categories; this.entries = [...merged.values()]; this.save(); return true;
  }

}
export const customCatalog = new CustomCatalog();

/** Store a compact local preview inside portable tag packs. */
export async function catalogPreview(blob: Blob): Promise<string> {
  if (blob.size > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('Unsupported catalogue image');
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image canvas unavailable');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.82);
  } finally { bitmap.close(); }
}
