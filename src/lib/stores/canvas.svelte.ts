import { newControlnetLayer, type ControlnetLayerSettings } from "../utils/controlnetState.js";
import Konva from "konva";
import { effectiveLayerVisibility, remapLayerRelations, type LayerRelations, type LayerGroup } from "../utils/layerRelations.js";
import { restrictGenerationMaskToRasterAlpha, applySpatialMaskToRasterAlpha } from "../utils/layerAlpha.js";
import { uploadImageBytes } from "../utils/api.js";
import { generation } from "./generation.svelte.js";
import { locale } from "./locale.svelte.js";
import type { RegionalPromptSelection } from "../types/index.js";
import { captureLayer, maskToGrayscale } from "../utils/canvasLayerExport.js";
import { withMaskProcessingSettings, type InpaintSettings } from "../utils/inpaintSettings.js";
import { InpaintResultRegistry, type InpaintResultSnapshot } from "../utils/inpaintResultRegistry.js";
import { processMaskCoverage } from "../utils/maskProcessing.js";
import { resolveTint } from "../utils/layerTints.js";
import { canvasHistory } from "./canvasHistory.svelte.js";
import { fittedCanvasViewport, viewportMatchesCanvasFit } from "../utils/canvasViewport.js";
import {
  PROJECT_DOCUMENT_VERSION,
  captureRasterPaint,
  type RasterPaintCommand,
  emptyDocument,
  type ProjectDocument,
  type ProjectLayer,
} from "../utils/projectDocument.js";

export type ToolType = "brush" | "eraser" | "rectFill" | "ellipseFill" | "lasso" | "eyedropper" | "move" | "view" | "canvasResize";
export type CanvasLayerType = "raster" | "mask" | "region" | "controlnet";

export function isMaskLayer(layer: Pick<CanvasLayer, "type"> | null | undefined): boolean {
  return layer?.type === "mask" || layer?.type === "region";
}

export interface CanvasLayer extends LayerRelations {
  rasterPaint?: RasterPaintCommand[];
  id: string;
  name: string;
  type: CanvasLayerType;
  controlnet?: ControlnetLayerSettings;
  /** Session-only owned URL, excluded from project serialization. */
  controlnetPreviewUrl?: string | null;
  visible: boolean;
  opacity: number;
  /** How much of this layer counts for a run, 0..1. A mask's painted area
   * multiplied by it is the mask a run reads; a raster's own opacity does the
   * job instead. Kept apart from `opacity`, which is only how the layer is
   * drawn on the canvas: dimming an overlay used to silently weaken the mask. */
  coverage?: number;
  locked: boolean;
  /** Cosmetic tint key from `layerTints.ts`. Display only: generation never
   * reads it, so recolouring a mask or a region cannot change a run. */
  tint?: string;
  /** Whether generation-context guides are shown when this layer is selected. */
  showContext?: boolean;
  order: number;
  regionalPrompt?: string;
  regionalNegativePrompt?: string;
  regionalStrength?: number;
  positivePrompt?: string;
  negativePrompt?: string;
  denoise?: number;
  /** A mask whose density decides its own denoise: the painted core edits
   * strongly and the fringes fade out, instead of the whole mask running one
   * uniform denoise. */
  densityDenoise?: boolean;
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
  coverage?: number;
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

function genLayerId(): string {
  return `layer_${crypto.randomUUID()}`;
}

/**
 * A document carries its pixels, so whatever a raster layer points at is read
 * and handed back as a data URL: reopening a project must not depend on this
 * session's object URLs. A source that cannot be read is returned as it is and
 * refused by the document check before a save, rather than saved as an empty
 * layer.
 */
async function inlineImageSource(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Could not inline an image for the document:", error);
    return src;
  }
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
  groups = $state<LayerGroup[]>([]);
  activeGroupId = $state<string | null>(null);
  activeLayerId = $state<string | null>(null);
  /** A legacy global control is copied once; new/opened documents own their controls. */
  legacyControlnetMigrated = false;
  /** Bumped whenever pixels change without the layer records changing: painted
   * strokes, a replaced image, an applied result. A project reads it to know it
   * has unsaved picture changes, not only metadata changes. */
  paintRevision = $state(0);
  baseColor = $state("#808080");
  selectedWorkspaceSection = $state<"base" | "layers" | "control">("layers");
  lastSubmittedMaskUrl: string | null = null;
  lastSubmittedRasterLayerIds: string[] = [];
  private detachedLayers = new Map<string, any>();

