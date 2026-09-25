# Replacing Photopea with Patchy

Status: **groundwork only**. Patchy is vendored as a submodule and analysed here. Nothing in the app is wired to it yet.

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

## Why it is not a drop-in

The current Photopea integration is an **iframe**. `src/lib/components/PhotopeaEditor.svelte` loads `https://www.photopea.com` with a `customIO.save` hook that flattens the document to PNG and posts it back:

```
environment: { customIO: { save: 'app.activeDocument.saveToOE("png");' } }
```

The component then runs a `boot -> opening -> ready` handshake and hands the PNG to `importPhotopeaToCanvas` in `src/App.svelte`, which routes it to one of four targets: `base`, `raster`, `mask`, `region`.

Patchy has no hosted iframe endpoint. It is a native process with its own window, so there is nothing to point an iframe at unless its WebAssembly bundle is built and served locally. A full replacement therefore also replaces the *transport*, not just the URL.

The upside: Patchy is MIT and runs locally. The Cloudflare challenge and the external-network dependency that currently break the embedded editor disappear on every path below.

## Options

| Path | How it works | Cost | Main risk |
|---|---|---|---|
| **A. Native hand-off** | MooshieUI writes the document to a temp PSD/PNG, launches `patchy.exe <file>`, the user edits and saves, MooshieUI reads the file back | Reuses `canvasLayerExport.ts`; no WASM toolchain; no new CI | No embedded panel; needs a bundled or user-supplied Patchy binary per platform, and a return path for the edited file |
| **B. WASM embed** | Build the `wasm-release` preset (emsdk 4.0.7 plus Qt 6.10.3 `wasm_multithread`, static) and ship the bundle inside the app; the WebView serves it locally | Keeps the in-app editor UX and stays offline | Multi-GB Qt-for-wasm provisioning in CI, COOP/COEP cross-origin isolation required by the threaded build, a ~4 GB memory ceiling, and no printing, scanner import or CLI in the browser build |
| **C. MCP / scripting** | Drive Patchy through its MCP connector or `--run-script` for automated edits with no user in the loop | Fits "apply filter then export" style actions | Not interactive painting; complementary to A or B rather than a replacement for them |

Path A is the smallest first step and the only one that ships without a new build toolchain. Path B is the one that actually preserves today's in-app editing panel.

A note on PSD: Patchy's strength is PSD/PSB round trips. Path A can stay on flattened PNG at first, but the four existing import targets (`base`, `raster`, `mask`, `region`) map naturally onto PSD layers if we ever want to send and receive a document instead of a flat image.

## Touchpoints to replace

| File | Current role |
|---|---|
| `src/lib/components/PhotopeaEditor.svelte` | The iframe, the `boot/opening/ready` handshake, the timeout/retry/open-in-browser fallbacks, save and import callbacks |
| `src/App.svelte` | `editInPhotopea`, `importPhotopeaToCanvas` (target routing), the `<PhotopeaEditor>` mount, the gallery context menu entry `gallery.edit_photopea` |
| `src/lib/components/generation/GenerationPage.svelte` | `editCanvasSourceInPhotopea("base" \| "layer")`, the `canvas.open_photopea` button, the `LayerPanel` hand-off |
| `src/lib/components/canvas/CanvasEditor.svelte` | Passes `oneditphotopea` down to the layer panel and canvases |
| `src/lib/components/canvas/layers/LayerPanel.svelte` | Per-layer "edit in Photopea" action |
| `src/lib/utils/canvasLayerExport.ts` | PNG and mask encoding helpers. Editor-agnostic and reusable as-is |
| `src/lib/locales/*.ts` | Twelve files carrying the `photopea.*` keys |

Two behaviours would need rethinking rather than porting:

- `opaqueMaskLuminanceToAlpha` in `canvasLayerExport.ts` exists because Photopea can export a black-on-white mask with no transparency. Patchy writes real alpha, so that conversion becomes unnecessary on the Patchy path.
- The `photopea.connection_timeout` and `photopea.proxy_hint` strings exist only because the editor is remote. A local editor has no network failure mode, so those messages would be dropped rather than translated.

## Round-trip contract to preserve

Whatever replaces Photopea has to keep all five actions working:

1. Send the canvas base out and import the result back as the base.
2. Send a raster layer out and import the result back as a raster layer.
3. Send the inpaint mask out and import it back as a mask.
4. Send a regional-prompt mask out and import it back as a region.
5. Save the edited document to the gallery.

Inpainting also depends on mask geometry surviving the trip: regions and masks are aligned to the sampler crop, so an editor round trip must not resample the mask.

## Packaging and licence

- MIT is compatible with this repository's AGPL-3.0-only licence. Keep the Patchy copyright notice and its `LICENSE` in any distributed bundle.
- Patchy's own `NOTICE-THIRD-PARTY.md` and `docs/legal-constraints.md` cover bundled fonts, textures and gesture boundaries. Review them before shipping a Patchy binary or its WASM bundle as part of an installer.
- The submodule is a build/analysis convenience. Shipping a compiled Patchy is a separate decision from vendoring its source.

## Open decision

Which path to implement: **A** (native hand-off), **B** (WASM embed), or **C** (MCP automation). Tracked as a Kanban card so the answer lands with the work rather than in chat.
