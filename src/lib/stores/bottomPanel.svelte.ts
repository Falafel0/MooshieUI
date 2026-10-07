import { isBottomTab, validatedCardSize, validatedShelfPins, visibleShelfTabs, DEFAULT_SHELF_PINS, shelfGroup, type BottomTabId } from "../utils/bottomPanel.js";

const SETTINGS_KEY = "mooshieui.bottomPanel.preferences.v2";

/** Local workspace UI preferences. Search survives tab changes and panel collapse. */
class BottomPanelStore {
  selections = $state<Record<string, BottomTabId>>({});
  pinned = $state<BottomTabId[]>([...DEFAULT_SHELF_PINS]);
  requestedPanel = $state<BottomTabId | null>(null);
  cardLayout = $state<"grid" | "strip">("strip");
  stylesView = $state<"saved" | "artists" | "create">("saved");
  referencesSearch = $state("");
  loraCardSize = $state(120);
  imageCardSize = $state(72);
  artistCardSize = $state(110);
  imageSearch = $state("");
  promptSearch = $state("");
  artistSearch = $state("");
  artistCategoryFilter = $state("all");

  constructor() { this.loadSettings(); }

  rememberedTab(key: string): BottomTabId | undefined { return this.selections[key] ?? this.selections[key.split(":")[0]]; }

  visibleTabs(key: string, available: BottomTabId[]): BottomTabId[] { return visibleShelfTabs(available, this.pinned, this.rememberedTab(key)); }

  resolveTab(key: string, visible: BottomTabId[]): BottomTabId {
    const remembered = this.rememberedTab(key);
    return remembered && visible.includes(remembered) ? remembered : visible[0];
  }

  selectTab(context: string, tab: BottomTabId) {
    this.selections = { ...this.selections, [context]: tab };
    this.saveSettings();
  }

  requestPanel(tab: BottomTabId) { this.requestedPanel = tab; }

  setPinned(tab: BottomTabId, pinned: boolean) {
    if (!pinned && this.pinned.length <= 1) return;
    this.pinned = pinned ? [...new Set([...this.pinned, tab])] : this.pinned.filter((id) => id !== tab);
    this.saveSettings();
  }

  movePin(tab: BottomTabId, direction: number) {
    const peers = this.pinned.filter((id) => shelfGroup(id) === shelfGroup(tab));
    const neighbor = peers[peers.indexOf(tab) + direction];
    if (!neighbor) return;
    const next = [...this.pinned];
    const index = next.indexOf(tab), target = next.indexOf(neighbor);
    [next[index], next[target]] = [next[target], next[index]];
    this.pinned = next;
    this.saveSettings();
  }

  setCardLayout(layout: "grid" | "strip") { this.cardLayout = layout; this.saveSettings(); }

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
        if (saved.selections && typeof saved.selections === "object") {
          this.selections = Object.fromEntries(Object.entries(saved.selections).filter(([key, tab]) => /^(image|novelai|video)(:(txt2img|img2img|inpainting|image_edit|video))?$/.test(key) && isBottomTab(tab))) as Record<string, BottomTabId>;
        }
        this.pinned = validatedShelfPins(saved.pinned);
        if (saved.cardLayout === "grid" || saved.cardLayout === "strip") this.cardLayout = saved.cardLayout;
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
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ selections: this.selections, pinned: this.pinned, cardLayout: this.cardLayout, loraCardSize: this.loraCardSize, imageCardSize: this.imageCardSize, artistCardSize: this.artistCardSize }));
    } catch (error) { console.error("Failed to save bottom panel preferences:", error); }
  }
}

export const bottomPanel = new BottomPanelStore();
