import type Konva from "konva";

interface HistoryEntry { layerId: string; nodes: Konva.Node[]; }
const MAX_HISTORY = 64;

class CanvasHistoryStore {
  undoStack = $state.raw<HistoryEntry[][]>([]);
  redoStack = $state.raw<HistoryEntry[][]>([]);
  private layers: Map<string, Konva.Layer> | null = null;
  private onRestored: ((layerIds: string[]) => void) | null = null;

  setRefs(layers: Map<string, Konva.Layer>, _width: number, _height: number) { this.layers = layers; }
  setOnRestored(callback: ((layerIds: string[]) => void) | null) { this.onRestored = callback; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private capture(ids: string[]): HistoryEntry[] {
    return ids.flatMap((id) => {
      const layer = this.layers?.get(id);
      return layer ? [{ layerId: id, nodes: layer.getChildren().map((node) => node.clone()) }] : [];
    });
  }
  private dispose(entries: HistoryEntry[][]) {
    for (const batch of entries) for (const entry of batch) for (const node of entry.nodes) node.destroy();
  }
  private append(stack: HistoryEntry[][], entries: HistoryEntry[]) {
    if (stack.length >= MAX_HISTORY) this.dispose(stack.slice(0, 1));
    return [...stack.slice(-(MAX_HISTORY - 1)), entries];
  }
  snapshotLayers(ids: string[]) {
    const entries = this.capture(ids);
    if (!entries.length) return;
    this.undoStack = this.append(this.undoStack, entries);
    this.dispose(this.redoStack);
    this.redoStack = [];
  }
  snapshot(id: string) { this.snapshotLayers([id]); }
  private restore(entries: HistoryEntry[]) {
    const restored: string[] = [];
    for (const entry of entries) {
      const layer = this.layers?.get(entry.layerId);
      if (!layer) continue;
      layer.destroyChildren();
      for (const node of entry.nodes) layer.add(node.clone());
      layer.batchDraw();
      restored.push(entry.layerId);
    }
    this.onRestored?.(restored);
    this.dispose([entries]);
  }
  undo() {
    if (!this.canUndo) return;
    const entries = this.undoStack[this.undoStack.length - 1];
    this.redoStack = this.append(this.redoStack, this.capture(entries.map((entry) => entry.layerId)));
    this.undoStack = this.undoStack.slice(0, -1);
    this.restore(entries);
  }
  redo() {
    if (!this.canRedo) return;
    const entries = this.redoStack[this.redoStack.length - 1];
    this.undoStack = this.append(this.undoStack, this.capture(entries.map((entry) => entry.layerId)));
    this.redoStack = this.redoStack.slice(0, -1);
    this.restore(entries);
  }
  clear() {
    this.dispose(this.undoStack); this.dispose(this.redoStack);
    this.undoStack = []; this.redoStack = [];
  }
}
export const canvasHistory = new CanvasHistoryStore();
