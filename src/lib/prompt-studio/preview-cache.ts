import { searchDanbooru, loadAnimaSourceImage } from '../utils/api.js';
import { userScopedKey } from '../utils/ipc.js';

/** Only public, general-rated thumbnail bytes and post IDs are persisted. No URLs/credentials. */
type RecordValue = { key: string; blob: Blob; postId?: number; expires: number; touched: number };
export type PreviewResult = { blob: Blob; postId?: number; cached: boolean; persistent: boolean };
const TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_ENTRY = 2 * 1024 * 1024;
const pending = new Map<string, Promise<PreviewResult>>();
let active = 0;
let generation = 0;
const queue: (() => void)[] = [];
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mooshie-studio-previews-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Preview storage unavailable'));
    request.onblocked = () => reject(new Error('Preview storage blocked'));
  });
}
async function read(key: string): Promise<RecordValue | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('images').objectStore('images').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
async function store(value: RecordValue): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const images = tx.objectStore('images');
    const all = images.getAll();
    all.onsuccess = () => {
      const rows = (all.result as RecordValue[]).filter(row => row.key !== value.key).sort((a, b) => b.touched - a.touched);
      let bytes = value.blob.size, count = 1;
      for (const row of rows) {
        if (row.expires <= Date.now() || count >= 64 || bytes + row.blob.size > MAX_BYTES) images.delete(row.key);
        else { bytes += row.blob.size; count++; }
      }
      images.put(value);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
async function slot() {
  if (active >= 2) {
    if (queue.length >= 8) throw new Error('Preview queue full');
    await new Promise<void>(resolve => queue.push(resolve));
  } else active++;
}
function release() { const next = queue.shift(); if (next) next(); else active--; }
async function decodedImage(bytes: number[]): Promise<Blob> {
  if (!bytes.length || bytes.length > MAX_ENTRY) throw new Error('Invalid thumbnail size');
  const data = new Uint8Array(bytes);
  // Reject HTML/error responses, SVG and unknown formats before decoding.
  const mime = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff ? 'image/jpeg'
    : data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 ? 'image/png'
    : String.fromCharCode(...data.slice(0, 6)).startsWith('GIF8') ? 'image/gif'
    : String.fromCharCode(...data.slice(0, 4)) === 'RIFF' && String.fromCharCode(...data.slice(8, 12)) === 'WEBP' ? 'image/webp' : '';
  if (!mime) throw new Error('Source did not return an image');
  const blob = new Blob([data], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const valid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width <= 4096 && bitmap.height <= 4096;
  bitmap.close();
  if (!valid) throw new Error('Invalid thumbnail dimensions');
  return blob;
}
function imageUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !(url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'donmai.us' || url.hostname.endsWith('.donmai.us'))) throw new Error('Unsupported preview host');
  return url.href;
}
function request(key: string, load: () => Promise<{ bytes: number[]; postId?: number }>): Promise<PreviewResult> {
  const existing = pending.get(key);
  if (existing) return existing;
  const epoch = generation;
  const promise = (async () => {
    try {
      const hit = await read(key);
      if (hit && hit.expires > Date.now()) return { blob: hit.blob, postId: hit.postId, cached: true, persistent: true };
    } catch { /* Private mode/quota errors never prevent a live preview. */ }
    await slot();
    try {
      const data = await load();
      const blob = await decodedImage(data.bytes);
      let persistent = true;
      try { if (epoch === generation) await store({ key, blob, postId: data.postId, expires: Date.now() + TTL, touched: Date.now() }); else persistent = false; }
      catch { persistent = false; }
      return { blob, postId: data.postId, cached: false, persistent };
    } finally { release(); }
  })();
  pending.set(key, promise);
  void promise.finally(() => pending.delete(key)).catch(() => {});
  return promise;
}
export function tagPreview(tag: string): Promise<PreviewResult> {
  // A single exact tag, never user-supplied metatags or ratings. Backend owns auth.
  if (!tag || tag.length > 200 || /[\s:\[\]|]/.test(tag)) return Promise.reject(new Error('Choose a single booru tag'));
  const scope = userScopedKey('preview');
  return request(`${scope}:tag:${tag}`, async () => {
    const posts = await searchDanbooru(tag, 1, 12, true, 'danbooru');
    const post = posts.find(p => p.rating === 'g' && p.preview_file_url);
    if (!post?.preview_file_url) throw new Error('No general-rated thumbnail');
    const bytes = await loadAnimaSourceImage(imageUrl(post.preview_file_url));
    return { bytes, postId: post.id };
  });
}
export function sourcePreview(url: string): Promise<PreviewResult> {
  let safe: string;
  try { safe = imageUrl(url); } catch { return Promise.reject(new Error('Unsupported preview URL')); }
  return request(`${userScopedKey('preview')}:image:${safe}`, async () => ({ bytes: await loadAnimaSourceImage(safe) }));
}
export async function clearPreviewCache(): Promise<void> {
  generation++;
  const db = await database();
  const scope = `${userScopedKey('preview')}:`;
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const images = tx.objectStore('images');
    const cursor = images.openCursor();
    cursor.onsuccess = () => { const row = cursor.result; if (!row) return; if (String(row.key).startsWith(scope)) row.delete(); row.continue(); };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
