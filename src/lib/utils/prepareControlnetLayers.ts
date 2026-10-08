import { canvas } from '../stores/canvas.svelte.js';
import { locale } from '../stores/locale.svelte.js';
import { uploadImageBytes } from './api.js';
import { canvasPngBytes, matteControlnetReference } from './canvasLayerExport.js';
import { documentControlnetSourceBytes } from './documentControlnetReference.js';
import { effectiveLayerVisibility, modifierAppliesToMask } from './layerRelations.js';

/** Restore control pixels for this ComfyUI session. Share sources within a run,
 * limit concurrent uploads, and commit filenames only after every source is valid. */
export async function prepareControlnetLayers() {
  const controls = canvas.layers.filter(layer => layer.type === 'controlnet' && layer.controlnet?.enabled
    && effectiveLayerVisibility(layer, canvas.groups)
    && canvas.layers.some(mask => mask.type === 'mask' && (mask.coverage ?? 1) > 0
      && modifierAppliesToMask({ ...layer, referenceRasterId: null }, mask.id, canvas.layers, canvas.groups)));
  const version = canvas.inpaintSourceVersion;
  const paintRevision = canvas.paintRevision;
  const width = canvas.canvasWidth, height = canvas.canvasHeight;
  const groups = JSON.stringify(canvas.groups.map(group => ({ id: group.id, visible: group.visible })));
  const plans = controls.flatMap(layer => {
    const source = layer.controlnet?.sourceData;
    const referenceId = layer.referenceRasterId;
    const reference = referenceId ? canvas.layers.find(item => item.id === referenceId && item.type === 'raster') : null;
    if (referenceId && !reference) throw new Error(locale.t('canvas.missing_connection'));
    if (!referenceId && !source) return []; // Legacy session filenames can still be used without a resize.
    const placement = layer.controlnet?.sourcePlacement ? { ...layer.controlnet.sourcePlacement } : undefined;
    const placementKey = JSON.stringify(placement);
    const referenceImage = reference?.image;
    const imageGeometry = referenceImage && { x: referenceImage.x, y: referenceImage.y, width: referenceImage.width, height: referenceImage.height, rotation: referenceImage.rotation, flipX: referenceImage.flipX, flipY: referenceImage.flipY, src: referenceImage.src };
    const clippingMaskId = reference?.clippingMaskId;
    const clippingEnabled = reference?.clippingEnabled;
    const referenceOpacity = reference?.opacity;
    const scope = JSON.stringify(layer.modifierScope);
    const unchanged = () => {
      const current = canvas.layers.find(item => item.id === layer.id);
      if (!current) return false;
      const currentReference = referenceId ? canvas.layers.find(item => item.id === referenceId && item.type === 'raster') : null;
      const currentImage = currentReference?.image;
      return canvas.inpaintSourceVersion === version && canvas.canvasWidth === width && canvas.canvasHeight === height
        && current.controlnet === layer.controlnet && current.controlnet?.sourceData === source
        && JSON.stringify(current.controlnet?.sourcePlacement) === placementKey
        && current.referenceRasterId === referenceId && current.groupId === layer.groupId
        && JSON.stringify(current.modifierScope) === scope && effectiveLayerVisibility(current, canvas.groups)
        && JSON.stringify(canvas.groups.map(group => ({ id: group.id, visible: group.visible }))) === groups
        && (!referenceId || !!currentReference && canvas.paintRevision === paintRevision
          && currentImage === referenceImage && currentImage?.src === imageGeometry?.src
          && currentImage?.x === imageGeometry?.x && currentImage?.y === imageGeometry?.y
          && currentImage?.width === imageGeometry?.width && currentImage?.height === imageGeometry?.height
          && currentImage?.rotation === imageGeometry?.rotation
          && currentImage?.flipX === imageGeometry?.flipX && currentImage?.flipY === imageGeometry?.flipY
          && currentReference.opacity === referenceOpacity
          && currentReference.clippingMaskId === clippingMaskId && currentReference.clippingEnabled === clippingEnabled);
    };
    return [{ layer, source, referenceId, placement, placementKey, unchanged }];
  });
  if (!plans.length) return;
  type Plan = typeof plans[number];
  const jobs: { plan: Plan; consumers: Plan[]; filename?: string }[] = [];
  const rasters = new Map<string, typeof jobs[number]>();
  const sources = new Map<string, Map<string | undefined, typeof jobs[number]>>();
  for (const plan of plans) {
    let job = plan.referenceId ? rasters.get(plan.referenceId) : sources.get(plan.source!)?.get(plan.placementKey);
    if (!job) {
      job = { plan, consumers: [] };
      jobs.push(job);
      if (plan.referenceId) rasters.set(plan.referenceId, job);
      else {
        let placements = sources.get(plan.source!);
        if (!placements) { placements = new Map(); sources.set(plan.source!, placements); }
        placements.set(plan.placementKey, job);
      }
    }
    job.consumers.push(plan);
  }
  const assertUnchanged = () => {
    if (!plans.every(plan => plan.unchanged())) throw new Error(locale.t('generation.controlnet.reference_changed'));
  };
  let nextJob = 0;
  const worker = async () => {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob++], { plan } = job;
      assertUnchanged();
      let bytes: number[];
      if (plan.referenceId) {
        const rendered = await canvas.exportRasterLayer(plan.referenceId);
        if (!rendered) throw new Error(locale.t('canvas.missing_connection'));
        bytes = await canvasPngBytes(matteControlnetReference(rendered));
      } else {
        bytes = await documentControlnetSourceBytes(plan.source!, plan.placement, width, height);
      }
      assertUnchanged();
      const result = await uploadImageBytes(bytes, `control-${plan.layer.id}.png`);
      assertUnchanged();
      job.filename = result.name;
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(2, jobs.length) }, worker));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  assertUnchanged();
  const filenames = new Map(jobs.flatMap(job => job.consumers.map(plan => [plan.layer.id, job.filename!] as const)));
  // Session filenames are transient; no undo entry or partial update on failure.
  canvas.layers = canvas.layers.map(item => filenames.has(item.id) ? { ...item, controlnet: { ...item.controlnet!, image: filenames.get(item.id)! } } : item);
}
