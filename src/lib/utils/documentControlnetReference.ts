import { placedControlnetReference, type CanvasImagePlacement } from './canvasResize.js';
import { canvasPngBytes } from './canvasLayerExport.js';

/** A restored or resized own reference must send the same document pixels to
 * generation and preprocessor previews, rather than a stale server filename. */
export async function documentControlnetSourceBytes(source: string, placement: CanvasImagePlacement | undefined, width: number, height: number): Promise<number[]> {
  if (!placement) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`ControlNet reference read failed: ${response.status}`);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode ControlNet reference'));
    image.src = source;
  });
  return canvasPngBytes(placedControlnetReference(image, placement, width, height));
}
