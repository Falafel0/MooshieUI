import Konva from "konva";
import { uploadImageBytes } from "../utils/api.js";
import { generation } from "./generation.svelte.js";
import { locale } from "./locale.svelte.js";
import type { RegionalPromptSelection } from "../types/index.js";
import { captureLayer, maskToGrayscale } from "../utils/canvasLayerExport.js";
import type { InpaintSettings } from "../utils/inpaintSettings.js";
import { InpaintResultRegistry, type InpaintResultSnapshot } from "../utils/inpaintResultRegistry.js";
import { processMaskCoverage } from "../utils/maskProcessing.js";
import { canvasHistory } from "./canvasHistory.svelte.js";

export type ToolType = "brush" | "eraser" | "rectFill" | "ellipseFill" | "lasso" | "eyedropper" | "move" | "view" | "transform" | "canvasResize";
export type CanvasLayerType = "raster" | "mask" | "region";

export function isMaskLayer(layer: Pick<CanvasLayer, "type"> | null | undefined): boolean {
  return layer?.type === "mask" || layer?.type === "region";
}

export interface CanvasLayer {
  id: string;
  name: string;
  type: CanvasLayerType;
  visible: boolean;
  opacity: number;
  locked: boolean;
  /** Whether generation-context guides are shown when this layer is selected. */
  showContext?: boolean;
  order: number;
  regionalPrompt?: string;
  regionalNegativePrompt?: string;
  regionalStrength?: number;
  positivePrompt?: string;
  negativePrompt?: string;
  denoise?: number;
  maskGrow?: number;
  inpaintWidth?: number;
  inpaintHeight?: number;
  inpaintAspectLocked?: boolean;
  initialRegion?: RegionalPromptSelection;
  inpaintSettings?: InpaintSettings;
  image?: { src: string; x: number; y: number; width: number; height: number; rotation: number; flipX: boolean; flipY: boolean };
}

export interface BrushSettings {
  size: number;
  opacity: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  locked: boolean;
}

export interface CanvasStagingEntry {
  url: string;
  owned: boolean;
}

export interface SpatialLayerSnapshot {
  id: string;
  type: "mask" | "region";
  visible: boolean;
  opacity: number;
  contentUrl: string | null;
}

export interface InpaintBaseSnapshot {
  previewUrl: string | null;
  uploadedInputName: string | null;
  width: number;
  height: number;
  spatialLayers: SpatialLayerSnapshot[];
  rasterVisibility?: Record<string, boolean>;
  owned: boolean;
}

export interface CanvasViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface TransformState {
  isMoving: boolean;
  targetLayerId: string | null;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
}

let nextLayerId = 0;
function genLayerId(): string {
  return `layer_${++nextLayerId}`;
}

class CanvasStore {
  // Tool state
  activeTool = $state<ToolType>("brush");
  previousTool = $state<ToolType | null>(null);
  brushSettings = $state<BrushSettings>({ size: 20, opacity: 1 });
  foregroundColor = $state("#ffffff");
  backgroundColor = $state("#000000");

  // Layers
  layers = $state<CanvasLayer[]>([]);
  activeLayerId = $state<string | null>(null);
  baseColor = $state("#808080");
  selectedWorkspaceSection = $state<"base" | "layers" | "control">("layers");
  lastSubmittedMaskUrl: string | null = null;
  lastSubmittedRasterLayerIds: string[] = [];
  private detachedLayers = new Map<string, any>();

  retainLayerNodes() {
    for (const node of this.detachedLayers.values()) node.destroy();
    this.detachedLayers.clear();
    for (const node of this._stageRef?.getLayers() ?? []) {
      if (this.layers.some((layer) => layer.id === node.id())) this.detachedLayers.set(node.id(), node.clone());
    }
    this._stageRef = null;
  }

  takeLayerNode(id: string): any {
    const node = this.detachedLayers.get(id);
    this.detachedLayers.delete(id);
    return node;
  }

  // Per-layer pixel thumbnails (data URLs), keyed by layer id
  layerThumbnails = $state<Record<string, string>>({});

  // Canvas document dimensions
  canvasWidth = $state(1024);
  canvasHeight = $state(1024);

  // Viewport
  viewport = $state<CanvasViewport>({ zoom: 1, panX: 0, panY: 0 });
  viewportInitialized = $state(false);
  viewportWidth = $state(0);
  viewportHeight = $state(0);

  // Bounding box (generation region)
  boundingBox = $state<BoundingBox>({ x: 0, y: 0, width: 1024, height: 1024, locked: false });

  // Mask overlay
  maskOverlayColor = $state("#ff3333");
  maskOverlayOpacity = $state(0.45);
  maskOverlayVisible = $state(true);
  showLayerContext = $state(true);
  controlContextPreviewUrl = $state<string | null>(null);

  // UI state
  isCanvasMode = $state(false);
  isPointerOverStage = $state(false);
  inpaintDrawMode = $state<"mask" | "regular">("regular");
  showGrid = $state(false);
  showRuleOfThirds = $state(false);
  showCheckerboard = $state(true);
  cursorPos = $state<{ x: number; y: number } | null>(null);
  referenceImageUrl = $state<string | null>(null);
  originalInpaintInputImageName = $state<string | null>(null);
  originalInpaintWidth = $state<number | null>(null);
  originalInpaintHeight = $state<number | null>(null);
  preparedInpaintPreviewUrl = $state<string | null>(null);
  preparedInpaintOwned = $state(false);
  inpaintSourceVersion = $state(0);
  persistedMaskPreviewUrl = $state<string | null>(null);
  // Base-image undo history for iterative inpainting. Each entry keeps the base
  // plus every editable mask/region independently, so undo never flattens the
  // layer stack into a single destructive mask.
  inpaintBaseHistory = $state<InpaintBaseSnapshot[]>([]);
  // Per-layer pixels waiting to be re-hydrated after an inpaint-base undo.
  // CanvasStage consumes this in one pass after dimensions/layers are synced.
  pendingSpatialLayerRestore = $state<SpatialLayerSnapshot[] | null>(null);
  // The latest inpaint result, held for DISPLAY ONLY. Pressing "Generate" always
  // re-rolls the current base + mask (never this result); it is only shown as the
  // canvas background so the user can preview it. "Apply" promotes it to the base.
  pendingResultPreviewUrl = $state<string | null>(null);
  pendingResultOwned = $state(false);
  pendingResultInputName = $state<string | null>(null);
  pendingResultWidth = $state<number | null>(null);
  pendingResultHeight = $state<number | null>(null);
  pendingResultMaskUrl = $state<string | null>(null);
  pendingResultSourceKey = $state<string | null>(null);
  pendingResultRasterLayerIds: string[] = [];
  insertingResult = $state(false);
  private inpaintResults = new InpaintResultRegistry();
  private completedInpaintResults = new Map<string, { maskUrl: string | null; rasterLayerIds: string[] }>();

  // Staging
  stagingImages = $state<CanvasStagingEntry[]>([]);
  stagingIndex = $state(0);
  isStagingActive = $state(false);

  // Move/transform
  transform = $state<TransformState>({
    isMoving: false,
    targetLayerId: null,
    startX: 0,
    startY: 0,
    deltaX: 0,
    deltaY: 0,
  });

  // Reference to the Konva stage (set by CanvasStage)
  private _stageRef: any = null;

  setStageRef(stage: any) {
    this._stageRef = stage;
  }

