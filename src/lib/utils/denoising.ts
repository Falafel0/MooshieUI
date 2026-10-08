/** Keep persisted, imported and typed denoise values inside the sampler range. */
export function normalizeDenoise(value: unknown, fallback = 0.7): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

/** Only image-to-image and inpainting start from a partially noised image. */
export function effectiveGenerationDenoise(mode: string, value: number): number {
  return mode === 'img2img' || mode === 'inpainting' ? normalizeDenoise(value) : 1;
}
