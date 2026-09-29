import type { Choice, Detail } from './studio.svelte.js';

/**
 * Saved-set format shared with the reference Atelier build, so an exported set
 * loads there and vice versa: `selected` is the lossless ordered tag list and
 * `id` carries the tag itself (`hair_ribbon`, not a local row id).
 */
export type StudioKind = 'character' | 'wardrobe' | 'scene';
export type StudioModel = 'NAI' | 'SDXL (NoobAI)' | 'Anima (Cosmos)';
export type SelectionSource = 'user' | 'auto-added' | 'dependency';

export interface StudioSnapshotV1 {
  version: 1;
  name: string;
  savedAt: string;
  kind: StudioKind;
  model: StudioModel;
  selected: { id: string; weight: number; source: SelectionSource; order: number }[];
  details?: Record<string, Detail>;
  prefix: string;
  suffix: string;
  readable: boolean;
  nai: boolean;
  /** A literal prompt kept alongside its parsed tags. */
  rawPrompt?: string;
}

export const SNAPSHOT_VERSION = 1;

export interface StudioState {
  name: string;
  kind: StudioKind;
  model: StudioModel;
  choices: Choice[];
  details: Record<string, Detail>;
  prefix: string;
  suffix: string;
  readable: boolean;
  nai: boolean;
  rawPrompt?: string;
}

export function toSnapshot(state: StudioState): StudioSnapshotV1 {
  return {
    version: SNAPSHOT_VERSION,
    name: state.name,
    savedAt: new Date().toISOString(),
    kind: state.kind,
    model: state.model,
    selected: state.choices.map((choice, order) => ({
      id: choice.tag,
      weight: choice.weight,
      source: choice.category === 'auto' ? 'auto-added' : choice.category === 'dependency' ? 'dependency' : 'user',
      order,
    })),
    details: state.details,
    prefix: state.prefix,
    suffix: state.suffix,
    readable: state.readable,
    nai: state.nai,
    ...(state.rawPrompt ? { rawPrompt: state.rawPrompt } : {}),
  };
}

/** Tags from a literal prompt, used when an imported set only carries prose. */
export function tagsFromRawPrompt(raw: string): Choice[] {
  const seen = new Set<string>();
  const out: Choice[] = [];
  for (const fragment of raw.split(/[,\n]+/)) {
    const tag = fragment
      .trim()
      .replace(/^\((.*?):[\d.]+\)$/, '$1')
      .replace(/^[\d.]+::(.*?)::$/, '$1')
      .replace(/^[([{]+|[)\]}]+$/g, '')
      .trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, name: tag.replaceAll('_', ' '), category: 'custom', weight: 1 });
  }
  return out;
}

const isKind = (value: unknown): value is StudioKind =>
  value === 'character' || value === 'wardrobe' || value === 'scene';
const isModel = (value: unknown): value is StudioModel =>
  value === 'NAI' || value === 'SDXL (NoobAI)' || value === 'Anima (Cosmos)';

function parseDetails(value: unknown): Record<string, Detail> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, Detail> = {};
  for (const [tag, raw] of Object.entries(value as Record<string, any>)) {
    if (!raw || typeof raw !== 'object') continue;
    const parts: Record<string, string> = {};
    if (raw.parts && typeof raw.parts === 'object') {
      for (const [name, part] of Object.entries(raw.parts)) if (typeof part === 'string' && part) parts[name] = part;
    }
    out[tag] = {
      mods: Array.isArray(raw.mods) ? raw.mods.filter((m: unknown): m is string => typeof m === 'string') : [],
      secondary: typeof raw.secondary === 'string' ? raw.secondary : undefined,
      quantity: typeof raw.quantity === 'string' ? raw.quantity : undefined,
      parts,
    };
  }
  return out;
}

/**
 * Accepts the shared snapshot, the earlier local preset shape and a bare
 * `{ rawPrompt }` set. Returns null only when nothing usable is present.
 */
export function fromSnapshot(value: unknown, fallbackName = 'Imported'): StudioState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, any>;
  const details = parseDetails(data.details);

  let choices: Choice[] = [];
  if (Array.isArray(data.selected)) {
    for (const item of data.selected) {
      if (item && typeof item.id === 'string' && item.id.trim()) {
        choices.push({
          tag: item.id,
          name: typeof item.displayName === 'string' ? item.displayName : item.id.replaceAll('_', ' '),
          category: typeof item.category === 'string' ? item.category : 'custom',
          weight: Number.isFinite(item.weight) ? Math.max(0.1, Math.min(2, item.weight)) : 1,
        });
      } else if (item && typeof item.tag === 'string' && item.tag.trim()) {
        // Earlier local presets stored `tag` / `name` / `category`.
        choices.push({
          tag: item.tag,
          name: typeof item.name === 'string' ? item.name : item.tag,
          category: typeof item.category === 'string' ? item.category : 'custom',
          weight: Number.isFinite(item.weight) ? Math.max(0.1, Math.min(2, item.weight)) : 1,
        });
      }
    }
  } else if (Array.isArray(data.choices)) {
    for (const item of data.choices) {
      if (item && typeof item.tag === 'string' && item.tag.trim()) {
        choices.push({
          tag: item.tag,
          name: typeof item.name === 'string' ? item.name : item.tag,
          category: typeof item.category === 'string' ? item.category : 'custom',
          weight: Number.isFinite(item.weight) ? Math.max(0.1, Math.min(2, item.weight)) : 1,
        });
      }
    }
  }
  const rawPrompt = typeof data.rawPrompt === 'string' ? data.rawPrompt : undefined;
  if (!choices.length && rawPrompt) choices = tagsFromRawPrompt(rawPrompt);
  if (!choices.length) return null;

  const seen = new Set<string>();
  choices = choices.filter((choice) => !seen.has(choice.tag) && seen.add(choice.tag));

  return {
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName,
    kind: isKind(data.kind) ? data.kind : 'character',
    model: isModel(data.model) ? data.model : 'NAI',
    choices,
    details,
    prefix: typeof data.prefix === 'string' ? data.prefix : '',
    suffix: typeof data.suffix === 'string' ? data.suffix : '',
    readable: data.readable !== false,
    nai: data.nai === true,
    rawPrompt,
  };
}

/** Triggers a JSON download of a set. */
export function downloadSnapshot(snapshot: StudioSnapshotV1): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${snapshot.name.replace(/[^\w.-]+/g, '_') || 'prompt-studio'}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readSnapshotFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}