  retainLayerNodes() {
    for (const node of this.detachedLayers.values()) node.destroy();
    this.detachedLayers.clear();
    for (const node of this._stageRef?.getLayers() ?? []) {
      if (this.layers.some((layer) => layer.id === node.id())) {
        const clone = node.clone();
        clone.findOne('.raster-clip-mask')?.destroy();
        this.detachedLayers.set(node.id(), clone);
      }
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
  /** Overlay strength for the canvas only: how strongly masks and regions are
   * drawn over the picture. Display only — painted coverage determines the generation mask. */
  maskOverlayOpacity = $state(0.45);
  maskOverlayVisible = $state(true);
  showLayerContext = $state(true);
  controlContextPreviewUrl = $state<string | null>(null);
  controlContextPreviewLayerId = $state<string | null>(null);
  controlContextPreviewKind = $state<'source' | 'processed'>('source');

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
    return this.layers.filter((l) => effectiveLayerVisibility(l, this.groups)).sort((a, b) => a.order - b.order);
  }

  get sortedLayers(): CanvasLayer[] {
    const rank = (layer: CanvasLayer) => layer.type === 'raster' ? 0 : layer.type === 'region' ? 2 : layer.type === 'controlnet' ? 3 : 1;
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
  /** The eyedropper paints the brush colour, and only a raster layer is drawn
   * in that colour: a mask or a region draws in its own tint, so picking a
   * colour for one would look like nothing happened. One rule, asked by both
   * the toolbar and the keyboard. */
  get canPickColor(): boolean {
    return this.activeLayer?.type === "raster";
  }

  setTool(tool: ToolType) {
    if (tool === "eyedropper" && !this.canPickColor) return;
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
    this.bumpPaintRevision();
    if (!this.originalInpaintInputImageName || this.originalInpaintWidth == null || this.originalInpaintHeight == null) {
      // A Patchy/base import may start from an empty document. In that case
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
    this.bumpPaintRevision();
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
          coverage: snapshot.coverage,
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

    const maskMetas = this.layers.filter((layer) => layer.type === "mask" && effectiveLayerVisibility(layer, this.groups) && (layer.coverage ?? 1) > 0);
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
        ctx.globalAlpha = meta.coverage ?? 1;
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
          coverage: meta.coverage,
          contentUrl,
        };
      });
  }

  /** Say that the picture changed, not just the layer list. */
  bumpPaintRevision() {
    this.paintRevision += 1;
  }

  /**
   * The whole workspace as a document: the canvas, every layer with its pixels,
   * the prompts that belong to them and where the view was.
   *
   * Mask and region pixels are captured exactly the way an inpaint-base undo
   * captures them, and a raster's pixels are inlined, so a saved project opens
   * without this session's object URLs.
   */
  /**
   * The document's shape without its pixels: cheap enough to compare on a
   * timer, which is what the unsaved-changes dot needs. Pixels are covered by
   * `paintRevision`, not by this.
   */
  documentShape(): ProjectDocument {
    const layers: ProjectLayer[] = [];
    for (const layer of [...this.layers].sort((a, b) => a.order - b.order)) {
      const { image, controlnetPreviewUrl: _preview, ...meta } = layer;
      const record: ProjectLayer = { ...meta };
      if (isMaskLayer(layer)) record.spatialPng = null;
      else if (layer.type === 'raster') {
        if (image) record.image = { ...image };
        const node = this._stageRef?.getLayers().find((node: any) => node.id() === layer.id) ?? this.detachedLayers.get(layer.id);
        record.rasterPaint = node ? captureRasterPaint(node.getChildren()) : layer.rasterPaint ?? [];
      }
      layers.push(record);
    }
    return {
      version: PROJECT_DOCUMENT_VERSION,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      baseColor: this.baseColor,
      backgroundColor: this.backgroundColor,
      viewport: { ...this.viewport },
      groups: this.groups.map(group => ({ ...group })),
      layers,
    };
  }

