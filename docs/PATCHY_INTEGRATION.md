# Replacing Photopea with Patchy

Status: **native hand-off and live read-back implemented, plus automatic installation and process lifecycle**. Photopea is gone; MooshieUI installs Patchy, hands it a document, and can read either a saved result or the unsaved canvas of its open window. The WASM embed remains future work.

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
2. The user presses **Launch Patchy**. `launch_patchy` opens the prepared path; preparing or installing the editor never launches it. A separate, opt-in `patchy_auto_start` setting can open Patchy when MooshieUI starts.
3. The user edits and saves in Patchy. A flat PNG save may replace the hand-off file; adding layers can route Save to a neighbouring PSD/PSB. The read command detects a newer layered file and runs the app-managed `mooshieui-export.js` script in headless Patchy to export a flattened PNG.
4. The user chooses one of five destinations. `read_patchy_document` rejects the unchanged hand-off file; canvas imports route to `base`, `raster`, `mask` or `region`, while gallery save creates a new image.

### Live connection

The dialog's **Connect to open Patchy** control starts the `patchy-mcp --attach`
connector shipped beside the selected Patchy executable. It joins the existing
interactive window and does not create or close another editor. Every three
seconds MooshieUI reads the matching hand-off document's state and refreshes
the PNG preview only when its state token changes.
When live mode is selected, the same five import actions capture its current
pixels, including unsaved edits, without changing Patchy's save path or modified
state. Turning live mode off restores the saved-file workflow.

The live reader matches only the particular hand-off PNG or its neighbouring
PSD/PSB. Full imports request 1024-pixel rectangles and assemble them at native
resolution. Every rectangle must carry the same Patchy state token; if the
artist edits during capture, the import stops and asks for a retry. Patchy's
preview protocol bounds each image message, so full live imports are limited to
16 million pixels. Larger images still use the saved-file path. The live
connector requires Patchy's bundled `patchy-mcp` from the same installation;
the desktop-only dialog reports when the connector or open document is missing.
Launching a hand-off installs a user script at `RTsoft/Patchy/scripts/MooshieUI`
under the platform's application-data directory. In Patchy, **File > Scripts >
MooshieUI > Return to MooshieUI** opens a destination chooser for gallery, base,
raster, mask and region. A sidecar links it to the particular hand-off. The
script writes a short return request; the open MooshieUI dialog consumes it
after a successful live read. Existing customized script files are preserved.

The live controls also expose Patchy's own Undo and Redo, and can add the
original MooshieUI PNG as a named reference layer. These explicit edits use
`expectedState` from the last preview; a manual change before the click makes
the request fail safely rather than editing a stale document. The reference
image is imported through Patchy's `importFilesAsLayers` script API and the
temporary copy is removed afterward. No plug-in is installed inside Patchy.

Mask and region imports compare the edited pixels with the exact PNG sent to Patchy, so the original image's brightness cannot turn the whole canvas into a mask. A size mismatch is rejected for masks and regions. The canvas handler also checks for a document change while the import is being decoded.

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
| `patchy_auto_start` | false | Launch the editor when the app starts (independent of the hand-off button) |
| `patchy_keep_alive` | false | Leave the editor running when MooshieUI exits |

Opening a hand-off prepares the document and leaves launch to its explicit button.
`patchy_auto_start` opens the installed editor at app launch, without a document.

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
| **C. MCP / scripting** | Live read-back uses `patchy-mcp --attach`; automated edits are future work | The existing editor stays open while its pixels are read | Mutating scripts would need state-token checks and explicit user actions |

A note on PSD: MooshieUI sends one flattened PNG. Patchy may save a layered PSD/PSB beside it; the read path flattens that file back to one PNG. The four canvas targets do not reconstruct Patchy's layers.

## Known limitations of path A

