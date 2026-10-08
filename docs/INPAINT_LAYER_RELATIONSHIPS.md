# Inpaint layer relationships

This document specifies the relationship model and its intended UI. It does not
claim that all controls described below are already available in the application.

## Editor practices and the boundary of this model

The following official documentation was checked on 2026-10-08:

- [Photoshop clipping masks](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/create-and-manage-clipping-masks.html)
  use non-transparent base-layer content to reveal clipped layers. Photoshop
  communicates the relationship with indentation and a clipping icon. Its
  automatic consecutive-layer rules are specific to its compositor; MooshieUI
  uses explicit references so reordering cannot silently change a binding.
- [Photoshop layer masks](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/add-layer-masks.html)
  distinguish the layer thumbnail from its mask thumbnail and support moving or
  copying the mask to another layer.
- [Krita transparency masks](https://docs.krita.org/en/reference_manual/layers_and_masks/transparency_masks.html)
  hide or reveal pixels without deleting the original image. Gray coverage
  produces partial transparency.
- [Krita filter masks](https://docs.krita.org/en/reference_manual/layers_and_masks/filter_masks.html)
  attach a non-destructive effect to a layer and constrain it to painted coverage.
  [Filter layers](https://docs.krita.org/en/reference_manual/layers_and_masks/filter_layers.html)
  can instead affect the layers below them, with groups constraining the scope.
- [Krita alpha inheritance](https://docs.krita.org/en/tutorials/clipping_masks_and_alpha_inheritance.html)
  uses composited alpha inside an isolated group. Its documentation explicitly
  warns that pass-through groups behave differently. MooshieUI's organizational
  groups do not promise this isolated group-compositing behavior.
- [Blender modifiers](https://docs.blender.org/manual/en/latest/modeling/modifiers/introduction.html)
  expose a type icon, editable name, independent viewport/render participation,
  and an active outline. The useful analogy is an effect attached to its target;
  it does not imply that a ControlNet should become its own generation job.

MooshieUI's inpaint generator receives and returns a full-canvas composite. A
mask limits editable pixels; it does not select a raster that will be replaced
in isolation. Regions and ControlNets condition mask passes. Only edit masks
create generation passes.

## Fields and exact meanings

All bindings are explicit layer ids. An absent or `null` id means unbound. A
present id whose target is missing or has the wrong role is an error, and the
corresponding effect must fail closed rather than silently becoming global.

| Owner | Field | Meaning |
| --- | --- | --- |
| Any layer | `groupId` | One organizational group; no nested groups or group transforms. |
| Mask or region | `targetRasterId` | Intersect painted coverage with the target raster's intrinsic transformed alpha. |
| Raster | `clippingMaskId`, `clippingEnabled` | Multiply this raster's alpha by the referenced mask's painted alpha. |
| ControlNet | `referenceRasterId` | Use the rendered pixels of one raster as the control image. |
| Region or ControlNet | `modifierScope` | Choose which edit-mask passes receive this modifier. |

### Input composition versus edit coverage

Raster clipping is a real input-composition operation: the canvas preview and
the image exported to the generator must agree. It is not merely a colored guide.
Its source is the mask's painted alpha, independent of whether that mask is
enabled as an inpaint pass and independent of its generation `coverage` slider.
An explicit `clippingEnabled: false` bypasses clipping while preserving the id.

Mask/region intersection uses intrinsic raster alpha after its geometric
transform, **before raster opacity and before raster clipping**. Dimming a
raster or temporarily disabling its clipping must not silently change the area
an inpaint mask can edit. The intersection is applied before generation-specific
mask growth, feathering, or denoise processing. The target alpha also caps the
processed edit area after growth, feathering and inversion, so these operations
cannot extend edits beyond the target. This second constraint uses a minimum,
not another multiplication, preserving fractional alpha without squaring it.

These are different operations even when they refer to the same raster-mask
pair. The raster consumes raw painted mask alpha; the mask consumes raw raster
alpha. Neither reads the other's recursively computed output, so this common
pair is well defined and is not a dependency cycle. Arbitrary mask-to-mask,
raster-to-raster, and modifier-to-modifier references are not supported.

A ControlNet raster reference uses that raster's rendered image, including its
transform, opacity and clipping, in canvas coordinates. It does not generate a
new image, change the number of passes, or imply that only this raster receives
the generation result. UI visibility of the reference is distinct from whether
its pixels are usable as a source. Transparent source pixels use a black matte consistently in the control input
and its reference preview.

### Modifier scope and disabling

`modifierScope.mode` has three values:

- `auto`: an ungrouped modifier applies to all enabled masks; a grouped modifier
  applies to enabled masks in the same group.
- `document`: apply to all enabled masks, even when the modifier belongs to a
  group. Its own group still controls whether the modifier is enabled.
- `masks`: apply only to `maskIds`. An empty or absent whitelist applies to no
  masks. Missing targets are retained for repair and never replaced with all
  masks. If one target disappears, other valid explicit targets keep their scope.

`layer.visible` controls participation. ControlNet additionally requires its
`controlnet.enabled` switch. `group.visible: false` disables its members. A
modifier's on-canvas guide can be hidden independently; hiding a guide must not
change its scope or generation parameters. Disabling a modifier preserves every
binding so enabling it again restores the same intent.

The selected ControlNet shows a read-only guide on the canvas. Its inspector
distinguishes the **source image** (an upload or a linked raster) from the
**processed map** returned by the preprocessor. Preparing a preview switches to
the processed map; the two preview buttons let the user compare it with the
source. A linked raster does not override that processed-map view. Without a
preprocessor, the source itself is the control input. Generation still processes
the original source exactly once; a prepared preview never replaces it.

ControlNet guide opacity is the layer's display-only `opacity`, initially 40%
for new controls. It changes neither ControlNet strength nor the input pixels.
The canvas badge names the displayed image. Disabling the modifier does not
prevent inspecting its guide or discard a prepared map; hiding its group hides
the guide. Processed previews are session-only and must be prepared again after
changing source, preprocessor or model context. Masks are listed and inspected
in the right document panel; no duplicate mask list occupies the prompt panel.

Groups organize layers and define default modifier scope. They do not isolate
the raster compositor, create a generation job, change pixel coordinates, or
give a mask a layer-only output. A group may contain different roles. Global
raster compositing and global edit-mask order continue to be explicit.

## UI guidance

Use a single selectable layer list and place the selected layer's inspector
directly beneath it. Convey role with an icon and a distinct thumbnail, not color
alone: raster image, monochrome mask coverage, prompt-region contour, and a
ControlNet reference thumbnail. Number mask passes only. Modifiers get a scope
label such as `All masks`, `Face group`, `2 masks`, or `No targets`.

Show a chain/clipping icon for a real binding. Hovering or selecting it can
highlight the source and destination rows plus their canvas outlines. An invalid
reference needs a visible repair state. Indentation is appropriate for group
membership or a modifier with one explicit mask target; a modifier targeting
multiple masks appears once, with its target count, rather than as several
apparently independent copies.

Keep the common actions immediate: select a row, click a thumbnail to focus its
canvas content, toggle participation, rename, reorder, and undo. Show the scope
selector and binding controls in the selected inspector instead of repeating
select menus in the left prompt panel. A small read-only run summary can explain
which masks will run and how many modifiers each receives.

Do not implement pointer dragging as an unexplained action that sometimes
reorders, sometimes clips, and sometimes changes modifier scope. Offer distinct
drop targets or explicit commands with a preview of the resulting relationship.
Escape cancels; a completed action creates one undo entry.

## Persistence, deletion and duplication

Saving relationships requires persisted layer ids and group ids. The previous
project format discarded layer ids; adding references without migrating that
format would create broken links after every load. A loader that creates fresh
session ids must allocate all ids first, then remap every binding, every explicit
scope whitelist, and every group membership with those same maps. Legacy
documents receive unique ids and unbound/default scopes.

Unknown explicit ids remain explicit broken references. Clearing a missing
`targetRasterId` would expand editable coverage; clearing a missing clipping
mask would reveal previously hidden raster pixels; replacing a missing ControlNet
reference with the document would change its conditioning. Those changes require
an explicit user action. Removing a target must preserve enough metadata for
repair and undo, and must not widen a modifier whitelist.

Duplicating one layer gives it a new id while keeping its external bindings.
For example, a raster copy still shares its clipping mask until the user makes
an independent copy. Duplicating a selected set/group uses a two-pass id map:
references within the duplicated set point to the duplicated targets; references
outside it remain external. A mask copy does not silently add itself to an
existing modifier's explicit whitelist. Ungrouping should preserve the previous
effective targets of group-scoped modifiers with an explicit whitelist, instead
of accidentally making them global.

All related metadata changes belong to one document-history transaction. Undo
must restore ids, groups, bindings, scope, selection, and any pixels removed by
the action. Pointer slider gestures should produce one undo entry. Display-only
reference URLs must not be kept alive by serialized history entries.

## Submission snapshot

Before the first upload or other `await`, capture layer/group metadata, raw
spatial pixels, raster transforms and the complete relationship plan. Resolve
each mask's region and ControlNet payloads from that same snapshot. Changes made
while uploading must not alter a later pass in the existing run. Document-version
guards prevent a stale upload from targeting a newly opened document.

The single-mask fast path and multi-mask chain must apply the same scope and
alpha rules. Validating every document modifier before considering its scope
would wrongly block a pass because of an unrelated inactive modifier. A broken
modifier that does apply to a pass should instead be reported clearly before
submission. No validation or upload should convert a region or a ControlNet into
an additional generation step.


## Server compatibility

Requests using explicit density sampling or a raster area limit require the
updated bundled MooshieUI nodes. Desktop and browser/server paths probe the
additive `MooshieInpaintPrepare.area_limit` input before submission. An older
running ComfyUI must update those nodes and restart; class presence alone is
insufficient. Zero denoise and legacy requests avoid this extra probe.
