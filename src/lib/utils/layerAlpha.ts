/** Document-space RGBA pixels; ImageData can be passed directly. */
export interface LayerRgbaPixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

function assertRgbaPixels(pixels: LayerRgbaPixels, name: string): void {
  if (
    !Number.isSafeInteger(pixels.width) ||
    !Number.isSafeInteger(pixels.height) ||
    pixels.width <= 0 ||
    pixels.height <= 0 ||
    !Number.isSafeInteger(pixels.width * pixels.height * 4)
  ) {
    throw new RangeError(`${name} must have positive integer dimensions`);
  }
  if (!(pixels.data instanceof Uint8ClampedArray)) {
    throw new TypeError(`${name} must contain Uint8ClampedArray RGBA pixels`);
  }
  if (pixels.data.length % 4 !== 0) {
    throw new RangeError(`${name} must contain complete RGBA pixels`);
  }
  if (pixels.data.length !== pixels.width * pixels.height * 4) {
    throw new RangeError(`${name} RGBA length does not match its dimensions`);
  }
}

function assertSameSize(first: LayerRgbaPixels, second: LayerRgbaPixels): void {
  assertRgbaPixels(first, "First image");
  assertRgbaPixels(second, "Second image");
  if (first.width !== second.width || first.height !== second.height) {
    throw new RangeError("Layer alpha images must have the same dimensions");
  }
}

/**
 * Restrict a processed grayscale generation mask to a raster's intrinsic alpha.
 * Both images must already share document coordinates, including the raster's
 * transform. Coverage comes from mask red and raster alpha; raster colours and
 * display opacity are irrelevant. The returned generation mask is grayscale
 * with opaque alpha. Inputs are neither modified nor resampled.
 */
export function restrictGenerationMaskToRasterAlpha(
  mask: LayerRgbaPixels,
  raster: LayerRgbaPixels,
): Uint8ClampedArray {
  assertSameSize(mask, raster);
  const output = new Uint8ClampedArray(mask.data.length);
  for (let index = 0; index < output.length; index += 4) {
    const coverage = Math.round(mask.data[index] * raster.data[index + 3] / 255);
    output[index] = coverage;
    output[index + 1] = coverage;
    output[index + 2] = coverage;
    output[index + 3] = 255;
  }
  return output;
}

/**
 * Clip a raster with the raw painted alpha of a mask or region. Mask RGB,
 * visibility, cached coverage and display opacity do not define painted alpha.
 * Raster RGB is retained exactly, including fully transparent pixels. Callers
 * supply unmodified document-space pixels to keep reciprocal links acyclic.
 * Inputs are neither modified nor resampled.
 */
export function applySpatialMaskToRasterAlpha(
  raster: LayerRgbaPixels,
  mask: LayerRgbaPixels,
): Uint8ClampedArray {
  assertSameSize(raster, mask);
  const output = new Uint8ClampedArray(raster.data);
  for (let index = 3; index < output.length; index += 4) {
    output[index] = Math.round(raster.data[index] * mask.data[index] / 255);
  }
  return output;
}
