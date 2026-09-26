/** Geometry for the canvas transform tool.
 *
 * Every layer kind is edited through one box that covers the layer's real
 * content: the painted pixels of a mask, the drawn shapes of a region, the
 * image asset of a raster. Konva's transformer is not attached to the layer's
 * children, because a stroke inflates a client rect by its own width and the
 * box would stop matching the image a run actually reads. The box is a plain
 * rectangle instead, and each child is projected through the change the box
 * went through.
 *
 * Deliberately free of Konva: this is the arithmetic the node tests exercise,
 * and CanvasStage is the only caller.
 */

/** A rectangle with a transform, in canvas pixels. */
export interface BoxGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** Position, rotation and scale of one drawn shape. */
export interface NodeGeometry {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  strokeWidth?: number;
}

const DEG = Math.PI / 180;

export function identityBox(x: number, y: number, width: number, height: number): BoxGeometry {
  return { x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1 };
}

/** Where a shape lands when the box around it is moved, scaled and turned.
 * Scaling happens about the box origin, then the rotation is applied about the
 * same point, so the shape keeps its place inside the box. A stroke keeps its
 * relative weight. */
export function projectNode(base: NodeGeometry, box: BoxGeometry, reference: BoxGeometry): NodeGeometry {
  const sx = reference.scaleX === 0 ? 1 : box.scaleX / reference.scaleX;
  const sy = reference.scaleY === 0 ? 1 : box.scaleY / reference.scaleY;
  const deltaRotation = box.rotation - reference.rotation;
  const localX = (base.x - reference.x) * sx;
  const localY = (base.y - reference.y) * sy;
  const cos = Math.cos(deltaRotation * DEG);
  const sin = Math.sin(deltaRotation * DEG);
  const weight = (Math.abs(sx) + Math.abs(sy)) / 2;
  const projected: NodeGeometry = {
    x: box.x + localX * cos - localY * sin,
    y: box.y + localX * sin + localY * cos,
    rotation: base.rotation + deltaRotation,
    scaleX: base.scaleX * sx,
    scaleY: base.scaleY * sy,
  };
  if (base.strokeWidth !== undefined) projected.strokeWidth = base.strokeWidth * weight;
  return projected;
}

/** The axis-aligned bounding box of a rectangle turned about its own origin. */
export function rotatedBounds(x: number, y: number, width: number, height: number, rotation: number): BoxGeometry {
  const cos = Math.abs(Math.cos(rotation * DEG));
  const sin = Math.abs(Math.sin(rotation * DEG));
  const turnedWidth = width * cos + height * sin;
  const turnedHeight = width * sin + height * cos;
  return identityBox(x + (width - turnedWidth) / 2, y + (height - turnedHeight) / 2, turnedWidth, turnedHeight);
}

/** The box that covers all of the given boxes, or null when there are none. */
export function unionBounds(boxes: BoxGeometry[]): BoxGeometry | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return identityBox(left, top, right - left, bottom - top);
}

/** Keep a box inside the document, so a transform cannot park content where
 * the export would not find it. The box is intersected with the document
 * rectangle, not merely moved: a shape that hangs off the edge keeps the part
 * that is inside. */
export function clampToDocument(box: BoxGeometry, documentWidth: number, documentHeight: number): BoxGeometry {
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(documentWidth, box.x + box.width);
  const bottom = Math.min(documentHeight, box.y + box.height);
  return identityBox(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/** Whether a box has anything worth transforming. A sliver is not: it would
 * draw handles on top of each other and a drag could not pick one. */
export function isTransformable(box: BoxGeometry | null): box is BoxGeometry {
  return !!box && box.width >= 2 && box.height >= 2;
}
