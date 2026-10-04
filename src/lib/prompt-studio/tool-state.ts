import { userScopedKey } from '../utils/ipc.js';

/** Small working preferences only; large global datasets live in IndexedDB. */
export function restoreTool<T extends Record<string, unknown>>(name: string, defaults: T): T {
  try {
    const raw = JSON.parse(localStorage.getItem(userScopedKey(`mooshie.prompt-studio.tool.${name}.v1`)) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
      const value = raw[key];
      const valid = Array.isArray(fallback) ? Array.isArray(value) : typeof value === typeof fallback && value !== null;
      return [key, valid ? value : fallback];
    })) as T;
  } catch (error) { console.warn('Prompt Studio working state:', error); return defaults; }
}
export function saveTool(name: string, value: Record<string, unknown>) {
  try { localStorage.setItem(userScopedKey(`mooshie.prompt-studio.tool.${name}.v1`), JSON.stringify(value)); }
  catch (error) { console.warn('Prompt Studio working state:', error); }
}
