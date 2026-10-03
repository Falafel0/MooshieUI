import type {
  AnimaArtistMixerParams,
  AnimaToolsParams,
} from "../types/index.js";
import { getPromptInertRanges } from "./promptInertRanges.js";

export function defaultAnimaArtistMixer(): AnimaArtistMixerParams {
  return {
    enabled: false,
    artist_chain: "",
    method: "adapter",
    strength: 1,
    normalize_weights: true,
    alignment_mode: "base_anchored",
    combine_mode: "output_avg",
    fusion_mode: "interpolate",
    apply_to_uncond: false,
    uncond_strength: 0,
    start_block: 0,
    end_block: -1,
    start_percent: 0,
    end_percent: 1,
    artist_ema_alpha: 0,
    lowrank_k: 1,
    artist_static_capture: false,
    static_capture_k: 6,
    artist_anchor_q: false,
    anchor_seed_list: "",
    anchor_seeds_count: 1,
    anchor_user_blend: 0,
    anchor_deep_layer_threshold: -1,
    stabilizer_end_percent: 1,
    anchor_refresh_mode: "once",
    anchor_cache_points: 8,
    anchor_keyframe_mode: "uniform_sigma",
    layer_filter: "",
    structure_preserve: 0,
    delta_norm_cap: 0,
    style_balance: 0,
  };
}

export function defaultAnimaTools(): AnimaToolsParams {
  return {
    enabled: false,
    quality_prompt: "",
    artist_tags: "",
    character_tags: "",
    clothing_tags: "",
    pose_tags: "",
    background_tags: "",
    separator: ", ",
    composer_enabled: false,
    enable_artist: true,
    enable_character: true,
    enable_clothing: true,
    enable_background: true,
    enable_pose: true,
    character_detail: "trigger",
    seed: -1,
    artist_count: 1,
    character_seed: -1,
    character_tag_count: 3,
    character_keep_features: true,
    clothing_seed: -1,
    clothing_source: "author",
    multi_lora_enabled: false,
  };
}

export function normalizeAnimaArtistMixer(
  value: Partial<AnimaArtistMixerParams> | null | undefined,
): AnimaArtistMixerParams {
  return { ...defaultAnimaArtistMixer(), ...(value ?? {}) };
}

export function normalizeAnimaTools(
  value: Partial<AnimaToolsParams> | null | undefined,
): AnimaToolsParams {
  return { ...defaultAnimaTools(), ...(value ?? {}) };
}

export const ANIMA_PROMPT_GROUPS = [
  "quality_prompt",
  "artist_tags",
  "character_tags",
  "clothing_tags",
  "pose_tags",
  "background_tags",
] as const;

export type AnimaPromptGroup = (typeof ANIMA_PROMPT_GROUPS)[number];

export const ANIMA_GROUP_LABELS: Record<AnimaPromptGroup, string> = {
  quality_prompt: "anima_studio.group.quality",
  artist_tags: "anima_studio.group.artist",
  character_tags: "anima_studio.group.character",
  clothing_tags: "anima_studio.group.clothing",
  pose_tags: "anima_studio.group.pose",
  background_tags: "anima_studio.group.background",
};

/** Used by imports as well as the prompt editor; unknown tags remain character details. */
export function groupAnimaTags(tags: string[], known: readonly { n: string; c: number }[] = []): Partial<Record<AnimaPromptGroup, string[]>> {
  const index = new Map(known.map(entry => [entry.n.toLowerCase(), entry.c]));
  const groups: Partial<Record<AnimaPromptGroup, string[]>> = {};
  for (const raw of tags) {
    // Macro IDs, scheduling and LoRA names must retain their exact spelling.
    const syntax = getPromptInertRanges(raw);
    const tag = syntax.length ? raw.trim() : raw.trim().replace(/^@/, '').replaceAll('_', ' ');
    if (!tag) continue;
    const category = index.get(raw.trim().replace(/^@/, '').toLowerCase().replaceAll(' ', '_'));
    const value = tag.toLowerCase();
    const group: AnimaPromptGroup = syntax.length ? 'character_tags' : category === 1 ? 'artist_tags' : category === 4 ? 'character_tags'
      : /background|indoors|outdoors|sky|room|street|forest|beach|city|night|day|sunset|scenery/.test(value) ? 'background_tags'
      : /standing|sitting|lying|kneeling|looking|holding|walking|running|pose|from (above|below|side)|cowboy shot|full body|upper body/.test(value) ? 'pose_tags'
      : /dress|shirt|skirt|pants|shorts|jacket|coat|uniform|swimsuit|bikini|shoes|boots|socks|gloves|hat|clothes|clothing/.test(value) ? 'clothing_tags'
      : /quality|masterpiece|highres|absurdres|detailed|aesthetic|score/.test(value) ? 'quality_prompt' : 'character_tags';
    groups[group] = [...(groups[group] ?? []), tag];
  }
  return groups;
}

export function parseTagList(value: string): string[] {
  const ranges = getPromptInertRanges(value);
  const tags: string[] = [];
  const stack: string[] = [];
  let start = 0, rangeIndex = 0;
  for (let i = 0; i < value.length; i++) {
    while (ranges[rangeIndex] && ranges[rangeIndex].end <= i) rangeIndex++;
    if (ranges[rangeIndex]?.start === i) { i = ranges[rangeIndex].end - 1; continue; }
    const char = value[i];
    if (char === '\\') { i++; continue; }
    if (char === '(') stack.push(')');
    else if (char === '[') stack.push(']');
    else if (char === '{') stack.push('}');
    else if (char === stack.at(-1)) stack.pop();
    else if (!stack.length && (char === ',' || char === '\n')) {
      const tag = value.slice(start, i).trim();
      if (tag) tags.push(tag);
      start = i + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) tags.push(tail);
  return tags;
}

export function updateTagList(value: string, tag: string, remove = false): string {
  const next = parseTagList(value);
  const key = tag.trim().toLowerCase();
  const filtered = next.filter((item) => item.toLowerCase() !== key);
  if (!remove && key) filtered.push(tag.trim());
  return filtered.join(", ");
}

/** Expand the same named macros as the main prompt without mutating saved groups. */
export function resolveAnimaPromptGroups(params: AnimaToolsParams, resolve: (text: string) => string): AnimaToolsParams {
  const result = { ...params };
  for (const group of ANIMA_PROMPT_GROUPS) result[group] = resolve(params[group]);
  return result;
}

/** Keep the visible model-only LoRA switch without reviving retired prompt groups. */
export function generationAnimaTools(params: AnimaToolsParams): AnimaToolsParams | null {
  return params.multi_lora_enabled
    ? { ...defaultAnimaTools(), enabled: true, multi_lora_enabled: true }
    : null;
}
