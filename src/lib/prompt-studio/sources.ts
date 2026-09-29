/**
 * Upstream sources and their thematic grouping.
 *
 * Anima Tools publishes its catalogues as raw arrays (see the Rust
 * `anima_catalog` command, which mirrors `js/<file>` from
 * github.com/nregret/Comfyui-Anima-Tools) and each entry already carries the
 * upstream `categories` group plus the tag list it should inject. Danbooru
 * attire is the same idea one level up: a `{ slot: [tags] }` map whose slots
 * line up with the studio's clothing subcategories.
 *
 * Nothing here invents tags — every entry either injects the tag list the
 * upstream catalogue authored or one of Danbooru's own grouped tag lists.
 */

/** Themes the studio groups its own tags and every source under. */
export type StudioTheme = 'style' | 'character' | 'detail' | 'wardrobe' | 'scene' | 'pose' | 'quality';

export type SourceId = 'artists' | 'characters' | 'character_details' | 'clothing' | 'attire' | 'backgrounds' | 'poses';

export interface SourceEntry {
  id: string;
  name: string;
  /** Tags injected when the entry is picked. */
  tags: string[];
  /** Upstream thematic groups, shown verbatim so grouping stays faithful. */
  categories: string[];
  traits: string[];
  preview?: string;
}

export interface SourceMeta {
  id: SourceId;
  labelKey: string;
  theme: StudioTheme;
  /** Entries are recipes that inject several tags at once. */
  multi: boolean;
}

export const SOURCES: SourceMeta[] = [
  { id: 'artists', labelKey: 'prompt_studio.source_artists', theme: 'style', multi: false },
  { id: 'characters', labelKey: 'prompt_studio.source_characters', theme: 'character', multi: true },
  { id: 'character_details', labelKey: 'prompt_studio.source_details', theme: 'character', multi: true },
  { id: 'clothing', labelKey: 'prompt_studio.source_clothing', theme: 'wardrobe', multi: true },
  { id: 'attire', labelKey: 'prompt_studio.source_attire', theme: 'wardrobe', multi: true },
  { id: 'backgrounds', labelKey: 'prompt_studio.source_backgrounds', theme: 'scene', multi: false },
  { id: 'poses', labelKey: 'prompt_studio.source_poses', theme: 'pose', multi: false },
];

export interface AttireSlot {
  slot: string;
  labelKey: string;
  /** Catalogue subcategory the slot belongs to, when one exists. */
  sub?: string;
}

/**
 * Danbooru attire slots. `top` / `bottom` / `uniform` / `traditional` / `socks`
 * have a matching subcategory in the studio catalogue; the rest are clothing
 * concepts the catalogue has no slot for yet, so they are added as themed
 * extras rather than being forced into a wrong subcategory.
 */
export const ATTIRE_SLOTS: AttireSlot[] = [
  { slot: 'top', labelKey: 'prompt_studio.attire_top', sub: 'top_type' },
  { slot: 'bottom', labelKey: 'prompt_studio.attire_bottom', sub: 'bottom_type' },
  { slot: 'uniform', labelKey: 'prompt_studio.attire_uniform', sub: 'dress_type' },
  { slot: 'traditional', labelKey: 'prompt_studio.attire_traditional', sub: 'dress_type' },
  { slot: 'socks', labelKey: 'prompt_studio.attire_socks', sub: 'legwear' },
  { slot: 'shoes', labelKey: 'prompt_studio.attire_shoes' },
  { slot: 'decoration', labelKey: 'prompt_studio.attire_decoration' },
  { slot: 'vocabulary', labelKey: 'prompt_studio.attire_vocabulary' },
];

export const THEME_LABELS: { theme: StudioTheme; key: string }[] = [
  { theme: 'character', key: 'prompt_studio.theme_character' },
  { theme: 'style', key: 'prompt_studio.theme_style' },
  { theme: 'wardrobe', key: 'prompt_studio.theme_wardrobe' },
  { theme: 'scene', key: 'prompt_studio.theme_scene' },
  { theme: 'pose', key: 'prompt_studio.theme_pose' },
  { theme: 'detail', key: 'prompt_studio.theme_detail' },
  { theme: 'quality', key: 'prompt_studio.theme_quality' },
];

/** Theme owning each catalogue subcategory, used to file studio picks. */
export const SUB_THEMES: Record<string, StudioTheme> = {
  gender: 'character',
  age: 'character',
  species: 'character',
  skin: 'character',
  breast_size: 'character',
  body_build: 'character',
  hair_length: 'character',
  hair_color: 'character',
  hair_color_wheel: 'character',
  hair_blend: 'character',
  hair_style: 'character',
  eye_color: 'character',
  eye_color_wheel: 'character',
  eye_blend: 'character',
  pupil_shape: 'character',
  top_type: 'wardrobe',
  top_material: 'wardrobe',
  bottom_type: 'wardrobe',
  legwear: 'wardrobe',
  dress_type: 'wardrobe',
  emotions: 'detail',
};

