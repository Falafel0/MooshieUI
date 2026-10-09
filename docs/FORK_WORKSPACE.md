# Fork workspace

The fork uses `Falafel0/MooshieUI` for signed desktop updates, server version checks, release notes and issue reports. Its desktop identifier is `com.falafel0.mooshieui`. Releases publish a signed Windows installer and updater manifest. Upstream configuration and managed runtime paths are not automatically imported. Existing external ComfyUI servers can be connected in Settings.

## Release numbering and upstream

New releases use `v<upstream version>-mooshie.<number>`, beginning with `v2.3.18-mooshie.1`. The base version follows the merged upstream release; increment the numeric suffix for fork releases on that base and reset it to 1 after moving to a newer upstream base. Keep existing `fork.N` tags and releases unchanged. A higher upstream base makes the first `mooshie.N` release newer than the previous `2.3.9-fork.9` for desktop and server update checks.

The current upstream base is Mooshieblob1/MooshieUI v2.3.18 through `fd63cfc57afdc10bffefa1a62c5ad1648de3120c`, including component-kind detection after the release tag.

Component warnings belong to the selected file and active model location. Refreshing the inventory invalidates cached inspection; remote server filenames are never inspected as local files. Krea 2 setup shares one installation between the model panel and notifications, waits for all transfers before retrying, and enables the mode only while the original Krea 2 model and encoder remain selected. Turning the mode off selects an installed stock encoder. When none is available, the action stays disabled with an explanation; the active mode and encoder remain consistent.

## Inpainting

Inpainting always opens the canvas. The right workspace contains document layers and the Inspector for the selected item. Select a layer to edit its properties; mask, region and raster controls change with the selection. The shared bottom Shelf groups resources, results and workflow tools.

- **Base:** load a source or work on the blank colored document. A blank document without painted masks generates over the full canvas.
- **Raster:** paint or insert images, then move, resize, rotate or flip them. Visibility and opacity affect the generation input.
- **Mask:** paint the area to change. Each visible, nonempty mask starts an inpainting pass using the document prompt and its own denoise and mask processing. Overlapping prompt regions add conditioning; masks do not have local prompts.
- **Region:** a prompt conditioning area with its own positive and negative text and strength. It does not edit pixels or start an inpainting pass by itself. Multiple visible regions can overlap a mask; text-to-image also reads painted regions.
- **Patchy:** prepare the base, a selected layer, or a result as a PNG, then press Launch Patchy. Save the edit there and choose a gallery, base, raster, mask or region destination here. For a mask or region, the changed pixels relative to the sent image form the painted area; resizing that image makes the mask import invalid. A layered PSD/PSB save can be flattened on read-back, but its layer structure does not transfer to this canvas.
- **ControlNet:** add a ControlNet layer, then configure its source, strength, start/end range and modifier target in the Inspector. The canvas overlay helps align the control source.

The context eye toggles the selected mask's affected bounds and padding guides. Guides use a reduced-resolution preview for responsiveness and are excluded from exported pixels. Precise output still depends on the model and ComfyUI processing.

## Results and cancellation

A completed result is a preview until explicitly applied. Replace the base to continue from it, insert the full result as a raster layer, or insert only the processed mask area. Dismissing the preview retains the current base. Mask-area insertion uses the submission's affected area, including growth and feathering, rather than a mask edited after submission.

Replacing the base hides the raster layers already included in that submission, preventing their pixels and opacity from being applied twice. The layers remain editable in the stack. Undoing the base replacement restores their visibility. Raster layers added after submission remain visible.

The queue tracks source versions and submission order. Canceling a regional chain stops subsequent steps. Changing the base invalidates pending result attachment; a slower old result cannot overwrite a newer accepted preview. Results remain available through the gallery independently of canvas application.

Anima can run sequential inpainting from a painted prompt region without a separate ordinary mask. SDXL prompt regions only influence conditioning and still need an inpaint mask to select pixels for editing.

Layer nodes and viewport survive mode changes and canvas remounts. Named projects save document dimensions, base and layer pixels, and generation settings; use the project bar's Save action before closing or switching projects. An older settings-only project can still open without canvas pixels.

## Prompt Studio

Build, Mix, Editor and Library share one local draft. In Build and Mix, the draft remains editable on the right. In Editor, edit the central full-prompt arena; the right side previews the output.

The pills are the prompt editor. Click a pill to edit its text, including its weight. Press Enter to commit, Escape to cancel, or × to remove it. Add tag accepts a tag, multiple comma-separated tags or complete prompt syntax. Attention groups, scheduling and LoRA constructs remain intact. Long pills wrap. Copy prompt includes the main prompt and every enabled chunk.

Undo and redo restore edits, removals, weights and pin changes. Clear prompt clears the output and disables chunks without deleting their content; Undo restores it. Text and chunk tools manage enabled chunks, their content and reusable saved chunks. Approximate CLIP tokens and syntax warnings help review the prompt; the counter is an estimate rather than a model tokenizer.

Use Review & send to choose Text to Image, Image to Image or Inpainting, positive or negative, and append/prepend/replace. The dialog shows the resulting text before applying. Named prompt blocks remain available. Ctrl+Enter commits the active pill and opens this review. Cancel leaves generation unchanged.

## Prompt alternation

Every-step `[a|b]` alternation works with RES multistep, its ancestral and CFG++ variants, and Euler/DPM++ 2M CFG++ samplers. It can appear inside a schedule, for example `<fromto[0.875]:[(artist a:1.35)|(artist b:1.25)]||painting>`. Artist weights and the selected sampler are preserved. Adaptive samplers and samplers that evaluate intermediate off-schedule timesteps remain unsupported. Restart the managed ComfyUI process after updating so it loads the new prompt-alternation adapter.

## Validation

Focused tests cover mask processing, regional ordering, final-only upscaling, frozen layer settings, cancellation, stale result rejection and the inpainting nodes. Browser interaction checks cover drawing, duplication, rename cancellation, hidden-layer protection, per-layer properties, resizing and viewport preservation.

The Windows library test harness can lack the common-controls v6 activation manifest required by desktop dialogs. In that case it fails before running tests with `STATUS_ENTRYPOINT_NOT_FOUND`; embedding a common-controls v6 manifest in the generated test executable allows the tests to run. Production installers already receive their manifest from Tauri.

## Preparation and responsiveness

Generate immediately shows preparation status before a task ID is available. Cancel during preparation prevents submission; if ComfyUI accepts the job late, cancellation targets that job. Accepted tasks already in the queue remain intact. The status is painted before synchronous input preparation; minimized windows use a bounded fallback. Preparation timings are recorded in diagnostic logs separately from sampling time.

Long prompt editors keep the complete native editable text while measuring interactive tags and spelling marks near the visible lines. The Shelf initially renders a batch of LoRAs, models or images and loads more when scrolling or pressing Show more. Search covers the entire library, including cards not yet rendered. LoRA thumbnail requests follow visible cards with at most three in flight. Changing panels or filtering removes waiting requests; inlined thumbnails need no backend read. A failed preview uses a placeholder rather than a permanent loading indicator.

Use the project dimensions or C over the canvas to open Resize canvas. Choose Canvas bounds to pad/crop around an anchor without scaling, or Scale document to resize artwork and spatial layers together. Undo restores the previous document size and content.
