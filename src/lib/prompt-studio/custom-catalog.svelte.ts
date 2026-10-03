import { userScopedKey } from '../utils/ipc.js';
export type CustomCatalogEntry = { id: string; name: string; tag: string; subId: string; preview?: string };
const scopedKey = () => userScopedKey('mooshie.studio.custom-catalog.v1');
function normalized(value: unknown): CustomCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  const rows = value.flatMap((row: any) => {
    if (!row || typeof row.tag !== 'string' || !row.tag.trim() || typeof row.subId !== 'string' || !row.subId.trim()) return [];
    return [{ id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : crypto.randomUUID(), tag: row.tag.trim(), name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : row.tag.trim().replaceAll('_', ' '), subId: row.subId.trim(), preview: typeof row.preview === 'string' && row.preview.length <= 400000 && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(row.preview) ? row.preview : undefined }];
  });
  const unique = new Map<string, CustomCatalogEntry>();
  const ids = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify([row.subId, row.tag]);
    const existing = unique.get(key);
    const id = existing?.id ?? (ids.has(row.id) ? crypto.randomUUID() : row.id);
    ids.add(id);
    unique.set(key, { ...row, id, preview: row.preview ?? existing?.preview });
  }
  return [...unique.values()];
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mooshie-studio-custom-catalog', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('catalogs');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Catalogue storage blocked'));
  });
}
class CustomCatalog {
  entries = $state<CustomCatalogEntry[]>([]);
  storageError = $state(false);
  ready = $state(false);
  private loadedKey = '';
  private revision = 0;
  private saveQueue = Promise.resolve();
  private loading: { key: string; promise: Promise<void> } | undefined;
  load(): Promise<void> {
    const key = scopedKey();
    if (this.loading?.key === key) return this.loading.promise;
    if (this.ready && this.loadedKey === key) return Promise.resolve();
    const revision = ++this.revision;
    this.ready = false; this.loadedKey = ''; this.entries = []; this.storageError = false;
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
        this.entries = normalized(rows); this.loadedKey = key; this.ready = true;
      }
    } catch (error) { if (revision === this.revision && key === scopedKey()) this.storageError = true; console.warn('Custom catalogue load:', error); }
  }
  add(entry: Omit<CustomCatalogEntry, 'id'> & { id?: string }) {
    if (!this.ready || this.loadedKey !== scopedKey()) return;
    const existing = this.entries.find(row => entry.id && row.id === entry.id)
      ?? this.entries.find(row => row.tag === entry.tag.trim() && row.subId === entry.subId.trim());
    const rows = normalized([{ ...existing, ...entry, id: existing?.id ?? crypto.randomUUID() }]);
    if (!rows.length) return;
    this.entries = [...this.entries.filter(row => row.id !== rows[0].id && !(row.tag === rows[0].tag && row.subId === rows[0].subId)), ...rows]; this.save();
  }
  remove(id: string) {
    if (!this.ready || this.loadedKey !== scopedKey()) return;
    this.entries = this.entries.filter(row => row.id !== id); this.save();
  }
  private save() {
    const key = this.loadedKey; const rows = JSON.parse(JSON.stringify(this.entries));
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
  export() {
    if (!this.ready || this.loadedKey !== scopedKey()) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ kind: 'mooshie-custom-catalog', version: 1, entries: this.entries }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'prompt-studio-custom-catalog.json'; link.click(); URL.revokeObjectURL(url);
  }
  import(value: unknown): boolean {
    if (!this.ready || this.loadedKey !== scopedKey()) return false;
    const data = value as { kind?: string; version?: number; entries?: unknown } | null;
    if (!data || data.kind !== 'mooshie-custom-catalog' || data.version !== 1 || !Array.isArray(data.entries)) return false;
    const merged = new Map(this.entries.map(entry => [JSON.stringify([entry.subId, entry.tag]), entry]));
    const imported = normalized(data.entries);
    if (data.entries.length && !imported.length) return false;
    const usedIds = new Set(this.entries.map(entry => entry.id));
    for (const row of imported) {
      const key = JSON.stringify([row.subId, row.tag]);
      const existing = merged.get(key);
      const id = existing?.id ?? (usedIds.has(row.id) ? crypto.randomUUID() : row.id);
      usedIds.add(id);
      merged.set(key, { ...row, id, preview: row.preview ?? existing?.preview });
    }
    this.entries = [...merged.values()]; this.save(); return true;
  }
}
export const customCatalog = new CustomCatalog();

/** Store a compact chosen image independently of the expiring source-preview cache. */
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
