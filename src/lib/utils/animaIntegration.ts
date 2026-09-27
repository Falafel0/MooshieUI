import type {
  AnimaArtistMixerParams,
  AnimaToolsParams,
} from "../types/index.js";

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

export function parseTagList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function updateTagList(value: string, tag: string, remove = false): string {
  const next = parseTagList(value);
  const key = tag.trim().toLowerCase();
  const filtered = next.filter((item) => item.toLowerCase() !== key);
  if (!remove && key) filtered.push(tag.trim());
  return filtered.join(", ");
}
