import Konva from "konva";
import type { CanvasLayer } from "./canvas.svelte.js";
import type { LayerGroup } from "../utils/layerRelations.js";
import type { CanvasImagePlacement } from '../utils/canvasResize.js';
import { copyInpaintLayerSnapshot } from '../utils/inpaintLayerSnapshot.js';

export interface CanvasDocumentGeometry {
  width: number;
  height: number;
  boundingBox: { x: number; y: number; width: number; height: number; locked: boolean };
  baseImagePlacement: { source: string; rect: CanvasImagePlacement } | null;
}

interface HistoryLayerEntry {
  layerId: string;
  nodes: Konva.Node[];
  layer?: Konva.Layer;
}
interface DocumentState {
  layers: CanvasLayer[];
  activeLayerId: string | null;
  /** Optional to preserve callers written before organizational groups. */
  groups?: LayerGroup[];
  activeGroupId?: string | null;
  geometry?: CanvasDocumentGeometry;
}
interface HistoryEntry {
  layers: HistoryLayerEntry[];
  document?: DocumentState;
}
const MAX_HISTORY = 64;

class CanvasHistoryStore {
  undoStack = $state.raw<HistoryEntry[]>([]);
  redoStack = $state.raw<HistoryEntry[]>([]);
  private layers: Map<string, Konva.Layer> | null = null;
  private onRestored: ((layerIds: string[]) => void) | null = null;
  private onDocumentRestored: ((layers: CanvasLayer[], activeLayerId: string | null, groups: LayerGroup[], activeGroupId: string | null, geometry?: CanvasDocumentGeometry) => void) | null = null;
  private getDocumentState: (() => DocumentState) | null = null;

