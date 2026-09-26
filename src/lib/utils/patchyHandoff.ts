/**
 * The Patchy hand-off contract, as pure functions.
 *
 * The document travels through the filesystem, so both halves of the round trip
 * have to agree on *one* file: the name it is written under, and the way the
 * file that comes back is recognised as a real save rather than MooshieUI's own
 * export read again. Keeping those rules here (no DOM, no Tauri) makes them
 * testable on their own and stops the dialog from re-deriving them inline.
 */

/** What the hand-off is for. A mask hand-off sends a blank mask to paint. */
export type PatchyPurpose = "image" | "mask";

/** The `file_name` the backend was given, as a stem plus a document name. */
export interface PatchyDocumentName {
  /** Extension-less stem, so the editor's Save As default keeps the same stem. */
  stem: string;
  /** File name handed out, e.g. `ComfyUI_0001_.png` or `base_17-mask.png`. */
  fileName: string;
}

/** Strip anything a file name cannot carry, and any extension we replace. */
function safeStem(name: string): string {
  const withoutPath = name.split(/[\\/]/).pop() ?? name;
  const withoutExtension = withoutPath.replace(/\.(jxl|webp|jpe?g|psd|psb|png)$/i, "");
  const cleaned = withoutExtension.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "");
  return cleaned || "document";
}

/**
 * Name the document for one hand-off.
 *
 * The mask purpose gets its own stem so the two documents of the same image can
 * never be confused, and every hand-off is unique on disk: the backend appends
 * its own token, so a later hand-off can never overwrite the file an earlier one
 * (and whatever the editor saved beside it) still owns.
 */
export function handoffDocumentName(
  imageFilename: string | undefined,
  purpose: PatchyPurpose,
): PatchyDocumentName {
  const stem = safeStem(imageFilename ?? "document.png");
  const masked = purpose === "mask" ? `${stem}-mask` : stem;
  return { stem: masked, fileName: `${masked}.png` };
}

/**
 * Cheap fingerprint used for one question only: "has Patchy saved over our
 * hand-off file yet?". Comparing lengths alone would misreport a re-encode of
 * the same size as "not saved", so the bytes are hashed (FNV-1a, 32 bits) and
 * the length is kept beside the hash.
 */
export function fingerprint(bytes: number[]): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${bytes.length}`;
}

/** PNG width/height from the IHDR chunk, or null for anything else. */
export function pngDimensions(bytes: number[]): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24) return null;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return null;
  }
  const readU32 = (offset: number) =>
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0;
  const width = readU32(16);
  const height = readU32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Coverage at least this bright counts as painted on a mask document. */
export const MASK_COVERAGE_MIN_LUMA = 8;

/**
 * Whether a returned mask document carries anything the user painted.
 *
 * A mask hand-off starts as a flat black canvas, so coverage is the brightness
 * the user painted: white = use this area, black = leave it alone. This is the
 * check the dialog refuses on — reading it here means an empty mask is reported
 * before the bytes are handed to the canvas at all.
 */
export function maskCoverageOf(pixels: Uint8ClampedArray): {
  covered: boolean;
  /** Painted share of the document, 0..1, for the message. */
  ratio: number;
  /** Brightest pixel found, so a faint brush is still recognised as paint. */
  peak: number;
} {
  let coveredPixels = 0;
  let peak = 0;
  const total = Math.floor(pixels.length / 4);
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
    if (luma > peak) peak = luma;
    if (luma >= MASK_COVERAGE_MIN_LUMA) coveredPixels += 1;
  }
  return {
    covered: coveredPixels > 0,
    ratio: total > 0 ? coveredPixels / total : 0,
    peak,
  };
}

/** The byte prefix of a layered Patchy document (PSD and PSB alike). */
export const LAYERED_DOCUMENT_MAGIC = "8BPS";

/** Describe which file the read-back came from, for the import card. */
export function resultOriginText(
  flattened: boolean,
  layeredSource: string | null,
  documentName: string,
): string {
  return flattened ? layeredSource ?? documentName : documentName;
}