  getStageRef(): any {
    return this._stageRef;
  }

  // Derived
  get activeLayer(): CanvasLayer | null {
    return this.layers.find((l) => l.id === this.activeLayerId) ?? null;
  }

  get visibleLayers(): CanvasLayer[] {
    return this.layers.filter((l) => l.visible).sort((a, b) => a.order - b.order);
  }

  get sortedLayers(): CanvasLayer[] {
    const rank = (layer: CanvasLayer) => layer.type === 'raster' ? 0 : layer.type === 'region' ? 2 : 1;
    return [...this.layers].sort((a, b) => rank(b) - rank(a) || b.order - a.order);
  }

  get zoomPercent(): number {
    return Math.round(this.viewport.zoom * 100);
  }

  // Colors
  swapColors() {
    const tmp = this.foregroundColor;
    this.foregroundColor = this.backgroundColor;
    this.backgroundColor = tmp;
  }

  resetColors() {
    this.foregroundColor = "#ffffff";
    this.backgroundColor = "#000000";
  }

  // Tools
  setTool(tool: ToolType) {
    if (tool !== this.activeTool) {
      this.previousTool = this.activeTool;
      this.activeTool = tool;
    }
  }

  restorePreviousTool() {
    if (this.previousTool) {
      this.activeTool = this.previousTool;
      this.previousTool = null;
    }
  }

  beginMove(layerId: string, startX: number, startY: number) {
    this.transform = {
      isMoving: true,
      targetLayerId: layerId,
      startX,
      startY,
      deltaX: 0,
      deltaY: 0,
    };
  }

  updateMove(currentX: number, currentY: number) {
    if (!this.transform.isMoving) return;
    this.transform = {
      ...this.transform,
      deltaX: currentX - this.transform.startX,
      deltaY: currentY - this.transform.startY,
    };
  }

  endMove() {
    this.transform = {
      isMoving: false,
      targetLayerId: null,
      startX: 0,
      startY: 0,
      deltaX: 0,
      deltaY: 0,
    };
  }

