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