  /**
   * The whole workspace as a document: the canvas, every layer with its pixels,
   * the prompts that belong to them and where the view was.
   *
   * Mask and region pixels are captured exactly the way an inpaint-base undo
   * captures them, and a raster's pixels are inlined, so a saved project opens
   * without this session's object URLs.
   */
  async captureDocument(): Promise<ProjectDocument> {
    const doc = this.documentShape();
    const ordered = [...this.layers].sort((a, b) => a.order - b.order);
    const stageLayers = this._stageRef?.getLayers?.() ?? [];
    for (let index = 0; index < ordered.length; index += 1) {
      const layer = ordered[index];
      const record = doc.layers[index];
      if (!layer || !record) continue;
      if (isMaskLayer(layer)) {
        record.spatialPng = null;
        // Hidden layers keep their pixels too. Visibility controls participation,
        // not whether an undo, project save or later reveal can restore the drawing.
        const konva = stageLayers.find((candidate: any) => candidate.id?.() === layer.id);
        if (!konva) {
          // A mask with no stage layer behind it is an inconsistency the user
          // cannot see: say so instead of quietly saving an empty mask. An
          // unpainted mask, on the other hand, is perfectly normal and stays
          // silent.
          console.warn(`No stage layer for mask ${layer.id}; its pixels are not saved`);
          continue;
        }
        try {
          const pixels = captureLayer(konva, this.canvasWidth, this.canvasHeight);
          const data = pixels.getContext("2d")?.getImageData(0, 0, pixels.width, pixels.height).data;
          if (data?.some((value, i) => i % 4 === 3 && value > 0)) {
            record.spatialPng = pixels.toDataURL("image/png");
          }
        } catch (error) {
          console.error("Failed to capture a layer's pixels:", error);
        }
      } else if (layer.image) {
        record.image = { ...layer.image, src: await inlineImageSource(layer.image.src) };
      }
    }
    return doc;
  }

