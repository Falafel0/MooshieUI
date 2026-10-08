import type { ControlnetLayerSettings } from "./controlnetState.js";
import type { LayerGroup, LayerRelations } from "./layerRelations.js";
/**
 * The document a project holds, and the rules that decide whether it changed.
 *
 * A project is the workspace itself: the canvas, its layers with their pixels
 * and the prompts that belong to them. Everything here is pure — building,
 * validating and signing a document — so the rules can be tested without a
 * canvas, a backend or a browser.
 *
 * Display-only settings deliberately stay out of `documentSignature`: a tint or
 * an overlay's opacity changes how a layer looks and nothing about what the
 * document is, so recolouring a mask must not mark a project as having
 * unsaved changes.
 */

export const PROJECT_DOCUMENT_VERSION = 2;

/** Canvas sizes a document may hold, matching the generation limits. */
export const DOCUMENT_MIN_SIZE = 64;
export const DOCUMENT_MAX_SIZE = 16384;

export interface ProjectRasterImage {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

/** Editable raster strokes, preserving eraser ordering above the source asset. */
export interface RasterPaintAttrs {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radiusX?: number;
  radiusY?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  offsetX?: number;
  offsetY?: number;
  skewX?: number;
  skewY?: number;
  opacity?: number;
  strokeWidth?: number;
  tension?: number;
  points?: number[];
  fill?: string;
  stroke?: string;
  closed?: boolean;
  fillEnabled?: boolean;
  strokeEnabled?: boolean;
  strokeScaleEnabled?: boolean;
  perfectDrawEnabled?: boolean;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "round" | "bevel" | "miter";
  globalCompositeOperation?: "source-over" | "destination-out";
}

export interface RasterPaintCommand {
  type: "Line" | "Rect" | "Ellipse";
  attrs: RasterPaintAttrs;
}

/** Structural adapter: project rules need no Konva or browser dependency. */
export interface RasterPaintSourceNode {
  getClassName(): string;
  getAttrs(): Record<string, unknown>;
  hasName?(name: string): boolean;
}

const PAINT_NUMBERS = ["x", "y", "width", "height", "radiusX", "radiusY", "rotation", "scaleX", "scaleY", "offsetX", "offsetY", "skewX", "skewY", "opacity", "strokeWidth", "tension"] as const;
const PAINT_BOOLEANS = ["closed", "fillEnabled", "strokeEnabled", "strokeScaleEnabled", "perfectDrawEnabled"] as const;
const PAINT_STRINGS = ["fill", "stroke"] as const;
const PAINT_FIELDS: readonly (keyof RasterPaintAttrs)[] = [...PAINT_NUMBERS, ...PAINT_BOOLEANS, ...PAINT_STRINGS, "points", "lineCap", "lineJoin", "globalCompositeOperation"];

export function isRasterPaint(value: unknown): value is RasterPaintCommand[] {
  if (!Array.isArray(value)) return false;
  return value.every(command => {
    if (!command || typeof command !== "object" || !["Line", "Rect", "Ellipse"].includes(command.type)) return false;
    const attrs = command.attrs;
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return false;
    if (Object.keys(attrs).some(field => !PAINT_FIELDS.includes(field as keyof RasterPaintAttrs))) return false;
    if (PAINT_NUMBERS.some(field => attrs[field] !== undefined && (typeof attrs[field] !== "number" || !Number.isFinite(attrs[field])))) return false;
    if (PAINT_BOOLEANS.some(field => attrs[field] !== undefined && typeof attrs[field] !== "boolean")) return false;
    if (PAINT_STRINGS.some(field => attrs[field] !== undefined && typeof attrs[field] !== "string")) return false;
    if (attrs.points !== undefined && (!Array.isArray(attrs.points) || attrs.points.length % 2 !== 0 || attrs.points.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n)))) return false;
    if (command.type === "Line" && !Array.isArray(attrs.points)) return false;
    if (attrs.opacity !== undefined && (attrs.opacity < 0 || attrs.opacity > 1)) return false;
    if (["width", "height", "radiusX", "radiusY", "strokeWidth"].some(field => attrs[field] !== undefined && attrs[field] < 0)) return false;
    if (attrs.lineCap !== undefined && !["butt", "round", "square"].includes(attrs.lineCap)) return false;
    if (attrs.lineJoin !== undefined && !["round", "bevel", "miter"].includes(attrs.lineJoin)) return false;
    if (attrs.globalCompositeOperation !== undefined && attrs.globalCompositeOperation !== "source-over" && attrs.globalCompositeOperation !== "destination-out") return false;
    return true;
  });
}

