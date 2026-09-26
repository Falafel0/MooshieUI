/** Cosmetic only: how a mask or a region is drawn, never what generation runs.
 *
 * Two masks side by side are indistinguishable when every layer shares one
 * colour, and a region painted in the brush colour looks exactly like a raster
 * stroke. Each layer can therefore carry its own tint, and the palette lives
 * here so the canvas, the layer list and the status bar cannot drift apart.
 *
 * The keys are literal colours on purpose. A theme variable would tie the
 * interface to Tailwind still emitting it — this project defines its own
 * neutral ramp and v4 only ships the colours something actually uses — while
 * the canvas needs a literal value regardless. One palette, one value, one
 * place to change it.
 */
export const LAYER_TINTS = {
  rose: "#fb7185",
  amber: "#fbbf24",
  lime: "#a3e635",
  emerald: "#34d399",
  sky: "#38bdf8",
  violet: "#a78bfa",
  fuchsia: "#e879f9",
  slate: "#94a3b8",
} as const;

export type LayerTintKey = keyof typeof LAYER_TINTS;

export const LAYER_TINT_KEYS = Object.keys(LAYER_TINTS) as LayerTintKey[];

/** Masks and regions differ at a glance; a raster layer is the picture itself. */
export const DEFAULT_LAYER_TINT: Record<string, LayerTintKey> = {
  mask: "rose",
  region: "violet",
  raster: "sky",
};

type TintedLayer = { type: string; tint?: string };

/** The palette key a layer draws with: its own choice, else its type's default.
 * An unknown key falls back instead of leaving the layer invisible. */
export function resolveTintKey(layer: TintedLayer): LayerTintKey {
  const chosen = layer.tint as LayerTintKey | undefined;
  if (chosen && chosen in LAYER_TINTS) return chosen;
  return DEFAULT_LAYER_TINT[layer.type] ?? "slate";
}

/** The literal colour, for anything drawn on a canvas or in the interface. */
export function resolveTint(layer: TintedLayer): string {
  return LAYER_TINTS[resolveTintKey(layer)];
}
