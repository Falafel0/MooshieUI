import { isBottomTab, validatedCardSize, type BottomTabId, type BottomPanelContext } from "../utils/bottomPanel.js";

const SETTINGS_KEY = "mooshieui.bottomPanel.preferences.v2";

/** Local workspace UI preferences. Search survives tab changes and panel collapse. */
class BottomPanelStore {
  selections = $state<Partial<Record<BottomPanelContext, BottomTabId>>>({});
  loraCardSize = $state(120);
  imageCardSize = $state(72);
  artistCardSize = $state(110);
  imageSearch = $state("");
  promptSearch = $state("");
  artistSearch = $state("");
  artistCategoryFilter = $state("all");

  constructor() { this.loadSettings(); }

  resolveTab(context: BottomPanelContext, visible: BottomTabId[]): BottomTabId {
    const remembered = this.selections[context];
    return remembered && visible.includes(remembered) ? remembered : visible[0];
  }

  selectTab(context: BottomPanelContext, tab: BottomTabId) {
    this.selections = { ...this.selections, [context]: tab };
    this.saveSettings();
  }

  setCardSize(kind: "lora" | "image" | "artist", value: number) {
    if (kind === "lora") this.loraCardSize = validatedCardSize(value, 120, 60, 200);
    else if (kind === "image") this.imageCardSize = validatedCardSize(value, 72, 48, 160);
    else this.artistCardSize = validatedCardSize(value, 110, 72, 200);
    this.saveSettings();
  }

  loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      if (saved && typeof saved === "object") {
        for (const context of ["image", "novelai", "video"] as const) {
          if (isBottomTab(saved.selections?.[context])) this.selections = { ...this.selections, [context]: saved.selections[context] };
        }
        const legacyTab = localStorage.getItem("mooshieui.bottomPanel.activeTab.v1");
        if (!raw && isBottomTab(legacyTab)) this.selections = { image: legacyTab, novelai: legacyTab, video: legacyTab };
        let legacySizes: Record<string, unknown> = {};
        try { legacySizes = JSON.parse(localStorage.getItem("mooshieui.bottomPanel.cardSize.v1") || "{}") ?? {}; } catch {}
        this.loraCardSize = validatedCardSize(saved.loraCardSize ?? legacySizes.lora, 120, 60, 200);
        this.imageCardSize = validatedCardSize(saved.imageCardSize ?? legacySizes.image, 72, 48, 160);
        const legacyArtist = Number(localStorage.getItem("mooshieui.bottomPanel.artistCardSize.v1") ?? 110);
        this.artistCardSize = validatedCardSize(saved.artistCardSize ?? legacyArtist, 110, 72, 200);
      }
    } catch (error) { console.error("Failed to load bottom panel preferences:", error); }
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ selections: this.selections, loraCardSize: this.loraCardSize, imageCardSize: this.imageCardSize, artistCardSize: this.artistCardSize }));
    } catch (error) { console.error("Failed to save bottom panel preferences:", error); }
  }
}

export const bottomPanel = new BottomPanelStore();