/** Clone primitives before the first asynchronous image/asset operation. */
export function captureRasterPaint(nodes: readonly RasterPaintSourceNode[] = []): RasterPaintCommand[] {
  const commands: RasterPaintCommand[] = [];
  for (const node of nodes) {
    if (node.hasName?.("raster-asset") || node.hasName?.("raster-clip-mask")) continue;
    const type = node.getClassName();
    if (type !== "Line" && type !== "Rect" && type !== "Ellipse") {
      throw new Error(`Cannot save raster paint node: ${type}`);
    }
    const original = node.getAttrs();
    const attrs = Object.fromEntries(PAINT_FIELDS.filter(field => original[field] !== undefined)
      .map(field => [field, field === "points" && Array.isArray(original[field]) ? [...original[field]] : original[field]])) as RasterPaintAttrs;
    commands.push({ type, attrs });
  }
  if (!isRasterPaint(commands)) throw new Error("Cannot save invalid raster paint attributes");
  return commands;
}

/** Validate stored commands and return independent attributes for rendering. */
export function decodeRasterPaint(value: unknown): RasterPaintCommand[] | null {
  if (!isRasterPaint(value)) return null;
  return value.map(command => ({ type: command.type, attrs: { ...command.attrs,
    ...(command.attrs.points ? { points: [...command.attrs.points] } : {}) } }));
}

/** One layer, with its pixels: a data URL for a mask or a region, and the
 * image (usually inlined pixels) for a raster. */
export interface ProjectLayer extends LayerRelations {
  /** v2 persists ids; legacy v1 layers receive ids during the load migration. */
  id?: string;
  name: string;
  type: "raster" | "mask" | "region" | "controlnet";
  controlnet?: ControlnetLayerSettings;
  visible: boolean;
  opacity: number;
  coverage?: number;
  locked: boolean;
  tint?: string;
  showContext?: boolean;
  order: number;
  regionalPrompt?: string;
  regionalNegativePrompt?: string;
  regionalStrength?: number;
  positivePrompt?: string;
  negativePrompt?: string;
  denoise?: number;
  densityDenoise?: boolean;
  maskGrow?: number;
  inpaintWidth?: number;
  inpaintHeight?: number;
  inpaintAspectLocked?: boolean;
  initialRegion?: unknown;
  inpaintSettings?: unknown;
  image?: ProjectRasterImage;
  /** Raw primitives above image; source-over paint and destination-out erasers. */
  rasterPaint?: RasterPaintCommand[];
  /** Painted pixels of a mask or a region, as `data:image/png`. */
  spatialPng?: string | null;
}

export interface ProjectDocument {
  version: number;
  canvasWidth: number;
  canvasHeight: number;
  baseColor: string;
  backgroundColor: string;
  /** Where the view was, so reopening a document shows it as it was left.
   * Not part of the signature: moving the view is not an edit. */
  viewport: { zoom: number; panX: number; panY: number };
  layers: ProjectLayer[];
  /** Required in v2. Optional here so legacy v1 documents can be migrated. */
  groups?: LayerGroup[];
}

/** Clamp a canvas side to what the app can hold, rounding to whole pixels. */
export function clampDocumentSize(value: unknown): number {
  const size = Math.round(Number(value));
  if (!Number.isFinite(size)) return DOCUMENT_MIN_SIZE;
  return Math.max(DOCUMENT_MIN_SIZE, Math.min(DOCUMENT_MAX_SIZE, size));
}

/** An empty document, as "New" creates it. */
export function emptyDocument(
  width: number,
  height: number,
  background = "#000000",
): ProjectDocument {
  return {
    version: PROJECT_DOCUMENT_VERSION,
    canvasWidth: clampDocumentSize(width),
    canvasHeight: clampDocumentSize(height),
    baseColor: "#808080",
    backgroundColor: background,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    layers: [],
    groups: [],
  };
}

