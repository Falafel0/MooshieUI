export interface InpaintSettings {
  resize_mode: 'resize' | 'crop' | 'fill' | 'latent';
  mask_blur: number;
  invert_mask: boolean;
  masked_content: 'original' | 'fill' | 'noise' | 'nothing';
  area: 'whole' | 'masked';
  padding: number;
  context_padding_x: number;
  context_padding_y: number;
  context_shape: 'bounds' | 'square';
  context_min_size: number;
  preserve_context_aspect: boolean;
  soft: boolean;
  schedule_bias: number;
  preservation: number;
  transition_contrast: number;
  mask_influence: number;
  difference_threshold: number;
  difference_contrast: number;
}

export const DEFAULT_INPAINT_SETTINGS: InpaintSettings = {
  resize_mode: 'resize', mask_blur: 4, invert_mask: false,
  masked_content: 'original', area: 'whole', padding: 32,
  context_padding_x: 32, context_padding_y: 32, context_shape: 'bounds', context_min_size: 0,
  preserve_context_aspect: true, soft: false,
  schedule_bias: 1, preservation: 0.5, transition_contrast: 4,
  mask_influence: 0, difference_threshold: 0.5, difference_contrast: 2,
};

export function normalizeInpaintSettings(value: Partial<InpaintSettings> | null | undefined): InpaintSettings {
  const next = { ...DEFAULT_INPAINT_SETTINGS };
  if (!value || typeof value !== 'object') return next;
  for (const key of ['resize_mode', 'masked_content', 'area', 'context_shape'] as const) {
    const options = key === 'resize_mode' ? ['resize','crop','fill','latent'] : key === 'area' ? ['whole','masked'] : key === 'context_shape' ? ['bounds','square'] : ['original','fill','noise','nothing'];
    if (options.includes(value[key] as string)) (next as any)[key] = value[key];
  }
  for (const key of ['soft','invert_mask','preserve_context_aspect'] as const) if (typeof value[key] === 'boolean') next[key] = value[key];
  const limits = { mask_blur: 64, padding: 256, context_padding_x: 512, context_padding_y: 512, context_min_size: 4096, schedule_bias: 8, preservation: 1, transition_contrast: 16, mask_influence: 1, difference_threshold: 1, difference_contrast: 16 };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const number = value[key];
    if (typeof number === 'number' && Number.isFinite(number)) next[key] = Math.max(key.includes('contrast') || key === 'schedule_bias' ? 0.01 : 0, Math.min(limits[key], number));
  }
  // Old saved workspaces only had one padding value.
  if (value.context_padding_x === undefined && typeof value.padding === 'number') next.context_padding_x = next.padding;
  if (value.context_padding_y === undefined && typeof value.padding === 'number') next.context_padding_y = next.padding;
  return next;
}
