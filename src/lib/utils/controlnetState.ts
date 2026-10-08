import type { ControlNetPayload } from "../types/index.js";
import type { CanvasImagePlacement } from './canvasResize.js';
export interface ControlNetState {
  controlnetEnabled: boolean;
  controlnetMode: "preset" | "custom";
  controlnetPreset: string | null;
  controlnetModel: string | null;
  controlnetPreprocessor: string | null;
  controlnetImage: string | null;
  controlnetStrength: number;
  controlnetStartPercent: number;
  controlnetEndPercent: number;
  mode: string;
  isNovelAi: boolean;
}
export function controlnetPayload(state: ControlNetState): ControlNetPayload | null {
  if (!state.controlnetEnabled || state.isNovelAi || state.mode === "video") return null;
  const text = (value: string | null) => value?.trim() || null;
  return {
    enabled: true, preset: state.controlnetMode === "preset" ? text(state.controlnetPreset) : null,
    controlnet_model: text(state.controlnetModel), preprocessor: text(state.controlnetPreprocessor),
    image: text(state.controlnetImage), strength: state.controlnetStrength,
    start_percent: state.controlnetStartPercent, end_percent: state.controlnetEndPercent,
  };
}
export function controlnetRequestKey(state: ControlNetState & { modelFamily: string }, previewOnly = false): string {
  // Inspecting a source/map does not require the modifier to participate in a run.
  return JSON.stringify([state.mode, state.modelFamily, previewOnly ? null : state.controlnetEnabled, state.controlnetMode, state.controlnetPreset, state.controlnetModel, state.controlnetImage, state.controlnetPreprocessor]);
}
export class LatestControlnetRequest {
  private revision = 0;
  begin(key: string) { return { revision: ++this.revision, key }; }
  current(request: { revision: number; key: string }, key: string) { return request.revision === this.revision && request.key === key; }
  invalidate() { this.revision++; }
}

/** A document control is independent of the generation mode's global panel. */
export interface ControlnetLayerSettings {
  enabled: boolean;
  mode: "preset" | "custom";
  preset: string | null;
  model: string | null;
  preprocessor: string | null;
  image: string | null;
  strength: number;
  startPercent: number;
  endPercent: number;
  /** Durable reference pixels travel with the project, unlike a ComfyUI filename. */
  sourceData?: string | null;
  /** Document-space placement of an imported reference, retained across canvas bounds changes. */
  sourcePlacement?: CanvasImagePlacement;
}
export function newControlnetLayer(): ControlnetLayerSettings {
  return { enabled: true, mode: "custom", preset: null, model: null, preprocessor: null,
    image: null, strength: 1, startPercent: 0, endPercent: 1 };
}
export function controlnetLayerPayloads(layers: readonly { id?: string; type: string; visible: boolean; order: number; controlnet?: ControlnetLayerSettings }[]): ControlNetPayload[] {
  return [...layers].filter(layer => layer.type === 'controlnet' && layer.visible && layer.controlnet?.enabled)
    .sort((a, b) => a.order - b.order).map(layer => {
      const c = layer.controlnet!;
      return { ...(layer.id !== undefined ? { layer_id: layer.id } : {}), enabled: true, preset: c.mode === 'preset' ? c.preset?.trim() || null : null, controlnet_model: c.model?.trim() || null,
        image: c.image?.trim() || null, preprocessor: c.preprocessor?.trim() || null,
        strength: c.strength, start_percent: c.startPercent, end_percent: c.endPercent };
    });
}

/** Model switches during input preparation must not reuse a reference for another pipeline. */
export function generationModelContextKey(state: { mode: string; checkpoint: string; modelFamily: string }): string {
  return JSON.stringify([state.mode, state.checkpoint, state.modelFamily]);
}
