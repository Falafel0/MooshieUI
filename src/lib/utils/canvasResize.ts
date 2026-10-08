/** Document resize geometry, shared by drawn pixels, imported assets and references. */
export interface CanvasImagePlacement { x: number; y: number; width: number; height: number }
export interface CanvasResizeOptions {
  mode: 'bounds' | 'scale';
  /** Which point of the old document stays anchored inside the new bounds. */
  anchor?: { x: 0 | 0.5 | 1; y: 0 | 0.5 | 1 };
}
export interface CanvasResizeTransform { scaleX: number; scaleY: number; offsetX: number; offsetY: number }

export function documentResizeTransform(oldWidth: number, oldHeight: number, width: number, height: number, options: CanvasResizeOptions): CanvasResizeTransform {
  if (options.mode === 'scale') return { scaleX: width / oldWidth, scaleY: height / oldHeight, offsetX: 0, offsetY: 0 };
  const anchor = options.anchor ?? { x: 0.5, y: 0.5 };
  // Integer offsets preserve pixel alignment when the old document has an odd side.
  return { scaleX: 1, scaleY: 1, offsetX: Math.round((width - oldWidth) * anchor.x), offsetY: Math.round((height - oldHeight) * anchor.y) };
}

export function resizedPlacement<T extends CanvasImagePlacement>(rect: T, transform: CanvasResizeTransform): T {
  return { ...rect, x: rect.x * transform.scaleX + transform.offsetX, y: rect.y * transform.scaleY + transform.offsetY,
    width: rect.width * transform.scaleX, height: rect.height * transform.scaleY };
}

export function fittedImagePlacement(imageWidth: number, imageHeight: number, width: number, height: number): CanvasImagePlacement {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale, drawHeight = imageHeight * scale;
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}

/** ControlNet inputs are full-document pixels; empty margins must stay black. */
export function placedControlnetReference(source: CanvasImageSource, placement: CanvasImagePlacement, width: number, height: number): HTMLCanvasElement {
  const pixels = document.createElement('canvas');
  pixels.width = width; pixels.height = height;
  const context = pixels.getContext('2d')!;
  context.fillStyle = '#000000'; context.fillRect(0, 0, width, height);
  context.drawImage(source, placement.x, placement.y, placement.width, placement.height);
  return pixels;
}
