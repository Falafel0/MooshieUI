export const BOTTOM_TABS = ["loras", "references", "prompts", "styles", "checkpoints", "artists", "style_creator", "images", "compare", "jobs", "notes", "schedule", "timeline"] as const;
export type BottomTabId = typeof BOTTOM_TABS[number];
export type BottomPanelContext = "image" | "novelai" | "video";
export const SHELF_GROUPS = ["resources", "results", "workflow"] as const;
export type ShelfGroup = typeof SHELF_GROUPS[number];
export const DEFAULT_SHELF_PINS: BottomTabId[] = ["loras", "references", "prompts", "styles", "images", "compare", "jobs", "notes"];

export function bottomPanelContext(video: boolean, novelai: boolean): BottomPanelContext {
  return video ? "video" : novelai ? "novelai" : "image";
}
export function shelfSelectionKey(context: BottomPanelContext, mode: string): string { return `${context}:${mode}`; }
export function isBottomTab(value: unknown): value is BottomTabId {
  return typeof value === "string" && BOTTOM_TABS.includes(value as BottomTabId);
}
export function shelfGroup(tab: BottomTabId): ShelfGroup {
  return ["images", "compare"].includes(tab) ? "results" : ["jobs", "notes", "schedule", "timeline"].includes(tab) ? "workflow" : "resources";
}
export function availableBottomTabs(context: BottomPanelContext, checkpoints: boolean): BottomTabId[] {
  return BOTTOM_TABS.filter((tab) => (tab !== "checkpoints" || checkpoints)
    && (context === "video" ? ["references", "images", "prompts", "timeline", "jobs", "notes"].includes(tab) : tab !== "timeline")
    && (context !== "novelai" || !["loras", "checkpoints", "compare", "schedule"].includes(tab)));
}
export function validatedShelfPins(value: unknown): BottomTabId[] {
  if (!Array.isArray(value)) return [...DEFAULT_SHELF_PINS];
  const pins = [...new Set(value.filter(isBottomTab))];
  return pins.length ? pins : [...DEFAULT_SHELF_PINS];
}
export function visibleShelfTabs(available: BottomTabId[], pinned: BottomTabId[], selected?: BottomTabId): BottomTabId[] {
  let chosen = pinned.filter((tab) => available.includes(tab));
  if (selected && available.includes(selected) && !chosen.includes(selected)) chosen = [...chosen, selected];
  if (!chosen.length) chosen = ["notes"];
  return SHELF_GROUPS.flatMap((group) => chosen.filter((tab) => shelfGroup(tab) === group));
}
export function bottomTabLabelKey(tab: BottomTabId, context: BottomPanelContext): string {
  const labels: Partial<Record<BottomTabId, string>> = { references: "references", checkpoints: "models", styles: "style_library", jobs: "jobs", images: context === "video" ? "tab.videos" : "variants" };
  return `bottom_panel.${labels[tab] ?? `tab.${tab}`}`;
}
export function validatedCardSize(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}
