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

export const PROJECT_DOCUMENT_VERSION = 1;

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

/** One layer, with its pixels: a data URL for a mask or a region, and the
 * image (usually inlined pixels) for a raster. */
export interface ProjectLayer {
  name: string;
  type: "raster" | "mask" | "region";
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
  };
}

const COLOUR = /^#[0-9a-fA-F]{3,8}$/;

/**
 * True when the value is a document this build can open.
 *
 * Deliberately structural rather than fatal: a document from a future version
 * or with a broken layer is rejected here and reported by the caller, instead
 * of half-loading and leaving the canvas in a state the user cannot explain.
 */
export function isProjectDocument(value: unknown): value is ProjectDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<ProjectDocument>;
  if (typeof doc.version !== "number" || doc.version > PROJECT_DOCUMENT_VERSION) return false;
  if (typeof doc.canvasWidth !== "number" || typeof doc.canvasHeight !== "number") return false;
  if (doc.canvasWidth < DOCUMENT_MIN_SIZE || doc.canvasHeight < DOCUMENT_MIN_SIZE) return false;
  if (doc.canvasWidth > DOCUMENT_MAX_SIZE || doc.canvasHeight > DOCUMENT_MAX_SIZE) return false;
  if (typeof doc.baseColor !== "string" || !COLOUR.test(doc.baseColor)) return false;
  if (typeof doc.backgroundColor !== "string" || !COLOUR.test(doc.backgroundColor)) return false;
  if (!Array.isArray(doc.layers)) return false;
  return doc.layers.every((layer) => {
    if (!layer || typeof layer !== "object") return false;
    const candidate = layer as Partial<ProjectLayer>;
    if (candidate.type !== "raster" && candidate.type !== "mask" && candidate.type !== "region") {
      return false;
    }
    if (typeof candidate.name !== "string" || typeof candidate.order !== "number") return false;
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
    layer.name,
    layer.visible ? 1 : 0,
    // A raster's opacity is real; a mask's or a region's is how it is drawn.
    layer.type === "raster" ? layer.opacity : 0,
    typeof layer.coverage === "number" ? layer.coverage : 1,
    layer.locked ? 1 : 0,
    layer.order,
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
    region,
    imageSignature(layer.image),
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
