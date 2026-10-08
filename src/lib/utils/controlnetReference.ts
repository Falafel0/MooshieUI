import { uploadImageBytes } from './api.js';

/** Upload and preserve the same reference pixels for a later project session. */
export async function prepareControlnetReference(file: File): Promise<{ name: string; sourceData: string; blob: Blob }> {
  const sourceData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image data'));
    reader.onerror = () => reject(reader.error ?? new Error('Image read failed'));
    reader.readAsDataURL(file);
  });
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const uploaded = await uploadImageBytes(bytes, file.name);
  return { name: uploaded.name, sourceData, blob: file };
}
