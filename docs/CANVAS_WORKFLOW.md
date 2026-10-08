# Canvas, layer placement and inpainting

The workspace uses document pixels for layer positions and input preparation.
Pan and zoom are view transforms; they do not resize the document or alter a
submitted image. The renderer is Konva over Canvas 2D, not a GPU inference engine.

## What overlaps and what runs

- Raster layers composite from lower to higher stack order with real pixel alpha
  and layer opacity. A clipped raster intersects its pixels with a linked mask's
  raw painted alpha. Hiding that mask's edit pass does not remove its clipping.
- Masks and prompt regions appear as tinted overlays above the picture. Their
  display opacity and the global overlay strength are cosmetic; painted coverage
  controls their effect. Regions do not paint their tint into a generated result.
- An enabled edit mask defines an inpainting pass. The numbered mask order is
  separate from the raster stack. Overlapping edit masks run in that order.
- Regions and ControlNet modify the selected mask passes. A group defines default
  modifier scope; explicit per-mask links or document scope override that default.
  Groups do not provide isolated raster compositing or additional generation steps.
- The selected ControlNet has a read-only source/processed-map guide above the
  document. To place, scale or rotate its source precisely, link a raster and
  transform that raster. The guide itself is not a paintable raster layer.

The project dimensions open Resize canvas. Cropping hides content outside the document; enlarging the bounds reveals it again, including mask pixels saved in a named project. Canvas background fills new space. ControlNet references with only a session filename must be re-imported before changing bounds.

## Tools

| Tool/action | Behavior |
|---|---|
| Brush (B) | Paint on the active raster, mask or region; use size and paint opacity. |
| Eraser (E) | Remove alpha from that layer; partial opacity produces fractional erasure. |
| Rectangle (U), ellipse (O), freeform fill (Q) | Add a filled shape to the active layer. Freeform fill is not a separate persistent selection tool. |
| Move/resize (V) | Move, resize and rotate the whole selected layer's canvas content. Painted raster strokes and an imported image transform together. Shift preserves proportions; Alt scales from the center. |
| Pan (H), Space, middle mouse | Navigate the view without editing pixels. Wheel zooms around the pointer; Shift+wheel pans horizontally. |
| Pipette (I) | Sample the visible image color for raster painting. |
| Fill layer | Fill the active layer; one undo action. |
| Clear pixels | Empty the layer while retaining its identity and relationships. |
| Resize canvas (C) | Open document dimensions. **Canvas bounds** pads or crops without scaling the artwork, using a nine-position anchor. **Scale document** resizes the base, raster placement, masks, regions and ControlNet sources together; the aspect lock is optional. Both operations use one undo step. |
| Undo/redo | Restore gesture-level edits; metadata links and pixel snapshots retain their respective state. |
| Ctrl+click | Select a visible layer by its actual on-canvas pixels. |

Painting and transforms respect locks. ControlNet references have no paint
surface. Input fields keep their typing shortcuts; canvas shortcuts are scoped to
canvas interaction. Imported-image placement fields in the Inspector edit the
source image asset; the on-canvas frame transforms the full mixed raster layer.

## Resize, crop and sampler alignment

Inpainting preparation applies one geometry policy to the base image and mask:

- **Resize** stretches to the requested document size.
- **Crop** scales proportionally to cover it and crops centrally.
- **Fill** fits proportionally; image borders extend into the margins while mask
  coverage stays zero in those margins.
- **Latent resize** encodes the native patch before resizing its latent representation.

For **Only masked**, the processed mask bounds, context padding, minimum context
size and optional square context define a patch. The patch is resized to its
sampling resolution, optionally preserving its aspect, then composited back at
its original document position. Prompt-region masks and ControlNet maps use the
same context box and exact sampler size. The ControlNet preview shows the full
source/map before that per-pass crop, rather than claiming to show the final
cropped sampler tensor. Raster-alpha limits remain effective after mask growth,
blur and inversion.

## Rendering and responsiveness

Document layers disable Konva hit canvases; only transform handles use the hit
surface. Pointer painting updates the touched layer. View updates, clipping and
thumbnails are scheduled with animation frames; bounds and clipping inputs are
cached. Preview mask processing is limited to a 512-pixel longest side. Hover
color sampling is throttled because it requires compositing the view.

Brush/eraser thickness scales through the node transform once. Painted raster
bounds use alpha, so black paint and partial erasure work like colored paint.
Bounds caches ignore pan and zoom, while pixel revisions invalidate linked
ControlNet previews and edit-area guides after painting and transforms.

Each spatial layer still owns a Canvas 2D surface and undo retains up to 64
entries. Large documents, many layers, clipping readbacks and saving full pixel
content cost CPU and memory; this is not a tiled image engine. A small functional
cloud-Chromium scene completed 60 pan/zoom frames without document-pixel reads
(median about 16.7 ms); this is a diagnostic sample, not a hardware-independent
performance guarantee. GPU model inference is a separate backend workload.

See [layer relationships](INPAINT_LAYER_RELATIONSHIPS.md) and
[Patchy integration](PATCHY_INTEGRATION.md) for source binding and external editing.
