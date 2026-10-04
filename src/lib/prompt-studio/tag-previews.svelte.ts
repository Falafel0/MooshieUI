import { loadCollectionAsset } from './collections.js';

export type TagPreviewInfo = { open: string[]; closed: string[]; extensions: Record<string, string>; blurred: Record<string, string>; restricted: string[]; poses: Record<string, string>; journal: { дни?: unknown[] }; status: { t?: string } };
export const previewTagKey = (tag: string) => tag.replaceAll(' ', '_').replace(/\\([()[\]])/g, '$1');

/** Supplied thumbnails only; preview availability never triggers a remote request. */
class TagPreviews {
  info = $state.raw<TagPreviewInfo>();
  loading = $state(false);
  failed = $state(false);
  private request: Promise<void> | undefined;
  load(): Promise<void> {
    if (this.info) return Promise.resolve();
    if (this.request) return this.request;
    this.loading = true; this.failed = false;
    this.request = loadCollectionAsset<TagPreviewInfo>('preview-info.json').then(info => { this.info = info; })
      .catch(error => { this.failed = true; console.warn('Prompt Studio tag previews:', error); })
      .finally(() => { this.loading = false; this.request = undefined; });
    return this.request;
  }
  image(tag: string): string | undefined { const value = this.info?.blurred[previewTagKey(tag)]; return value ? `data:image/webp;base64,${value}` : undefined; }
}
export const tagPreviews = new TagPreviews();
