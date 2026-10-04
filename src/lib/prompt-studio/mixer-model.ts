export type MixFamily = 'medium' | 'style' | 'light' | 'local' | 'artists';
export type MixOption = { id: string; tag: string; family: MixFamily; key?: string; name?: string };
export type MixChoice = MixOption & { weight: number; locked: boolean };

export function uniqueMixOptions<T extends MixOption>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(row => !!row.tag.trim() && !seen.has(row.tag.trim()) && !!seen.add(row.tag.trim()));
}

export function restoreMixChoices(value: unknown): MixChoice[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return uniqueMixOptions(value.filter(row => row && typeof row.tag === 'string' && row.tag.trim() && Number.isFinite(row.weight) && ['medium', 'style', 'light', 'local', 'artists'].includes(row.family))
    .map((row, index) => {
      const id = typeof row.id === 'string' && row.id && !ids.has(row.id) ? row.id : `restored:${index}:${row.tag}`;
      ids.add(id);
      return { ...row, id, tag: row.tag.trim(), weight: Math.max(.1, Math.min(2, row.weight)), locked: row.locked === true } as MixChoice;
    })).slice(0, 6);
}

/** Terms change independently of weights; locked slots and their order survive. */
export function randomizeMix(choices: MixChoice[], pool: MixOption[], count: number, random = Math.random): MixChoice[] {
  const locked = choices.filter(row => row.locked);
  const lockedTags = new Set(locked.map(row => row.tag));
  const available = uniqueMixOptions(pool).filter(row => !lockedTags.has(row.tag));
  if (!Number.isInteger(count) || count < 2 || count > 6 || locked.length > count || available.length < count - locked.length) return choices;
  for (let index = available.length - 1; index > 0; index--) {
    const other = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
    [available[index], available[other]] = [available[other], available[index]];
  }
  const fresh = available.slice(0, count - locked.length);
  const next: MixChoice[] = [];
  let cursor = 0;
  for (const previous of choices) {
    if (previous.locked) next.push(previous);
    else if (cursor < fresh.length) next.push({ ...fresh[cursor++], weight: previous.weight, locked: false });
  }
  return [...next, ...fresh.slice(cursor).map(row => ({ ...row, weight: 1, locked: false }))];
}