  private revokeOwnedUrls(urls: string[]) {
    const seen = new Set<string>();
    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      URL.revokeObjectURL(url);
    }
  }

  private clearPreparedInpaintOverride() {
    if (this.preparedInpaintOwned && this.preparedInpaintPreviewUrl) {
      URL.revokeObjectURL(this.preparedInpaintPreviewUrl);
    }
    this.preparedInpaintPreviewUrl = null;
    this.preparedInpaintOwned = false;
  }

  // Discard the display-only pending inpaint result, revoking its owned URL.
  private clearPendingInpaintResult() {
    if (this.pendingResultOwned && this.pendingResultPreviewUrl) {
      URL.revokeObjectURL(this.pendingResultPreviewUrl);
    }
    this.pendingResultPreviewUrl = null;
    this.pendingResultOwned = false;
    this.pendingResultInputName = null;
    this.pendingResultWidth = null;
    this.pendingResultHeight = null;
    this.pendingResultMaskUrl = null;
    this.pendingResultSourceKey = null;
    this.pendingResultRasterLayerIds = [];
  }

  dismissInpaintResult() {
    this.clearPendingInpaintResult();
  }

  setInpaintOriginalSource(source: {
    previewUrl: string;
    width: number;
    height: number;
    uploadedInputName: string | null;
  } | null) {
    this.clearPreparedInpaintOverride();
    this.clearPendingInpaintResult();
    this.clearInpaintBaseHistory();
    this.completedInpaintResults.clear();
    this.inpaintSourceVersion += 1;
    this.invalidateInpaintPrompts();

    if (!source) {
      this.originalInpaintInputImageName = null;
      this.originalInpaintWidth = null;
      this.originalInpaintHeight = null;
      this.referenceImageUrl = null;
      return;
    }

    this.referenceImageUrl = source.previewUrl;
    this.originalInpaintInputImageName = source.uploadedInputName;
    this.originalInpaintWidth = source.width;
    this.originalInpaintHeight = source.height;
    generation.inputImage = source.uploadedInputName;
    generation.width = source.width;
    generation.height = source.height;
    if (this.layers.length === 0) this.initCanvas(source.width, source.height);
    else this.resizeCanvas(source.width, source.height);
  }

  setPreparedInpaintOverride(source: {
    previewUrl: string;
    width: number;
    height: number;
    uploadedInputName: string | null;
    owned: boolean;
  }) {
    // Swapping to an explicit new base discards any display-only pending result.
    this.clearPendingInpaintResult();
    // Snapshot the outgoing base and the mask applied to it so the user can undo
    // back to it, and so the same mask can be re-hydrated onto the incoming
    // result (letting "Generate" re-roll the same region without repainting).
    const spatialLayers = this.snapshotSpatialLayers();
    this.inpaintBaseHistory = [
      ...this.inpaintBaseHistory,
      {
        previewUrl: this.preparedInpaintPreviewUrl ?? this.referenceImageUrl,
        uploadedInputName: generation.inputImage,
        width: generation.width,
        height: generation.height,
        spatialLayers,
        // Only a prepared preview is an owned object URL; the session-original
        // referenceImageUrl is owned elsewhere and must not be revoked here.
        owned: this.preparedInpaintPreviewUrl ? this.preparedInpaintOwned : false,
      },
    ];

    // Swap in the new base. Do NOT revoke the outgoing prepared URL: the history
    // entry above now owns it.
    this.preparedInpaintPreviewUrl = source.previewUrl;
    this.preparedInpaintOwned = source.owned;
    generation.inputImage = source.uploadedInputName;
    generation.width = source.width;
    generation.height = source.height;

    // Keep the document layer stack intact. A base swap is independent from
    // masks, regions and raster layers, just like replacing a Photoshop base.
    this.persistedMaskPreviewUrl = null;
    this.resizeCanvas(source.width, source.height);
    this.inpaintSourceVersion += 1;
    this.invalidateInpaintPrompts();
  }

  // Called on inpaint completion. Holds the result for DISPLAY ONLY: it becomes
  // the canvas background so the user can preview it, but the generation base
  // (generation.inputImage) and the editable mask are left untouched, so the next
  // "Generate" re-rolls the ORIGINAL base + mask instead of iterating on the
  // result. Promoting the result to the base is an explicit "Apply" action.
  setPendingInpaintResult(source: {
    previewUrl: string;
    width: number;
    height: number;
    uploadedInputName: string | null;
    owned: boolean;
    maskUrl?: string | null;
    sourceKey?: string | null;
    rasterLayerIds?: string[];
  }) {
    // A superseded re-roll: revoke the previous pending preview before replacing.
    this.clearPendingInpaintResult();
    this.pendingResultPreviewUrl = source.previewUrl;
    this.pendingResultOwned = source.owned;
    this.pendingResultInputName = source.uploadedInputName;
    this.pendingResultWidth = source.width;
    this.pendingResultHeight = source.height;
    this.pendingResultMaskUrl = source.maskUrl ?? null;
    this.pendingResultSourceKey = source.sourceKey ?? null;
    this.pendingResultRasterLayerIds = source.rasterLayerIds ?? [];
    if (source.sourceKey) {
      this.completedInpaintResults.delete(source.sourceKey);
      this.completedInpaintResults.set(source.sourceKey, {
        maskUrl: source.maskUrl ?? null,
        rasterLayerIds: [...(source.rasterLayerIds ?? [])],
      });
      // Keep the session cache bounded while retaining insertion data for the
      // most recent result thumbnails.
      while (this.completedInpaintResults.size > 64) {
        const oldest = this.completedInpaintResults.keys().next().value;
        if (oldest === undefined) break;
        this.completedInpaintResults.delete(oldest);
      }
    }
  }

  getCompletedInpaintResult(sourceKey: string) {
    const snapshot = this.completedInpaintResults.get(sourceKey);
    return snapshot ? { maskUrl: snapshot.maskUrl, rasterLayerIds: [...snapshot.rasterLayerIds] } : null;
  }

  // Promote the pending inpaint result to be the new base: checkpoint the current
  // base + its mask for undo, then adopt the result as the base. Editable masks
  // and regions stay in the layer stack for another pass. Ownership of the pending preview URL transfers to the prepared
  // override (so it is NOT revoked here).
  applyInpaintResult() {
    if (!this.pendingResultPreviewUrl || this.pendingResultWidth == null || this.pendingResultHeight == null) {
      return;
    }

    const bakedLayers = new Set(this.pendingResultRasterLayerIds);
    const rasterVisibility = Object.fromEntries(this.layers.filter(layer => bakedLayers.has(layer.id)).map(layer => [layer.id, layer.visible]));
    const spatialLayers = this.snapshotSpatialLayers();
    this.inpaintBaseHistory = [
      ...this.inpaintBaseHistory,
      {
        previewUrl: this.preparedInpaintPreviewUrl ?? this.referenceImageUrl,
        uploadedInputName: generation.inputImage,
        width: generation.width,
        height: generation.height,
        spatialLayers,
        rasterVisibility,
        // Only a prepared preview is an owned object URL; the session-original
        // referenceImageUrl is owned elsewhere and must not be revoked here.
        owned: this.preparedInpaintPreviewUrl ? this.preparedInpaintOwned : false,
      },
    ];

    // Transfer the pending result into the prepared override. Do NOT revoke the
    // pending URL: the prepared override now owns it. Do NOT revoke the outgoing
    // prepared URL either: the history entry above now owns it.
    this.preparedInpaintPreviewUrl = this.pendingResultPreviewUrl;
    this.preparedInpaintOwned = this.pendingResultOwned;
    generation.inputImage = this.pendingResultInputName;
    generation.width = this.pendingResultWidth;
    generation.height = this.pendingResultHeight;

    // Clear pending WITHOUT revoking (ownership was transferred above).
    this.pendingResultPreviewUrl = null;
    this.pendingResultOwned = false;
    this.pendingResultInputName = null;
    this.pendingResultWidth = null;
    this.pendingResultHeight = null;
    this.pendingResultMaskUrl = null;
    this.pendingResultSourceKey = null;
    this.pendingResultRasterLayerIds = [];
    // These pixels are already in the generated base. Keep the editable layers
    // available, but hide them to avoid applying their opacity a second time.
    this.layers = this.layers.map(layer => bakedLayers.has(layer.id) ? { ...layer, visible: false } : layer);

    // Applying a base never removes layer objects. The same mask/region can be
    // refined or disabled explicitly after inspecting the result.
    this.persistedMaskPreviewUrl = null;
    this.resizeCanvas(generation.width, generation.height);
    this.inpaintSourceVersion += 1;
    this.invalidateInpaintPrompts();
  }

  get canApplyInpaintResult(): boolean {
    return generation.mode === "inpainting" && this.pendingResultPreviewUrl !== null;
  }

  restoreOriginalInpaintSource() {
    if (!this.originalInpaintInputImageName || this.originalInpaintWidth == null || this.originalInpaintHeight == null) {
      // A Photopea/base import may start from an empty document. In that case
      // "restore original" means returning to the blank base, not doing nothing.
      this.clearPreparedInpaintOverride();
      this.clearPendingInpaintResult();
      this.clearInpaintBaseHistory();
      generation.inputImage = null;
      this.inpaintSourceVersion += 1;
      this.invalidateInpaintPrompts();
      return;
    }
    this.clearPreparedInpaintOverride();
    this.clearPendingInpaintResult();
    this.clearInpaintBaseHistory();
    generation.inputImage = this.originalInpaintInputImageName;
    generation.width = this.originalInpaintWidth;
    generation.height = this.originalInpaintHeight;
    this.resizeCanvas(this.originalInpaintWidth, this.originalInpaintHeight);
    this.inpaintSourceVersion += 1;
    this.invalidateInpaintPrompts();
  }

  clearInpaintSession() {
    this.clearMask();
    this.clearPreparedInpaintOverride();
    this.clearPendingInpaintResult();
    this.clearInpaintBaseHistory();
    this.completedInpaintResults.clear();
    this.inpaintSourceVersion += 1;
    this.invalidateInpaintPrompts();
    this.originalInpaintInputImageName = null;
    this.originalInpaintWidth = null;
    this.originalInpaintHeight = null;
    this.referenceImageUrl = null;
  }

  private clearInpaintBaseHistory() {
    for (const entry of this.inpaintBaseHistory) {
      if (entry.owned && entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    }
    this.inpaintBaseHistory = [];
    this.pendingSpatialLayerRestore = null;
  }

  // Step the inpaint base back to the previous image while preserving the
  // editable layer stack. The current prepared preview is revoked.
  undoInpaintBase() {
    if (!this.inpaintBaseHistory.length) return;

    // Stepping back discards any un-applied result being previewed.
    this.clearPendingInpaintResult();

    const entry = this.inpaintBaseHistory[this.inpaintBaseHistory.length - 1];
    this.inpaintBaseHistory = this.inpaintBaseHistory.slice(0, -1);

    // Discard the base we're leaving (the current prepared override, if any).
    if (this.preparedInpaintOwned && this.preparedInpaintPreviewUrl) {
      URL.revokeObjectURL(this.preparedInpaintPreviewUrl);
    }

    if (entry.previewUrl && entry.previewUrl === this.referenceImageUrl) {
      // Stepping back to the session original: no prepared override.
      this.preparedInpaintPreviewUrl = null;
      this.preparedInpaintOwned = false;
    } else {
      this.preparedInpaintPreviewUrl = entry.previewUrl;
      this.preparedInpaintOwned = entry.owned;
    }

    generation.inputImage = entry.uploadedInputName;
    if (entry.rasterVisibility) {
      this.layers = this.layers.map(layer => layer.id in entry.rasterVisibility!
        ? { ...layer, visible: entry.rasterVisibility![layer.id] } : layer);
    }
    generation.width = entry.width;
    generation.height = entry.height;

    // Restore each still-existing mask/region separately after CanvasStage has
    // rebuilt the matching document geometry. This preserves names, prompts,
    // opacity and visibility instead of collapsing everything into mask #1.
    const snapshotsById = new Map(entry.spatialLayers.map((layer) => [layer.id, layer]));
    this.layers = this.layers.map((layer) => {
      const snapshot = snapshotsById.get(layer.id);
      return snapshot
        ? {
          ...layer,
          visible: snapshot.visible,
          opacity: snapshot.opacity,
          image: snapshot.contentUrl ? {
            src: snapshot.contentUrl,
            x: 0,
            y: 0,
            width: entry.width,
            height: entry.height,
            rotation: 0,
            flipX: false,
            flipY: false,
          } : undefined,
          initialRegion: undefined,
        }
        : layer;
    });
    this.pendingSpatialLayerRestore = entry.spatialLayers.map((layer) => ({ ...layer }));

    this.persistedMaskPreviewUrl = null;
    this.resizeCanvas(entry.width, entry.height);
    this.inpaintSourceVersion += 1;
    this.invalidateInpaintPrompts();
  }

  get canUndoInpaintBase(): boolean {
    return generation.mode === "inpainting" && this.inpaintBaseHistory.length > 0;
  }

  get currentPreparedInputImage(): string | null {
    if (generation.mode === "inpainting") {
      return this.preparedInpaintPreviewUrl;
    }
    return this.currentStagingImage;
  }

  get hasResettableInpaintSource(): boolean {
    return generation.mode === "inpainting" && !!this.referenceImageUrl && !!this.originalInpaintInputImageName;
  }

  get resettableInpaintPreviewImage(): string | null {
    if (generation.mode === "inpainting") {
      return this.preparedInpaintPreviewUrl ?? this.referenceImageUrl;
    }
    return this.currentStagingImage;
  }

  clearPreparedInputs() {
    if (generation.mode === "inpainting" && this.hasResettableInpaintSource) {
      this.restoreOriginalInpaintSource();
      return;
    }
    this.clearStaging();
  }

  dismissPreparedInput() {
    if (generation.mode === "inpainting" && this.currentPreparedInputImage) {
      this.restoreOriginalInpaintSource();
      return;
    }
    this.dismissCurrentStaging();
  }

  stageImage(url: string, options?: { owned?: boolean }) {
    if (!url) return;
    this.stagingImages = [
      ...this.stagingImages,
      {
        url,
        owned: options?.owned ?? false,
      },
    ];
    this.stagingIndex = this.stagingImages.length - 1;
    this.isStagingActive = this.stagingImages.length > 0;
  }

  stageBlob(blob: Blob) {
    this.stageImage(URL.createObjectURL(blob), { owned: true });
  }

  clearStaging() {
    for (const entry of this.stagingImages) {
      if (entry.owned) URL.revokeObjectURL(entry.url);
    }
    this.stagingImages = [];
    this.stagingIndex = 0;
    this.isStagingActive = false;
  }

  nextStaging() {
    if (!this.stagingImages.length) return;
    this.stagingIndex = (this.stagingIndex + 1) % this.stagingImages.length;
  }

  prevStaging() {
    if (!this.stagingImages.length) return;
    this.stagingIndex = (this.stagingIndex - 1 + this.stagingImages.length) % this.stagingImages.length;
  }

  dismissCurrentStaging() {
    if (!this.stagingImages.length) return;
    const current = this.stagingImages[this.stagingIndex];
    if (current?.owned) URL.revokeObjectURL(current.url);
    this.stagingImages = this.stagingImages.filter((_, index) => index !== this.stagingIndex);

    if (!this.stagingImages.length) {
      this.stagingIndex = 0;
      this.isStagingActive = false;
      return;
    }

    if (this.stagingIndex >= this.stagingImages.length) {
      this.stagingIndex = this.stagingImages.length - 1;
    }
    this.isStagingActive = true;
  }

  get currentStagingImage(): string | null {
    if (!this.stagingImages.length) return null;
    return this.stagingImages[this.stagingIndex]?.url ?? null;
  }

  get effectiveReferenceImage(): string | null {
    if (generation.mode === "inpainting") {
      // A just-generated result is previewed as the background; below it the base
      // override (or session original) shows through until the user applies/undoes.
      if (this.pendingResultPreviewUrl) return this.pendingResultPreviewUrl;
      if (this.preparedInpaintPreviewUrl) return this.preparedInpaintPreviewUrl;
    }
    return this.currentStagingImage ?? this.referenceImageUrl;
  }

  setReferenceImage(url: string | null) {
    this.referenceImageUrl = url;
  }

  async setPersistedMaskPreview(url: string | null) {
    if (url && this.isCanvasMode) {
      await this.addRasterImage(url, locale.t("canvas.layer.inpaint_mask"), "mask");
      this.setTool("brush");
      this.persistedMaskPreviewUrl = null;
    } else this.persistedMaskPreviewUrl = url;
  }

  clearMask() {
    generation.setModeInput('inpainting', { mask: null });
    this.persistedMaskPreviewUrl = null;
    this.layers = this.layers.map((layer) => layer.type === "mask" ? { ...layer, image: undefined, initialRegion: undefined } : layer);

    if (!this._stageRef) return;
    const stageLayers = this._stageRef.getLayers?.() ?? [];
    for (const layerMeta of this.layers.filter((layer) => layer.type === "mask")) {
      const layer = stageLayers.find((l: any) => l.id?.() === layerMeta.id);
      layer?.destroyChildren?.();
      layer?.batchDraw?.();
    }
  }

  // Composite the editable inpaint mask layer(s) into a tinted, transparent-bg
  // data URL so the mask survives a base swap (layers are rebuilt on swap).
  // Returns null when there is no mask layer or the mask is empty.
  snapshotInpaintMask(): string | null {
    const stage = this._stageRef;
    if (!stage) return null;

    const maskMetas = this.layers.filter((layer) => layer.type === "mask" && layer.visible && layer.opacity > 0);
    if (!maskMetas.length) return null;

    const stageLayers = stage.getLayers?.() ?? [];
    const offscreen = document.createElement("canvas");
    offscreen.width = this.canvasWidth;
    offscreen.height = this.canvasHeight;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return null;

    let drew = false;
    for (const meta of maskMetas) {
      const layer = stageLayers.find((l: any) => l.id?.() === meta.id);
      if (!layer) continue;

      try {
        const layerCanvas = captureLayer(layer, this.canvasWidth, this.canvasHeight);
        ctx.globalAlpha = meta.opacity;
        ctx.drawImage(layerCanvas, 0, 0);
        drew = true;
      } catch (error) {
        console.error("Failed to snapshot inpaint mask:", error);
      }
    }
    ctx.globalAlpha = 1;

    if (!drew) return null;

    // Skip blank masks so undo never restores an empty mask.
    const data = ctx.getImageData(0, 0, offscreen.width, offscreen.height).data;
    let hasPixels = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        hasPixels = true;
        break;
      }
    }
    if (!hasPixels) return null;

    return offscreen.toDataURL("image/png");
  }

  /** Capture masks and prompt regions independently for non-destructive base undo. */
  snapshotSpatialLayers(): SpatialLayerSnapshot[] {
    const stageLayers = this._stageRef?.getLayers?.() ?? [];
    return this.layers
      .filter((layer): layer is CanvasLayer & { type: "mask" | "region" } => isMaskLayer(layer))
      .map((meta) => {
        const layer = stageLayers.find((candidate: any) => candidate.id?.() === meta.id);
        let contentUrl: string | null = null;
        if (layer) {
          try {
            const pixels = captureLayer(layer, this.canvasWidth, this.canvasHeight);
            const data = pixels.getContext("2d")?.getImageData(0, 0, pixels.width, pixels.height).data;
            if (data?.some((value, index) => index % 4 === 3 && value > 0)) {
              contentUrl = pixels.toDataURL("image/png");
            }
          } catch (error) {
            console.error("Failed to snapshot spatial layer:", error);
          }
        }
        return {
          id: meta.id,
          type: meta.type,
          visible: meta.visible,
          opacity: meta.opacity,
          contentUrl,
        };
      });
  }

  setInpaintDrawMode(mode: "mask" | "regular") {
    this.inpaintDrawMode = mode;
    const type = mode === "mask" ? "mask" : "raster";
    if (mode === "mask" ? !isMaskLayer(this.activeLayer) : this.activeLayer?.type !== type) {
      const target = this.sortedLayers.find((layer) => mode === "mask" ? isMaskLayer(layer) : layer.type === type);
      if (target) this.setActiveLayer(target.id);
      else this.addLayer(type);
    }
  }

  sendActiveLayerToMask(): boolean {
    if (!this._stageRef || !this.activeLayerId) return false;

    const sourceLayerMeta = this.layers.find((l) => l.id === this.activeLayerId);
    if (!sourceLayerMeta) return false;

    let maskLayerMeta = this.layers.find((l) => l.type === "mask");
    if (!maskLayerMeta) {
      const newId = this.addLayer("mask", locale.t("canvas.layer.inpaint_mask"));
      maskLayerMeta = this.layers.find((l) => l.id === newId) ?? undefined;
    }
    if (!maskLayerMeta) return false;

    if (sourceLayerMeta.id === maskLayerMeta.id) {
      this.activeLayerId = maskLayerMeta.id;
      return true;
    }

    const stageLayers = this._stageRef.getLayers?.() ?? [];
    const sourceLayer = stageLayers.find((layer: any) => layer.id?.() === sourceLayerMeta.id);
    const maskLayer = stageLayers.find((layer: any) => layer.id?.() === maskLayerMeta.id);
    if (!sourceLayer || !maskLayer) return false;

    const sourceNodes = sourceLayer.getChildren?.() ?? [];
    if (!sourceNodes.length) return false;

    for (const node of sourceNodes) {
      const gco = node.globalCompositeOperation?.();
      if (gco === "destination-out") continue;

      const clone = node.clone?.();
      if (!clone) continue;

      clone.globalCompositeOperation?.("source-over");
      clone.opacity?.(1);

      if (clone.stroke && typeof clone.stroke === "function") {
        clone.stroke(this.maskOverlayColor);
      }
      if (clone.fill && typeof clone.fill === "function") {
        clone.fill(this.maskOverlayColor);
      }

      maskLayer.add(clone);
    }

    sourceLayer.destroyChildren?.();
    sourceLayer.batchDraw?.();
    maskLayer.batchDraw?.();

    this.activeLayerId = maskLayerMeta.id;
    return true;
  }

  // Brush
  adjustBrushSize(delta: number) {
    this.brushSettings = {
      ...this.brushSettings,
      size: Math.max(1, Math.min(500, this.brushSettings.size + delta)),
    };
  }

  // Layers
  addLayer(type: CanvasLayerType = "raster", name?: string): string {
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    const id = genLayerId();
    const maxOrder = this.layers.reduce((max, l) => Math.max(max, l.order), -1);
    const layerName = name ?? (type === "mask"
      ? locale.t("canvas.mask_name", { n: String(this.layers.filter((layer) => layer.type === "mask").length + 1) })
      : type === "region"
        ? locale.t("canvas.region_name", { n: String(this.layers.filter((layer) => layer.type === "region").length + 1) })
        : locale.t("canvas.layer.raster", { n: String(this.layers.filter((l) => l.type === "raster").length + 1) }));

    this.layers = [
      ...this.layers,
      {
        id,
        name: layerName,
        type,
        visible: true,
        opacity: 1,
        locked: false,
        showContext: true,
        order: maxOrder + 1,
      },
    ];
    this.setActiveLayer(id);
    return id;
  }

  addRegionLayer(region?: RegionalPromptSelection): string {
    const id = this.addLayer("region");
    this.layers = this.layers.map((layer) => layer.id === id ? {
      ...layer,
      regionalPrompt: region?.text ?? "",
      regionalNegativePrompt: "",
      regionalStrength: region?.strength ?? 1,
      initialRegion: region ? { ...region, points: region.points?.map((point) => ({ ...point })) } : undefined,
    } : layer);
    this.setTool("rectFill");
    return id;
  }

  updateLayerRegion(id: string, patch: { regionalPrompt?: string; regionalNegativePrompt?: string; regionalStrength?: number }) {
    this.layers = this.layers.map((layer) => layer.id === id && layer.type === "region" ? { ...layer, ...patch } : layer);
  }

  removeLayer(id: string) {
    if (!this.layers.some((layer) => layer.id === id)) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId, [id]);
    this.detachedLayers.get(id)?.destroy();
    this.detachedLayers.delete(id);
    const removed = this.layers.find((l) => l.id === id);
    this.layers = this.layers.filter((l) => l.id !== id);
    this.clearLayerThumbnail(id);
    if (this.activeLayerId === id) {
      if (this.layers.length === 0) {
        this.activeLayerId = null;
      } else if (removed) {
        // Select the surviving layer whose order is nearest to the removed one.
        const nearest = this.layers.reduce((best, l) =>
          Math.abs(l.order - removed.order) < Math.abs(best.order - removed.order) ? l : best
        );
        this.activeLayerId = nearest.id;
      } else {
        this.activeLayerId = this.layers[this.layers.length - 1].id;
      }
    }
  }

  setLayerThumbnail(id: string, dataUrl: string) {
    this.layerThumbnails = { ...this.layerThumbnails, [id]: dataUrl };
  }

  clearLayerThumbnail(id: string) {
    if (!(id in this.layerThumbnails)) return;
    const next = { ...this.layerThumbnails };
    delete next[id];
    this.layerThumbnails = next;
  }

  duplicateLayer(id: string): string | null {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return null;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    const newId = genLayerId();
    const source = this._stageRef?.getLayers().find((node: any) => node.id() === id);
    // Clone actual canvas nodes, including eraser operations, before publishing metadata.
    // The stage adopts this node on its next sync instead of creating an empty layer.
    if (source) this._stageRef.add(source.clone({ id: newId }));
    this.layers = [
      ...this.layers.map((l) => l.order > layer.order ? { ...l, order: l.order + 1 } : l),
      {
        ...layer,
        id: newId,
        name: `${layer.name} copy`,
        order: layer.order + 1,
      },
    ];
    this.setActiveLayer(newId);
    return newId;
  }

  getLayerMoveTarget(id: string, direction: "up" | "down"): CanvasLayer | null {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return null;
    // Match the panel's top-to-bottom order and its mask/raster groups.
    const siblings = this.sortedLayers.filter((l) => l.type === layer.type);
    const index = siblings.findIndex((l) => l.id === id);
    return siblings[index + (direction === "up" ? -1 : 1)] ?? null;
  }

  reorderLayer(id: string, direction: "up" | "down") {
    const layer = this.layers.find((l) => l.id === id);
    const target = this.getLayerMoveTarget(id, direction);
    if (!layer || !target) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => {
      if (l.id === id) return { ...l, order: target.order };
      if (l.id === target.id) return { ...l, order: layer.order };
      return l;
    });
  }

  renameLayer(id: string, name: string) {
    if (this.layers.find((layer) => layer.id === id)?.name === name) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, name } : l));
  }

  toggleLayerVisibility(id: string) {
    if (!this.layers.some((layer) => layer.id === id)) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
  }

  setLayerOpacity(id: string, opacity: number, recordHistory = true) {
    const layer = this.layers.find((item) => item.id === id);
    if (!layer || layer.opacity === opacity) return;
    if (recordHistory) canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, opacity } : l));
  }

  toggleLayerLock(id: string) {
    if (!this.layers.some((layer) => layer.id === id)) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l));
  }

  toggleLayerContext(id: string) {
    this.layers = this.layers.map((layer) => layer.id === id && isMaskLayer(layer)
      ? { ...layer, showContext: layer.showContext === false }
      : layer);
  }

  setActiveLayer(id: string) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    this.activeLayerId = id;
    this.selectedWorkspaceSection = "layers";
    this.inpaintDrawMode = isMaskLayer(layer) ? "mask" : "regular";
  }

  fillActiveLayer() {
    const meta = this.activeLayer;
    const node = this._stageRef?.getLayers().find((layer: any) => layer.id() === meta?.id);
    if (!meta || !node || meta.locked || !meta.visible || this.selectedWorkspaceSection !== 'layers') return;
    node.add(new Konva.Rect({ x: 0, y: 0, width: this.canvasWidth, height: this.canvasHeight,
      fill: isMaskLayer(meta) ? this.maskOverlayColor : this.foregroundColor,
      opacity: this.brushSettings.opacity, listening: false }));
    node.batchDraw();
  }

  // Clear all content from a layer (via Konva stage ref)
  clearLayer(id: string) {
    if (!this._stageRef) return;
    const meta = this.layers.find((layer) => layer.id === id);
    if (!meta || meta.locked) return;
    this.layers = this.layers.map((layer) => layer.id === id ? { ...layer, image: undefined, initialRegion: undefined } : layer);
    const layers = this._stageRef.getLayers();
    for (const kLayer of layers) {
      if (kLayer.id() === id) {
        kLayer.destroyChildren();
        kLayer.batchDraw();
        break;
      }
    }
  }

  setLayerInpaintSettings(id: string, settings: InpaintSettings | undefined) {
    this.layers = this.layers.map((layer) => layer.id === id ? { ...layer, inpaintSettings: settings } : layer);
  }

  setLayerGenerationOverride(id: string, enabled: boolean) {
    this.layers = this.layers.map((layer) => layer.id === id && layer.type === "mask" ? {
      ...layer,
      inpaintSettings: enabled ? { ...generation.inpaintSettings } : undefined,
      maskGrow: enabled ? generation.growMaskBy : undefined,
      inpaintWidth: enabled ? (layer.inpaintWidth ?? generation.width) : undefined,
      inpaintHeight: enabled ? (layer.inpaintHeight ?? generation.height) : undefined,
      inpaintAspectLocked: enabled ? (layer.inpaintAspectLocked ?? true) : undefined,
      denoise: enabled && layer.type === "mask" ? generation.denoise : undefined,
      positivePrompt: enabled && layer.type === "mask" ? (layer.positivePrompt ?? "") : undefined,
      negativePrompt: enabled && layer.type === "mask" ? (layer.negativePrompt ?? "") : undefined,
    } : layer);
  }

  updateLayerGeneration(id: string, patch: { positivePrompt?: string; negativePrompt?: string; denoise?: number; maskGrow?: number }) {
    this.layers = this.layers.map((layer) => layer.id === id && layer.type === "mask" ? { ...layer, ...patch } : layer);
  }

  setLayerInpaintSize(id: string, width: number, height: number) {
    const clamp = (value: number) => Math.max(64, Math.min(16384, Math.round(value / 8) * 8));
    this.layers = this.layers.map((layer) => layer.id === id && layer.type === "mask" ? {
      ...layer,
      inpaintWidth: clamp(width),
      inpaintHeight: clamp(height),
    } : layer);
  }

  setLayerInpaintAspectLocked(id: string, locked: boolean) {
    this.layers = this.layers.map((layer) => layer.id === id && layer.type === "mask" ? { ...layer, inpaintAspectLocked: locked } : layer);
  }

  updateLayerImage(id: string, patch: Partial<NonNullable<CanvasLayer['image']>>) {
    this.layers = this.layers.map((layer) => layer.id === id && layer.image && !layer.locked ? { ...layer, image: { ...layer.image, ...patch } } : layer);
  }

  restoreLayerImage(id: string, node: Konva.Image | undefined) {
    const layer = this.layers.find((layer) => layer.id === id);
    if (!layer) return;
    let image: CanvasLayer['image'];
    if (node?.image()) {
      const source = node.image()!;
      const pixels = document.createElement('canvas');
      pixels.width = 'width' in source ? Number(source.width) : node.width();
      pixels.height = 'height' in source ? Number(source.height) : node.height();
      pixels.getContext('2d')!.drawImage(source, 0, 0);
      const src = layer.image?.src ?? (isMaskLayer(layer) ? maskToGrayscale(pixels) ?? pixels : pixels).toDataURL('image/png');
      image = { src, x: node.x() - (node.scaleX() < 0 ? node.width() : 0), y: node.y() - (node.scaleY() < 0 ? node.height() : 0), width: node.width(), height: node.height(), rotation: node.rotation(), flipX: node.scaleX() < 0, flipY: node.scaleY() < 0 };
    }
    this.layers = this.layers.map((layer) => layer.id === id ? { ...layer, image } : layer);
  }

  async addRasterImage(src: string, name: string, type: CanvasLayerType = "raster", isCurrent: () => boolean = () => true): Promise<string> {
    const sourceVersion = this.inpaintSourceVersion;
    const image = await this.loadImage(src);
    if (!isCurrent() || sourceVersion !== this.inpaintSourceVersion) return "";
    const pixels = document.createElement("canvas");
    pixels.width = image.naturalWidth;
    pixels.height = image.naturalHeight;
    pixels.getContext("2d")!.drawImage(image, 0, 0);
    const scale = Math.min(1, this.canvasWidth / pixels.width, this.canvasHeight / pixels.height);
    const width = pixels.width * scale;
    const height = pixels.height * scale;
    const id = this.addLayer(type, name);
    this.layers = this.layers.map((layer) => layer.id === id ? { ...layer, image: {
      src: pixels.toDataURL("image/png"), x: (this.canvasWidth-width)/2, y: (this.canvasHeight-height)/2,
      width, height, rotation: 0, flipX: false, flipY: false,
    } } : layer);
    this.setTool("move");
    return id;
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load canvas image"));
      image.src = src;
    });
  }

  async insertInpaintResult(masked: boolean) {
    if (!this.pendingResultPreviewUrl || this.insertingResult) return;
    this.insertingResult = true;
    const resultUrl = this.pendingResultPreviewUrl;
    const maskUrl = this.pendingResultMaskUrl;
    const sourceVersion = this.inpaintSourceVersion;
    const isCurrent = () => resultUrl === this.pendingResultPreviewUrl && sourceVersion === this.inpaintSourceVersion;
    try {
    const image = await this.loadImage(resultUrl);
    if (!isCurrent()) return;
    const pixels = document.createElement("canvas");
    pixels.width = this.canvasWidth;
    pixels.height = this.canvasHeight;
    const ctx = pixels.getContext("2d")!;
    ctx.drawImage(image, 0, 0, pixels.width, pixels.height);
    if (masked && maskUrl) {
      const mask = await this.loadImage(maskUrl);
      if (!isCurrent()) return;
      const alpha = document.createElement("canvas");
      alpha.width = pixels.width; alpha.height = pixels.height;
      const maskCtx = alpha.getContext("2d")!;
      maskCtx.drawImage(mask, 0, 0, alpha.width, alpha.height);
      const data = maskCtx.getImageData(0, 0, alpha.width, alpha.height);
      for (let i = 0; i < data.data.length; i += 4) data.data[i+3] = data.data[i];
      maskCtx.putImageData(data, 0, 0);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(alpha, 0, 0);
    }
    await this.addRasterImage(pixels.toDataURL("image/png"), locale.t('canvas.result_layer'), "raster", isCurrent);
    if (isCurrent()) this.clearPendingInpaintResult();
    } finally {
      this.insertingResult = false;
    }
  }

  exportMaskLayer(id: string): HTMLCanvasElement | null {
    const meta = this.layers.find((layer) => layer.id === id && isMaskLayer(layer) && layer.visible && layer.opacity > 0);
    const node = this._stageRef?.getLayers().find((layer: any) => layer.id() === id);
    if (!meta || !node) return null;
    const pixels = captureLayer(node, this.canvasWidth, this.canvasHeight);
    const result = maskToGrayscale(pixels);
    if (!result) return null;
    // Apply the layer's coverage once, independently of preview visibility.
    const ctx = result.getContext("2d")!;
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = 1 - meta.opacity;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, result.width, result.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return result;
  }

  // Viewport
  zoomIn() {
    this.setZoom(Math.min(20, this.viewport.zoom * 1.2), this.viewportWidth / 2, this.viewportHeight / 2);
  }

  zoomOut() {
    this.setZoom(Math.max(0.05, this.viewport.zoom / 1.2), this.viewportWidth / 2, this.viewportHeight / 2);
  }

  setZoom(zoom: number, centerX?: number, centerY?: number) {
    this.viewportInitialized = true;
    const oldZoom = this.viewport.zoom;
    const newZoom = Math.max(0.05, Math.min(20, zoom));

    if (centerX !== undefined && centerY !== undefined) {
      // Zoom toward the cursor position
      const scale = newZoom / oldZoom;
      this.viewport = {
        zoom: newZoom,
        panX: centerX - (centerX - this.viewport.panX) * scale,
        panY: centerY - (centerY - this.viewport.panY) * scale,
      };
    } else {
      this.viewport = { ...this.viewport, zoom: newZoom };
    }
  }

  zoomToFit(containerWidth: number, containerHeight: number) {
    const scaleX = containerWidth / this.canvasWidth;
    const scaleY = containerHeight / this.canvasHeight;
    const zoom = Math.min(scaleX, scaleY) * 0.9;
    this.viewport = {
      zoom,
      panX: (containerWidth - this.canvasWidth * zoom) / 2,
      panY: (containerHeight - this.canvasHeight * zoom) / 2,
    };
    this.viewportInitialized = true;
  }

  resetZoom() {
    this.viewportInitialized = true;
    this.viewport = {
      zoom: 1,
      panX: (this.viewportWidth - this.canvasWidth) / 2,
      panY: (this.viewportHeight - this.canvasHeight) / 2,
    };
  }

  setViewportSize(width: number, height: number) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  resizeCanvas(width: number, height: number) {
    if (width === this.canvasWidth && height === this.canvasHeight) return;
    // A completed preview belongs to the exact document geometry captured at
    // submission time. Keeping it after a manual resize would let Apply restore
    // stale dimensions and misalign the saved mask.
    this.clearPendingInpaintResult();
    this.inpaintSourceVersion += 1;
    this.invalidateInpaintPrompts();
    const scaleX = this.canvasWidth > 0 ? width / this.canvasWidth : 1;
    const scaleY = this.canvasHeight > 0 ? height / this.canvasHeight : 1;
    const scaleLayerContents = (node: any) => {
      for (const child of node?.getChildren?.() ?? []) {
        // Raster assets are driven by their serializable layer metadata below.
        if (child.name?.() === "raster-asset") continue;
        child.x?.(child.x() * scaleX);
        child.y?.(child.y() * scaleY);
        child.scaleX?.(child.scaleX() * scaleX);
        child.scaleY?.(child.scaleY() * scaleY);
      }
      node?.batchDraw?.();
    };
    for (const node of this._stageRef?.getLayers?.() ?? []) {
      if (this.layers.some((layer) => layer.id === node.id?.())) scaleLayerContents(node);
    }
    for (const node of this.detachedLayers.values()) scaleLayerContents(node);
    this.layers = this.layers.map((layer) => layer.image ? {
      ...layer,
      image: {
        ...layer.image,
        x: layer.image.x * scaleX,
        y: layer.image.y * scaleY,
        width: layer.image.width * scaleX,
        height: layer.image.height * scaleY,
      },
    } : layer);
    // Every thumbnail represents the old coordinate system; let the stage
    // regenerate them after the scaled nodes have been drawn.
    this.layerThumbnails = {};
    const centerX = this.viewport.panX + this.canvasWidth * this.viewport.zoom / 2;
    const centerY = this.viewport.panY + this.canvasHeight * this.viewport.zoom / 2;
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.viewport = {
      ...this.viewport,
      panX: centerX - width * this.viewport.zoom / 2,
      panY: centerY - height * this.viewport.zoom / 2,
    };
    this.boundingBox = {
      ...this.boundingBox,
      x: Math.round(this.boundingBox.x * scaleX),
      y: Math.round(this.boundingBox.y * scaleY),
      width: Math.round(this.boundingBox.width * scaleX),
      height: Math.round(this.boundingBox.height * scaleY),
    };
    // The document frame is the inpainting Canvas size. Keep the generation
    // fields in lockstep so the dimensions panel, saved settings and backend
    // request cannot retain the previous size after an on-canvas resize.
    if (generation.mode === "inpainting") {
      generation.width = width;
      generation.height = height;
      void generation.saveSettings();
    }
  }

  // Canvas init — creates default layers
  initCanvas(width: number, height: number) {
    canvasHistory.clear();
    for (const node of this.detachedLayers.values()) node.destroy();
    this.detachedLayers.clear();
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.layers = [];
    this.activeLayerId = null;
    this.layerThumbnails = {};
    this.viewportInitialized = false;

    this.addLayer("raster");
    this.addLayer("mask", locale.t("canvas.layer.inpaint_mask"));

    // Set active to the raster layer
    const rasterLayer = this.layers.find((l) => l.type === "raster");
    if (rasterLayer) this.activeLayerId = rasterLayer.id;

    // Default layers are document initialization, not user undo operations.
    canvasHistory.clear();
    this.boundingBox = { x: 0, y: 0, width, height, locked: false };
  }

  captureInpaintSubmission() {
    // The backend result already contains feathered compositing. Cut its full
    // affected support, so inserting it does not feather twice or lose growth.
    const width = this.canvasWidth, height = this.canvasHeight;
    const support = new Uint8Array(width * height);
    let hasMask = false;
    for (const layer of this.layers.filter((layer) => layer.type === "mask")) {
      const source = this.exportMaskLayer(layer.id);
      if (!source) continue;
      hasMask = true;
      const pixels = source.getContext("2d")!.getImageData(0, 0, width, height).data;
      const settings = layer.inpaintSettings ?? generation.inpaintSettings;
      const values = Float32Array.from({ length: width * height }, (_, i) => pixels[i * 4] / 255);
      const grown = processMaskCoverage(values, width, height, layer.maskGrow ?? generation.growMaskBy, 0, settings.invert_mask);
      const affected = processMaskCoverage(grown, width, height, Math.floor(3 * settings.mask_blur), 0, false);
      for (let i = 0; i < support.length; i++) if (affected[i] > 0) support[i] = 255;
    }
    let maskUrl = this.lastSubmittedMaskUrl;
    if (hasMask) {
      const mask = document.createElement("canvas");
      mask.width = width; mask.height = height;
      const context = mask.getContext("2d")!;
      const image = context.createImageData(width, height);
      for (let i = 0; i < support.length; i++) {
        image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = support[i];
        image.data[i * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      maskUrl = mask.toDataURL("image/png");
    }
    return this.inpaintResults.capture(this.inpaintSourceVersion, maskUrl, this.lastSubmittedRasterLayerIds);
  }

  registerInpaintPrompt(promptId: string, snapshot = this.captureInpaintSubmission()) {
    this.inpaintResults.register(promptId, snapshot);
  }

  claimInpaintPrompt(promptId: string) {
    return this.inpaintResults.claim(promptId, this.inpaintSourceVersion);
  }

  acceptInpaintResult(snapshot: InpaintResultSnapshot) {
    return this.inpaintResults.accept(snapshot, this.inpaintSourceVersion);
  }

  finishInpaintResult(snapshot: InpaintResultSnapshot) {
    this.inpaintResults.finish(snapshot);
  }

  invalidateInpaintPrompts(promptIds?: string[]) {
    this.inpaintResults.invalidate(promptIds);
  }

  // Export
  async exportLayerAsImage(layerCanvas: HTMLCanvasElement, filename: string): Promise<{ name: string; subfolder: string; type: string }> {
    const blob = await new Promise<Blob>((resolve) => {
      layerCanvas.toBlob((b) => resolve(b!), "image/png");
    });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));
    return uploadImageBytes(bytes, filename);
  }

  async syncMaskToGeneration(maskCanvas: HTMLCanvasElement | null, uploadToComfy: boolean = true, ensureCurrentDocument: () => void = () => {}): Promise<boolean> {
    if (!maskCanvas) {
      generation.maskImage = null;
      this.persistedMaskPreviewUrl = null;
      return false;
    }

    const ctx = maskCanvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    let hasMask = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        hasMask = true;
        break;
      }
    }

    if (!hasMask) {
      generation.maskImage = null;
      this.persistedMaskPreviewUrl = null;
      return false;
    }

    const exportCanvas = maskToGrayscale(maskCanvas);
    if (!exportCanvas) return false;

    // Persist/update uploaded mask preview only when we actually sync to ComfyUI.
    if (uploadToComfy) {
      this.lastSubmittedMaskUrl = exportCanvas.toDataURL("image/png");
      // Editable mask layers are already visible; avoid a second stale overlay.
      this.persistedMaskPreviewUrl = null;
      const result = await this.exportLayerAsImage(exportCanvas, `canvas_mask_${Date.now()}.png`);
      ensureCurrentDocument();
      generation.maskImage = result.name;
    }

    return true;
  }

  // Sync canvas to generation store before generating
  async syncToGeneration(
    getRasterComposite: () => HTMLCanvasElement | null,
    getMaskCanvas: () => HTMLCanvasElement | null
  ) {
    const sourceVersion = this.inpaintSourceVersion;
    const documentWidth = this.canvasWidth;
    const documentHeight = this.canvasHeight;
    const sourceMode = generation.mode;
    const ensureCurrentDocument = () => {
      if (sourceVersion !== this.inpaintSourceVersion || sourceMode !== generation.mode ||
          documentWidth !== this.canvasWidth || documentHeight !== this.canvasHeight) {
        throw new Error("Canvas document changed while preparing generation. Please generate again.");
      }
    };
    const rasterCanvas = getRasterComposite();
    this.lastSubmittedRasterLayerIds = this.layers.filter(layer => layer.type === 'raster' && layer.visible && layer.opacity > 0).map(layer => layer.id);
    let maskCanvas = getMaskCanvas();
    const isInpainting = generation.mode === "inpainting";

    let hasRaster = false;
    let hasMask = false;

    // Composite a stable base and visible raster edits, never the pending preview.
    const baseUrl = this.preparedInpaintPreviewUrl ?? this.referenceImageUrl;
    const emptyBase = isInpainting && !baseUrl;
    if (isInpainting) {
      const composite = document.createElement("canvas");
      composite.width = this.canvasWidth; composite.height = this.canvasHeight;
      const ctx = composite.getContext("2d")!;
      ctx.fillStyle = this.baseColor;
      ctx.fillRect(0, 0, composite.width, composite.height);
      if (baseUrl) {
        const image = await this.loadImage(baseUrl);
        ensureCurrentDocument();
        const scale = Math.min(composite.width / image.naturalWidth, composite.height / image.naturalHeight);
        const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
        ctx.drawImage(image, (composite.width-w)/2, (composite.height-h)/2, w, h);
      }
      if (rasterCanvas) ctx.drawImage(rasterCanvas, 0, 0);
      if (baseUrl || emptyBase) {
        const result = await this.exportLayerAsImage(composite, `canvas_input_${Date.now()}.png`);
        ensureCurrentDocument();
        generation.inputImage = result.name;
      }
      hasRaster = true;
    } else {
      // Non-inpaint modes use raster if present, otherwise staged image fallback.
      if (rasterCanvas) {
        const ctx = rasterCanvas.getContext("2d")!;
        const data = ctx.getImageData(0, 0, rasterCanvas.width, rasterCanvas.height).data;
        // Check if any pixel has non-zero alpha
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0) { hasRaster = true; break; }
        }
        if (hasRaster) {
          const result = await this.exportLayerAsImage(rasterCanvas, "canvas_input.png");
          generation.inputImage = result.name;
        }
      }

      if (!hasRaster && this.currentStagingImage) {
        const response = await fetch(this.currentStagingImage);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = Array.from(new Uint8Array(arrayBuffer));
        const result = await uploadImageBytes(bytes, "staged_input.png");
        generation.inputImage = result.name;
        hasRaster = true;
      }
    }

    // A blank document can generate over its full base without importing a file.
    if (isInpainting && !baseUrl && !maskCanvas?.getContext("2d")!.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data.some((value, index) => index % 4 === 3 && value > 0)) {
      maskCanvas = document.createElement("canvas");
      maskCanvas.width = this.canvasWidth; maskCanvas.height = this.canvasHeight;
      const ctx = maskCanvas.getContext("2d")!;
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    }
    // Export mask
    hasMask = await this.syncMaskToGeneration(maskCanvas, true, ensureCurrentDocument);
    ensureCurrentDocument();

    // Keep the user-selected mode when using canvas flow for image editing modes.
    if (generation.mode === "inpainting") {
      generation.mode = "inpainting";
    } else if (generation.mode === "img2img") {
      generation.mode = "img2img";
    } else if (hasRaster && hasMask) {
      generation.mode = "inpainting";
    } else if (hasRaster) {
      generation.mode = "img2img";
    } else {
      generation.mode = "txt2img";
    }

    // Sync dimensions from bounding box
    generation.width = this.boundingBox.width;
    generation.height = this.boundingBox.height;
  }
}

export const canvas = new CanvasStore();

canvasHistory.setOnDocumentRestored((layers, activeLayerId) => {
  canvas.layers = layers;
  canvas.activeLayerId = activeLayerId;
});
canvasHistory.setDocumentStateProvider(() => ({
  layers: canvas.layers,
  activeLayerId: canvas.activeLayerId,
}));