- **Desktop only.** The editor is a local application, so the hand-off is meaningless for a remote browser client. The entry points are hidden unless `isTauri` is true, which also means they do not appear under a plain `vite dev` without the Tauri shell. Browser-mode users had a working Photopea editor and lose it; path B is what would bring it back.
- **Patchy must be installed** — by MooshieUI on Windows and macOS, or by the user
  (manually, on Linux, or when automatic installation is turned off).
- **One image returns.** The exported source has no MooshieUI layer structure. A PSD/PSB saved in Patchy can retain its layers on disk, but only its flattened pixels return to the chosen MooshieUI destination.
- **Layered flattening needs a native check.** The script uses Patchy's documented `doc.exportAs` and `--headless --run-script` interfaces, while the failure path has a regression test. A real Windows Patchy layered round trip and all five UI actions still need hands-on validation before claiming full integration.
- **The attached connector needs a native check.** Its protocol follows Patchy v0.99's documented `--attach`, `get_state`, `get_preview` and `expectedState` contracts. The Windows build and a real interactive round trip must verify reconnection, image tiles, Undo/Redo and the reference layer before calling the integration complete.
- **Saved-file mode needs a save.** If the file is never saved, it reports that no saved result exists; live mode can capture unsaved pixels from the open editor.

## Files

| File | Role |
|---|---|
| `src/lib/components/PatchyHandoff.svelte` | The dialog: prepares the document, launches the editor, reads the result back, handles the not-found and error states |
| `src/lib/utils/api.ts` | `resolvePatchyPath`, `writePatchyDocument`, `readPatchyDocument`, `launchPatchy`, `getPatchyStatus`, `installPatchy`, `stopPatchy` |
| `src-tauri/src/commands/patchy.rs` | Desktop-gated commands, the executable resolver and the process handle, with unit tests |
| `src-tauri/src/commands/patchy_live.rs` | Attached MCP session, matching the hand-off, preview polling and full-resolution tiled read-back |
| `src-tauri/resources/patchy/mooshieui-export.js` | App-managed Patchy script for exporting a layered save to a flat PNG |
| `src-tauri/src/patchy_install.rs` | Release lookup, checksum-verified download and per-platform extraction, with unit tests |
| `src/lib/components/settings/SettingsPage.svelte` | The Patchy section: install button with progress and the three lifecycle switches |
| `src/App.svelte` | `editInPatchy`, `importPatchyToCanvas` (target routing), the `<PatchyHandoff>` mount, the gallery context menu entry `gallery.edit_patchy`, Patchy auto-start |
| `src/lib/components/generation/GenerationPage.svelte` | `editCanvasSourceInPatchy("base" \| "layer")`, the `canvas.open_patchy` buttons, the `LayerPanel` hand-off |
| `src/lib/components/canvas/CanvasEditor.svelte` | Passes `oneditpatchy` down to the layer panel and canvases |
| `src/lib/components/canvas/layers/LayerPanel.svelte` | Per-layer "open in Patchy" action |
| `src/lib/utils/canvasLayerExport.ts` | PNG and painted-pixel coverage helpers for mask and region imports |
| `src/lib/locales/*.ts` | Twelve files carrying the `patchy.*` keys |

Deleted: `src/lib/components/PhotopeaEditor.svelte` and the short-lived
`src/lib/stores/patchy.svelte.ts`, whose single field moved into the config so
the resolver has one source of truth.

Two behaviours changed rather than being ported:

- `opaqueMaskLuminanceToAlpha` remains a fallback when the handed-out source is unavailable. Normal Patchy mask and region imports compare edited pixels with that source instead of inferring a selection from brightness.
- `photopea.connection_timeout`, `photopea.proxy_hint`, `photopea.retry` and `photopea.open_browser` are gone. A local editor has no network failure mode to report; the network strings were dropped rather than translated.

## Round-trip contract

The dialog offers five read-back actions; their wiring and conversion paths have automated coverage, but a complete Windows UI round trip is still pending:

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
