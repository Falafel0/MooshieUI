/**
 * Which workspaces the navigation offers.
 *
 * Video and music are intact in the tree — views, stores, Tauri commands, Rust
 * templates and the vendored ComfyUI nodes — but the released build cannot run
 * them: the video path needs director/retake nodes that the shipped ComfyUI does
 * not have, and the music path needs external binaries (yt-dlp, ffmpeg, its own
 * venv). A tab that leads to a dead end is worse than no tab, so both are off
 * the navigation on every surface — the desktop rail and the mobile tab bar —
 * while every code path behind them stays where it is.
 *
 * Flip a flag to true to put the workspace back on the navigation; nothing else
 * has to change.
 */
export const videoWorkspaceVisible = false;
export const musicWorkspaceVisible = false;

export type WorkspaceId = "generate" | "studio" | "video" | "music" | "gallery" | "modelhub" | "artists" | "characters" | "settings";
export type WorkspacePage = Exclude<WorkspaceId, "video">;

export interface WorkspaceDefinition {
  id: WorkspaceId;
  labelKey: string;
  keywords: string;
}

const WORKSPACES: WorkspaceDefinition[] = [
  { id: "generate", labelKey: "nav.generate", keywords: "image txt2img img2img inpaint generation" },
  { id: "studio", labelKey: "nav.prompt_studio", keywords: "prompt studio compose tags draft" },
  { id: "video", labelKey: "generation.mode.video", keywords: "video animation" },
  { id: "music", labelKey: "nav.music", keywords: "music audio" },
  { id: "gallery", labelKey: "nav.gallery", keywords: "gallery images history" },
  { id: "modelhub", labelKey: "nav.modelhub", keywords: "models download hub" },
  { id: "artists", labelKey: "nav.artists", keywords: "artist styles library" },
  { id: "characters", labelKey: "artist_gallery.tab_characters", keywords: "characters animadex" },
  { id: "settings", labelKey: "nav.settings", keywords: "settings preferences configuration" },
];

export function availableWorkspaces(options: { canUseModelhub: boolean; canUseVideo: boolean }): WorkspaceDefinition[] {
  return WORKSPACES.filter(({ id }) =>
    (id !== "modelhub" || options.canUseModelhub) &&
    (id !== "video" || (videoWorkspaceVisible && options.canUseVideo)) &&
    (id !== "music" || musicWorkspaceVisible),
  );
}

export function availableSettingsShortcuts(browserMode: boolean) {
  return [
    { id: "appearance", labelKey: "settings.sections.appearance", keywords: "density compact comfortable touch theme animation motion", desktopOnly: false },
    { id: "projects", labelKey: "settings.sections.projects", keywords: "project workspace save load", desktopOnly: true },
  ].filter((entry) => !entry.desktopOnly || !browserMode);
}