const COLOUR = /^#[0-9a-fA-F]{3,8}$/;
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function validRelations(layer: Partial<ProjectLayer>): boolean {
  if (layer.groupId !== undefined && layer.groupId !== null && !isId(layer.groupId)) return false;
  for (const [field, roles] of [
    ["targetRasterId", ["mask", "region"]],
    ["clippingMaskId", ["raster"]],
    ["referenceRasterId", ["controlnet"]],
  ] as const) {
    const id = layer[field];
    if (id == null) continue;
    const allowedRoles: readonly string[] = roles;
    if (!isId(id) || !allowedRoles.includes(layer.type ?? "")) return false;
  }
  if (layer.clippingEnabled !== undefined && (layer.type !== "raster" || typeof layer.clippingEnabled !== "boolean")) return false;
  if (layer.modifierScope !== undefined) {
    const scope = layer.modifierScope;
    if (layer.type !== "region" && layer.type !== "controlnet") return false;
    if (!scope || typeof scope !== "object" || (scope.mode !== "auto" && scope.mode !== "document" && scope.mode !== "masks")) return false;
    if (scope.maskIds !== undefined && (!Array.isArray(scope.maskIds) || !scope.maskIds.every(isId))) return false;
  }
  // Missing referenced ids are deliberately not rejected or erased: the
  // document keeps the explicit intent and the UI can repair the broken link.
  return true;
}

function validGroups(value: unknown): value is LayerGroup[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(group => {
    if (!group || typeof group !== "object" || !isId(group.id) || ids.has(group.id)
      || typeof group.name !== "string" || typeof group.visible !== "boolean"
      || (group.collapsed !== undefined && typeof group.collapsed !== "boolean")) return false;
    ids.add(group.id);
    return true;
  });
}

/**
 * True when the value is a document this build can open.
 *
 * Deliberately structural rather than fatal: a document from a future version
 * or with structurally invalid metadata is rejected here and reported by the
 * caller. An otherwise sound explicit reference to a removed layer remains a
 * repairable broken link; the loader must not erase it or widen its scope.
 */
export function isProjectDocument(value: unknown): value is ProjectDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<ProjectDocument>;
  if (!Number.isInteger(doc.version) || (doc.version !== 1 && doc.version !== PROJECT_DOCUMENT_VERSION)) return false;
  if (typeof doc.canvasWidth !== "number" || typeof doc.canvasHeight !== "number") return false;
  if (doc.canvasWidth < DOCUMENT_MIN_SIZE || doc.canvasHeight < DOCUMENT_MIN_SIZE) return false;
  if (doc.canvasWidth > DOCUMENT_MAX_SIZE || doc.canvasHeight > DOCUMENT_MAX_SIZE) return false;
  if (typeof doc.baseColor !== "string" || !COLOUR.test(doc.baseColor)) return false;
  if (typeof doc.backgroundColor !== "string" || !COLOUR.test(doc.backgroundColor)) return false;
  if (!Array.isArray(doc.layers)) return false;
  if (doc.version === 2 && !validGroups(doc.groups)) return false;
  if (doc.groups !== undefined && !validGroups(doc.groups)) return false;
  const ids = new Set<string>();
  return doc.layers.every((layer) => {
    if (!layer || typeof layer !== "object") return false;
    const candidate = layer as Partial<ProjectLayer>;
    if (doc.version === 2 && !isId(candidate.id)) return false;
    if (candidate.id !== undefined) {
      if (!isId(candidate.id) || ids.has(candidate.id)) return false;
      ids.add(candidate.id);
    }
    if (candidate.type !== "raster" && candidate.type !== "mask" && candidate.type !== "region" && candidate.type !== "controlnet") {
      return false;
    }
    if (candidate.type === "controlnet") {
      const c = candidate.controlnet;
      if (!c || typeof c.enabled !== 'boolean' || (c.mode !== 'preset' && c.mode !== 'custom')
          || !Number.isFinite(c.strength) || c.strength < 0 || !Number.isFinite(c.startPercent)
          || !Number.isFinite(c.endPercent) || c.startPercent < 0 || c.endPercent > 1 || c.startPercent >= c.endPercent
          || (c.sourceData != null && !/^data:image\//.test(c.sourceData))) return false;
    }
    if (typeof candidate.name !== "string" || typeof candidate.order !== "number") return false;
    if (!validRelations(candidate)) return false;
    if (candidate.rasterPaint !== undefined && (candidate.type !== "raster" || !isRasterPaint(candidate.rasterPaint))) return false;
    if (candidate.type === "raster" && candidate.image) {
      const image = candidate.image as Partial<ProjectRasterImage>;
      if (typeof image.src !== "string" || typeof image.width !== "number") return false;
      // A stored raster must be able to reach its pixels after a restart; a
      // document naming a session-only URL would open with an empty layer.
      if (!isDurableUrl(image.src)) return false;
    }
    return true;
  });
}

/**
 * True when a stored document can still reach these pixels after a restart.
 *
 * A `blob:` URL, a `file:` URL or one of the app's own `thumbnail://` /
 * `gallery://` schemes belongs to this session or this machine's app state and
 * is not something a document may rely on: pixels that travel with a project
 * are inlined (`data:`) or reachable (`http(s):`, an absolute path).
 */
export function isDurableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^(data:|https?:|\/)/.test(url);
}

