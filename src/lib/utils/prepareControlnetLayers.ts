import { canvas } from '../stores/canvas.svelte.js';
import { locale } from '../stores/locale.svelte.js';
import { uploadImageBytes } from './api.js';
import { canvasPngBytes, matteControlnetReference } from './canvasLayerExport.js';
import { effectiveLayerVisibility, modifierAppliesToMask } from './layerRelations.js';
/** Restore a project's control pixels into the current ComfyUI session before submitting. */
export async function prepareControlnetLayers() {
  const controls = canvas.layers.filter(layer => layer.type === 'controlnet' && layer.controlnet?.enabled
    && effectiveLayerVisibility(layer, canvas.groups)
    && canvas.layers.some(mask => mask.type === 'mask' && (mask.coverage ?? 1) > 0
      // Validate the reference below so a missing source produces a useful
      // error instead of silently dropping an otherwise active modifier.
      && modifierAppliesToMask({ ...layer, referenceRasterId: null }, mask.id, canvas.layers, canvas.groups)));
  for (const layer of controls) {
    const source = layer.controlnet?.sourceData;
    const referenceId = layer.referenceRasterId;
    const reference = referenceId ? canvas.layers.find(item => item.id === referenceId && item.type === 'raster') : null;
    if (referenceId && !reference) throw new Error(locale.t('canvas.missing_connection'));
    if (!referenceId && !source) continue; // Legacy filenames remain usable in their existing ComfyUI session.

    const version = canvas.inpaintSourceVersion;
    const paintRevision = canvas.paintRevision;
    const referenceImage = reference?.image;
    const clippingMaskId = reference?.clippingMaskId;
    const clippingEnabled = reference?.clippingEnabled;
    const referenceOpacity = reference?.opacity;
    const scope = JSON.stringify(layer.modifierScope);
    const groups = JSON.stringify(canvas.groups.map(group => ({ id: group.id, visible: group.visible })));
    const unchanged = () => {
      const current = canvas.layers.find(item => item.id === layer.id);
      if (!current) return false;
      const currentReference = referenceId ? canvas.layers.find(item => item.id === referenceId && item.type === 'raster') : null;
      return canvas.inpaintSourceVersion === version && current.controlnet === layer.controlnet
        && current.controlnet?.sourceData === source
        && current.referenceRasterId === referenceId && current.groupId === layer.groupId
        && JSON.stringify(current.modifierScope) === scope && effectiveLayerVisibility(current, canvas.groups)
        && JSON.stringify(canvas.groups.map(group => ({ id: group.id, visible: group.visible }))) === groups
        && (!referenceId || !!currentReference && canvas.paintRevision === paintRevision
          && currentReference.image === referenceImage && currentReference.opacity === referenceOpacity
          && currentReference.clippingMaskId === clippingMaskId && currentReference.clippingEnabled === clippingEnabled);
    };
    let bytes: number[];
    if (referenceId) {
      const rendered = await canvas.exportRasterLayer(referenceId);
      if (!rendered) throw new Error(locale.t('canvas.missing_connection'));
      bytes = await canvasPngBytes(matteControlnetReference(rendered));
    } else {
      const response = await fetch(source!);
      if (!response.ok) throw new Error(locale.t('generation.controlnet.image_failed', { error: String(response.status) }));
      bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
    }
    if (!unchanged()) throw new Error(locale.t('generation.controlnet.reference_changed'));
    const result = await uploadImageBytes(bytes, `control-${layer.id}.png`);
    if (!unchanged()) throw new Error(locale.t('generation.controlnet.reference_changed'));
    // Transient server filenames do not create an undo step.
    canvas.layers = canvas.layers.map(item => item.id === layer.id ? { ...item, controlnet: { ...item.controlnet!, image: result.name } } : item);
  }
}
