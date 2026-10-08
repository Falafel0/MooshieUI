import { generation } from './generation.svelte.js';
import { canvas } from './canvas.svelte.js';
import { newControlnetLayer, type ControlnetLayerSettings } from '../utils/controlnetState.js';

const fields: Record<string, keyof ControlnetLayerSettings> = {
  controlnetEnabled: 'enabled', controlnetMode: 'mode', controlnetPreset: 'preset',
  controlnetModel: 'model', controlnetPreprocessor: 'preprocessor', controlnetImage: 'image',
  controlnetStrength: 'strength', controlnetStartPercent: 'startPercent', controlnetEndPercent: 'endPercent',
};
function selectedControl() {
  return generation.mode === 'inpainting' && canvas.activeLayer?.type === 'controlnet' ? canvas.activeLayer : null;
}
/** The editor reads the selected document control in inpainting, the global control elsewhere. */
export const controlnetEditor = new Proxy(generation, {
  get(target, property) {
    const layer = selectedControl(), key = String(property);
    if (layer && key === 'controlnetPreviewUrl') return layer.controlnetPreviewUrl ?? layer.controlnet?.sourceData ?? null;
    if (layer && key in fields) return (layer.controlnet ?? newControlnetLayer())[fields[key]];
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  },
  set(target, property, value) {
    const layer = selectedControl(), key = String(property);
    if (layer && key === 'controlnetPreviewUrl') { canvas.setControlnetPreview(layer.id, value); return true; }
    if (layer && key in fields) { canvas.updateControlnetLayer(layer.id, { [fields[key]]: value }); return true; }
    return Reflect.set(target, property, value);
  },
});
export function controlnetEditorContext(): string { return selectedControl()?.id ?? ''; }
export function setControlnetSourceData(data: string | null) {
  const layer = selectedControl();
  if (layer) canvas.updateControlnetLayer(layer.id, { sourceData: data });
}
