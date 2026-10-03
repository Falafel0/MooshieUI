import type { Category, Variant } from './types.js';

/** Curated additions to existing slots, available offline. Online catalogs stay separate. */
const additions: Record<string, string[]> = {
  species: ['vampire', 'fairy', 'mermaid', 'android', 'robot', 'cyborg', 'witch', 'werewolf', 'wolf_girl', 'bunny_girl', 'dog_girl', 'cat_boy', 'fox_boy', 'demon_boy', 'oni', 'ghost', 'slime_girl'],
  skin: ['dark_skin', 'tan', 'pale_skin', 'blue_skin', 'green_skin', 'grey_skin', 'scales', 'freckles', 'vitiligo', 'tattoo', 'scar'],
  hair_style: ['curly_hair', 'messy_hair', 'spiked_hair', 'hair_bun', 'double_bun', 'side_ponytail', 'low_ponytail', 'high_ponytail', 'side_braid', 'french_braid', 'braided_bun', 'single_hair_bun', 'half_updo', 'undercut', 'pixie_cut', 'afro', 'ringlets', 'drill_hair', 'hair_over_one_eye', 'swept_bangs', 'blunt_bangs', 'parted_bangs', 'ahoge', 'hair_flaps', 'hair_ornament'],
  hair_color: ['brown_hair', 'grey_hair', 'aqua_hair', 'light_brown_hair', 'dark_blue_hair', 'multicolored_hair'],
  eye_color: ['brown_eyes', 'grey_eyes', 'black_eyes', 'orange_eyes', 'aqua_eyes', 'white_eyes'],
  pupil_shape: ['horizontal_pupils', 'cross-shaped_pupils', 'no_pupils'],
  emotions: ['grin', 'laughing', 'sad', 'crying', 'tears', 'angry', 'annoyed', 'surprised', 'scared', 'embarrassed', 'nervous_smile', 'evil_smile', 'closed_eyes', 'half-closed_eyes', 'wink', 'sleepy', 'serious', 'frown', 'puffy_cheeks', 'thinking', 'disgust'],
  top_type: ['cardigan', 'jacket', 'blazer', 'coat', 'trench_coat', 'bomber_jacket', 'leather_jacket', 'denim_jacket', 'suit_jacket', 'vest', 'waistcoat', 'camisole', 'tube_top', 'turtleneck', 'sweater_vest', 'poncho', 'cape', 'cloak', 'fur_coat', 'raincoat', 'jersey', 'sailor_shirt', 'polo_shirt', 'off-shoulder_shirt', 'bustier'],
  top_material: ['wool', 'satin', 'fur', 'mesh', 'latex'],
  bottom_type: ['skirt', 'pencil_skirt', 'high-waist_skirt', 'denim_skirt', 'plaid_skirt', 'hakama', 'culottes', 'cargo_pants', 'baggy_pants', 'wide-leg_pants', 'leggings', 'bike_shorts', 'denim_shorts', 'short_shorts', 'bloomers', 'overalls'],
  dress_type: ['dress', 'wedding_dress', 'cocktail_dress', 'frilled_dress', 'china_dress', 'yukata', 'hanfu', 'hanbok', 'sari', 'dirndl', 'nurse', 'military_uniform', 'police_uniform', 'sailor_uniform', 'serafuku', 'suit', 'tuxedo', 'jumpsuit', 'leotard', 'robe', 'gown'],
};

const garmentSlots = new Set(['top_type', 'bottom_type', 'dress_type']);
const garmentModifiers = [
  { name: 'Loose fit', tag: 'loose_clothes', conflictsWith: ['tight_clothes'] },
  { name: 'Fitted', tag: 'tight_clothes', conflictsWith: ['loose_clothes'] },
  { name: 'Striped', tag: 'striped' }, { name: 'Plaid', tag: 'plaid' },
  { name: 'Floral', tag: 'floral_print' }, { name: 'Frills', tag: 'frills' },
  { name: 'Embroidery', tag: 'embroidery' }, { name: 'Lace trim', tag: 'lace_trim' },
];
const clothingColors = ['black', 'white', 'red', 'blue', 'green', 'pink', 'purple', 'brown', 'beige', 'grey'];

/** The same detail controls apply to curated, live and user-authored variants. */
export function withContextOptions(variant: Variant, subId: string): Variant {
  if (!variant.tag || variant.tag === 'naked') return variant;
  let modifiers = variant.modifiers ?? [];
  let parts = variant.parts ?? [];
  if (garmentSlots.has(subId)) {
    modifiers = [...modifiers, ...garmentModifiers.filter(mod => !modifiers.some(v => v.tag === mod.tag))];
    const defaults = [
      { name: 'Color', tags: clothingColors.map(tag => ({ tag, name: tag })) },
      { name: 'Material', tags: ['cotton', 'leather', 'denim', 'silk', 'lace', 'velvet', 'wool', 'satin', 'fur', 'mesh', 'latex'].map(tag => ({ tag, name: tag })) },
    ];
    parts = [...parts, ...defaults.filter(part => !parts.some(existing => existing.name === part.name))];
  }
  if (subId === 'hair_color' || subId === 'hair_color_wheel') {
    modifiers = [...modifiers, ...[
      { name: 'Gradient', tag: 'gradient_hair', needsColor: true, conflictsWith: ['two-tone_hair'] },
      { name: 'Two tones', tag: 'two-tone_hair', needsColor: true, conflictsWith: ['gradient_hair'] },
      { name: 'Colored tips', tag: 'colored_tips', needsColor: true },
      { name: 'Colored inner hair', tag: 'colored_inner_hair', needsColor: true },
      { name: 'Streaks', tag: 'streaked_hair', needsColor: true },
    ].filter(mod => !modifiers.some(v => v.tag === mod.tag))];
  }
  return { ...variant, modifiers, parts };
}

export function expandCatalog(categories: Category[]): Category[] {
  return categories.map(category => ({ ...category, subs: category.subs.map(sub => {
    if (!sub.variants) return sub;
    const seen = new Set(sub.variants.map(v => v.tag));
    const extra: Variant[] = (additions[sub.id] ?? []).filter(tag => !seen.has(tag))
      .map(tag => ({ id: tag, tag, name: tag.replaceAll('_', ' ') }));
    const variants = [...sub.variants, ...extra].map(variant => withContextOptions(variant, sub.id));
    return { ...sub, variants, groups: sub.groups && extra.length
      ? [...sub.groups, { name: 'More', variantIds: extra.map(v => v.id) }] : sub.groups };
  }) }));
}