  /**
   * Replace the workspace with a stored document.
   *
   * Layer ids are handed out fresh so they cannot collide with ids this session
   * already used, and everything that belonged to the previous document — the
   * inpaint session, the base history, staged images, the pending result — is
   * cleared: a loaded project starts from its own base, not the old one's.
   */
  loadDocument(doc: ProjectDocument) {
    for (const layer of this.layers) if (layer.controlnetPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(layer.controlnetPreviewUrl);
    this.canvasWidth = doc.canvasWidth;
    this.canvasHeight = doc.canvasHeight;
    this.baseColor = doc.baseColor;
    this.backgroundColor = doc.backgroundColor;
    // The canvas follows the generation size while the workspace is in canvas
    // mode, so a document has to carry its size into both: otherwise opening a
    // project would resize it the moment the editor synced its dimensions.
    generation.width = doc.canvasWidth;
    generation.height = doc.canvasHeight;
    this.viewport = { ...doc.viewport };
    this.viewportInitialized = true;

    this.clearInpaintSession();
    this.dismissInpaintResult();
    this.clearStaging();
    this.clearMask();
    this.referenceImageUrl = null;
    this.lastSubmittedMaskUrl = null;
    this.persistedMaskPreviewUrl = null;
    canvasHistory.clear();

    const spatial: SpatialLayerSnapshot[] = [];
    const ids = doc.layers.map(() => genLayerId());
    const layerIds = new Map(doc.layers.flatMap((layer, index) => layer.id ? [[layer.id, ids[index]] as const] : []));
    const groupIds = new Map((doc.groups ?? []).map(group => [group.id, `group_${genLayerId()}`]));
    this.groups = (doc.groups ?? []).map(group => ({ ...group, id: groupIds.get(group.id)! }));
    this.activeGroupId = null;
    this.layers = doc.layers.map((layer, index) => {
      const { spatialPng, ...meta } = layer;
      const id = ids[index];
      if (layer.type === "mask" || layer.type === "region") {
        spatial.push({
          id,
          type: layer.type,
          visible: layer.visible,
          opacity: layer.opacity,
          coverage: layer.coverage,
          contentUrl: spatialPng ?? null,
        });
      }
      return { ...remapLayerRelations({ ...meta, id: layer.id ?? id }, layerIds, groupIds), id } as CanvasLayer;
    });
    this.activeLayerId = this.layers[0]?.id ?? null;
    // The stage re-hydrates mask and region pixels from these once it has built
    // the Konva layers for the new document, the same way a base undo does.
    this.pendingSpatialLayerRestore = spatial.length > 0 ? spatial : null;
    this.bumpPaintRevision();
  }

  /** Start an empty document at the given size. */
  newDocument(width: number, height: number, background = "#000000") {
    this.loadDocument(emptyDocument(width, height, background));
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

    // The strokes arrive as this mask's own overlay colour, so what lands in
    // the mask is drawn exactly like the rest of it.
    const tint = resolveTint(maskLayerMeta);

    for (const node of sourceNodes) {
      const gco = node.globalCompositeOperation?.();
      if (gco === "destination-out") continue;

      const clone = node.clone?.();
      if (!clone) continue;

      clone.globalCompositeOperation?.("source-over");
      clone.opacity?.(1);

      if (clone.stroke && typeof clone.stroke === "function") {
        clone.stroke(tint);
      }
      if (clone.fill && typeof clone.fill === "function") {
        clone.fill(tint);
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

  get activeGroup(): LayerGroup | null {
    return this.groups.find(group => group.id === this.activeGroupId) ?? null;
  }

  createGroup(name?: string): string {
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    const id = `group_${genLayerId()}`;
    this.groups = [...this.groups, { id, name: name ?? locale.t('canvas.group_default', { n: String(this.groups.length + 1) }), visible: true, collapsed: false }];
    this.setActiveGroup(id);
    return id;
  }

  setActiveGroup(id: string | null) {
    if (id != null && !this.groups.some(group => group.id === id)) return;
    this.activeGroupId = id;
    if (id != null) this.activeLayerId = null;
    this.selectedWorkspaceSection = 'layers';
  }

  renameGroup(id: string, name: string) {
    if (!name.trim() || !this.groups.some(group => group.id === id && group.name !== name.trim())) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.groups = this.groups.map(group => group.id === id ? { ...group, name: name.trim() } : group);
  }

  toggleGroupVisibility(id: string) {
    if (!this.groups.some(group => group.id === id)) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.groups = this.groups.map(group => group.id === id ? { ...group, visible: !group.visible } : group);
  }

  toggleGroupCollapsed(id: string) {
    this.groups = this.groups.map(group => group.id === id ? { ...group, collapsed: !group.collapsed } : group);
  }

  private preserveGroupScope(layer: CanvasLayer): CanvasLayer {
    if (!layer.groupId || (layer.type !== 'region' && layer.type !== 'controlnet') || (layer.modifierScope?.mode ?? 'auto') !== 'auto') return layer;
    return { ...layer, modifierScope: { mode: 'masks', maskIds: this.layers.filter(mask => mask.type === 'mask' && mask.groupId === layer.groupId).map(mask => mask.id) } };
  }

  removeGroup(id: string) {
    const group = this.groups.find(item => item.id === id);
    if (!group) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map(layer => layer.groupId === id ? {
      ...this.preserveGroupScope(layer), groupId: null,
      visible: group.visible && layer.visible,
      controlnet: layer.controlnet && !group.visible ? { ...layer.controlnet, enabled: false } : layer.controlnet,
    } : layer);
    this.groups = this.groups.filter(item => item.id !== id);
    if (this.activeGroupId === id) this.activeGroupId = null;
  }

  setLayerRelations(id: string, patch: Partial<LayerRelations>) {
    const layer = this.layers.find(item => item.id === id);
    if (!layer || layer.locked) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    // Leaving a folder must not turn a local modifier into a global effect.
    const prior = patch.groupId === null ? this.preserveGroupScope(layer) : layer;
    this.layers = this.layers.map(item => item.id === id ? { ...prior, ...patch,
      modifierScope: patch.modifierScope ? { ...patch.modifierScope, maskIds: patch.modifierScope.maskIds ? [...patch.modifierScope.maskIds] : undefined } : prior.modifierScope,
    } : item);
    this.bumpPaintRevision();
  }

  // Layers
  addLayer(type: CanvasLayerType = "raster", name?: string): string {
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    const id = genLayerId();
    const maxOrder = this.layers.reduce((max, l) => Math.max(max, l.order), -1);
    const layerName = name ?? (type === "controlnet" ? locale.t("generation.controlnet.title") : type === "mask"
      ? locale.t("canvas.mask_name", { n: String(this.layers.filter((layer) => layer.type === "mask").length + 1) })
      : type === "region"
        ? locale.t("canvas.region_name", { n: String(this.layers.filter((layer) => layer.type === "region").length + 1) })
        : locale.t("canvas.layer.raster", { n: String(this.layers.filter((l) => l.type === "raster").length + 1) }));

    this.layers = [
      ...this.layers,
      {
        id,
        groupId: this.activeGroupId ?? this.activeLayer?.groupId ?? null,
        name: layerName,
        type,
        visible: true,
        opacity: type === 'controlnet' ? .4 : 1,
        // A mask or a region starts at full coverage: the sliders that dim the
        // overlay are display-only, so this is the one value a run reads.
        coverage: type === "mask" || type === "region" ? 1 : undefined,
        controlnet: type === "controlnet" ? newControlnetLayer() : undefined,
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

  private controlnetEditLayerId: string | null = null;
  private controlnetBatchLayerId: string | null = null;
  beginControlnetEdit(id: string) {
    const layer = this.layers.find(item => item.id === id && item.type === 'controlnet');
    if (!layer || layer.locked || this.controlnetEditLayerId === id) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.controlnetEditLayerId = id;
  }
  endControlnetEdit() { this.controlnetEditLayerId = null; }

  updateControlnetLayer(id: string, patch: Partial<ControlnetLayerSettings>) {
    const layer = this.layers.find(item => item.id === id && item.type === 'controlnet');
    if (!layer || layer.locked) return;
    if (this.controlnetEditLayerId !== id && this.controlnetBatchLayerId !== id) {
      canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
      this.controlnetBatchLayerId = id;
      queueMicrotask(() => { if (this.controlnetBatchLayerId === id) this.controlnetBatchLayerId = null; });
    }
    this.layers = this.layers.map(item => item.id === id ? { ...item, controlnet: { ...newControlnetLayer(), ...item.controlnet, ...patch } } : item);
  }
  setControlnetPreview(id: string, url: string | null) {
    this.layers = this.layers.map(item => item.id === id ? { ...item, controlnetPreviewUrl: url } : item);
  }

  updateLayerRegion(id: string, patch: { regionalPrompt?: string; regionalNegativePrompt?: string; regionalStrength?: number }) {
    this.layers = this.layers.map((layer) => layer.id === id && layer.type === "region" ? { ...layer, ...patch } : layer);
  }

  /** One rule for "can this layer go away": the last layer is the document. */
  get canDeleteActiveLayer(): boolean {
    return !!this.activeLayerId && this.layers.length > 1;
  }

  removeLayer(id: string) {
    if (!this.layers.some((layer) => layer.id === id)) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId, [id]);
    this.detachedLayers.get(id)?.destroy();
    this.detachedLayers.delete(id);
    const removed = this.layers.find((l) => l.id === id);
    if (removed?.controlnetPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(removed.controlnetPreviewUrl);
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
    if (source) {
      const clone = source.clone({ id: newId });
      clone.findOne('.raster-clip-mask')?.destroy();
      this._stageRef.add(clone);
    }
    this.layers = [
      ...this.layers.map((l) => l.order > layer.order ? { ...l, order: l.order + 1 } : l),
      {
        ...layer,
        id: newId,
        controlnet: layer.controlnet ? { ...layer.controlnet } : undefined,
        controlnetPreviewUrl: layer.controlnet?.sourceData ?? null,
        name: `${layer.name} copy`,
        order: layer.order + 1,
      },
    ];
    this.setActiveLayer(newId);
    return newId;
  }

  /** Copy the painted shape without changing the original's role in generation. */
  duplicateSpatialLayerAs(id: string, type: 'mask' | 'region'): string | null {
    const source = this.layers.find(layer => layer.id === id);
    if (!source || !isMaskLayer(source) || source.locked) return null;
    const newId = this.duplicateLayer(id);
    if (!newId) return null;
    this.layers = this.layers.map(layer => layer.id === newId ? {
      ...layer, type, locked: false, densityDenoise: false, denoise: undefined, maskGrow: undefined,
      inpaintSettings: undefined, inpaintWidth: undefined, inpaintHeight: undefined,
      modifierScope: type === 'region' ? layer.modifierScope : undefined,
      regionalPrompt: type === 'region' ? source.regionalPrompt ?? generation.positivePrompt : undefined,
      regionalNegativePrompt: type === 'region' ? source.regionalNegativePrompt ?? '' : undefined,
      regionalStrength: type === 'region' ? source.regionalStrength ?? 1 : undefined,
      name: locale.t(type === 'mask' ? 'canvas.mask_name' : 'canvas.region_name', { n: String(this.layers.filter(item => item.type === type).length + 1) }),
    } : layer);
    this.setActiveLayer(newId);
    return newId;
  }

  getLayerMoveTarget(id: string, direction: "up" | "down"): CanvasLayer | null {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer || layer.locked) return null;
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

  /** Reorder within a layer role in one undo operation; roles never change. */
  moveLayerTo(id: string, targetId: string, after: boolean): boolean {
    const layer = this.layers.find(item => item.id === id);
    const target = this.layers.find(item => item.id === targetId);
    if (!layer || layer.locked || !target || layer.type !== target.type || id === targetId) return false;
    const siblings = this.sortedLayers.filter(item => item.type === layer.type);
    const remaining = siblings.filter(item => item.id !== id);
    const index = remaining.findIndex(item => item.id === targetId) + (after ? 1 : 0);
    const reordered = [...remaining.slice(0, index), layer, ...remaining.slice(index)];
    if (reordered.every((item, index) => item.id === siblings[index].id) && (layer.groupId ?? null) === (target.groupId ?? null)) return false;
    const orders = new Map(reordered.map((item, index) => [item.id, siblings[index].order]));
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map(item => {
      const prior = item.id === id && !target.groupId ? this.preserveGroupScope(item) : item;
      return orders.has(item.id) ? { ...prior, order: orders.get(item.id)!,
        groupId: item.id === id ? target.groupId ?? null : item.groupId } : item;
    });
    this.setActiveLayer(id);
    return true;
  }

  renameLayer(id: string, name: string) {
    if (this.layers.find((layer) => layer.id === id)?.name === name) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, name } : l));
  }

  /** Modifier participation is independent of its on-canvas guide visibility. */
  toggleModifier(id: string) {
    const layer = this.layers.find(item => item.id === id);
    if (!layer || (layer.type !== 'region' && layer.type !== 'controlnet')) return;
    const enabled = !(layer.visible && (layer.type !== 'controlnet' || layer.controlnet?.enabled));
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map(item => item.id === id ? {...item, visible:enabled, controlnet:item.controlnet ? {...item.controlnet, enabled} : undefined} : item);
  }

  toggleLayerVisibility(id: string) {
    if (!this.layers.some((layer) => layer.id === id)) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
  }

  /** How the layer is drawn. For a mask or a region this is display only — a
   * run reads `coverage` — and for a raster it is the real opacity of a layer
   * that becomes part of the picture. */
  setLayerOpacity(id: string, opacity: number, recordHistory = true) {
    const layer = this.layers.find((item) => item.id === id);
    // The slider stays inside 0..1; the store cannot assume its caller does.
    if (!Number.isFinite(opacity)) return;
    const next = Math.max(0, Math.min(1, opacity));
    if (!layer || layer.opacity === next) return;
    if (recordHistory) canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, opacity: next } : l));
  }

  /** How much of a mask's painted area counts for a run, from nothing to all of
   * it. This is the value the exported mask is scaled by. */
  setLayerCoverage(id: string, coverage: number, recordHistory = true) {
    const layer = this.layers.find((item) => item.id === id && item.type !== "raster");
    if (!Number.isFinite(coverage)) return;
    const next = Math.max(0, Math.min(1, coverage));
    if (!layer || (layer.coverage ?? 1) === next) return;
    if (recordHistory) canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, coverage: next } : l));
  }

  /** Whether this mask's density drives its denoise per pixel. Stored as
   * undefined when off, so a layer that never used it stays as it was. */
  setLayerDensityDenoise(id: string, enabled: boolean) {
    const layer = this.layers.find((item) => item.id === id && item.type === "mask");
    if (!layer || !!layer.densityDenoise === enabled) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) =>
      l.id === id ? { ...l, densityDenoise: enabled ? true : undefined } : l
    );
  }

  /** Cosmetic: which palette colour this mask or region is drawn with. A raster
   * layer is the picture itself, so it has no overlay tint to choose. */
  setLayerTint(id: string, tint: string) {
    const layer = this.layers.find((item) => item.id === id);
    if (!layer || !isMaskLayer(layer) || layer.tint === tint) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, tint } : l));
  }

  toggleLayerLock(id: string) {
    if (!this.layers.some((layer) => layer.id === id)) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId);
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l));
  }

  toggleLayerContext(id: string) {
    this.layers = this.layers.map((layer) => layer.id === id && (isMaskLayer(layer) || layer.type === "controlnet")
      ? { ...layer, showContext: layer.showContext === false }
      : layer);
  }

  setActiveLayer(id: string) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    this.activeLayerId = id;
    this.activeGroupId = null;
    this.selectedWorkspaceSection = "layers";
    this.inpaintDrawMode = isMaskLayer(layer) ? "mask" : "regular";
  }

  fillActiveLayer() {
    const meta = this.activeLayer;
    const node = this._stageRef?.getLayers().find((layer: any) => layer.id() === meta?.id);
    if (!meta || !node || meta.type === 'controlnet' || meta.locked || !effectiveLayerVisibility(meta, this.groups) || this.selectedWorkspaceSection !== 'layers') return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId, [meta.id]);
    this.bumpPaintRevision();
    node.add(new Konva.Rect({ x: 0, y: 0, width: this.canvasWidth, height: this.canvasHeight,
      fill: isMaskLayer(meta) ? resolveTint(meta) : this.foregroundColor,
      opacity: this.brushSettings.opacity, listening: false }));
    node.batchDraw();
  }

  // Clear all content from a layer (via Konva stage ref)
  clearLayer(id: string) {
    if (!this._stageRef) return;
    const meta = this.layers.find((layer) => layer.id === id);
    if (!meta || meta.locked) return;
    canvasHistory.snapshotDocument(this.layers, this.activeLayerId, [id]);
    this.bumpPaintRevision();
    this.layers = this.layers.map((layer) => layer.id === id ? { ...layer, image: undefined, initialRegion: undefined, rasterPaint: undefined } : layer);
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
    this.layers = this.layers.map((layer) => layer.id === id && layer.type === "mask" && !layer.locked
      ? withMaskProcessingSettings(layer, enabled ? {
        settings: generation.inpaintSettings, width: generation.width, height: generation.height,
      } : null)
      : layer);
  }

  /** A mask defines the denoise and the mask settings. Prompts belong to regions
   * and to the document, never to a mask. */
  updateLayerGeneration(id: string, patch: { denoise?: number; maskGrow?: number }) {
    const values = { ...patch };
    if (values.denoise !== undefined) {
      if (!Number.isFinite(values.denoise)) return;
      values.denoise = Math.max(0, Math.min(1, values.denoise));
    }
    if (values.maskGrow !== undefined) {
      if (!Number.isFinite(values.maskGrow)) return;
      values.maskGrow = Math.max(0, Math.min(256, Math.round(values.maskGrow)));
    }
    this.layers = this.layers.map((layer) => layer.id === id && layer.type === "mask" && !layer.locked ? { ...layer, ...values } : layer);
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
    // The pixels or the placement of the picture changed; the layer record
    // around them may be identical, so the picture revision moves instead.
    this.bumpPaintRevision();
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
    this.bumpPaintRevision();
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

  /** Intrinsic pixels ignore display opacity and clipping; rendered pixels include both. */
  exportRasterLayer(id: string, options: { raw?: boolean } = {}): HTMLCanvasElement | null {
    const meta = this.layers.find(layer => layer.id === id && layer.type === 'raster');
    const node = this._stageRef?.getLayers().find((layer: any) => layer.id() === id);
    if (!meta || !node) return null;
    const pixels = captureLayer(node, this.canvasWidth, this.canvasHeight, { includeClipping: false });
    if (!options.raw && meta.clippingMaskId && meta.clippingEnabled !== false) {
      const maskMeta = this.layers.find(layer => layer.id === meta.clippingMaskId && layer.type === 'mask');
      const maskNode = maskMeta && this._stageRef?.getLayers().find((layer: any) => layer.id() === maskMeta.id);
      const ctx = pixels.getContext('2d')!;
      if (!maskNode) ctx.clearRect(0, 0, pixels.width, pixels.height);
      else {
        const mask = captureLayer(maskNode, this.canvasWidth, this.canvasHeight);
        const rgba = ctx.getImageData(0, 0, pixels.width, pixels.height);
        rgba.data.set(applySpatialMaskToRasterAlpha(rgba, mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height)));
        ctx.putImageData(rgba, 0, 0);
      }
    }
    if (options.raw || meta.opacity === 1) return pixels;
    const output = document.createElement('canvas');
    output.width = pixels.width; output.height = pixels.height;
    const ctx = output.getContext('2d')!;
    ctx.globalAlpha = meta.opacity;
    ctx.drawImage(pixels, 0, 0);
    return output;
  }

  exportMaskLayer(id: string): HTMLCanvasElement | null {
    const meta = this.layers.find(layer => layer.id === id && isMaskLayer(layer)
      && effectiveLayerVisibility(layer, this.groups) && (layer.coverage ?? 1) > 0);
    const node = this._stageRef?.getLayers().find((layer: any) => layer.id() === id);
    if (!meta || !node) return null;
    const result = maskToGrayscale(captureLayer(node, this.canvasWidth, this.canvasHeight));
    if (!result) return null;
    const ctx = result.getContext('2d')!;
    if (meta.targetRasterId != null) {
      const raster = this.exportRasterLayer(meta.targetRasterId, { raw: true });
      // A lost explicit target cannot accidentally permit a full-canvas edit.
      if (!raster) return null;
      const maskData = ctx.getImageData(0, 0, result.width, result.height);
      const rasterData = raster.getContext('2d')!.getImageData(0, 0, raster.width, raster.height);
      maskData.data.set(restrictGenerationMaskToRasterAlpha(maskData, rasterData));
      ctx.putImageData(maskData, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 1 - (meta.coverage ?? 1);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, result.width, result.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
    this.viewport = fittedCanvasViewport(
      containerWidth,
      containerHeight,
      this.canvasWidth,
      this.canvasHeight,
    );
    this.viewportInitialized = true;
  }

  viewportIsFitted(containerWidth = this.viewportWidth, containerHeight = this.viewportHeight) {
    return this.viewportInitialized && viewportMatchesCanvasFit(
      this.viewport,
      containerWidth,
      containerHeight,
      this.canvasWidth,
      this.canvasHeight,
    );
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
    // Every caller eventually reaches this method (the transformer, a base
    // import, undo and image load). Normalize once here so a fractional or
    // non-finite intermediate value cannot leave node geometry and document
    // metadata in different coordinate systems.
    const nextWidth = Math.max(1, Math.round(Number.isFinite(width) ? width : this.canvasWidth));
    const nextHeight = Math.max(1, Math.round(Number.isFinite(height) ? height : this.canvasHeight));
    if (nextWidth === this.canvasWidth && nextHeight === this.canvasHeight) return;
    const keepFitted = this.viewportIsFitted();
    // A completed preview belongs to the exact document geometry captured at
    // submission time. Keeping it after a manual resize would let Apply restore
    // stale dimensions and misalign the saved mask.
    this.clearPendingInpaintResult();
    this.inpaintSourceVersion += 1;
    this.invalidateInpaintPrompts();
    const scaleX = this.canvasWidth > 0 ? nextWidth / this.canvasWidth : 1;
    const scaleY = this.canvasHeight > 0 ? nextHeight / this.canvasHeight : 1;
    const scaleLayerContents = (node: any) => {
      for (const child of node?.getChildren?.() ?? []) {
        // Raster assets are driven by their serializable layer metadata below.
        if (child.name?.() === "raster-asset" || child.name?.() === "raster-clip-mask") continue;
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
    this.canvasWidth = nextWidth;
    this.canvasHeight = nextHeight;
    this.viewport = keepFitted
      ? fittedCanvasViewport(this.viewportWidth, this.viewportHeight, nextWidth, nextHeight)
      : {
          ...this.viewport,
          panX: centerX - nextWidth * this.viewport.zoom / 2,
          panY: centerY - nextHeight * this.viewport.zoom / 2,
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
      generation.width = nextWidth;
      generation.height = nextHeight;
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
    this.groups = [];
    this.activeGroupId = null;
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
      const target = layer.targetRasterId ? this.exportRasterLayer(layer.targetRasterId, { raw: true }) : null;
      const targetAlpha = target?.getContext('2d')!.getImageData(0, 0, width, height).data;
      for (let i = 0; i < support.length; i++) {
        if (affected[i] > 0 && (!layer.targetRasterId || (targetAlpha && targetAlpha[i * 4 + 3] > 0))) support[i] = 255;
      }
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
    this.lastSubmittedRasterLayerIds = this.layers.filter(layer => layer.type === 'raster' && effectiveLayerVisibility(layer, this.groups) && layer.opacity > 0).map(layer => layer.id);
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

canvasHistory.setOnDocumentRestored((layers, activeLayerId, groups, activeGroupId) => {
  canvas.layers = layers;
  canvas.groups = groups ?? [];
  canvas.activeGroupId = activeGroupId ?? null;
  canvas.activeLayerId = activeLayerId;
});
canvasHistory.setDocumentStateProvider(() => ({
  layers: canvas.layers,
  activeLayerId: canvas.activeLayerId,
  groups: canvas.groups,
  activeGroupId: canvas.activeGroupId,
}));
