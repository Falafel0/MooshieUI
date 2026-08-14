import Konva from "konva";

interface HistoryEntry {
  layerId: string;
  imageData: string; // base64 data URL from layer.toDataURL()
}

const MAX_HISTORY = 64;

class CanvasHistoryStore {
  undoStack = $state<HistoryEntry[][]>([]);
  redoStack = $state<HistoryEntry[][]>([]);

  private _konvaLayers: Map<string, Konva.Layer> | null = null;
  private _canvasWidth = 0;
  private _canvasHeight = 0;
  private _onRestored: ((layerIds: string[]) => void) | null = null;

  setRefs(konvaLayers: Map<string, Konva.Layer>, canvasWidth: number, canvasHeight: number) {
    this._konvaLayers = konvaLayers;
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
  }

  // Called after undo/redo finishes restoring layers (async image load), so the
  // consumer can regenerate anything derived from layer pixels (e.g. thumbnails).
  setOnRestored(cb: ((layerIds: string[]) => void) | null) {
    this._onRestored = cb;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // Snapshot specific layers before a destructive operation
  snapshotLayers(layerIds: string[]) {
    if (!this._konvaLayers) return;

    const entries: HistoryEntry[] = [];
    for (const id of layerIds) {
      const kLayer = this._konvaLayers.get(id);
      if (!kLayer) continue;

      const dataUrl = this._captureLayer(kLayer);
      entries.push({ layerId: id, imageData: dataUrl });
    }

    if (entries.length > 0) {
      this.undoStack = [...this.undoStack.slice(-(MAX_HISTORY - 1)), entries];
      // Clear redo when a new action is taken
      this.redoStack = [];
    }
  }

  // Snapshot a single layer (convenience)
  snapshot(layerId: string) {
    this.snapshotLayers([layerId]);
  }

  // Capture a layer as a data URL, forcing it visible during capture so a hidden
  // mask layer (e.g. while an inpaint result is being previewed) still yields
  // pixels instead of a transparent/empty frame. Restores transform + visibility.
  private _captureLayer(kLayer: Konva.Layer): string {
    const origScaleX = kLayer.scaleX();
    const origScaleY = kLayer.scaleY();
    const origX = kLayer.x();
    const origY = kLayer.y();
    const origVisible = kLayer.visible();
    kLayer.scaleX(1);
    kLayer.scaleY(1);
    kLayer.x(0);
    kLayer.y(0);
    kLayer.visible(true);
    try {
      return kLayer.toDataURL({
        pixelRatio: 1,
        width: this._canvasWidth,
        height: this._canvasHeight,
      });
    } finally {
      kLayer.scaleX(origScaleX);
      kLayer.scaleY(origScaleY);
      kLayer.x(origX);
      kLayer.y(origY);
      kLayer.visible(origVisible);
    }
  }

  async undo() {
    if (!this.canUndo || !this._konvaLayers) return;

    const entries = this.undoStack[this.undoStack.length - 1];

    // Before restoring, snapshot current state for redo
    const redoEntries: HistoryEntry[] = [];
    for (const entry of entries) {
      const kLayer = this._konvaLayers.get(entry.layerId);
      if (!kLayer) continue;

      const dataUrl = this._captureLayer(kLayer);
      redoEntries.push({ layerId: entry.layerId, imageData: dataUrl });
    }

    this.redoStack = [...this.redoStack.slice(-(MAX_HISTORY - 1)), redoEntries];
    this.undoStack = this.undoStack.slice(0, -1);

    // Restore layers from snapshot
    await this._restoreEntries(entries);
  }

  async redo() {
    if (!this.canRedo || !this._konvaLayers) return;

    const entries = this.redoStack[this.redoStack.length - 1];

    // Before restoring, snapshot current state for undo
    const undoEntries: HistoryEntry[] = [];
    for (const entry of entries) {
      const kLayer = this._konvaLayers.get(entry.layerId);
      if (!kLayer) continue;

      const dataUrl = this._captureLayer(kLayer);
      undoEntries.push({ layerId: entry.layerId, imageData: dataUrl });
    }

    this.undoStack = [...this.undoStack.slice(-(MAX_HISTORY - 1)), undoEntries];
    this.redoStack = this.redoStack.slice(0, -1);

    await this._restoreEntries(entries);
  }

  private async _restoreEntries(entries: HistoryEntry[]) {
    if (!this._konvaLayers) return;

    const restoredIds: string[] = [];
    for (const entry of entries) {
      const kLayer = this._konvaLayers.get(entry.layerId);
      if (!kLayer) continue;

      // Clear the layer
      kLayer.destroyChildren();

      let img: HTMLImageElement;
      try {
        img = await this._loadImage(entry.imageData);
      } catch (error) {
        console.error("Failed to load history snapshot:", error);
        continue;
      }

      // The layer may have been removed or rebuilt while the image loaded.
      const cur = this._konvaLayers.get(entry.layerId);
      if (!cur || cur !== kLayer) continue;

      const kImage = new Konva.Image({
        image: img,
        x: 0,
        y: 0,
        width: this._canvasWidth,
        height: this._canvasHeight,
        listening: false,
      });
      kLayer.add(kImage);
      kLayer.batchDraw();
      restoredIds.push(entry.layerId);
    }

    this._onRestored?.(restoredIds);
  }

  private _loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

export const canvasHistory = new CanvasHistoryStore();
