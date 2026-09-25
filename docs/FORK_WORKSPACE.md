# Fork workspace

The fork uses `Falafel0/MooshieUI` for signed desktop updates, server version checks, release notes and issue reports. Its desktop identifier is `com.falafel0.mooshieui`, and server releases publish to the separate `ghcr.io/falafel0/mooshieui-fork` container package. Upstream configuration and managed runtime paths are not automatically imported. Existing external ComfyUI servers can be connected in Settings.

## Inpainting

Inpainting always opens the canvas. The right workspace groups Base, Layers and ControlNet. Select a layer to edit its properties; mask, region and raster controls change with the selection. The bottom drawer retains session images and prompt tools.

- **Base:** load a source or work on the blank colored document. A blank document without painted masks generates over the full canvas.
- **Raster:** paint or insert images, then move, resize, rotate or flip them. Visibility and opacity affect the generation input.
- **Mask:** paint the area to change. Local prompts, denoise, growth and mask processing can override document settings.
- **Region:** a special mask layer with its own regional prompt. Visible masks and regions run from bottom to top; the layer list shows their step numbers. Hidden or empty ordinary masks are skipped. Regions require a prompt and painted area.
- **Photopea:** open the current base, selected raster/mask/region layer, or a generated result. Import the edited PNG as a new base or layer. Transparent masks use alpha coverage; fully opaque mask and region imports use brightness (black = no coverage, white = full coverage).
- **ControlNet:** configure its source, strength and start/end range in the dedicated tab. The canvas overlay helps align the control source.

The context eye toggles the selected mask's affected bounds and padding guides. Guides use a reduced-resolution preview for responsiveness and are excluded from exported pixels. Precise output still depends on the model and ComfyUI processing.

## Results and cancellation

A completed result is a preview until explicitly applied. Replace the base to continue from it, insert the full result as a raster layer, or insert only the processed mask area. Dismissing the preview retains the current base. Mask-area insertion uses the submission's affected area, including growth and feathering, rather than a mask edited after submission.

Replacing the base hides the raster layers already included in that submission, preventing their pixels and opacity from being applied twice. The layers remain editable in the stack. Undoing the base replacement restores their visibility. Raster layers added after submission remain visible.

The queue tracks source versions and submission order. Canceling a regional chain stops subsequent steps. Changing the base invalidates pending result attachment; a slower old result cannot overwrite a newer accepted preview. Results remain available through the gallery independently of canvas application.

Anima can run sequential inpainting from a painted prompt region without a separate ordinary mask. SDXL prompt regions only influence conditioning and still need an inpaint mask to select pixels for editing.

Layer nodes and viewport survive mode changes and canvas remounts within the current session. This is not a saved layered project format: export work before closing or reloading the application.

## Validation

Focused tests cover mask processing, regional ordering, final-only upscaling, frozen layer settings, cancellation, stale result rejection and the inpainting nodes. Browser interaction checks cover drawing, duplication, rename cancellation, hidden-layer protection, per-layer properties, resizing and viewport preservation.

The Windows library test harness can lack the common-controls v6 activation manifest required by desktop dialogs. In that case it fails before running tests with `STATUS_ENTRYPOINT_NOT_FOUND`; embedding a common-controls v6 manifest in the generated test executable allows the tests to run. Production installers already receive their manifest from Tauri.
