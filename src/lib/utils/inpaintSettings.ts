export interface InpaintSettings {
  resize_mode: 'resize' | 'crop' | 'fill' | 'latent';
  mask_blur: number;
  invert_mask: boolean;
  masked_content: 'original' | 'fill' | 'noise' | 'nothing';
  area: 'whole' | 'masked';
  padding: number;
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
  masked_content: 'original', area: 'whole', padding: 32, soft: false,
  schedule_bias: 1, preservation: 0.5, transition_contrast: 4,
  mask_influence: 0, difference_threshold: 0.5, difference_contrast: 2,
};

export function normalizeInpaintSettings(value: Partial<InpaintSettings> | null | undefined): InpaintSettings {
  const next = { ...DEFAULT_INPAINT_SETTINGS };
  if (!value || typeof value !== 'object') return next;
  for (const key of ['resize_mode', 'masked_content', 'area'] as const) {
    const options = key === 'resize_mode' ? ['resize','crop','fill','latent'] : key === 'area' ? ['whole','masked'] : ['original','fill','noise','nothing'];
    if (options.includes(value[key] as string)) (next as any)[key] = value[key];
  }
  for (const key of ['soft','invert_mask'] as const) if (typeof value[key] === 'boolean') next[key] = value[key];
  const limits = { mask_blur: 64, padding: 256, schedule_bias: 8, preservation: 1, transition_contrast: 16, mask_influence: 1, difference_threshold: 1, difference_contrast: 16 };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const number = value[key];
    if (typeof number === 'number' && Number.isFinite(number)) next[key] = Math.max(key.includes('contrast') || key === 'schedule_bias' ? 0.01 : 0, Math.min(limits[key], number));
  }
  return next;
}
