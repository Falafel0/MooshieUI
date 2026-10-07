export const BOTTOM_TABS = ["loras", "checkpoints", "images", "prompts", "artists", "styles", "style_creator", "schedule", "compare", "timeline", "notes"] as const;
export type BottomTabId = typeof BOTTOM_TABS[number];
export type BottomPanelContext = "image" | "novelai" | "video";

export function bottomPanelContext(video: boolean, novelai: boolean): BottomPanelContext {
  return video ? "video" : novelai ? "novelai" : "image";
}

export function isBottomTab(value: unknown): value is BottomTabId {
  return typeof value === "string" && BOTTOM_TABS.includes(value as BottomTabId);
}

export function availableBottomTabs(context: BottomPanelContext, checkpoints: boolean): BottomTabId[] {
  if (context === "video") return ["images", "prompts", "timeline", "notes"];
  return BOTTOM_TABS.filter((tab) => tab !== "timeline"
    && (tab !== "checkpoints" || checkpoints)
    && (context !== "novelai" || !["loras", "compare", "schedule"].includes(tab)));
}

export function bottomTabLabelKey(tab: BottomTabId, context: BottomPanelContext): string {
  return `bottom_panel.tab.${tab === "images" && context === "video" ? "videos" : tab}`;
}

export function validatedCardSize(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}