export function themeForSub(subId: string): StudioTheme | undefined {
  return SUB_THEMES[subId];
}

/** Theme for a selection, whether it came from the catalogue or a source. */
export function themeForCategory(category: string): StudioTheme {
  if (category.startsWith('source:')) return (category.slice(7) as StudioTheme) ?? 'detail';
  return SUB_THEMES[category] ?? 'detail';
}

const cleanTags = (value: unknown): string[] => {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const tag = String(raw).trim().replace(/_/g, ' ');
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
};

const cleanList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];

/**
 * Normalises every upstream shape into `SourceEntry[]`:
 * catalogue arrays (clothing, backgrounds, poses), the artist table, the
 * character table (`name` + `copyright`, grouped by franchise), the
 * `{ key: { trigger, tags } }` detail map and the `{ slot: [tags] }` attire map.
 */
export function normalizeCatalog(source: SourceId, raw: unknown): SourceEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is Record<string, any> => !!item && typeof item === 'object')
      .map((item, index) => {
        const name = String(item.name ?? item.trigger ?? `#${index}`);
        // The character table carries no tag list: the character tag is the name
        // and the franchise is the copyright tag that has to ship with it.
        const tags = item.tags
          ? cleanTags(item.tags)
          : source === 'characters'
            ? cleanTags([name, item.copyright])
            : [];
        const categories = cleanList(item.categories);
        if (source === 'characters' && item.copyright) categories.unshift(String(item.copyright));
        if (source === 'artists') categories.unshift(artistTier(Number(item.post_count) || 0, Number(item.p) || 0));
        return {
          id: String(item.id ?? `${source}_${index}`),
          name,
          tags,
          categories,
          traits: cleanList(item.traits).length
            ? cleanList(item.traits)
            : [item.gender, item.hair, item.eye].filter((v): v is string => typeof v === 'string' && !!v),
          preview: typeof item.preview === 'string' ? item.preview : undefined,
        };
      })
      .filter((entry) => entry.tags.length);
  }

  if (raw && typeof raw === 'object') {
    const entries: SourceEntry[] = [];
    for (const [key, value] of Object.entries(raw as Record<string, any>)) {
      if (!value || typeof value !== 'object') continue;
      const trigger = cleanTags(value.trigger);
      const tags = [...trigger, ...cleanTags(value.tags)];
      if (!tags.length) continue;
      const [name, group] = key.split('||');
      entries.push({
        id: key,
        name: name || key,
        tags,
        categories: group ? [group] : source === 'attire' ? [key] : [],
        traits: [],
        preview: typeof value.preview === 'string' ? value.preview : undefined,
      });
    }
    return entries;
  }

  return [];
}

/** Artist popularity tiers, read off the upstream post counts. */
export function artistTier(postCount: number, tier: number): string {
  if (tier > 1) return 'artists_tier_top';
  if (postCount >= 1000) return 'artists_tier_popular';
  return 'artists_tier_niche';
}

/**
 * Upstream category labels mix locale and English, e.g.
 * `"礼服/裙装 (Dress & Gown)"`. The English half is the part the app can show,
 * so it is unwrapped when present and the raw label kept otherwise.
 */
export function groupLabel(category: string): string {
  const match = category.match(/\(([^)]+)\)\s*$/);
  return (match ? match[1] : category).trim();
}

/**
 * Files a free Danbooru tag into the catalogue theme it belongs to. Artist and
 * copyright tags are studio themes of their own; general tags are matched on
 * garment and feature words, so a Danbooru import lands in the right place
 * instead of a single "imported" pile.
 */
export function classifyTag(tag: string, danbooruCategory = 0): { category: string; name: string } {
  const name = tag.replace(/_/g, ' ');
  if (danbooruCategory === 1) return { category: 'source:style', name };
  if (danbooruCategory === 3) return { category: 'source:detail', name };
  const value = name.toLowerCase();
  if (/masterpiece|highres|absurdres|best quality|detailed|aesthetic|score_\d|solo|rating_/.test(value)) {
    return { category: 'source:quality', name };
  }
  if (/scenery|background|indoors|outdoors|sky|room|street|forest|beach|city|night|day|sunset|classroom|bedroom|water|clouds/.test(value)) {
    return { category: 'source:scene', name };
  }
  if (/standing|sitting|lying|kneeling|crouching|looking|holding|walking|running|arms|hands|legs|pose|from above|from below|from side|cowboy shot|full body|upper body|close-up/.test(value)) {
    return { category: 'source:pose', name };
  }
  if (/dress|shirt|skirt|pants|shorts|jacket|coat|uniform|swimsuit|bikini|shoes|boots|socks|gloves|hat|ribbon|necktie|apron|kimono|clothes|clothing|outfit|swimsuit/.test(value)) {
    return { category: 'source:wardrobe', name };
  }
  return { category: 'source:character', name };
}
