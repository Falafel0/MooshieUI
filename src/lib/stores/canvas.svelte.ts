import { uploadImageBytes } from "../utils/api.js";
import { generation } from "./generation.svelte.js";
import { locale } from "./locale.svelte.js";
import type { MaskInpaintStep } from "../utils/maskInpaintChain.js";

export type ToolType = "brush" | "eraser" | "rectFill" | "lasso" | "eyedropper" | "move" | "view" | "transform";

export interface CanvasLayer {
  id: string;
  name: string;
  type: "raster" | "mask";
  visible: boolean;
  opacity: number;
  locked: boolean;
  order: number;
  /** Per-mask inpaint denoise (mask layers only). */
  denoise?: number;
  /** Per-mask inpaint prompt (mask layers only). Empty falls back to the global prompt. */
  prompt?: string;
  /** When true, this mask's prompt is APPENDED to the base prompt instead of replacing it. */
  promptAddToBase?: boolean;
  /** Per-mask inpaint grow (mask expansion px). Falls back to the global setting. */
  growMaskBy?: number;
  /** Per-mask inpaint area mode. Falls back to the global setting. */
  inpaintArea?: "whole" | "mask_only";
  /** Per-mask mask_only box resolution. Falls back to the global setting. */
  inpaintMaskWidth?: number;
  inpaintMaskHeight?: number;
  /** Per-mask mask edge blend pixels. Falls back to the global setting. */
  inpaintMaskBlend?: number;
  /** Per-mask mask hipass filter. Falls back to the global setting. */
  inpaintMaskHipass?: number;
  /** Per-mask context crop factor. Falls back to the global setting. */
  inpaintContextFactor?: number;
  /** Per-mask device mode. Falls back to the global setting. */
  inpaintDeviceMode?: "cpu (compatible)" | "gpu (much faster)";
  /** Per-mask differential diffusion toggle. Falls back to the global setting. */
  differentialDiffusion?: boolean;
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

export interface InpaintBaseSnapshot {
  previewUrl: string | null;
  uploadedInputName: string | null;
  width: number;
  height: number;
  maskSnapshotUrl: string | null;
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

function loadImageDataUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Feather a white-on-black mask's luminance (red channel) with a separable box
// blur so the inpaint result's alpha edge is a soft gradient instead of a hard
// binary cut (which leaves a visible seam). The mask is white(255)=keep /
// black(0)=transparent; only the red channel carries the luminance.
function featherMaskLuminance(data: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0 || width <= 0 || height <= 0) return;
  const src = new Float32Array(width * height);
  for (let i = 0; i < src.length; i++) src[i] = data[i << 2];
  const tmp = new Float32Array(src.length);
  // Horizontal box blur
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let sum = 0;
      for (let xx = x0; xx <= x1; xx++) sum += src[row + xx];
      tmp[row + x] = sum / (x1 - x0 + 1);
    }
  }
  // Vertical box blur, writing the feathered luminance back to the red channel.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      let sum = 0;
      for (let yy = y0; yy <= y1; yy++) sum += tmp[yy * width + x];
      data[(y * width + x) << 2] = sum / (y1 - y0 + 1);
    }
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
  activeLayerId = $state<string | null>(null);
  /** Id of the background raster layer that mirrors the input image. */
  backgroundLayerId = $state<string | null>(null);

  // Per-layer pixel thumbnails (data URLs), keyed by layer id
  layerThumbnails = $state<Record<string, string>>({});

  // Canvas document dimensions
  canvasWidth = $state(1024);
  canvasHeight = $state(1024);

  // Viewport
  viewport = $state<CanvasViewport>({ zoom: 1, panX: 0, panY: 0 });

  // Bounding box (generation region)
  boundingBox = $state<BoundingBox>({ x: 0, y: 0, width: 1024, height: 1024, locked: false });

  // Mask overlay
  maskOverlayColor = $state("#ff3333");
  maskOverlayOpacity = $state(0.45);
  maskOverlayVisible = $state(true);

  // UI state
  isCanvasMode = $state(false);
  isPointerOverStage = $state(false);
  // Drawing mode is derived from the active layer type: selecting a mask layer
  // enables mask drawing, selecting a raster layer enables regular drawing.
  // No more global toggle — the layer panel is the source of truth.
  get inpaintDrawMode(): "mask" | "regular" {
    return this.activeLayer?.type === "mask" ? "mask" : "regular";
  }
  showGrid = $state(false);
  showRuleOfThirds = $state(false);
  showCheckerboard = $state(true);
  // Compare mode: hide editable layers and show only the original input image.
  showOriginalForComparison = $state(false);
  cursorPos = $state<{ x: number; y: number } | null>(null);
  referenceImageUrl = $state<string | null>(null);
  // Whether referenceImageUrl is an object URL this store created and owns
  // (must be revoked when replaced/cleared). Gallery/display URLs passed via
  // setReferenceImage are borrowed and owned elsewhere.
  private referenceImageUrlOwned = false;
  originalInpaintInputImageName = $state<string | null>(null);
  originalInpaintWidth = $state<number | null>(null);
  originalInpaintHeight = $state<number | null>(null);
  preparedInpaintPreviewUrl = $state<string | null>(null);
  preparedInpaintOwned = $state(false);
  inpaintSourceVersion = $state(0);
  persistedMaskPreviewUrl = $state<string | null>(null);
  // Base-image undo history for iterative inpainting. Each entry is a base that
  // was inpainted plus the mask that was applied to it, so the user can step
  // back and so the same mask can be re-hydrated onto the incoming result.
  inpaintBaseHistory = $state<InpaintBaseSnapshot[]>([]);
  // A tinted mask snapshot waiting to be re-hydrated onto the freshly-rebuilt
  // mask layer after a base swap (consumed by CanvasStage).
  pendingMaskRestoreUrl = $state<string | null>(null);
  // A layer just duplicated whose pixels still need to be copied from its source
  // (consumed by CanvasStage once syncKonvaLayers creates the empty target layer).
  pendingDuplicate = $state<{ sourceId: string; targetId: string } | null>(null);
  // An image to inject into a freshly-created layer (consumed by CanvasStage after
  // syncKonvaLayers) — used by applyInpaintAsLayer to stamp the changed region.
  pendingLayerImage = $state<{ layerId: string; imageUrl: string; owned: boolean } | null>(null);
  // A mask layer that needs a thumbnail refresh after a direct Konva mutation
  // (e.g. sendActiveLayerToMask) — consumed by CanvasStage.
  pendingThumbRefresh = $state<string[]>([]);
  // A raster→mask content move that must run after syncKonvaLayers has created
  // the (possibly freshly-added) target mask's Konva layer — consumed by CanvasStage.
  pendingSendToMask = $state<{ sourceId: string; maskId: string } | null>(null);
  // The latest inpaint result, held for DISPLAY ONLY. Pressing "Generate" always
  // re-rolls the current base + mask (never this result); it is only shown as the
  // canvas background so the user can preview it. "Apply" promotes it to the base.
  pendingResultPreviewUrl = $state<string | null>(null);
  pendingResultOwned = $state(false);
  pendingResultInputName = $state<string | null>(null);
  pendingResultWidth = $state<number | null>(null);
  pendingResultHeight = $state<number | null>(null);
  // The mask snapshot captured when the pending result was generated. Used by
  // applyInpaintAsLayer so a mask edited AFTER generation doesn't change the
  // alpha region of the applied result.
  pendingResultMaskUrl = $state<string | null>(null);
  // While a finished inpaint result is being previewed, the editable mask strokes
  // are hidden so the clean result is visible. This flips true once the user starts
  // painting more mask, bringing the mask back so they can see what they're editing.
  maskEditedSinceResult = $state(false);

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
    return [...this.layers].sort((a, b) => b.order - a.order);
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

  // Replace the reference image, revoking the previous URL when this store owns
  // it. `owned` is true only for object URLs this store created (from
  // normalizeGenerationInputBytes); gallery/display URLs are borrowed.
  private setReferenceImageUrl(url: string | null, owned: boolean) {
    const prev = this.referenceImageUrl;
    if (prev && this.referenceImageUrlOwned && prev !== url) {
      URL.revokeObjectURL(prev);
    }
    this.referenceImageUrl = url;
    this.referenceImageUrlOwned = url !== null && owned;
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
    this.maskEditedSinceResult = false;
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
    this.inpaintSourceVersion += 1;

    if (!source) {
      this.originalInpaintInputImageName = null;
      this.originalInpaintWidth = null;
      this.originalInpaintHeight = null;
      this.setReferenceImageUrl(null, false);
      return;
    }

    this.setReferenceImageUrl(source.previewUrl, true);
    this.originalInpaintInputImageName = source.uploadedInputName;
    this.originalInpaintWidth = source.width;
    this.originalInpaintHeight = source.height;
    generation.inputImage = source.uploadedInputName;
    generation.width = source.width;
    generation.height = source.height;
    this.clearMask();
    this.initCanvas(source.width, source.height);
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
    // Base changed: invalidate any in-flight result from the previous base.
    this.inpaintSourceVersion += 1;
    // Snapshot the outgoing base and the mask applied to it so the user can undo
    // back to it, and so the same mask can be re-hydrated onto the incoming
    // result (letting "Generate" re-roll the same region without repainting).
    const outgoingMask = this.snapshotInpaintMask();
    this.inpaintBaseHistory = [
      ...this.inpaintBaseHistory,
      {
        previewUrl: this.preparedInpaintPreviewUrl ?? this.referenceImageUrl,
        uploadedInputName: generation.inputImage,
        width: generation.width,
        height: generation.height,
        maskSnapshotUrl: outgoingMask,
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

    // Rebuild layers for the new base, then re-hydrate the mask onto the fresh
    // mask layer. Clear the persisted (non-editable) overlay so the mask isn't
    // drawn twice.
    this.persistedMaskPreviewUrl = null;
    this.initCanvas(source.width, source.height);
    this.pendingMaskRestoreUrl = outgoingMask;
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
  }) {
    // A superseded re-roll: revoke the previous pending preview before replacing.
    this.clearPendingInpaintResult();
    this.pendingResultPreviewUrl = source.previewUrl;
    this.pendingResultOwned = source.owned;
    this.pendingResultInputName = source.uploadedInputName;
    this.pendingResultWidth = source.width;
    this.pendingResultHeight = source.height;
    // Capture the mask that produced this result, so applyInpaintAsLayer uses it
    // even if the user edits the mask afterward.
    this.pendingResultMaskUrl = this.persistedMaskPreviewUrl;
  }

  // Promote the pending inpaint result to be the new base: checkpoint the current
  // base + its mask for undo, adopt the result as the base, then start a fresh
  // mask on top. Ownership of the pending preview URL transfers to the prepared
  // override (so it is NOT revoked here).
  applyInpaintResult() {
    if (!this.pendingResultPreviewUrl || this.pendingResultWidth == null || this.pendingResultHeight == null) {
      return;
    }

    // Base changed: invalidate any in-flight result from the previous base.
    this.inpaintSourceVersion += 1;

    const outgoingMask = this.snapshotInpaintMask();
    this.inpaintBaseHistory = [
      ...this.inpaintBaseHistory,
      {
        previewUrl: this.preparedInpaintPreviewUrl ?? this.referenceImageUrl,
        uploadedInputName: generation.inputImage,
        width: generation.width,
        height: generation.height,
        maskSnapshotUrl: outgoingMask,
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
    // Preserve the original canvas dimensions — the inpaint result can come back
    // a few px off (VAE padding rounds to multiples of 8), and adopting those
    // would silently shrink/grow the canvas on apply.
    generation.width = this.canvasWidth;
    generation.height = this.canvasHeight;

    // Clear pending WITHOUT revoking (ownership was transferred above).
    this.pendingResultPreviewUrl = null;
    this.pendingResultOwned = false;
    this.pendingResultInputName = null;
    this.pendingResultWidth = null;
    this.pendingResultHeight = null;

    // Fresh mask on the new base.
    this.persistedMaskPreviewUrl = null;
    this.clearMask();
    this.initCanvas(generation.width, generation.height);
  }

  // Apply the pending inpaint result as a NEW raster layer containing ONLY the
  // changed (masked) region, transparent elsewhere, stacked on top of the
  // untouched base — Photoshop-style non-destructive inpaint. The result is
  // composited with the white-on-black mask (mask luminance → alpha). Returns
  // the new layer id, or null when there is nothing to apply.
  async applyInpaintAsLayer(): Promise<string | null> {
    if (!this.pendingResultPreviewUrl) return null;

    // Detach the pending result SYNCHRONOUSLY before any await, so a newer
    // result arriving mid-load is neither revoked by mistake nor composited.
    // Ownership of the result object URL transfers to this call.
    const resultUrl = this.pendingResultPreviewUrl;
    const resultOwned = this.pendingResultOwned;
    this.pendingResultPreviewUrl = null;
    this.pendingResultOwned = false;
    this.pendingResultInputName = null;
    this.pendingResultWidth = null;
    this.pendingResultHeight = null;
    this.maskEditedSinceResult = false;
    const maskUrl = this.pendingResultMaskUrl;

    // Composite at CANVAS dimensions: the result may return a few px off (VAE
    // padding rounds to multiples of 8, and normalizeGenerationInputBytes shrinks
    // >1M px inputs), while the mask snapshot is captured at canvas dimensions.
    // Compositing both onto a canvas-sized offscreen keeps them aligned and
    // avoids the mask being stretched out of register (then re-stretched by
    // injectLayerImage).
    const w = this.canvasWidth;
    const h = this.canvasHeight;
    if (w <= 0 || h <= 0) {
      if (resultOwned) URL.revokeObjectURL(resultUrl);
      return null;
    }

    let layerId: string | null = null;
    try {
      let resultImg: HTMLImageElement;
      try {
        resultImg = await loadImageDataUrl(resultUrl);
      } catch {
        return null;
      }

      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(resultImg, 0, 0, w, h);

      // Keep only the masked region: set output alpha from the mask's luminance.
      if (maskUrl) {
        try {
          const maskImg = await loadImageDataUrl(maskUrl);
          const maskCanvas = document.createElement("canvas");
          maskCanvas.width = w;
          maskCanvas.height = h;
          const mctx = maskCanvas.getContext("2d");
          if (mctx) {
            mctx.drawImage(maskImg, 0, 0, w, h);
            const maskData = mctx.getImageData(0, 0, w, h);
            // Feather the mask edge so the result alpha is a soft gradient, not a
            // hard binary cut (otherwise the inpainted region shows a visible seam).
            featherMaskLuminance(maskData.data, w, h, 4);
            const outData = ctx.getImageData(0, 0, w, h);
            // Mask is white-on-black: white (255) = keep, black (0) = transparent.
            for (let i = 0; i < maskData.data.length; i += 4) {
              outData.data[i + 3] = maskData.data[i];
            }
            ctx.putImageData(outData, 0, 0);
          }
        } catch {
          // Mask failed to load — fall back to keeping the full result.
        }
      }

      // Bail on an empty mask rather than creating a useless blank layer.
      const check = ctx.getImageData(0, 0, w, h).data;
      let hasPixels = false;
      for (let i = 3; i < check.length; i += 4) {
        if (check[i] > 0) {
          hasPixels = true;
          break;
        }
      }
      if (!hasPixels) return null;

      const blob = await new Promise<Blob | null>((resolve) =>
        off.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) return null;
      const url = URL.createObjectURL(blob);

      layerId = this.addLayer("raster", locale.t("canvas.layer.inpaint_result"));
      this.pendingLayerImage = { layerId, imageUrl: url, owned: true };
      return layerId;
    } finally {
      // The pending result's pixels are now consumed into the new layer.
      if (resultOwned) URL.revokeObjectURL(resultUrl);
    }
  }

  get canApplyInpaintResult(): boolean {
    return generation.mode === "inpainting" && this.pendingResultPreviewUrl !== null;
  }

  // Called by the canvas when the user paints/edits the mask. While a pending
  // inpaint result is on screen the mask is hidden; this brings it back so the
  // user can see the region they're adding to.
  markMaskEdited() {
    if (this.pendingResultPreviewUrl && !this.maskEditedSinceResult) {
      this.maskEditedSinceResult = true;
    }
  }

  // Whether the editable inpaint mask strokes should be hidden on the canvas. True
  // only while a finished result is being previewed and the user is not painting
  // more mask. The caller additionally keeps the mask visible during a re-roll
  // (via progress.isGenerating), which the store deliberately does not know about.
  get shouldHideInpaintMask(): boolean {
    return (
      generation.mode === "inpainting" &&
      this.pendingResultPreviewUrl !== null &&
      !this.maskEditedSinceResult
    );
  }

  restoreOriginalInpaintSource() {
    if (!this.originalInpaintInputImageName || this.originalInpaintWidth == null || this.originalInpaintHeight == null) {
      return;
    }
    // Base changed: invalidate any in-flight result from the previous base.
    this.inpaintSourceVersion += 1;
    this.clearPreparedInpaintOverride();
    this.clearPendingInpaintResult();
    this.clearInpaintBaseHistory();
    generation.inputImage = this.originalInpaintInputImageName;
    // Restore the base to the ORIGINAL input but KEEP the canvas layers + masks.
    // "Clear all"/"Dismiss" reset the staged input, not the user's drawings —
    // clearMask()/initCanvas() here would wipe the masks and raster layers.
    generation.width = this.canvasWidth;
    generation.height = this.canvasHeight;
  }

  clearInpaintSession() {
    this.clearMask();
    this.clearPreparedInpaintOverride();
    this.clearPendingInpaintResult();
    this.clearInpaintBaseHistory();
    this.inpaintSourceVersion += 1;
    this.originalInpaintInputImageName = null;
    this.originalInpaintWidth = null;
    this.originalInpaintHeight = null;
    this.setReferenceImageUrl(null, false);
  }

  private clearInpaintBaseHistory() {
    for (const entry of this.inpaintBaseHistory) {
      if (entry.owned && entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    }
    this.inpaintBaseHistory = [];
  }

  // Step the inpaint base back to the previous image, re-applying the mask that
  // was on it. The current (discarded) prepared preview is revoked.
  undoInpaintBase() {
    if (!this.inpaintBaseHistory.length) return;

    // Stepping back discards any un-applied result being previewed.
    this.clearPendingInpaintResult();
    // Base changed: invalidate any in-flight result from the previous base.
    this.inpaintSourceVersion += 1;

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
    generation.width = entry.width;
    generation.height = entry.height;

    this.persistedMaskPreviewUrl = null;
    this.initCanvas(entry.width, entry.height);
    this.pendingMaskRestoreUrl = entry.maskSnapshotUrl;
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

  // The reference image actually shown on the canvas. In compare mode this is
  // the ORIGINAL input (pre-inpaint), otherwise the effective (current) image.
  get referenceImageToShow(): string | null {
    if (this.showOriginalForComparison) return this.referenceImageUrl;
    return this.effectiveReferenceImage;
  }

  toggleShowOriginal() {
    this.showOriginalForComparison = !this.showOriginalForComparison;
  }

  setReferenceImage(url: string | null) {
    this.setReferenceImageUrl(url, false);
  }

  setPersistedMaskPreview(url: string | null) {
    this.persistedMaskPreviewUrl = url;
  }

  clearMask() {
    generation.maskImage = null;
    this.persistedMaskPreviewUrl = null;

    if (!this._stageRef) return;
    const stageLayers = this._stageRef.getLayers?.() ?? [];
    const clearedIds: string[] = [];
    for (const layerMeta of this.layers.filter((l) => l.type === "mask")) {
      const layer = stageLayers.find((l: any) => l.id?.() === layerMeta.id);
      layer?.destroyChildren?.();
      layer?.batchDraw?.();
      clearedIds.push(layerMeta.id);
    }
    // Refresh the mask thumbnails so the panel stops showing the old mask.
    if (clearedIds.length) this.pendingThumbRefresh = clearedIds;
  }

  // Clear raster strokes (and Apply-as-Layer results) on all raster layers, but
  // keep the background raster's input image. The background layer keeps only its
  // "background-image" node (the input mirrored from referenceImageToShow);
  // non-background raster layers are emptied entirely.
  clearRasters() {
    if (!this._stageRef) return;
    const stageLayers = this._stageRef.getLayers?.() ?? [];
    const clearedIds: string[] = [];
    for (const layerMeta of this.layers.filter((l) => l.type === "raster")) {
      const layer = stageLayers.find((l: any) => l.id?.() === layerMeta.id);
      if (!layer) continue;
      if (layerMeta.id === this.backgroundLayerId) {
        for (const child of [...(layer.getChildren?.() ?? [])]) {
          if (child.name?.() !== "background-image") child.destroy?.();
        }
      } else {
        layer.destroyChildren?.();
      }
      layer.batchDraw?.();
      clearedIds.push(layerMeta.id);
    }
    if (clearedIds.length) this.pendingThumbRefresh = clearedIds;
  }

  // Clear all editable content (masks + raster strokes) while keeping the layer
  // structure and the background input image intact.
  clearAllContent() {
    this.clearMask();
    this.clearRasters();
  }

  // Composite the editable inpaint mask layer(s) into a tinted, transparent-bg
  // data URL so the mask survives a base swap (layers are rebuilt on swap).
  // Returns null when there is no mask layer or the mask is empty.
  snapshotInpaintMask(): string | null {
    const stage = this._stageRef;
    if (!stage) return null;

    const maskMetas = this.layers.filter((l) => l.type === "mask");
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

      // The viewport is applied as a layer transform; reset it so the snapshot
      // captures canvas-space pixels, then restore it. Force the mask visible —
      // a hidden mask (result being previewed) otherwise snapshots as empty.
      const origScaleX = layer.scaleX();
      const origScaleY = layer.scaleY();
      const origX = layer.x();
      const origY = layer.y();
      const origVisible = layer.visible();
      layer.scaleX(1);
      layer.scaleY(1);
      layer.x(0);
      layer.y(0);
      layer.visible(true);
      try {
        const layerCanvas = layer.toCanvas({
          pixelRatio: 1,
          width: this.canvasWidth,
          height: this.canvasHeight,
        });
        ctx.drawImage(layerCanvas, 0, 0);
        drew = true;
      } catch (error) {
        console.error("Failed to snapshot inpaint mask:", error);
      } finally {
        layer.scaleX(origScaleX);
        layer.scaleY(origScaleY);
        layer.x(origX);
        layer.y(origY);
        layer.visible(origVisible);
      }
    }

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

  sendActiveLayerToMask(id?: string): boolean {
    const sourceId = id ?? this.activeLayerId;
    if (!this._stageRef || !sourceId) return false;

    const sourceLayerMeta = this.layers.find((l) => l.id === sourceId);
    if (!sourceLayerMeta || sourceLayerMeta.type !== "raster") return false;

    // Resolve the source Konva layer and check it has content BEFORE creating a
    // mask, so an empty source can't leave a stray mask layer behind.
    const stageLayers = this._stageRef.getLayers?.() ?? [];
    const sourceLayer = stageLayers.find((layer: any) => layer.id?.() === sourceId);
    if (!sourceLayer) return false;
    const sourceNodes = sourceLayer.getChildren?.() ?? [];
    if (!sourceNodes.length) return false;

    // Ensure a mask layer exists (create if the user removed the only one).
    // Prefer the ACTIVE mask as the target so multi-mask sends land on the mask
    // the user is editing, not always the first.
    let maskLayerMeta =
      this.activeLayer?.type === "mask"
        ? this.activeLayer
        : this.layers.find((l) => l.type === "mask");
    if (!maskLayerMeta) {
      const newId = this.addLayer("mask", locale.t("canvas.layer.inpaint_mask"));
      maskLayerMeta = this.layers.find((l) => l.id === newId) ?? undefined;
    }
    if (!maskLayerMeta) return false;

    // Undo snapshot happens in moveNodesToMask (after the mask's Konva layer
    // exists) so both source and mask target are captured.
    this.activeLayerId = maskLayerMeta.id;
    // The mask's Konva layer may not exist yet (a freshly-added mask only gets
    // one after syncKonvaLayers runs in CanvasStage's $effect). Defer the actual
    // node move so the target layer is resolved from the current Konva tree.
    this.pendingSendToMask = { sourceId, maskId: maskLayerMeta.id };
    // Refresh BOTH thumbnails once the move completes.
    this.pendingThumbRefresh = [maskLayerMeta.id, sourceId];
    return true;
  }

  // Collect each visible mask layer's white-on-black PNG + per-mask denoise/prompt
  // for the sequential per-mask inpaint chain. Skips empty masks.
  async getMaskInpaintSteps(): Promise<MaskInpaintStep[]> {
    const stage = this._stageRef;
    if (!stage) return [];
    const maskMetas = this.layers
      .filter((l) => l.type === "mask" && l.visible)
      .sort((a, b) => a.order - b.order);
    if (!maskMetas.length) return [];
    const stageLayers = stage.getLayers?.() ?? [];
    const steps: MaskInpaintStep[] = [];
    for (const meta of maskMetas) {
      const layer = stageLayers.find((l: any) => l.id?.() === meta.id);
      if (!layer) continue;
      const maskBytes = await this.maskLayerToPngBytes(layer);
      if (!maskBytes) continue;
      steps.push({
        id: meta.id,
        name: meta.name,
        maskBytes,
        denoise: meta.denoise ?? generation.denoise,
        prompt: meta.prompt ?? "",
        promptAddToBase: meta.promptAddToBase ?? false,
        growMaskBy: meta.growMaskBy ?? generation.growMaskBy,
        inpaintArea: meta.inpaintArea ?? generation.inpaintArea,
        inpaintMaskWidth: meta.inpaintMaskWidth ?? generation.inpaintMaskWidth,
        inpaintMaskHeight: meta.inpaintMaskHeight ?? generation.inpaintMaskHeight,
        inpaintMaskBlend: meta.inpaintMaskBlend ?? generation.inpaintMaskBlend,
        inpaintMaskHipass: meta.inpaintMaskHipass ?? generation.inpaintMaskHipass,
        inpaintContextFactor: meta.inpaintContextFactor ?? generation.inpaintContextFactor,
        inpaintDeviceMode: meta.inpaintDeviceMode ?? generation.inpaintDeviceMode,
        differentialDiffusion: meta.differentialDiffusion ?? generation.differentialDiffusion,
      });
    }
    return steps;
  }

  // Extract a single mask layer as white-on-black PNG bytes. Mask strokes are
  // drawn tinted (maskOverlayColor); any non-transparent pixel becomes white and
  // everything else opaque black, matching the ComfyUI inpaint mask convention.
  private async maskLayerToPngBytes(layer: any): Promise<number[] | null> {
    const origScaleX = layer.scaleX();
    const origScaleY = layer.scaleY();
    const origX = layer.x();
    const origY = layer.y();
    const origVisible = layer.visible();
    layer.scaleX(1);
    layer.scaleY(1);
    layer.x(0);
    layer.y(0);
    layer.visible(true);

    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = layer.toCanvas({
        pixelRatio: 1,
        width: this.canvasWidth,
        height: this.canvasHeight,
      });
    } catch (error) {
      console.error("Failed to extract mask layer:", error);
    } finally {
      layer.scaleX(origScaleX);
      layer.scaleY(origScaleY);
      layer.x(origX);
      layer.y(origY);
      layer.visible(origVisible);
    }

    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const p = imgData.data;
    let hasMask = false;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] > 0 && (p[i] > 64 || p[i + 1] > 64 || p[i + 2] > 64)) {
        p[i] = p[i + 1] = p[i + 2] = 255;
        p[i + 3] = 255;
        hasMask = true;
      } else {
        p[i] = p[i + 1] = p[i + 2] = 0;
        p[i + 3] = 255;
      }
    }
    if (!hasMask) return null;
    ctx.putImageData(imgData, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!blob) return null;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }

  // Brush
  adjustBrushSize(delta: number) {
    this.brushSettings = {
      ...this.brushSettings,
      size: Math.max(1, Math.min(500, this.brushSettings.size + delta)),
    };
  }

  // Layers
  addLayer(type: "raster" | "mask" = "raster", name?: string): string {
    const id = genLayerId();
    const maxOrder = this.layers.reduce((max, l) => Math.max(max, l.order), -1);
    let layerName = name;
    if (!layerName && type === "raster") {
      // Pick the first unused "Raster N" name so removing a layer doesn't make
      // a later add reuse an already-taken name.
      const existing = new Set(this.layers.map((l) => l.name));
      let n = this.layers.filter((l) => l.type === "raster").length + 1;
      do {
        layerName = locale.t("canvas.layer.raster", { n: String(n) });
        n += 1;
      } while (existing.has(layerName));
    } else if (!layerName) {
      layerName = locale.t("canvas.layer.inpaint_mask");
    }

    this.layers = [
      ...this.layers,
      {
        id,
        name: layerName,
        type,
        visible: true,
        opacity: 1,
        locked: false,
        order: maxOrder + 1,
        // Mask layers carry their own inpaint denoise + prompt.
        denoise: type === "mask" ? generation.denoise : undefined,
        prompt: type === "mask" ? "" : undefined,
      },
    ];
    this.activeLayerId = id;
    return id;
  }

  removeLayer(id: string) {
    const removed = this.layers.find((l) => l.id === id);
    this.layers = this.layers.filter((l) => l.id !== id);
    this.clearLayerThumbnail(id);
    if (removed?.type === "mask") {
      // Removing a mask invalidates the composite mask synced to the generation
      // store and the persisted preview used by applyInpaintAsLayer — otherwise
      // ComfyUI keeps inpainting with a deleted mask. Only null the state when
      // the LAST mask was removed: with other masks surviving, nulling here would
      // make ComfyUI ignore them too; the composite is re-synced on the next
      // auto-commit / Generate instead.
      const remainingMasks = this.layers.some((l) => l.type === "mask");
      if (!remainingMasks) {
        generation.maskImage = null;
        this.persistedMaskPreviewUrl = null;
      }
    }
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

  // Add a staged/gallery image as a NEW raster layer, letterboxed onto the
  // canvas. The URL is borrowed (owned elsewhere); injectLayerImage stamps it
  // without revoking.
  addImageAsRasterLayer(imageUrl: string, name?: string): string | null {
    if (!imageUrl) return null;
    const layerId = this.addLayer("raster", name);
    this.pendingLayerImage = { layerId, imageUrl, owned: false };
    return layerId;
  }

  duplicateLayer(id: string): string | null {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return null;
    const newId = genLayerId();
    const maxOrder = this.layers.reduce((max, l) => Math.max(max, l.order), -1);
    this.layers = [
      ...this.layers,
      {
        ...layer,
        id: newId,
        name: `${layer.name} copy`,
        order: maxOrder + 1,
      },
    ];
    this.activeLayerId = newId;
    // The clone currently has no pixel content — request a pixel copy from the
    // source Konva layer once syncKonvaLayers creates the empty target layer.
    this.pendingDuplicate = { sourceId: id, targetId: newId };
    return newId;
  }

  reorderLayer(id: string, direction: "up" | "down") {
    const sorted = [...this.layers].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((l) => l.id === id);
    if (idx < 0) return;

    const swapIdx = direction === "up" ? idx + 1 : idx - 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const tmpOrder = sorted[idx].order;
    sorted[idx].order = sorted[swapIdx].order;
    sorted[swapIdx].order = tmpOrder;

    this.layers = [...sorted];
  }

  renameLayer(id: string, name: string) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, name } : l));
  }

  toggleLayerVisibility(id: string) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
  }

  setLayerOpacity(id: string, opacity: number) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, opacity } : l));
  }

  setLayerDenoise(id: string, denoise: number) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, denoise } : l));
  }

  setLayerPrompt(id: string, prompt: string) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, prompt } : l));
  }

  setLayerPromptAddToBase(id: string, add: boolean) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, promptAddToBase: add } : l));
  }

  // Generic per-layer inpaint setting setter (key = CanvasLayer field name).
  setLayerInpaintSetting(id: string, key: string, value: unknown) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, [key]: value } : l));
  }

  toggleLayerLock(id: string) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l));
  }

  setActiveLayer(id: string) {
    this.activeLayerId = id;
  }

  // Select the first mask layer (used when entering the inpaint flow so the
  // user starts drawing the mask).
  selectMaskLayer(): boolean {
    // Keep the ACTIVE mask if one is already selected (multi-mask: entering the
    // inpaint flow should not yank selection back to mask #1).
    if (this.activeLayer?.type === "mask") return true;
    const maskLayer = this.layers.find((l) => l.type === "mask");
    if (!maskLayer) return false;
    this.activeLayerId = maskLayer.id;
    return true;
  }

  // Clear all content from a layer (via Konva stage ref)
  clearLayer(id: string) {
    if (!this._stageRef) return;
    const meta = this.layers.find((l) => l.id === id);
    const layers = this._stageRef.getLayers();
    for (const kLayer of layers) {
      if (kLayer.id() === id) {
        kLayer.destroyChildren();
        kLayer.batchDraw();
        break;
      }
    }
    if (meta?.type === "mask") {
      // Clearing a mask empties it, so the synced composite mask is stale.
      generation.maskImage = null;
      this.persistedMaskPreviewUrl = null;
    }
    // Refresh the now-empty layer's thumbnail.
    this.pendingThumbRefresh = [id];
  }

  // Viewport
  zoomIn() {
    this.setZoom(Math.min(20, this.viewport.zoom * 1.2));
  }

  zoomOut() {
    this.setZoom(Math.max(0.05, this.viewport.zoom / 1.2));
  }

  setZoom(zoom: number, centerX?: number, centerY?: number) {
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
  }

  resetZoom() {
    this.viewport = { zoom: 1, panX: 0, panY: 0 };
  }

  // Resize the canvas WITHOUT wiping layers — used when the user changes the
  // generation dimensions. Existing content stays at its coordinates; the Konva
  // clip and the background letterbox are updated reactively (syncKonvaLayers +
  // the reference/background effects watch canvasWidth/canvasHeight).
  resizeCanvas(width: number, height: number) {
    if (width === this.canvasWidth && height === this.canvasHeight) return;
    if (this.layers.length === 0) {
      this.initCanvas(width, height);
      return;
    }
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  // Canvas init — creates default layers
  initCanvas(width: number, height: number) {
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.layers = [];
    this.activeLayerId = null;
    this.layerThumbnails = {};
    // Clear mask preview state so a stale overlay from a previous mask isn't
    // drawn on top of the fresh (empty) mask layer — ghost mask visual glitch.
    this.persistedMaskPreviewUrl = null;
    this.maskEditedSinceResult = false;
    // Discard any display-only pending inpaint result (owned object URL would
    // otherwise leak, and its dimensions no longer match the new canvas) and
    // drop one-shot flags that now point at layer ids that no longer exist.
    this.clearPendingInpaintResult();
    this.pendingDuplicate = null;
    if (this.pendingLayerImage?.owned && this.pendingLayerImage.imageUrl) {
      URL.revokeObjectURL(this.pendingLayerImage.imageUrl);
    }
    this.pendingLayerImage = null;
    this.pendingThumbRefresh = [];

    this.backgroundLayerId = this.addLayer("raster", locale.t("canvas.layer.background"));
    this.addLayer("mask", locale.t("canvas.layer.inpaint_mask"));

    // Set active to the raster layer
    const rasterLayer = this.layers.find((l) => l.type === "raster");
    if (rasterLayer) this.activeLayerId = rasterLayer.id;

    this.boundingBox = { x: 0, y: 0, width, height, locked: false };
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

  async syncMaskToGeneration(maskCanvas: HTMLCanvasElement | null, uploadToComfy: boolean = true): Promise<boolean> {
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

    // Convert mask to white-on-black for ComfyUI.
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = maskCanvas.width;
    exportCanvas.height = maskCanvas.height;
    const exportCtx = exportCanvas.getContext("2d")!;
    exportCtx.fillStyle = "black";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(maskCanvas, 0, 0);

    const imgData = exportCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
    const pixels = imgData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0 && (pixels[i] > 64 || pixels[i + 1] > 64 || pixels[i + 2] > 64)) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
        pixels[i + 3] = 255;
      } else {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }
    }
    exportCtx.putImageData(imgData, 0, 0);

    // Persist the mask preview overlay — always, so auto-commit (uploadToComfy=false)
    // keeps the visual overlay in sync with the actual mask pixels.
    this.persistedMaskPreviewUrl = exportCanvas.toDataURL("image/png");

    if (uploadToComfy) {
      const result = await this.exportLayerAsImage(exportCanvas, "canvas_mask.png");
      generation.maskImage = result.name;
    }

    return true;
  }

  // Does the canvas have any non-transparent pixel (i.e. user-drawn content)?
  private canvasHasAlpha(canvas: HTMLCanvasElement): boolean {
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return true;
    }
    return false;
  }

  // Composite the base image (letterboxed to the canvas) under drawn raster
  // strokes, producing the full canvas content used as the inpaint input.
  private async compositeBaseWithRaster(
    baseUrl: string,
    strokes: HTMLCanvasElement,
  ): Promise<HTMLCanvasElement> {
    const off = document.createElement("canvas");
    off.width = this.canvasWidth;
    off.height = this.canvasHeight;
    const ctx = off.getContext("2d")!;
    try {
      const baseImg = await loadImageDataUrl(baseUrl);
      // Letterbox (contain) the base onto the canvas, preserving aspect ratio —
      // stretching distorts the base (and misaligns it with the raster strokes)
      // whenever the base's aspect ratio differs from the canvas.
      const imageRatio = baseImg.naturalWidth / baseImg.naturalHeight;
      const canvasRatio = off.width / off.height;
      let drawW = off.width;
      let drawH = off.height;
      if (imageRatio > canvasRatio) {
        drawH = off.width / imageRatio;
      } else {
        drawW = off.height * imageRatio;
      }
      ctx.drawImage(baseImg, (off.width - drawW) / 2, (off.height - drawH) / 2, drawW, drawH);
    } catch {
      // Base failed to load — fall back to strokes only.
    }
    ctx.drawImage(strokes, 0, 0);
    return off;
  }

  // Sync canvas to generation store before generating
  async syncToGeneration(
    getRasterComposite: () => HTMLCanvasElement | null,
    getMaskCanvas: () => HTMLCanvasElement | null
  ) {
    const rasterCanvas = getRasterComposite();
    const maskCanvas = getMaskCanvas();
    const isInpainting = generation.mode === "inpainting";

    let hasRaster = false;
    let hasMask = false;

    // In inpainting mode, keep the currently selected input image as the baseline.
    // This makes denoise behave as expected: only the masked area is reworked.
    if (isInpainting) {
      // The background raster layer mirrors the input image, so the raster
      // composite IS the full base+strokes input — upload it directly (no
      // separate base composite step).
      if (rasterCanvas && this.canvasHasAlpha(rasterCanvas)) {
        const result = await this.exportLayerAsImage(rasterCanvas, "canvas_input.png");
        generation.inputImage = result.name;
        hasRaster = true;
      } else if (generation.inputImage) {
        hasRaster = true;
      }
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

    // Export mask
    hasMask = await this.syncMaskToGeneration(maskCanvas, true);

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