  setRefs(layers: Map<string, Konva.Layer>, _width: number, _height: number) { this.layers = layers; }
  setOnRestored(callback: ((layerIds: string[]) => void) | null) { this.onRestored = callback; }
  setOnDocumentRestored(callback: ((layers: CanvasLayer[], activeLayerId: string | null, groups: LayerGroup[], activeGroupId: string | null, geometry?: CanvasDocumentGeometry) => void) | null) {
    this.onDocumentRestored = callback;
  }
  setDocumentStateProvider(provider: (() => DocumentState) | null) { this.getDocumentState = provider; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private clonePixelLayer(layer: Konva.Layer): Konva.Layer {
    const clone = layer.clone();
    // This destination-in image is derived from clipping metadata and rebuilt
    // by the renderer. Keeping it as pixel content would bake clipping into
    // undo snapshots and make later unlinking lose the original raster pixels.
    for (const node of clone.getChildren()) if (node.hasName("raster-clip-mask")) node.destroy();
    return clone;
  }

  private capture(ids: string[]): HistoryLayerEntry[] {
    return ids.flatMap((id) => {
      const layer = this.layers?.get(id);
      return layer ? [{ layerId: id, nodes: layer.getChildren().filter(node => !node.hasName("raster-clip-mask")).map((node) => node.clone()) }] : [];
    });
  }
  private captureDocument(state: DocumentState, layerIds: string[] = []): HistoryEntry {
    // Layer metadata only contains plain serializable values. Copy it so later
    // mutations cannot change the state held by the history entry. Pixel trees
    // are copied only for layers that are about to be removed/replaced.
    const metadata = copyInpaintLayerSnapshot(state.layers.map(({ controlnetPreviewUrl: _preview, ...layer }) => layer), state.groups ?? []);
    const layersToCopy = new Set(layerIds);
    return {
      document: { layers: metadata.layers, activeLayerId: state.activeLayerId,
        groups: metadata.groups, activeGroupId: state.activeGroupId ?? null,
        ...(state.geometry ? { geometry: { ...state.geometry, boundingBox: { ...state.geometry.boundingBox },
          baseImagePlacement: state.geometry.baseImagePlacement ? { ...state.geometry.baseImagePlacement, rect: { ...state.geometry.baseImagePlacement.rect } } : null } } : {}) },
      layers: state.layers.flatMap((meta) => {
        const layer = this.layers?.get(meta.id);
        return layersToCopy.has(meta.id) && layer
          ? [{ layerId: meta.id, nodes: [], layer: this.clonePixelLayer(layer) }]
          : [];
      }),
    };
  }
  private dispose(entries: HistoryEntry[]) {
    for (const entry of entries) for (const layerEntry of entry.layers) {
      for (const node of layerEntry.nodes) node.destroy();
      layerEntry.layer?.destroy();
    }
  }
  private append(stack: HistoryEntry[], entry: HistoryEntry) {
    if (stack.length >= MAX_HISTORY) this.dispose(stack.slice(0, 1));
    return [...stack.slice(-(MAX_HISTORY - 1)), entry];
  }
  snapshotLayers(ids: string[]) {
    const layers = this.capture(ids);
    if (!layers.length) return;
    this.undoStack = this.append(this.undoStack, { layers });
    this.dispose(this.redoStack);
    this.redoStack = [];
  }
  snapshot(id: string) { this.snapshotLayers([id]); }
  snapshotDocument(layers: CanvasLayer[], activeLayerId: string | null, layerIdsToCopy: string[] = []) {
    // Existing layer-only callers still capture the complete document context
    // supplied by the store, before the action mutates groups or bindings.
    const context = this.getDocumentState?.();
    const entry = this.captureDocument({ ...context, layers, activeLayerId }, layerIdsToCopy);
    this.undoStack = this.append(this.undoStack, entry);
    this.dispose(this.redoStack);
    this.redoStack = [];
    return entry;
  }
  /** Restore a failed document operation without offering its partial result as redo. */
  rollbackDocumentSnapshot(entry: HistoryEntry) {
    if (this.undoStack.at(-1) !== entry) return;
    this.undoStack = this.undoStack.slice(0, -1);
    this.restore(entry);
  }
  private restore(entry: HistoryEntry) {
    if (entry.document) {
      this.restoreDocument(entry);
      return;
    }
    const restored: string[] = [];
    for (const layerEntry of entry.layers) {
      const layer = this.layers?.get(layerEntry.layerId);
      if (!layer) continue;
      layer.destroyChildren();
      for (const node of layerEntry.nodes) layer.add(node.clone());
      layer.batchDraw();
      restored.push(layerEntry.layerId);
    }
    this.onRestored?.(restored);
    this.dispose([entry]);
  }
  private restoreDocument(entry: HistoryEntry) {
    const document = entry.document!;
    const entriesById = new Map(entry.layers.map((layer) => [layer.layerId, layer]));
    const targetIds = new Set(document.layers.map((layer) => layer.id));
    const liveLayers = this.layers;
    const stage = liveLayers
      ? [...liveLayers.values()].map((layer) => layer.getStage()).find((candidate): candidate is Konva.Stage => candidate !== null)
      : undefined;
    const restored: string[] = [];

    if (liveLayers) {
      for (const [id, layer] of [...liveLayers]) {
        if (!targetIds.has(id)) {
          layer.destroy();
          liveLayers.delete(id);
        }
      }
      for (const meta of document.layers) {
        if (meta.type === "controlnet") continue;
        const current = liveLayers.get(meta.id);
        const saved = entriesById.get(meta.id)?.layer;
        if (!current || saved) {
          if (current) current.destroy();
          const restoredLayer = saved?.clone() ?? new Konva.Layer({ id: meta.id });
          restoredLayer.id(meta.id);
          if (stage) stage.add(restoredLayer);
          liveLayers.set(meta.id, restoredLayer);
        }
        restored.push(meta.id);
      }
    }

    this.onDocumentRestored?.(document.layers, document.activeLayerId, document.groups ?? [], document.activeGroupId ?? null, document.geometry);
    this.onRestored?.(restored);
    this.dispose([entry]);
  }
  private captureInverse(entry: HistoryEntry): HistoryEntry {
    if (entry.document) {
      const state = this.getDocumentState?.() ?? entry.document;
      const targetIds = new Set(entry.document.layers.map((layer) => layer.id));
      const idsRemovedByRestore = state.layers.filter((layer) => !targetIds.has(layer.id)).map((layer) => layer.id);
      // A document resize snapshots surviving layers too: redo needs their
      // transformed pixels, not just metadata or layers removed by undo.
      return this.captureDocument(state, [...new Set([...idsRemovedByRestore, ...entry.layers.map(layer => layer.layerId)])]);
    }
    return { layers: this.capture(entry.layers.map((layer) => layer.layerId)) };
  }
  undo() {
    if (!this.canUndo) return;
    const entry = this.undoStack[this.undoStack.length - 1];
    this.redoStack = this.append(this.redoStack, this.captureInverse(entry));
    this.undoStack = this.undoStack.slice(0, -1);
    this.restore(entry);
  }
  redo() {
    if (!this.canRedo) return;
    const entry = this.redoStack[this.redoStack.length - 1];
    this.undoStack = this.append(this.undoStack, this.captureInverse(entry));
    this.redoStack = this.redoStack.slice(0, -1);
    this.restore(entry);
  }
  clear() {
    this.dispose(this.undoStack);
    this.dispose(this.redoStack);
    this.undoStack = [];
    this.redoStack = [];
  }
}

export const canvasHistory = new CanvasHistoryStore();
