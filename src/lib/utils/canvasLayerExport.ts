import type Konva from "konva";

/** Export document pixels without viewport transforms or preview-only visibility. */
export function captureLayer(layer: Konva.Layer, width: number, height: number): HTMLCanvasElement {
  const saved = { x: layer.x(), y: layer.y(), scaleX: layer.scaleX(), scaleY: layer.scaleY(), visible: layer.visible(), opacity: layer.opacity() };
  try {
    layer.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true, opacity: 1 });
    return layer.toCanvas({ pixelRatio: 1, width, height });
  } finally {
    layer.setAttrs(saved);
  }
}

/** Convert the mask layer's alpha coverage into a grayscale generation mask. */
export function maskToGrayscale(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const ctx = output.getContext("2d")!;
  const pixels = source.getContext("2d")!.getImageData(0, 0, source.width, source.height);
  let hasPixels = false;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = pixels.data[i + 3];
    if (value > 0) hasPixels = true;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    pixels.data[i + 3] = 255;
  }
  if (!hasPixels) return null;
  ctx.putImageData(pixels, 0, 0);
  return output;
}

/** Photopea can export a black-on-white mask without transparency. Convert its
 * luminance to coverage; transparent exports already encode coverage in alpha. */
export function opaqueMaskLuminanceToAlpha(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 255) return false;
  }
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i + 3] = Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
  }
  return true;
}

export interface MaskPixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Return the tight non-zero bounds of an exported grayscale generation mask. */
export function grayscaleMaskBounds(source: HTMLCanvasElement): MaskPixelBounds | null {
  const width = source.width;
  const height = source.height;
  if (width <= 0 || height <= 0) return null;
  const pixels = source.getContext("2d")!.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export async function canvasPngBytes(canvas: HTMLCanvasElement): Promise<number[]> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode mask PNG");
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
