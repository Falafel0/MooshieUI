# MooshieUI Fork

> **A Windows-first fork of [MooshieUI](https://github.com/Mooshieblob1/MooshieUI), built around a layer-based inpainting workspace.**
> This branch is maintained as its own project: it has its own version line (`2.3.7-fork.*`), its own releases, installers and signed updates, its own application identifier and settings directory (**MooshieUI Fork**), and it is not interchangeable with an upstream install. A second install can read the same ComfyUI server, model folders and gallery only if you point it at them in Settings.

Every release of this branch ships **one Windows installer** (`x64-setup.exe` for Windows 10/11 on x86_64) plus its signature and the updater manifest. Linux and macOS builds, the headless-server binary, and container images are not part of this fork's release path; the source for browser/server mode is still in the repository and still builds, it is simply not what this branch publishes.

![MooshieUI Fork](docs/screenshot.avif)

---

## What this branch changes

The upstream app answers the question *"what do I generate?"*. This branch is about *"what do I change, and where?"* — it takes the canvas editor apart into three mechanisms that never borrow from each other:

| Layer type | What it is | What a generation run reads from it |
|------------|------------|-------------------------------------|
| **Raster** | An image placed on the canvas: the picture itself | Its pixels, its transform (position, size, rotation, flips) and its real opacity |
| **Mask** | A painted area for an inpainting pass | The painted pixels, the mask's denoise, its painted coverage and its processing (grow, blur, invert) |
| **Prompt region** | An area that speaks to the prompt | The region's prompt, negative prompt and strength — **never pixels** |

A mask has no prompt of its own: it runs the global prompt, and the text of a prompt region it overlaps is added to the conditioning. A prompt region never edits pixels. This separation is enforced in code (`src/lib/utils/regionalStrategy.ts`) and covered by tests, so a region can no longer be mistaken for a mask and vice versa.

**Per-mask strength, stated in one place.** Each mask has:

- **Denoise** — how strongly the pixels under it are changed, with a "use the document value" checkbox so the inherited default stays visible instead of hidden.
- **Painted coverage** — how much of the painted area counts as a mask. At 0% the layer is left out of a run entirely.
- **Edge falloff by coverage** — on: the core of a brush stroke is edited at full strength and the edges fade below it, using a per-pixel denoise schedule (no extra nodes, no extra passes); off: the whole mask is edited at one strength.
- **Grow, blur, invert, own inpaint size** — a mask can carry its own processing and size, or inherit the document's.

**Move and resize are one tool.** The handles sit on the layer's *real* content — the painted pixels of a mask, the drawn shapes of a region, the image of a raster — not on a rectangle that a stroke width quietly inflated. Dragging moves; dragging a handle resizes; Shift keeps the proportions, Alt scales from the centre, and the angle snaps only to the upright ones. The dashed context guides around the layer follow a move live instead of lagging a repaint behind it.

**Display and generation are separated on purpose.** Opacity, tint and the visibility of an overlay change how the layer looks on the canvas and nothing else; the sliders that a run reads live under their own heading, above the display ones.

**The rest of the branch's own work:**

- **Prompt arena and macro palette** against a local [monbooru](https://github.com/monbooru/monbooru) server, with the client implemented in Rust so the API token never enters the webview. monbooru can be installed and launched from Settings, the same way Patchy is handled.
- **Patchy hand-off** — install, send the canvas to [Patchy](https://github.com/SethRobinson/Patchy), and take the edited document back, with the file locations and the direction of the exchange stated in the UI.
- **Projects** — save the current local state (prompts, presets, styles and the rest) under a name and load it back later.
- **Recommended parameters can be hidden completely**, for people who already know what they are doing.
- **Windows-only release pipeline** — one NSIS build, a manifest with a single `windows-x86_64` entry, and an artifact check that fails the release if a second installer sneaks into the upload set.

---

## Install

1. Download the latest `MooshieUI.Fork_<version>_x64-setup.exe` from [Releases](https://github.com/Falafel0/MooshieUI/releases).
2. Run it. The app installs as **MooshieUI Fork** alongside an upstream install; nothing is shared but the machine.
3. On first start the setup wizard downloads `uv`, Python, ComfyUI and PyTorch (NVIDIA, AMD and Intel Arc are auto-detected), then installs MooshieUI's custom nodes. On Windows it also installs an app-local copy of Git when no working Git is found. Expect 5-10 GB for the runtime plus space for models, and 5-15 minutes for the first setup.
4. ComfyUI launches with the app; the managed install prefers port **18288** and keeps whatever port you already saved.

Updates arrive through the app's own updater, signed against this fork's releases. To connect to a ComfyUI you already run, choose **Remote** in the connection settings.

### Where this branch expects a hand-off

| Tool | Hand-off | How it is installed |
|------|----------|---------------------|
| Patchy | The canvas is written out and opened in Patchy; the edited document is read back by the app | Auto-installed from its release, under this app's data directory |
| monbooru | The server keeps its own `monbooru.toml` and data directory; the app talks to it over its REST API on port 8455 | Auto-installed from its release (portable lite archive, SHA-256 verified), started and stopped from Settings |

Both tools run as separate programs in their own process; the app starts, supervises and stops them.

---

## Build from source

Windows with Node.js 22.12+ or 24+, stable Rust, and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Falafel0/MooshieUI.git
cd MooshieUI
npm install
npm run tauri dev      # Tauri + Vite hot-reload on port 1420
npm run tauri build    # production build (NSIS installer)
```

Two Rust builds, one crate — the default links `tauri`, the server build does not:

```bash
cd src-tauri
cargo check                                     # desktop features
cargo check --no-default-features --features server
cargo test --lib                                # ~710 unit tests
cargo fmt --check && cargo clippy
```

Frontend and repository gates:

```bash
npm run check                                   # svelte-check; 0 errors is the gate
npm run build                                   # Vite production build
node --test tests/*.test.mjs                    # node test files wired into CI explicitly
node scripts/check-i18n-parity.mjs              # 12 locales, keys and placeholders
```

Any `tauri` reference outside a `#[cfg(feature = "desktop")]` gate compiles locally and breaks the server build — including function parameters and the arguments at the call site. Keep that in mind when adding a command, and see [CONTRIBUTING.md](CONTRIBUTING.md) and [push-instructions.md](push-instructions.md) for the rest of the workflow.

---

## How it is put together

- **Two modes, one UI.** The same frontend runs as a Tauri desktop app and as a browser app served by an embedded axum server. `window.__MOOSHIE_BROWSER_MODE__` decides which one you are in.
- **One IPC path.** Every backend call goes through `ipcInvoke()` / `ipcListen()` in `src/lib/utils/ipc.ts`, which route to Tauri IPC or to HTTP/SSE. Calling `invoke()` directly bypasses both modes and is not done.
- **The gallery stores JPEG XL.** Images are read back through `loadGalleryImageDisplay()` and exported through `loadGalleryImagePng()`; nothing reads a gallery file directly.
- **Layers are state, not widgets.** `src/lib/stores/canvas.svelte.ts` owns layers, their geometry and the export paths; the Konva stage renders what the store says.
- **Locale files are flat, checked for parity, and honest.** `en.ts` is the source of truth for 12 languages; `scripts/check-i18n-parity.mjs` blocks a release whose key or placeholder sets disagree.

---

## Current limits, stated plainly

- **Windows only.** No Linux or macOS installers come out of this branch. The macOS build files exist for manual experiments and are not part of a release.
- **img2img does not read prompt regions yet.** Regional conditioning applies to text-to-image and inpainting; the img2img path ignores region text.
- **Patchy runs beside the app, not inside it.** Embedding it in the window would need a web/wasm build that does not exist yet, so the hand-off goes through files by design.
- **Upstream features that this branch does not touch** — video, music, NovelAI, the model hub, Compare Grid, the prompt assistant — behave as upstream documents them in the [wiki](https://github.com/Mooshieblob1/MooshieUI/wiki).

---

## Documentation

| Document | Covers |
|----------|--------|
| [docs/FORK_WORKSPACE.md](docs/FORK_WORKSPACE.md) | What this branch is, and how to work in it |
| [docs/PATCHY_INTEGRATION.md](docs/PATCHY_INTEGRATION.md) | The Patchy hand-off, end to end |
| [docs/MONBOORU_PROMPT_WORKBENCH.md](docs/MONBOORU_PROMPT_WORKBENCH.md) | The prompt arena and the monbooru client |
| [docs/METADATA_CARRIERS.md](docs/METADATA_CARRIERS.md) | Where generation metadata is stored and read |
| [docs/README.md](docs/README.md) | Index of technical references and planning notes |
| [CHANGELOG.md](CHANGELOG.md) / [RELEASE_NOTES.md](RELEASE_NOTES.md) | Version history and the current release |

Shared upstream features are documented in the [MooshieUI wiki](https://github.com/Mooshieblob1/MooshieUI/wiki); the wiki is maintained upstream and describes upstream behaviour.

---

## Contributing

Pull requests against this branch are welcome. `main` is protected: work on a branch, run the frontend and Rust gates above, and open a PR. GlassWorm resistance checks run on every push and pull request; enable the same checks locally with:

```bash
bash scripts/setup-hooks.sh
```

---

## Credits and license

This branch is a fork of **[MooshieUI](https://github.com/Mooshieblob1/MooshieUI)** by Mooshieblob1, and most of what the app can do is upstream's work: the generation pipeline, the ComfyUI integration and custom nodes, the model hub, video and music generation, the NovelAI backend, the prompt assistant, the gallery, server mode, the twelve translations, and the documentation the [wiki](https://github.com/Mooshieblob1/MooshieUI/wiki) keeps. The canvas layer work, the prompt arena, the monbooru client and install, the Patchy hand-off, projects and the Windows-only release pipeline are this branch's additions.

The ecosystem credit list — ComfyUI, Tauri, Svelte, Tailwind, PyTorch, uv, llama.cpp, ONNX Runtime, the bundled ComfyUI nodes, the research behind MultiDiffusion/SpotDiffusion/CFG Rescale/OmniSR, the model creators, and the data and service providers — is maintained upstream; see [Acknowledgments in the upstream README](https://github.com/Mooshieblob1/MooshieUI#-acknowledgments). Patchy is by [Seth Robinson](https://github.com/SethRobinson/Patchy); monbooru is by the [monbooru](https://github.com/monbooru/monbooru) project.

Licensed under the [GNU Affero General Public License v3.0](LICENSE), as upstream is. If your work is used here and credited poorly, [open an issue](https://github.com/Falafel0/MooshieUI/issues) and it will be fixed.
