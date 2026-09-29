import { TAG_IMPLICATIONS } from './palettes.js';

/**
 * Tag relationships, mirroring the four verbs the reference Atelier engine uses:
 *
 * - `implies`  — selecting the source always brings the target along
 * - `requires` — the target is a structural prerequisite of the source
 * - `suggests` — offered as a one-click companion, never added automatically
 * - `conflicts` — the two cannot coexist; the UI asks before replacing
 *
 * Sources are always real Danbooru tags, so an auto-added target is never a
 * fabricated concept: it is either an implication the tag already carries or an
 * explicitly authored dependency.
 */
export type RelationType = 'implies' | 'requires' | 'suggests' | 'conflicts';

export interface Relation {
  source: string;
  target: string;
  type: RelationType;
}

/** Authored on top of the palette implications that shipped with the catalogue. */
const AUTHORED: Relation[] = [
  // Species carry their anatomy.
  { source: 'cat_girl', target: 'cat_ears', type: 'requires' },
  { source: 'cat_girl', target: 'cat_tail', type: 'requires' },
  { source: 'fox_girl', target: 'fox_ears', type: 'requires' },
  { source: 'fox_girl', target: 'fox_tail', type: 'requires' },
  { source: 'western_dragon', target: 'dragon_tail', type: 'requires' },
  { source: 'demon', target: 'demon_horns', type: 'requires' },
  { source: 'angel', target: 'halo', type: 'implies' },
  { source: 'succubus', target: 'succubus_horns', type: 'suggests' },

  // Hairstyles: a braid count only means something with the braid itself.
  { source: 'twin_braids', target: 'braid', type: 'requires' },
  { source: 'multiple_braids', target: 'braid', type: 'requires' },
  { source: 'gradient_hair', target: 'two-tone_hair', type: 'conflicts' },
  { source: 'colored_tips', target: 'colored_inner_hair', type: 'suggests' },
  { source: 'twintails', target: 'hair_ribbon', type: 'suggests' },
  { source: 'ponytail', target: 'hair_ribbon', type: 'suggests' },

  // Body: mutually exclusive shapes.
  { source: 'flat_chest', target: 'large_breasts', type: 'conflicts' },
  { source: 'petite', target: 'muscular_female', type: 'conflicts' },

  // Outfits bring their accessories and styling companions.
  { source: 'maid_dress', target: 'frills', type: 'suggests' },
  { source: 'school_uniform', target: 'pleated_skirt', type: 'suggests' },
  { source: 'gothic_lolita', target: 'thighhighs', type: 'suggests' },
  { source: 'apron', target: 'maid_dress', type: 'suggests' },
  { source: 'necktie', target: 'school_uniform', type: 'suggests' },
  { source: 'headbow', target: 'gothic_lolita', type: 'suggests' },
];

/** Every implicit `implies` pair from the catalogue, plus the authored table. */
export const RELATIONS: Relation[] = [
  ...Object.entries(TAG_IMPLICATIONS).flatMap(([source, targets]) =>
    targets.map((target) => ({ source, target, type: 'implies' as RelationType })),
  ),
  ...AUTHORED,
];

const index = new Map<string, Relation[]>();
for (const relation of RELATIONS) {
  const list = index.get(relation.source);
  if (list) list.push(relation); else index.set(relation.source, [relation]);
}

export function relationsFrom(tag: string): Relation[] {
  return index.get(tag) ?? [];
}

/** Targets of `implies` / `requires`, i.e. tags to add silently. */
export function dependentTags(tag: string): { tag: string; type: 'implies' | 'requires' }[] {
  return relationsFrom(tag)
    .filter((r): r is Relation & { type: 'implies' | 'requires' } => r.type === 'implies' || r.type === 'requires')
    .map((r) => ({ tag: r.target, type: r.type }));
}

export function suggestedTags(tag: string): string[] {
  return relationsFrom(tag).filter((r) => r.type === 'suggests').map((r) => r.target);
}

/** Conflicting tags already present in `selected`, matched in either direction. */
export function conflictingTags(tag: string, selected: Iterable<string>): string[] {
  const present = new Set(selected);
  const clashes = new Set<string>();
  for (const relation of relationsFrom(tag)) {
    if (relation.type === 'conflicts' && present.has(relation.target)) clashes.add(relation.target);
  }
  for (const other of present) {
    for (const relation of relationsFrom(other)) {
      if (relation.type === 'conflicts' && relation.target === tag) clashes.add(other);
    }
  }
  return [...clashes];
}
