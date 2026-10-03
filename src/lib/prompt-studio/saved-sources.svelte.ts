import { userScopedKey } from '../utils/ipc.js';

export type SavedSourceEntry = { id: string; source: string; name: string; tags: string[]; category?: number; preview?: string };
const key = () => userScopedKey('mooshie.prompt-studio.sources.v1');
function normalize(value: unknown): SavedSourceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: any) => {
    if (!row || typeof row.id !== 'string' || typeof row.source !== 'string' || !Array.isArray(row.tags)) return [];
    const tags = [...new Set<string>(row.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && !!tag.trim()).map((tag: string) => tag.trim()))];
    if (!tags.length) return [];
    return [{ id: row.id, source: row.source, name: typeof row.name === 'string' ? row.name : tags[0], tags, category: Number.isInteger(row.category) ? row.category : undefined, preview: typeof row.preview === 'string' && row.preview.startsWith('https://') ? row.preview : undefined }];
  });
}
class SavedSources {
  entries = $state<SavedSourceEntry[]>([]);
  storageError = $state(false);
  private loadedKey = '';
  load() {
    if (this.loadedKey === key()) return;
    this.loadedKey = key();
    this.entries = [];
    try { this.entries = normalize(JSON.parse(localStorage.getItem(key()) || '[]')); }
    catch (error) { console.warn('Saved sources load:', error); }
  }
  has(id: string, source: string) { return this.entries.some(entry => entry.id === id && entry.source === source); }
  add(rows: SavedSourceEntry[]) {
    const next = new Map(this.entries.map(entry => [JSON.stringify([entry.source, entry.id]), entry]));
    for (const entry of normalize(rows)) next.set(JSON.stringify([entry.source, entry.id]), entry);
    this.entries = [...next.values()]; this.save();
  }
  remove(id: string, source: string) { this.entries = this.entries.filter(entry => entry.id !== id || entry.source !== source); this.save(); }
  private save() {
    try { localStorage.setItem(key(), JSON.stringify(this.entries)); this.storageError = false; }
    catch (error) { this.storageError = true; console.warn('Saved sources save:', error); }
  }
  export() {
    const blob = new Blob([JSON.stringify({ kind: 'mooshie-studio-sources', version: 1, entries: this.entries }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'prompt-studio-sources.json'; link.click(); URL.revokeObjectURL(url);
  }
  import(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const data = value as { kind?: string; version?: number; entries?: unknown };
    if (data.kind !== 'mooshie-studio-sources' || data.version !== 1 || !Array.isArray(data.entries)) return false;
    this.add(normalize(data.entries)); return true;
  }
}
export const savedSources = new SavedSources();
