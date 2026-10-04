export type Dictionaries = Record<string, string | string[] | unknown>;
/** Expand template choices; escaped braces and unknown dictionaries survive for review. */
export function resolveTemplate(input: string, dictionaries: Dictionaries, random = Math.random): { text: string; unresolved: boolean } {
  let text = input;
  const pick = (values: string[]) => values[Math.min(values.length - 1, Math.max(0, Math.floor(random() * values.length)))] ?? '';
  for (let pass = 0; pass < 16; pass++) {
    const next = text.replace(/(?<!\\)\{@([\w]+)\}/g, (whole, key) => {
      const value = dictionaries[key];
      return Array.isArray(value) && value.every(v => typeof v === 'string') ? pick(value) : typeof value === 'string' ? value : whole;
    }).replace(/(?<!\\)\{([^{}]*\|[^{}]*)\}/g, (_, choices: string) => pick(choices.split('|')));
    if (next === text) break;
    text = next;
  }
  return { text: text.replace(/,\s*,/g, ',').trim(), unresolved: /(?<!\\)\{(?:@|[^{}]*\|)/.test(text) };
}
export function artistPrompt(tag: string, prefix: boolean): string {
  return `${prefix ? '@' : ''}${tag.replace(/[()[\]{}]/g, '\\$&')}`;
}
export type Relations = {
  worlds: { tags: string[]; world: number[]; worlds: string[]; table: string[][]; axes: Record<string, number[]> };
  graph: { near: number[][]; odd: number[][] };
  veto: { tags: string[]; bits: string; threshold: number };
  measure: { tags: string[]; pairs: number[][]; bits: string; precision: number; seen: number; unseen: number; threshold: number };
};
const bitCache = new Map<string, Uint8Array>();
export function pairFlag(tags: string[], bits: string, a: string, b: string): boolean | undefined {
  let i = tags.indexOf(a), j = tags.indexOf(b);
  if (i < 0 || j < 0 || i === j) return undefined;
  if (i > j) [i, j] = [j, i];
  const offset = i * (2 * tags.length - i - 1) / 2 + j - i - 1;
  let bytes = bitCache.get(bits);
  if (!bytes) { bytes = Uint8Array.from(atob(bits), char => char.charCodeAt(0)); bitCache.set(bits, bytes); }
  return !!(bytes[offset >> 3] & (1 << (offset & 7)));
}
export type Compatibility = { other: string; level: 'conflict' | 'unusual' | 'related'; score?: number; worlds?: string[] };
export function wardrobeCompatibility(data: Relations, tag: string, selected: string[]): Compatibility[] {
  const result: Compatibility[] = [];
  const a = data.worlds.tags.indexOf(tag);
  for (const other of selected) {
    if (other === tag) continue;
    const b = data.worlds.tags.indexOf(other);
    const wa = data.worlds.world[a], wb = data.worlds.world[b];
    const world = wa >= 0 && wb >= 0 ? data.worlds.table[wa]?.[wb] : undefined;
    const relation = (rows: number[][]) => { const row = rows[a] ?? []; for (let i = 0; i < row.length; i += 2) if (row[i] === b) return row[i + 1]; return undefined; };
    const veto = pairFlag(data.veto.tags, data.veto.bits, tag, other);
    const mi = data.measure.tags.indexOf(tag), mj = data.measure.tags.indexOf(other);
    const pairs = data.measure.pairs[mi] ?? [];
    let score: number | undefined;
    if (mi >= 0 && mj >= 0) {
      const seen = pairFlag(data.measure.tags, data.measure.bits, tag, other);
      score = (seen ? data.measure.seen : data.measure.unseen) / data.measure.precision;
      for (let i = 0; i < pairs.length; i += 2) if (pairs[i] === mj) score = pairs[i + 1] / data.measure.precision;
    }
    const odd = relation(data.graph.odd), near = relation(data.graph.near);
    const level = veto || world === 'no' ? 'conflict' : world === 'odd' || odd !== undefined ? 'unusual' : near !== undefined ? 'related' : undefined;
    if (level) result.push({ other, level, score, worlds: wa >= 0 && wb >= 0 ? [data.worlds.worlds[wa], data.worlds.worlds[wb]] : undefined });
  }
  return result;
}
