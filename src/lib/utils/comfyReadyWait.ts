import { ipcListen } from "./ipc.js";
/** Register before starting ComfyUI so a fast ready event cannot be lost. */
export async function createComfyReadyWait(timeoutMs: number): Promise<{ promise: Promise<void>; cancel: () => void }> {
  let listeners: (() => void)[] = [];
  let settled = false;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  void promise.catch(() => {});
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    for (const unlisten of listeners) unlisten();
    listeners = [];
    if (error) reject(error); else resolve();
  };
  const timer = setTimeout(() => finish(new Error("ComfyUI startup timed out")), timeoutMs);
  try {
    await Promise.all([
      ipcListen("comfyui:server_ready", () => finish()),
      ipcListen("comfyui:server_error", (event) => finish(new Error(event.payload?.error || "ComfyUI startup failed"))),
    ].map(async (subscription) => { const unlisten = await subscription; if (settled) unlisten(); else listeners = [...listeners, unlisten]; }));
  } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  return { promise, cancel: () => finish() };
}
