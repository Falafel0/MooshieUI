import type { CanvasLayer } from '../stores/canvas.svelte.js';
import type { LayerGroup } from './layerRelations.js';

/** Canvas submission metadata is plain data, including immutable image strings.
 * Copy containers rather than serializing multi-megabyte images through JSON.
 * This also accepts Svelte proxies, which structuredClone cannot copy. */
function copyData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyData) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyData(item)])) as T;
  }
  return value;
}

export function copyInpaintLayerSnapshot(layers: readonly CanvasLayer[], groups: readonly LayerGroup[]) {
  return { layers: layers.map(copyData), groups: groups.map(copyData) };
}

function transient(key: string, value: unknown): boolean {
  return key === 'controlnetPreviewUrl' || key === 'collapsed' || key === 'image' && typeof value === 'string';
}

function sameData(expected: unknown, current: unknown): boolean {
  if (expected === current) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(current) && expected.length === current.length && expected.every((item, index) => sameData(item, current[index]));
  }
  if (expected === null || current === null || typeof expected !== 'object' || typeof current !== 'object' || Array.isArray(current)) return false;
  const previous = expected as Record<string, unknown>;
  const next = current as Record<string, unknown>;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const before = transient(key, previous[key]) ? undefined : previous[key];
    const after = transient(key, next[key]) ? undefined : next[key];
    if (!sameData(before, after)) return false;
  }
  return true;
}

/** Detect document changes without constructing another copy or serializing
 * image pixels. Display-only previews and uploaded ControlNet filenames may
 * change during preparation; source pixels and placements may not. */
export function sameInpaintPreparationSnapshot(
  expected: { layers: readonly CanvasLayer[]; groups: readonly LayerGroup[] },
  layers: readonly CanvasLayer[],
  groups: readonly LayerGroup[],
): boolean {
  return sameData(expected.layers, layers) && sameData(expected.groups, groups);
}