function imageSignature(image: ProjectRasterImage | undefined): string {
  if (!image) return "-";
  return [
    image.x,
    image.y,
    image.width,
    image.height,
    image.rotation,
    image.flipX ? 1 : 0,
    image.flipY ? 1 : 0,
    // The pixels matter, not the reference: an inlined document and one that
    // points at the same file are the same picture only when the length agrees.
    // A session-only `blob:` URL changes with every new import, so its length
    // tracks a changed picture too.
    image.src.length,
  ].join(",");
}

function layerSignature(layer: ProjectLayer): string {
  const settings = layer.inpaintSettings ? JSON.stringify(layer.inpaintSettings) : "-";
  const region = layer.initialRegion ? JSON.stringify(layer.initialRegion) : "-";
  return [
    layer.type,
    layer.id ?? "-",
    layer.name,
    layer.visible ? 1 : 0,
    // A raster's opacity is real; a mask's or a region's is how it is drawn.
    layer.type === "raster" ? layer.opacity : 0,
    typeof layer.coverage === "number" ? layer.coverage : 1,
    layer.locked ? 1 : 0,
    layer.order,
    layer.groupId ?? "-",
    layer.targetRasterId ?? "-",
    layer.clippingMaskId ?? "-",
    layer.clippingEnabled === false ? 0 : 1,
    layer.referenceRasterId ?? "-",
    JSON.stringify(layer.modifierScope ?? { mode: "auto" }),
    layer.denoise ?? "-",
    layer.densityDenoise ? 1 : 0,
    layer.maskGrow ?? "-",
    layer.inpaintWidth ?? "-",
    layer.inpaintHeight ?? "-",
    layer.inpaintAspectLocked === false ? 0 : 1,
    layer.regionalPrompt ?? "",
    layer.regionalNegativePrompt ?? "",
    layer.regionalStrength ?? "-",
    layer.positivePrompt ?? "",
    layer.negativePrompt ?? "",
    settings,
    JSON.stringify((layer.controlnet?.sourceData || layer.referenceRasterId) ? { ...layer.controlnet, image: null } : layer.controlnet ?? null),
    region,
    imageSignature(layer.image),
    JSON.stringify(layer.rasterPaint ?? []),
    typeof layer.spatialPng === "string" ? layer.spatialPng.length : 0,
  ].join("\u0001");
}

/**
 * A cheap digest of everything that makes the document what it is.
 *
 * `paintRevision` comes from the canvas store: painted strokes and replaced
 * pixels change a layer without changing its metadata, and no structural digest
 * can see that.
 */
export function documentSignature(doc: ProjectDocument | null, paintRevision = 0): string {
  if (!doc) return "none";
  const parts = [
    doc.version,
    doc.canvasWidth,
    doc.canvasHeight,
    doc.baseColor,
    doc.backgroundColor,
    paintRevision,
    doc.layers.length,
    doc.groups?.length ?? 0,
    ...(doc.groups ?? []).map(group => [group.id, group.name, group.visible ? 1 : 0].join("\u0001")),
    ...doc.layers.map(layerSignature),
  ];
  return parts.join("\u0002");
}

/** The app settings that travel with a document, as one comparable string. */
export function settingsSignature(state: unknown): string {
  if (state === null || state === undefined) return "none";
  try {
    return JSON.stringify(state) ?? "none";
  } catch {
    return "unreadable";
  }
}
