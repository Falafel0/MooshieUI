export const GENERATION_SECTIONS = ["imageInputs", "imageEdit", "prompts", "dimensions", "videoSettings", "inpaintLayers", "generationSettings", "model", "sampler", "novelai", "naiFaceDetail", "controlnet", "styleTransfer", "styleRef", "facefix", "upscaleHistory"] as const;
export type GenerationSectionId = typeof GENERATION_SECTIONS[number];
const LEGACY_DEFAULT = ["dimensions", "prompts", "imageInputs", "imageEdit", ...GENERATION_SECTIONS.slice(4)];
export function normalizeGenerationSections(order: unknown, migrateLegacyDefault = false): GenerationSectionId[] {
  if (!Array.isArray(order) || (migrateLegacyDefault && JSON.stringify(order) === JSON.stringify(LEGACY_DEFAULT))) return [...GENERATION_SECTIONS];
  const expanded = order.flatMap((id) => id === "modelSampler" ? ["model", "sampler"] : [id]);
  const valid = [...new Set(expanded.filter((id): id is GenerationSectionId => typeof id === "string" && GENERATION_SECTIONS.includes(id as GenerationSectionId)))];
  return [...valid, ...GENERATION_SECTIONS.filter((id) => !valid.includes(id))];
}
