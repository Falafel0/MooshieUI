# Replacing Photopea with Patchy

Status: **path A (native hand-off) implemented, plus automatic installation and process lifecycle**. Photopea is gone; MooshieUI now installs Patchy itself, hands a document to it and reads the result back. Paths B and C below remain open as future work.

## What Patchy is

| Fact | Value |
|---|---|
| Source | https://github.com/SethRobinson/Patchy |
| Licence | MIT, Copyright (c) 2026 Seth A. Robinson |
| Vendored at | `third-party/patchy` (shallow submodule) |
| Pinned commit | `7d14d1f6ede2dc8fb52c11eefcc7cc8783473711` (v0.99) |
| Language | C++ / Qt 6 |
| Targets | Windows, macOS, Linux desktop builds, plus an Emscripten WebAssembly build of the same editor |
| Automation | JavaScript scripting API, `--run-script`, `--headless`, CLI screenshots, and a separate MCP server binary (`patchy-mcp.exe`) |

Update the pin with:

```bash
git -C third-party/patchy fetch --depth 1 origin main
git -C third-party/patchy checkout <commit>
git add third-party/patchy && git commit -m "chore: bump vendored Patchy"
```

The submodule is a source reference. Nothing in the build reads it yet, so CI does not need `submodules: recursive`.

## Why it was not a drop-in

The old integration was an **iframe**. `PhotopeaEditor.svelte` loaded `https://www.photopea.com` with a `customIO.save` hook that flattened the document to PNG and posted it back:

```
environment: { customIO: { save: 'app.activeDocument.saveToOE("png");' } }
```

It then ran a `boot -> opening -> ready` handshake and handed the PNG to `importPhotopeaToCanvas` in `src/App.svelte`. Patchy has no hosted iframe endpoint, so the replacement had to replace the *transport*, not just the URL.

## How the hand-off works

The document travels through the filesystem instead of a `postMessage` channel:

1. `PatchyHandoff.svelte` builds PNG bytes for the source (session blob, or a JXL -> PNG transcode through `loadGalleryImagePng`) and writes them through `write_patchy_document`, which returns an absolute path under the app data directory.
2. `launch_patchy` spawns the editor detached with that path as its single argument. Patchy forwards a second launch to its already-running window, so pressing the button again brings the existing window forward rather than starting a second copy.
3. The user edits and saves with File -> Save (Ctrl+S), which writes back to the same path.
4. "Import result" calls `read_patchy_document` and routes the bytes exactly as before: gallery save, `base`, `raster`, `mask` or `region`.

Everything downstream of the bytes is unchanged, including the staleness guard in `importPatchyToCanvas` that refuses to apply an import to a newer document.

### Executable resolution

`resolve_patchy_executable` in `src-tauri/src/commands/patchy.rs` checks, in order:

1. the explicit path stored in settings (`patchy_executable_path`),
2. the `PATCHY_PATH` environment variable,
3. the copy MooshieUI installed itself (`<app data>/patchy/install/<tag>/…`),
4. per-platform install locations (`%LOCALAPPDATA%\Programs\Patchy\patchy.exe` and friends on Windows, `/Applications/Patchy.app/Contents/MacOS/Patchy` on macOS, `/usr/local/bin/patchy`, `/usr/bin/patchy`, `~/.local/bin/patchy` on Linux),
5. a PATH scan.

