import { ipcStore } from "../utils/ipc.js";

const STORE_KEY = "patchyEditor";

/**
 * Settings for the Patchy hand-off.
 *
 * The editor is a separate native application, so the only durable state we
 * own is where its executable lives when auto-detection cannot find it.
 */
class PatchyStore {
  /** User-chosen executable path, overriding auto-detection. */
  executablePath = $state<string | null>(null);
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = await ipcStore.get<{ executablePath?: string | null }>(STORE_KEY);
      this.executablePath = saved?.executablePath ?? null;
    } catch (e) {
      console.error("Patchy: failed to load settings:", e);
    }
  }

  async setExecutablePath(path: string | null): Promise<void> {
    this.executablePath = path;
    try {
      await ipcStore.set(STORE_KEY, { executablePath: path });
    } catch (e) {
      console.error("Patchy: failed to persist executable path:", e);
    }
  }
}

export const patchy = new PatchyStore();
