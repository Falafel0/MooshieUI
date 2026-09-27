export interface CanvasViewportLike {
  zoom: number;
  panX: number;
  panY: number;
}

const FIT_PADDING = 0.9;

/** Return the centred viewport used by the canvas' Fit command. */
export function fittedCanvasViewport(
  containerWidth: number,
  containerHeight: number,
  documentWidth: number,
  documentHeight: number,
): CanvasViewportLike {
  const safeDocumentWidth = Math.max(1, documentWidth);
  const safeDocumentHeight = Math.max(1, documentHeight);
  const safeContainerWidth = Math.max(0, containerWidth);
  const safeContainerHeight = Math.max(0, containerHeight);
  const zoom = Math.min(
    safeContainerWidth / safeDocumentWidth,
    safeContainerHeight / safeDocumentHeight,
  ) * FIT_PADDING;

  return {
    zoom,
    panX: (safeContainerWidth - safeDocumentWidth * zoom) / 2,
    panY: (safeContainerHeight - safeDocumentHeight * zoom) / 2,
  };
}

/**
 * Whether the user is still looking at the exact Fit viewport. Keeping this
 * state sticky lets late panel/banner layout changes and a replacement base
 * image re-fit automatically, while preserving any deliberate zoom or pan.
 */
export function viewportMatchesCanvasFit(
  viewport: CanvasViewportLike,
  containerWidth: number,
  containerHeight: number,
  documentWidth: number,
  documentHeight: number,
  epsilon = 1e-6,
): boolean {
  const fitted = fittedCanvasViewport(
    containerWidth,
    containerHeight,
    documentWidth,
    documentHeight,
  );
  return Math.abs(viewport.zoom - fitted.zoom) <= epsilon
    && Math.abs(viewport.panX - fitted.panX) <= epsilon
    && Math.abs(viewport.panY - fitted.panY) <= epsilon;
}
