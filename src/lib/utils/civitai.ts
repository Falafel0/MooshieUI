/** CivitAI's public .com and .red sites share model/image IDs and v1 paths. */
export function isCivitaiHost(host: string): boolean {
  const value = host.toLowerCase();
  return ['civitai.com', 'civitai.red'].some(domain => value === domain || value.endsWith(`.${domain}`));
}

export function parseCivitaiUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && isCivitaiHost(url.hostname) && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

function positiveId(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Model page or public API model URL; keep version selection intact. */
export function parseCivitaiModelRef(value: string): { modelId: number; versionId?: number } | null {
  const numeric = positiveId(value.trim());
  if (numeric) return { modelId: numeric };
  const url = parseCivitaiUrl(value);
  if (!url) return null;
  const match = url.pathname.match(/^\/(?:api\/v1\/)?models\/(\d+)(?:\/|$)/);
  const modelId = positiveId(match?.[1] ?? null);
  const version = url.searchParams.get('modelVersionId');
  const versionId = positiveId(version);
  if (!modelId || (version !== null && !versionId)) return null;
  return { modelId, ...(versionId ? { versionId } : {}) };
}

/** The same download endpoint exists on both sites; query options are retained. */
export function isCivitaiDownloadUrl(value: string): boolean {
  const url = parseCivitaiUrl(value);
  return !!url && /^\/api\/download\/models\/[1-9]\d*\/?$/.test(url.pathname);
}