When nothing is found the dialog installs the editor (see below) or, if that is
unavailable or declined, shows a "not found" state with a file picker ("Locate
Patchy…") and a link to the release page. The picked path is written to
`config.patchy_executable_path`, the only place the resolver reads it from, so it
survives restarts.

### Installation

MooshieUI provisions the editor itself, the way it provisions ComfyUI, so a
first-time user never has to leave the app:

1. `install_patchy` asks the GitHub API for the latest `SethRobinson/Patchy`
   release and picks the asset for this platform (`PatchyWindowsNoInstaller.zip`
   on Windows, `PatchyMacOS.dmg` on macOS).
2. It downloads to a temporary file and verifies the SHA-256 against the
   release's `SHA256SUMS.txt` before anything is unpacked.
3. It extracts into `<app data>/patchy/install/<tag>/` — the zip directly on
   Windows, `hdiutil attach`/`detach` around a copy of the `.app` on macOS — and
   returns the executable path.
4. Progress is reported as `patchy:install_progress` events (`downloading` with
   `downloaded`/`total`, then `verifying`, then `extracting`) so both the
   hand-off dialog and the settings panel show a determinate bar.

Linux is not provisioned automatically. The release ships a Flatpak bundle,
which needs the Flatpak runtime rather than a plain extraction, so
`is_supported()` is false there and the UI points at the release page instead of
offering a button that can only fail.

### Lifecycle

Patchy follows the same shape as ComfyUI, with three switches in Settings:

| Setting | Default | Effect |
|---|---|---|
| `patchy_auto_install` | true | Install the editor automatically the first time an edit needs it |
| `patchy_auto_start` | false | Launch the editor together with the app, on top of the hand-off launch |
| `patchy_keep_alive` | false | Leave the editor running when MooshieUI exits |

Auto-start has two parts: the hand-off dialog launches the editor as soon as the
document is written, so opening it is never a separate step, and
`patchy_auto_start` additionally opens it at app launch (skipped when nothing is
installed).

Auto-shutdown closes only the editor this app started. The spawned child is held
in a process-global handle and terminated on `RunEvent::ExitRequested` with
`taskkill /T /F` on Windows and a plain kill elsewhere. Because Patchy forwards a
second launch to an already-running instance, a child that has already exited
means the user's own editor was in front — that one is never touched.

## Options that remain open

| Path | How it works | Cost | Main risk |
|---|---|---|---|
| ~~**A. Native hand-off**~~ | Implemented. See above. | - | - |
| **B. WASM embed** | Build the `wasm-release` preset (emsdk 4.0.7 plus Qt 6.10.3 `wasm_multithread`, static) and ship the bundle inside the app; the WebView serves it locally | Restores an in-app editing panel and works in browser mode | Multi-GB Qt-for-wasm provisioning in CI, COOP/COEP cross-origin isolation required by the threaded build, a ~4 GB memory ceiling, and no printing, scanner import or CLI in the browser build |
| **C. MCP / scripting** | Drive Patchy through its MCP connector or `--run-script` for automated edits with no user in the loop | Fits "apply filter then export" style actions | Not interactive painting; complementary to A or B rather than a replacement for them |

A note on PSD: Patchy's strength is PSD/PSB round trips. The hand-off stays on flattened PNG, but the four import targets (`base`, `raster`, `mask`, `region`) map naturally onto PSD layers if we ever want to exchange a document instead of a flat image.

## Known limitations of path A

- **Desktop only.** The editor is a local application, so the hand-off is meaningless for a remote browser client. The entry points are hidden unless `isTauri` is true, which also means they do not appear under a plain `vite dev` without the Tauri shell. Browser-mode users had a working Photopea editor and lose it; path B is what would bring it back.
- **Patchy must be installed** — by MooshieUI on Windows and macOS, or by the user
  (manually, on Linux, or when automatic installation is turned off).
- **The document is a flattened PNG.** Layer structure does not survive the trip in either direction, so the editor sees one image; the four import targets are what the user gets back.
- **Saving is the user's job.** If the file is never saved, "Import result" reports that no saved result exists rather than importing a stale copy.

## Files

| File | Role |
|---|---|
| `src/lib/components/PatchyHandoff.svelte` | The dialog: prepares the document, launches the editor, reads the result back, handles the not-found and error states |
| `src/lib/utils/api.ts` | `resolvePatchyPath`, `writePatchyDocument`, `readPatchyDocument`, `launchPatchy`, `getPatchyStatus`, `installPatchy`, `stopPatchy` |
| `src-tauri/src/commands/patchy.rs` | Desktop-gated commands, the executable resolver and the process handle, with unit tests |
| `src-tauri/src/patchy_install.rs` | Release lookup, checksum-verified download and per-platform extraction, with unit tests |
| `src/lib/components/settings/SettingsPage.svelte` | The Patchy section: install button with progress and the three lifecycle switches |
| `src/App.svelte` | `editInPatchy`, `importPatchyToCanvas` (target routing), the `<PatchyHandoff>` mount, the gallery context menu entry `gallery.edit_patchy`, Patchy auto-start |
| `src/lib/components/generation/GenerationPage.svelte` | `editCanvasSourceInPatchy("base" \| "layer")`, the `canvas.open_patchy` buttons, the `LayerPanel` hand-off |
| `src/lib/components/canvas/CanvasEditor.svelte` | Passes `oneditpatchy` down to the layer panel and canvases |
| `src/lib/components/canvas/layers/LayerPanel.svelte` | Per-layer "open in Patchy" action |
| `src/lib/utils/canvasLayerExport.ts` | PNG and mask encoding helpers. Editor-agnostic and unchanged |
| `src/lib/locales/*.ts` | Twelve files carrying the `patchy.*` keys |

Deleted: `src/lib/components/PhotopeaEditor.svelte` and the short-lived
`src/lib/stores/patchy.svelte.ts`, whose single field moved into the config so
the resolver has one source of truth.

Two behaviours changed rather than being ported:

- `opaqueMaskLuminanceToAlpha` stays. It was written for Photopea's black-on-white mask exports, but any external editor can return an opaque mask, so it remains a safety net for the `mask` and `region` targets.
- `photopea.connection_timeout`, `photopea.proxy_hint`, `photopea.retry` and `photopea.open_browser` are gone. A local editor has no network failure mode to report; the network strings were dropped rather than translated.

## Round-trip contract

All five actions work through the hand-off:

1. Send the canvas base out and import the result back as the base.
2. Send a raster layer out and import the result back as a raster layer.
3. Send the inpaint mask out and import it back as a mask.
4. Send a regional-prompt mask out and import it back as a region.
5. Save the edited document to the gallery.

Inpainting also depends on mask geometry surviving the trip: regions and masks are aligned to the sampler crop, so an editor round trip must not resample the mask. The hand-off writes and reads the mask at its own resolution, so no resampling is introduced.

## Packaging and licence

- MIT is compatible with this repository's AGPL-3.0-only licence. Keep the Patchy copyright notice and its `LICENSE` in any distributed bundle.
- Patchy's own `NOTICE-THIRD-PARTY.md` and `docs/legal-constraints.md` cover bundled fonts, textures and gesture boundaries. Review them before shipping a Patchy binary or its WASM bundle as part of an installer.
- The submodule is a build/analysis convenience. Shipping a compiled Patchy is a separate decision from vendoring its source, and is not done today.

## Open decisions

1. Whether to bundle a Patchy binary in the installers, or keep fetching it on
   first use the way `install_patchy` does now.
2. Whether to move to PSD round trips so layer structure survives.
3. Whether to pursue path B (in-app panel, browser-mode support) or path C (unattended edits).
