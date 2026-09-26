/**
 * What both ends of the Patchy hand-off have to agree on, as pure functions.
 *
 * Two questions the dialog asks on every read: is the file that came back a
 * real save from the editor, or MooshieUI's own export read again (the
 * fingerprint), and what did the editor actually produce (the PNG's pixel size,
 * and the name of the layered file when the result had to be flattened). Both
 * live here — no DOM, no Tauri — so the dialog never re-derives them inline.
 */

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

/** Name the file the import came from: the layered save, or the hand-off one. */
export function resultOriginText(
  flattened: boolean,
  layeredSource: string | null,
  documentName: string,
): string {
  return flattened ? layeredSource ?? documentName : documentName;
}
