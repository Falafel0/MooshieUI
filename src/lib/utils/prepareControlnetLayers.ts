import { canvas } from '../stores/canvas.svelte.js';
import { uploadImageBytes } from './api.js';
/** Restore a project's control pixels into the current ComfyUI session before submitting. */
export async function prepareControlnetLayers() {
  const controls = canvas.layers.filter(layer => layer.type === 'controlnet' && layer.visible && layer.controlnet?.enabled);
  for (const layer of controls) {
    const source = layer.controlnet?.sourceData;
    if (!source) continue; // Legacy filenames remain usable in their existing ComfyUI session.
    const response = await fetch(source);
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
    const result = await uploadImageBytes(bytes, `control-${layer.id}.png`);
    const current = canvas.layers.find(item => item.id === layer.id);
    if (!current || current.controlnet?.sourceData !== source) throw new Error('ControlNet reference changed during preparation');
    // Transient server filenames do not create an undo step.
    canvas.layers = canvas.layers.map(item => item.id === layer.id ? { ...item, controlnet: { ...item.controlnet!, image: result.name } } : item);
  }
}
