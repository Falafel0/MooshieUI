import type { Detail, Choice } from './studio.svelte.js';

import { getPromptInertRanges } from '../utils/promptInertRanges.js';

const words = (tag: string) => {
  let result = '', cursor = 0;
  for (const range of getPromptInertRanges(tag)) {
    result += tag.slice(cursor, range.start).replaceAll('_', ' ') + tag.slice(range.start, range.end);
    cursor = range.end;
  }
  return result + tag.slice(cursor).replaceAll('_', ' ');
};

/** Keep modifiers attached to their owner, including weighted owners. */
export function contextualTag(choice: Choice, detail?: Detail): string {
  const colorContext = choice.category.startsWith('hair_') ? 'hair' : choice.category.startsWith('eye_') ? 'eyes' : '';
  const baseTag = colorContext && !choice.tag.includes('_') ? `${words(choice.tag)} ${colorContext}` : words(choice.tag);
  if (!detail) return baseTag;
  const clauses: string[] = [];
  for (const mod of detail.mods) {
    if (mod === 'gradient_hair' && detail.secondary) clauses.push(`a gradient fading to ${words(detail.secondary)}`);
    else if (mod === 'colored_inner_hair' && detail.secondary) clauses.push(`${words(detail.secondary)} inner hair`);
    else if (mod === 'sleeves_rolled_up') clauses.push('rolled-up sleeves');
    else if (mod === 'loose_clothes') clauses.push('a loose fit');
    else if (mod === 'tight_clothes') clauses.push('a fitted cut');
    else if (mod === 'striped') clauses.push('a striped pattern');
    else if (mod === 'plaid') clauses.push('a plaid pattern');
    else if (mod === 'streaked_hair') clauses.push(detail.secondary ? `${words(detail.secondary)} streaks` : 'colored streaks');
    else if (mod === 'colored_tips') clauses.push(detail.secondary ? `${words(detail.secondary)} tips` : 'colored tips');
    else if (mod === 'two-tone_hair') clauses.push(detail.secondary ? `a second tone of ${words(detail.secondary)}` : 'two tones');
    else clauses.push(words(mod));
  }
  if (detail.secondary && !detail.mods.some(mod => ['gradient_hair', 'colored_inner_hair', 'streaked_hair', 'colored_tips', 'two-tone_hair'].includes(mod))) {
    clauses.push(`${words(detail.secondary)} accents`);
  }
  for (const [name, part] of Object.entries(detail.parts)) if (part && part !== choice.tag && name !== 'Color' && name !== 'Material') clauses.push(words(part));
  const subject = detail.quantity && detail.quantity !== choice.tag ? words(detail.quantity) : baseTag;
  const base = [detail.parts.Color, detail.parts.Material].filter(Boolean).map(words).concat(subject).join(' ');
  return base + (clauses.length ? ` with ${clauses.join(' and ')}` : '');
}
