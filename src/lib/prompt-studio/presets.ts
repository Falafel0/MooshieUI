import type { Choice, Detail } from './studio.svelte.js';
import { CATEGORIES_DATA } from './categories.js';
import { classifyTag } from './sources.js';

/**
 * Saved-set format shared with the reference Atelier build, so an exported set
 * loads there and vice versa: `selected` is the lossless ordered tag list and
 * `id` carries the tag itself (`hair_ribbon`, not a local row id).
 */
export type StudioKind = 'character' | 'wardrobe' | 'scene';
export type StudioModel = 'NAI' | 'SDXL (NoobAI)' | 'Anima (Cosmos)';
export type StudioPromptGroup = { id: string; name: string; content: string; enabled: boolean };
export type SelectionSource = 'user' | 'auto-added' | 'dependency';

export interface StudioSnapshotV1 {
  version: 1;
  name: string;
  savedAt: string;
  kind: StudioKind;
  model: StudioModel;
  selected: { id: string; weight: number; source: SelectionSource; order: number; category?: string; displayName?: string }[];
  details?: Record<string, Detail>;
  prefix: string;
  suffix: string;
  readable: boolean;
  nai: boolean;
  /** A literal prompt kept alongside its parsed tags. */
  autoTags?: boolean;
  clothed?: boolean;
  rawPrompt?: string;
  groups?: StudioPromptGroup[];
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
  autoTags?: boolean;
  clothed?: boolean;
  rawPrompt?: string;
  groups?: StudioPromptGroup[];
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
      category: choice.category,
      displayName: choice.name,
      weight: choice.weight,
      source: choice.category === 'auto' ? 'auto-added' : choice.category === 'dependency' ? 'dependency' : 'user',
      order,
    })),
    details: state.details,
    groups: state.groups,
    prefix: state.prefix,
    suffix: state.suffix,
    readable: state.readable,
    nai: state.nai,
    autoTags: state.autoTags,
    clothed: state.clothed,
    ...(state.rawPrompt !== undefined ? { rawPrompt: state.rawPrompt } : {}),
  };
}

/** Tags from a literal prompt, used when an imported set only carries prose. */
export function tagsFromRawPrompt(raw: string): Choice[] {
  const seen = new Set<string>();
  const out: Choice[] = [];
  for (const fragment of raw.split(/[,\n]+/)) {
    const weighted = fragment.trim().match(/^\((.*?):([\d.]+)\)$/) ?? fragment.trim().match(/^([\d.]+)::(.*?)::$/);
    const weightText = fragment.trim().startsWith('(') ? weighted?.[2] : weighted?.[1];
    const weight = weightText && Number.isFinite(Number(weightText)) ? Math.max(0.1, Math.min(2, Number(weightText))) : 1;
    const tag = fragment
      .trim()
      .replace(/^\((.*?):[\d.]+\)$/, '$1')
      .replace(/^[\d.]+::(.*?)::$/, '$1')
      .replace(/^[([{]+|[)\]}]+$/g, '')
      .trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, name: tag.replaceAll('_', ' '), category: categoryFor(tag), weight });
  }
  return out;
}

function categoryFor(tag: string): string {
  for (const category of CATEGORIES_DATA) {
    for (const sub of category.subs) {
      if (sub.variants?.some((item) => item.tag === tag) || sub.sliderSteps?.some((item) => item.tag === tag)) return sub.id;
    }
  }
  return classifyTag(tag).category;
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
          category: typeof item.category === 'string' ? item.category : item.source === 'dependency' ? 'dependency' : item.source === 'auto-added' ? 'auto' : categoryFor(item.id),
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
  const rawPrompt = typeof data.rawPrompt === 'string' ? data.rawPrompt : typeof data.content === 'string' ? data.content : undefined;
  if (!choices.length && rawPrompt) choices = tagsFromRawPrompt(rawPrompt);
  if (!choices.length && !data.prefix && !data.suffix && !(data.version === 1 && Array.isArray(data.selected)) && !(Array.isArray(data.choices) && typeof data.prefix === 'string' && typeof data.suffix === 'string')) return null;

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
    autoTags: typeof data.autoTags === 'boolean' ? data.autoTags : undefined,
    clothed: typeof data.clothed === 'boolean' ? data.clothed : undefined,
    rawPrompt,
    groups: Array.isArray(data.groups) ? data.groups.filter((v: any) => v && typeof v.id === 'string' && typeof v.content === 'string').map((v: any) => ({ id: v.id, name: typeof v.name === 'string' ? v.name : '', content: v.content, enabled: v.enabled !== false })).filter((v: StudioPromptGroup, i: number, all: StudioPromptGroup[]) => all.findIndex(other => other.id === v.id) === i) : [],
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
  if (file.size > 5 * 1024 * 1024) throw new Error('Preset file exceeds 5 MB');
  const text = await file.text();
  return /\.txt$/i.test(file.name) ? { name: file.name.replace(/\.txt$/i, ''), rawPrompt: text } : JSON.parse(text);
}
