<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Konva from "konva";
  import { captureLayer } from "../../utils/canvasLayerExport.js";
  import { processMaskCoverage } from "../../utils/maskProcessing.js";
  import { resolveTint, resolveTintKey } from "../../utils/layerTints.js";
  import { isTypingTarget } from "../../utils/keyboardTarget.js";
  import {
    clampToDocument,
    identityBox,
    isTransformable,
    projectNode,
    rotatedBounds,
    type BoxGeometry,
    type NodeGeometry,
  } from "../../utils/canvasTransform.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { canvas, isMaskLayer, type CanvasLayer, type SpatialLayerSnapshot, type ToolType } from "../../stores/canvas.svelte.js";
  import { canvasHistory } from "../../stores/canvasHistory.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import ColorTooltip from "../ui/ColorTooltip.svelte";

  let { showLivePreview = true }: { showLivePreview?: boolean } = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let stage: Konva.Stage | null = null;

  // Tooltip state
  let tooltipVisible = $state(false);
  let tooltipColor = $state("#000000");
  let tooltipPos = $state({ x: 0, y: 0 });
  let tooltipRaf: number | null = null;
  /** Last `layerContentBounds` answer, keyed by what can change it. */
  let contentBoundsCache: { key: string; bounds: BoxGeometry | null } | null = null;
  /** A hover colour sample costs a full-stage composite, so it runs at most this often. */
  let lastTooltipSampleAt = 0;
  const TOOLTIP_SAMPLE_INTERVAL_MS = 90;

  // Konva layers keyed by canvas layer ID
  let konvaLayers = new Map<string, Konva.Layer>();
  // Background layer (checkerboard)
  let bgLayer: Konva.Layer | null = null;
  let checkerRect: Konva.Rect | null = null;
  let borderRect: Konva.Rect | null = null;
  let checkerPatternCanvas: HTMLCanvasElement | null = null;
  // Reference image layer (under paint layers)
  let refLayer: Konva.Layer | null = null;
  let refImageNode: Konva.Image | null = null;
  let baseColorNode: Konva.Rect | null = null;
  let lastRefSource: string | null = null;
  // Persisted mask preview layer (shows last exported/uploaded mask after remount)
  let persistedMaskLayer: Konva.Layer | null = null;
  let persistedMaskNode: Konva.Image | null = null;
  let lastMaskSource: string | null = null;
  // Processed mask / ControlNet preview. It visualizes generation context without
  // changing editable layer pixels or exported masks.
  let contextLayer: Konva.Layer | null = null;
  let contextRevision = 0;
  // Sampler preview rendered in document coordinates so it follows pan/zoom.
  let livePreviewLayer: Konva.Layer | null = null;
  let livePreviewNode: Konva.Image | null = null;
  let lastLivePreviewSource: string | null = null;
  let transformLayer: Konva.Layer | null = null;
  let selectionTransformer: Konva.Transformer | null = null;
  let canvasBoundsNode: Konva.Rect | null = null;
  /** The box the move/resize tool hands to Konva's transformer. It covers the
   * layer's real content, so a handle sits exactly where the mask, region or
   * image actually is, and the transform it performs is the transform that is
   * stored. */
  let layerBoxNode: Konva.Rect | null = null;
  /** Geometry captured when a transform starts, so every step of a live drag
   * projects from the original shapes instead of accumulating rounding. */
  let transformBase: { reference: BoxGeometry; nodes: Array<{ node: Konva.Node; base: NodeGeometry }> } | null = null;
  /** The dashed context guides, grouped so a live drag or resize can carry them
   * with the layer instead of leaving them behind until pixels are re-read. */
  let overlayGroup: Konva.Group | null = null;
  // UI overlay layer (brush cursor, bounding box)
  let uiLayer: Konva.Layer | null = null;

  // Drawing state (not reactive — performance-critical)
  let isDrawing = false;
  let isPanning = false;
  let isSpacePanning = false;
  let currentLine: Konva.Line | null = null;
  let activeStrokeTool: "brush" | "eraser" | null = null;
  let lastPointerPos: { x: number; y: number } | null = null;
  let brushCursor: Konva.Circle | null = null;

  // Rectangle tool state
  let isDrawingRect = false;
  let rectStartPos: { x: number; y: number } | null = null;
  let rectPreview: Konva.Rect | null = null;
  let isMovingLayer = false;
  let moveStartPos: { x: number; y: number } | null = null;
  let moveNodeStarts: Array<{ node: Konva.Node; x: number; y: number }> = [];
  let viewportRaf: number | null = null;

  // Lasso tool state (points kept in canvas space; preview drawn on the UI layer in screen space)
  let isLasso = false;
  let lassoPoints: number[] = [];
  let lassoPreviewLine: Konva.Line | null = null;

  // Alt-held quick eyedropper
  let isAltEyedropper = false;

  // Per-layer thumbnail regeneration (RAF-deduped per layer id)
  let thumbRafs = new Map<string, number>();
  let thumbInitialized = new Set<string>();

  // Container size
  let containerW = 0;
  let containerH = 0;

  onMount(() => {
    if (!containerEl) return;
    initStage();
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  onDestroy(() => {
    if (tooltipRaf !== null) {
      cancelAnimationFrame(tooltipRaf);
    }
    canvas.isPointerOverStage = false;
    if (viewportRaf !== null) {
      cancelAnimationFrame(viewportRaf);
      viewportRaf = null;
    }
    for (const raf of thumbRafs.values()) {
      cancelAnimationFrame(raf);
    }
    thumbRafs.clear();
    // Drop the pixel callback; document history is owned by the canvas store.
    canvasHistory.setOnRestored(null);
    if (stage) {
      canvas.retainLayerNodes();
      stage.destroy();
      stage = null;
    }
  });

  function scheduleViewportApply() {
    if (viewportRaf !== null) return;
    viewportRaf = requestAnimationFrame(() => {
      viewportRaf = null;
      applyViewport();
    });
  }

  function updateTooltip(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    tooltipRaf = null;
    if (!stage || isDrawing || isPanning || isDrawingRect || isMovingLayer) {
      tooltipVisible = false;
      return;
    }
    
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) {
      tooltipVisible = false;
      return;
    }
    
    // The box follows the pointer every frame; only the colour inside it costs a
    // composite of every layer, so that part runs at a readable rate instead.
    tooltipPos = { x: pointerPos.x + 15, y: pointerPos.y + 15 };
    const now = performance.now();
    if (tooltipVisible && now - lastTooltipSampleAt < TOOLTIP_SAMPLE_INTERVAL_MS) return;
    lastTooltipSampleAt = now;

    // Sample color from all layers
    const compositeCanvas = stage.toCanvas({ pixelRatio: 1 });
    const ctx = compositeCanvas.getContext("2d")!;
    const pixel = ctx.getImageData(Math.round(pointerPos.x), Math.round(pointerPos.y), 1, 1).data;

    if (pixel[3] > 0) {
      const hex = `#${pixel[0].toString(16).padStart(2, "0")}${pixel[1].toString(16).padStart(2, "0")}${pixel[2].toString(16).padStart(2, "0")}`;
      tooltipColor = hex;
      tooltipVisible = true;
    } else {
      tooltipVisible = false;
    }
  }

  function initStage() {
    if (!containerEl) return;

    const rect = containerEl.getBoundingClientRect();
    containerW = rect.width;
    containerH = rect.height;
    if (canvas.viewportInitialized) {
      canvas.viewport = { ...canvas.viewport,
        panX: canvas.viewport.panX + (containerW - canvas.viewportWidth) / 2,
        panY: canvas.viewport.panY + (containerH - canvas.viewportHeight) / 2 };
    }
    canvas.setViewportSize(containerW, containerH);

    stage = new Konva.Stage({
      container: containerEl,
      width: containerW,
      height: containerH,
    });

    canvas.setStageRef(stage);

    // Background layer (checkerboard)
    bgLayer = new Konva.Layer({ listening: false });
    stage.add(bgLayer);
    drawCheckerboard();

    // Reference image layer (input/staged image underlay)
    refLayer = new Konva.Layer({ listening: false });
    stage.add(refLayer);
    baseColorNode = new Konva.Rect({ width: canvas.canvasWidth, height: canvas.canvasHeight, fill: canvas.baseColor, listening: false });
    refLayer.add(baseColorNode);
    updateReferenceImage(canvas.effectiveReferenceImage);

    // Persisted mask preview layer (sits above reference, below paint layers)
    persistedMaskLayer = new Konva.Layer({ listening: false });
    stage.add(persistedMaskLayer);
    updatePersistedMaskOverlay(canvas.persistedMaskPreviewUrl);

    // Create Konva layers for each canvas layer
    syncKonvaLayers();

    contextLayer = new Konva.Layer({ listening: false });
    stage.add(contextLayer);

    livePreviewLayer = new Konva.Layer({ listening: false });
    stage.add(livePreviewLayer);

    transformLayer = new Konva.Layer();
    stage.add(transformLayer);
    canvasBoundsNode = new Konva.Rect({ x: 0, y: 0, width: canvas.canvasWidth, height: canvas.canvasHeight, fill: 'rgba(0,0,0,0.001)', listening: false });
    transformLayer.add(canvasBoundsNode);
    layerBoxNode = new Konva.Rect({ name: 'layer-content-box', x: 0, y: 0, width: 0, height: 0, fill: 'rgba(0,0,0,0.001)', listening: false });
    transformLayer.add(layerBoxNode);
    selectionTransformer = new Konva.Transformer({
      borderStroke: '#60a5fa', anchorFill: '#f8fafc', anchorStroke: '#2563eb',
      anchorCornerRadius: 1, rotateAnchorOffset: 22, keepRatio: false, flipEnabled: false,
      boundBoxFunc: (oldBox, newBox) => Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox,
    });
    selectionTransformer.on('transformstart', () => {
      if (canvas.activeTool === 'canvasResize') return;
      if (canvas.activeLayerId) canvasHistory.snapshot(canvas.activeLayerId);
      beginOnCanvasTransform();
    });
    selectionTransformer.on('transform', applyOnCanvasTransform);
    selectionTransformer.on('transformend', finishOnCanvasTransform);
    transformLayer.add(selectionTransformer);

    // UI overlay layer
    uiLayer = new Konva.Layer({ listening: false });
    stage.add(uiLayer);

    // Brush cursor
    brushCursor = new Konva.Circle({
      radius: canvas.brushSettings.size / 2,
      stroke: "#ffffff",
      strokeWidth: 1.5,
      dash: [4, 4],
      visible: false,
      listening: false,
    });
    uiLayer.add(brushCursor);

    // Set history refs
    canvasHistory.setRefs(konvaLayers, canvas.canvasWidth, canvas.canvasHeight);
    canvasHistory.setOnRestored((layerIds) => {
      for (const id of layerIds) {
        canvas.restoreLayerImage(id, konvaLayers.get(id)?.findOne('.raster-asset') as Konva.Image | undefined);
        scheduleThumbRefresh(id);
      }
    });
    // Apply initial viewport
    applyViewport();

    // Fit only a new document. Remounting panels must preserve zoom and pan.
    if (!canvas.viewportInitialized) canvas.zoomToFit(containerW, containerH);
    applyViewport();

    // Event handlers
    stage.on("mousedown touchstart", handlePointerDown);
    stage.on("mousemove touchmove", handlePointerMove);
    stage.on("mouseup touchend", handlePointerUp);
    stage.on("mouseenter", handlePointerEnter);
    stage.on("mouseleave", handlePointerLeave);
    stage.on("wheel", handleWheel);
    stage.on("contextmenu", (e) => e.evt.preventDefault());

    reorderStageLayers();
    void updateContextOverlay();
  }

  function reorderStageLayers() {
    if (!stage) return;

    bgLayer?.moveToBottom();
    if (refLayer) {
      refLayer.moveToBottom();
      refLayer.moveUp();
    }
    if (persistedMaskLayer) {
      persistedMaskLayer.moveToBottom();
      persistedMaskLayer.moveUp();
      persistedMaskLayer.moveUp();
    }

    const sorted = canvas.sortedLayers.toReversed();
    for (const layer of sorted) {
      const kLayer = konvaLayers.get(layer.id);
      if (kLayer) kLayer.moveToTop();
    }

    livePreviewLayer?.moveToTop();
    contextLayer?.moveToTop();
    transformLayer?.moveToTop();
    uiLayer?.moveToTop();
  }

  /** The box around a layer's real content: the painted pixels of a mask or a
   * region (processed exactly as the run will read them), the image asset of a
   * raster. This is why the handles sit where they should: Konva's own client
   * rect would add a stroke's width to the box and the box would lie. */
  function layerContentBounds(layer: CanvasLayer): BoxGeometry | null {
    if (layer.type === 'raster') {
      const image = layer.image;
      if (!image) return null;
      return clampToDocument(rotatedBounds(image.x, image.y, image.width, image.height, image.rotation), canvas.canvasWidth, canvas.canvasHeight);
    }
    const settings = layer.inpaintSettings ?? generation.inpaintSettings;
    const grow = layer.type === 'mask' ? layer.maskGrow ?? generation.growMaskBy : 0;
    const blur = layer.type === 'mask' ? settings.mask_blur : 0;
    const invert = layer.type === 'mask' && settings.invert_mask;
    const tint = resolveTint(layer);
    // Reading a mask means capturing the layer canvas and walking every pixel of
    // the document, so it cannot happen on each pan or zoom frame. The answer
    // changes only with the pixels, the layer's geometry or the very settings
    // this mask is processed with, so those form the key.
    // Only the layer's own content counts: `captureLayer` neutralises the
    // container's viewport transform before reading pixels, so pan and zoom must
    // not enter this key, while the children are exactly what a transform moves.
    const node = konvaLayers.get(layer.id);
    const geometry = node ? JSON.stringify(node.getChildren().map((child) => nodeGeometry(child))) : 'none';
    const key = [
      layer.id, canvas.paintRevision, grow, blur, invert, tint, geometry,
      canvas.canvasWidth, canvas.canvasHeight,
    ].join('|');
    if (contentBoundsCache?.key === key) return contentBoundsCache.bounds;

    const source = canvas.exportMaskLayer(layer.id);
    if (!source) {
      contentBoundsCache = { key, bounds: null };
      return null;
    }
    const processed = buildProcessedMask(source, grow, blur, invert, tint);
    const bounds = processed.bounds;
    const result = bounds ? clampToDocument(identityBox(bounds.x, bounds.y, bounds.width, bounds.height), canvas.canvasWidth, canvas.canvasHeight) : null;
    contentBoundsCache = { key, bounds: result };
    return result;
  }

  function nodeGeometry(node: Konva.Node): NodeGeometry {
    const shape = node as Konva.Shape;
    const geometry: NodeGeometry = { x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() };
    if (typeof node.rotation === 'function') {
      const strokeWidth = shape.strokeWidth?.();
      if (typeof strokeWidth === 'number') geometry.strokeWidth = strokeWidth;
    }
    return geometry;
  }

  function boxGeometryOf(node: Konva.Rect): BoxGeometry {
    return { x: node.x(), y: node.y(), width: node.width(), height: node.height(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() };
  }

  function beginOnCanvasTransform() {
    const layer = canvas.activeLayer;
    const kLayer = layer ? konvaLayers.get(layer.id) : null;
    transformBase = layerBoxNode && kLayer
      ? { reference: boxGeometryOf(layerBoxNode), nodes: kLayer.getChildren().map((node) => ({ node, base: nodeGeometry(node) })) }
      : null;
  }

  /** Carry the guides with the layer while it is being dragged or resized, so
   * what the dashed outline shows is what the run will read. */
  function liveOverlayTransform(box: BoxGeometry, reference: BoxGeometry) {
    if (!overlayGroup || !contextLayer) return;
    overlayGroup.setAttrs({
      x: box.x,
      y: box.y,
      offsetX: reference.x,
      offsetY: reference.y,
      scaleX: reference.scaleX === 0 ? 1 : box.scaleX / reference.scaleX,
      scaleY: reference.scaleY === 0 ? 1 : box.scaleY / reference.scaleY,
      rotation: box.rotation - reference.rotation,
    });
    contextLayer.batchDraw();
  }

  function liveOverlayOffset(dx: number, dy: number) {
    if (!overlayGroup || !contextLayer) return;
    overlayGroup.setAttrs({ x: dx, y: dy, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 });
    contextLayer.batchDraw();
  }

  function resetOverlayTransform() {
    if (!overlayGroup) return;
    overlayGroup.setAttrs({ x: 0, y: 0, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  }

  /** Konva's transformer reports every step of a drag: project each shape from
   * the geometry it had when the drag started. */
  function applyOnCanvasTransform() {
    if (canvas.activeTool !== 'move' || !layerBoxNode || !transformBase) return;
    const box = boxGeometryOf(layerBoxNode);
    const layer = canvas.activeLayer;
    const kLayer = layer ? konvaLayers.get(layer.id) : null;
    for (const entry of transformBase.nodes) {
      entry.node.setAttrs(projectNode(entry.base, box, transformBase.reference) as unknown as Konva.NodeConfig);
    }
    kLayer?.batchDraw();
    liveOverlayTransform(box, transformBase.reference);
  }

  function finishOnCanvasTransform() {
    if (!selectionTransformer) return;
    if (canvas.activeTool === 'canvasResize' && canvasBoundsNode) {
      // Generation backends work on 8-pixel latent units. Snap the visible
      // document frame so Canvas size always matches the value that is sent.
      const width = Math.max(64, Math.round(canvasBoundsNode.width() * canvasBoundsNode.scaleX() / 8) * 8);
      const height = Math.max(64, Math.round(canvasBoundsNode.height() * canvasBoundsNode.scaleY() / 8) * 8);
      canvasBoundsNode.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, width, height });
      canvas.resizeCanvas(width, height);
      refreshSelectionTransformer();
      return;
    }
    const layer = canvas.activeLayer;
    if (!layer) return;
    const kLayer = konvaLayers.get(layer.id);
    if (layer.type === 'raster' && layer.image && kLayer) {
      const node = kLayer.findOne('.raster-asset') as Konva.Image | undefined;
      if (node) {
        const width = Math.max(1, Math.abs(node.width() * node.scaleX()));
        const height = Math.max(1, Math.abs(node.height() * node.scaleY()));
        const flipX = node.scaleX() < 0;
        const flipY = node.scaleY() < 0;
        node.width(width);
        node.height(height);
        node.scaleX(flipX ? -1 : 1);
        node.scaleY(flipY ? -1 : 1);
        canvas.updateLayerImage(layer.id, {
          x: node.x() - (flipX ? width : 0), y: node.y() - (flipY ? height : 0),
          width, height, rotation: node.rotation(), flipX, flipY,
        });
      }
    }
    transformBase = null;
    resetOverlayTransform();
    scheduleThumbRefresh(layer.id);
    selectionTransformer.forceUpdate();
    // The handles must land on the content that just changed, and the guides on
    // the pixels the export will hand to a run.
    refreshSelectionTransformer();
    void updateContextOverlay();
    if (isMaskLayer(layer)) void autoCommitMaskIfNeeded();
  }

  function refreshSelectionTransformer() {
    if (!selectionTransformer || !transformLayer || !canvasBoundsNode) return;
    const zoom = Math.max(.05, canvas.viewport.zoom);
    selectionTransformer.setAttrs({ anchorSize: 9 / zoom, borderStrokeWidth: 1 / zoom, rotateAnchorOffset: 22 / zoom });
    if (progress.isGenerating) {
      selectionTransformer.nodes([]);
      transformLayer.batchDraw();
      return;
    }
    if (canvas.activeTool === 'canvasResize') {
      canvasBoundsNode.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, width: canvas.canvasWidth, height: canvas.canvasHeight });
      selectionTransformer.setAttrs({ rotateEnabled: false, keepRatio: false, enabledAnchors: ['middle-right', 'bottom-center', 'bottom-right'] });
      selectionTransformer.nodes([canvasBoundsNode]);
    } else if (canvas.activeTool === 'move') {
      // One tool for moving and resizing, and one box for both: the handles sit
      // on the layer's real content, and a drag anywhere else moves it. Every
      // layer kind rotates, and the modifiers are Konva's own - Shift keeps the
      // proportions, Alt scales from the centre, only upright angles snap.
      const layer = canvas.activeLayer;
      const onCanvas = canvas.selectedWorkspaceSection === 'layers';
      const bounds = layer && onCanvas && layer.visible && !layer.locked ? layerContentBounds(layer) : null;
      if (layerBoxNode && isTransformable(bounds)) {
        layerBoxNode.setAttrs({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, rotation: 0, scaleX: 1, scaleY: 1 });
        selectionTransformer.setAttrs({
          rotateEnabled: true,
          keepRatio: false,
          rotationSnaps: [0, 90, 180, 270, 360],
          rotationSnapTolerance: 4,
          enabledAnchors: ['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'],
        });
        selectionTransformer.nodes([layerBoxNode]);
      } else {
        selectionTransformer.nodes([]);
      }
    } else {
      selectionTransformer.nodes([]);
    }
    transformLayer.batchDraw();
  }

  function updateLivePreview(url: string | null) {
    if (!livePreviewLayer) return;
    if (!url || !showLivePreview || generation.mode !== 'inpainting' || !progress.isGenerating) {
      lastLivePreviewSource = null;
      livePreviewNode?.destroy();
      livePreviewNode = null;
      livePreviewLayer.batchDraw();
      return;
    }
    if (url === lastLivePreviewSource && livePreviewNode) {
      // Reuse the decoded preview while keeping document-space geometry exact
      // if the canvas changes size during a generation.
      livePreviewNode.position({ x: 0, y: 0 });
      livePreviewNode.size({ width: canvas.canvasWidth, height: canvas.canvasHeight });
      livePreviewLayer.batchDraw();
      return;
    }
    lastLivePreviewSource = url;
    const image = new Image();
    image.onload = () => {
      if (!livePreviewLayer || lastLivePreviewSource !== url) return;
      if (!livePreviewNode) {
        livePreviewNode = new Konva.Image({ image, x: 0, y: 0, width: canvas.canvasWidth, height: canvas.canvasHeight, listening: false });
        livePreviewLayer.add(livePreviewNode);
      } else {
        livePreviewNode.setAttrs({ image, x: 0, y: 0, width: canvas.canvasWidth, height: canvas.canvasHeight });
      }
      reorderStageLayers();
      livePreviewLayer.batchDraw();
    };
    image.onerror = () => {
      // Keep the last valid frame visible and allow a transient blob/data URL
      // failure to be retried if the producer publishes it again.
      if (lastLivePreviewSource === url) lastLivePreviewSource = null;
    };
    image.src = url;
  }

  function buildProcessedMask(source: HTMLCanvasElement, grow: number, blur: number, invert: boolean, color: string) {
    // The overlay is a display aid. Processing it at preview resolution keeps
    // brush strokes responsive even on multi-megapixel documents.
    const previewScale = Math.min(1, 512 / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * previewScale));
    const height = Math.max(1, Math.round(source.height * previewScale));
    const scaledSource = document.createElement('canvas');
    scaledSource.width = width; scaledSource.height = height;
    scaledSource.getContext('2d')!.drawImage(source, 0, 0, width, height);
    const sourceData = scaledSource.getContext('2d')!.getImageData(0, 0, width, height);
    const coverage = Float32Array.from({ length: width * height }, (_, i) => sourceData.data[i * 4] / 255);
    const values = processMaskCoverage(coverage, width, height, grow * previewScale, blur * previewScale, invert);
    const processed = document.createElement('canvas');
    processed.width = width; processed.height = height;
    const processedCtx = processed.getContext('2d')!;
    const pixels = processedCtx.createImageData(width, height);
    for (let i = 0; i < values.length; i++) {
      pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
      pixels.data[i * 4 + 3] = Math.round(values[i] * 255);
    }
    processedCtx.putImageData(pixels, 0, 0);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels.data[(y * width + x) * 4 + 3] > 8) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    processedCtx.globalCompositeOperation = 'source-in';
    processedCtx.fillStyle = color;
    processedCtx.fillRect(0, 0, width, height);
    return { image: processed, bounds: maxX >= 0 ? { x: minX / previewScale, y: minY / previewScale, width: (maxX - minX + 1) / previewScale, height: (maxY - minY + 1) / previewScale } : null };
  }

  async function updateContextOverlay() {
    if (!contextLayer) return;
    const revision = ++contextRevision;
    contextLayer.destroyChildren();
    // One group for the guides that belong to the active layer, so a drag or a
    // resize can move them with it. The group is rebuilt by every pass.
    overlayGroup = new Konva.Group({ listening: false });
    contextLayer.add(overlayGroup);

    if (canvas.selectedWorkspaceSection === 'control' && canvas.controlContextPreviewUrl) {
      if (!canvas.showLayerContext) { contextLayer.batchDraw(); return; }
      try {
        const image = await loadImageEl(canvas.controlContextPreviewUrl);
        if (!contextLayer || revision !== contextRevision) return;
        contextLayer.add(new Konva.Image({ image, width: canvas.canvasWidth, height: canvas.canvasHeight, opacity: Math.min(.58, .16 + generation.controlnetStrength * .18), listening: false }));
        contextLayer.add(new Konva.Rect({ x: 0, y: 0, width: canvas.canvasWidth, height: canvas.canvasHeight, stroke: '#22d3ee', strokeWidth: 1.5 / canvas.viewport.zoom, dash: [8 / canvas.viewport.zoom, 5 / canvas.viewport.zoom], opacity: .8, listening: false }));
      } catch { /* The source preview can disappear while a blob URL is replaced. */ }
      reorderStageLayers(); contextLayer.batchDraw(); return;
    }

    const layer = canvas.activeLayer;
    if (canvas.selectedWorkspaceSection !== 'layers' || !layer || !isMaskLayer(layer) || !layer.visible || layer.showContext === false) {
      contextLayer.batchDraw(); return;
    }
    const source = canvas.exportMaskLayer(layer.id);
    if (!source) { contextLayer.batchDraw(); return; }
    const settings = layer.inpaintSettings ?? generation.inpaintSettings;
    const grow = layer.type === 'mask' ? layer.maskGrow ?? generation.growMaskBy : 0;
    const color = resolveTint(layer);
    const { bounds } = buildProcessedMask(source, grow, layer.type === 'mask' ? settings.mask_blur : 0, layer.type === 'mask' && settings.invert_mask, color);
    if (!contextLayer || revision !== contextRevision) return;
    if (bounds) {
      const holder: Konva.Container = overlayGroup ?? contextLayer;
      holder.add(new Konva.Rect({ ...bounds, stroke: color, strokeWidth: 1.5 / canvas.viewport.zoom, dash: [7 / canvas.viewport.zoom, 4 / canvas.viewport.zoom], opacity: .95, listening: false }));
      if (layer.type === 'mask' && settings.area === 'masked') {
        const px = settings.context_padding_x ?? settings.padding;
        const py = settings.context_padding_y ?? settings.padding;
        const left = Math.max(0, bounds.x - px), top = Math.max(0, bounds.y - py);
        const right = Math.min(canvas.canvasWidth, bounds.x + bounds.width + px);
        const bottom = Math.min(canvas.canvasHeight, bounds.y + bounds.height + py);
        let width = Math.max(right - left, settings.context_min_size ?? 0);
        let height = Math.max(bottom - top, settings.context_min_size ?? 0);
        if (settings.context_shape === 'square') width = height = Math.max(width, height);
        width = Math.min(canvas.canvasWidth, width); height = Math.min(canvas.canvasHeight, height);
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        const x = Math.max(0, Math.min(canvas.canvasWidth - width, cx - width / 2));
        const y = Math.max(0, Math.min(canvas.canvasHeight - height, cy - height / 2));
        holder.add(new Konva.Rect({ x, y, width, height, stroke: '#f8fafc', strokeWidth: 1 / canvas.viewport.zoom, dash: [3 / canvas.viewport.zoom, 4 / canvas.viewport.zoom], opacity: .72, listening: false }));
      }
    }
    reorderStageLayers(); contextLayer.batchDraw();
  }

  function updateReferenceImage(url: string | null) {
    if (!refLayer) return;

    if (!url) {
      lastRefSource = null;
      if (refImageNode) {
        refImageNode.destroy();
        refImageNode = null;
      }
      refLayer.batchDraw();
      return;
    }

    lastRefSource = url;
    const img = new Image();
    img.onload = () => {
      if (!refLayer || lastRefSource !== url) return;

      const imageRatio = img.naturalWidth / img.naturalHeight;
      const canvasRatio = canvas.canvasWidth / canvas.canvasHeight;

      let drawWidth = canvas.canvasWidth;
      let drawHeight = canvas.canvasHeight;
      if (imageRatio > canvasRatio) {
        drawHeight = canvas.canvasWidth / imageRatio;
      } else {
        drawWidth = canvas.canvasHeight * imageRatio;
      }

      const offsetX = (canvas.canvasWidth - drawWidth) / 2;
      const offsetY = (canvas.canvasHeight - drawHeight) / 2;

      if (!refImageNode) {
        refImageNode = new Konva.Image({
          image: img,
          x: offsetX,
          y: offsetY,
          width: drawWidth,
          height: drawHeight,
          listening: false,
          opacity: 1,
        });
        refLayer.add(refImageNode);
      } else {
        refImageNode.image(img);
        refImageNode.x(offsetX);
        refImageNode.y(offsetY);
        refImageNode.width(drawWidth);
        refImageNode.height(drawHeight);
      }

      reorderStageLayers();
      refLayer.batchDraw();
    };
    img.onerror = () => {
      if (!refLayer || lastRefSource !== url) return;
      if (refImageNode) {
        refImageNode.destroy();
        refImageNode = null;
        refLayer.batchDraw();
      }
    };
    img.src = url;
  }

  function parseHexColor(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace("#", "");
    const value = clean.length === 3
      ? clean.split("").map((ch) => ch + ch).join("")
      : clean;
    const num = Number.parseInt(value, 16);
    if (!Number.isFinite(num)) return { r: 255, g: 51, b: 51 };
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    };
  }

  function updatePersistedMaskOverlay(url: string | null) {
    if (!persistedMaskLayer) return;

    if (!url || !canvas.maskOverlayVisible) {
      lastMaskSource = null;
      if (persistedMaskNode) {
        persistedMaskNode.destroy();
        persistedMaskNode = null;
      }
      persistedMaskLayer.batchDraw();
      return;
    }

    lastMaskSource = url;
    const img = new Image();
    img.onload = () => {
      if (!persistedMaskLayer || lastMaskSource !== url) return;

      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = img.naturalWidth;
      overlayCanvas.height = img.naturalHeight;
      const ctx = overlayCanvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, overlayCanvas.width, overlayCanvas.height);
      const pixels = data.data;
      const color = parseHexColor(resolveTint({ type: "mask" }));
      const baseAlpha = Math.max(0, Math.min(1, canvas.maskOverlayOpacity));

      for (let i = 0; i < pixels.length; i += 4) {
        const maskValue = pixels[i];
        if (maskValue > 8) {
          pixels[i] = color.r;
          pixels[i + 1] = color.g;
          pixels[i + 2] = color.b;
          pixels[i + 3] = Math.round(maskValue * baseAlpha);
        } else {
          pixels[i + 3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);

      const overlayImg = new Image();
      overlayImg.onload = () => {
        if (!persistedMaskLayer || lastMaskSource !== url) return;

        if (!persistedMaskNode) {
          persistedMaskNode = new Konva.Image({
            image: overlayImg,
            x: 0,
            y: 0,
            width: canvas.canvasWidth,
            height: canvas.canvasHeight,
            listening: false,
          });
          persistedMaskLayer.add(persistedMaskNode);
        } else {
          persistedMaskNode.image(overlayImg);
          persistedMaskNode.x(0);
          persistedMaskNode.y(0);
          persistedMaskNode.width(canvas.canvasWidth);
          persistedMaskNode.height(canvas.canvasHeight);
        }

        reorderStageLayers();
        persistedMaskLayer.batchDraw();
      };
      overlayImg.src = overlayCanvas.toDataURL("image/png");
    };
    img.onerror = () => {
      if (!persistedMaskLayer || lastMaskSource !== url) return;
      if (persistedMaskNode) {
        persistedMaskNode.destroy();
        persistedMaskNode = null;
        persistedMaskLayer.batchDraw();
      }
    };
    img.src = url;
  }

  function handleResize() {
    if (!containerEl || !stage) return;
    const rect = containerEl.getBoundingClientRect();
    const deltaWidth = rect.width - containerW;
    const deltaHeight = rect.height - containerH;
    containerW = rect.width;
    containerH = rect.height;
    canvas.setViewportSize(containerW, containerH);
    if (canvas.viewportInitialized && (deltaWidth || deltaHeight)) {
      canvas.viewport = { ...canvas.viewport, panX: canvas.viewport.panX + deltaWidth / 2, panY: canvas.viewport.panY + deltaHeight / 2 };
    }
    stage.width(containerW);
    stage.height(containerH);
    drawCheckerboard();
  }

  function drawCheckerboard() {
    if (!bgLayer) return;
    bgLayer.destroyChildren();

    // Use one pattern-filled rect instead of thousands of tiles for smooth panning.
    if (!checkerPatternCanvas) {
      const tileSize = 16;
      const pattern = document.createElement("canvas");
      pattern.width = tileSize * 2;
      pattern.height = tileSize * 2;
      const ctx = pattern.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, pattern.width, pattern.height);
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(tileSize, 0, tileSize, tileSize);
        ctx.fillRect(0, tileSize, tileSize, tileSize);
      }
      checkerPatternCanvas = pattern;
    }

    if (canvas.showCheckerboard && checkerPatternCanvas) {
      checkerRect = new Konva.Rect({
        x: 0,
        y: 0,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
        fillPatternImage: checkerPatternCanvas as unknown as HTMLImageElement,
        fillPatternRepeat: "repeat",
        listening: false,
      });
      bgLayer.add(checkerRect);
    }

    // Canvas border
    borderRect = new Konva.Rect({
      x: 0,
      y: 0,
      width: canvas.canvasWidth,
      height: canvas.canvasHeight,
      stroke: "#555",
      strokeWidth: 1 / canvas.viewport.zoom,
      listening: false,
    });
    bgLayer.add(borderRect);

    bgLayer.batchDraw();
  }

  // Sync Konva layers with canvas store layers
  function syncKonvaLayers() {
    if (!stage) return;

    const sorted = canvas.sortedLayers.toReversed();

    for (const layer of sorted) {
      const effectiveVisible = layer.visible;
      if (!konvaLayers.has(layer.id)) {
        const existing = stage.getLayers().find((node) => node.id() === layer.id) ?? canvas.takeLayerNode(layer.id);
        const kLayer = existing ?? new Konva.Layer({
          id: layer.id,
          opacity: displayOpacity(layer),
          visible: effectiveVisible,
        });

        // Clip to canvas bounds
        kLayer.clip({
          x: 0,
          y: 0,
          width: canvas.canvasWidth,
          height: canvas.canvasHeight,
        });

        stage.add(kLayer);

        if (!existing && layer.initialRegion) {
          const region = layer.initialRegion;
          const w = canvas.canvasWidth;
          const h = canvas.canvasHeight;
          const attrs = { fill: resolveTint(layer), opacity: 1, listening: false };
          if (region.shape === "circle") {
            kLayer.add(new Konva.Ellipse({ ...attrs, x: (region.x + region.width / 2) * w, y: (region.y + region.height / 2) * h, radiusX: region.width * w / 2, radiusY: region.height * h / 2 }));
          } else if (region.shape === "lasso" && region.points?.length) {
            kLayer.add(new Konva.Line({ ...attrs, points: region.points.flatMap((p) => [p.x * w, p.y * h]), closed: true }));
          } else {
            kLayer.add(new Konva.Rect({ ...attrs, x: region.x * w, y: region.y * h, width: region.width * w, height: region.height * h }));
          }
        }

        konvaLayers.set(layer.id, kLayer);
      } else {
        const kLayer = konvaLayers.get(layer.id)!;
        kLayer.opacity(displayOpacity(layer));
        kLayer.visible(effectiveVisible);
      }
      konvaLayers.get(layer.id)!.clip({ x: 0, y: 0, width: canvas.canvasWidth, height: canvas.canvasHeight });
      konvaLayers.get(layer.id)!.opacity(displayOpacity(layer));
      konvaLayers.get(layer.id)!.visible(effectiveVisible);
      if (layer.image) {
        const kLayer = konvaLayers.get(layer.id)!;
        const asset = layer.image;
        let node = kLayer.findOne('.raster-asset') as Konva.Image | undefined;
        if (!node) {
          node = new Konva.Image({ name: 'raster-asset', image: undefined, listening: false });
          kLayer.add(node);
          const target = node;
          const image = new Image();
          image.onload = () => {
            if (konvaLayers.get(layer.id) !== kLayer) return;
            target.setAttr('sourceImage', image);
            paintLayerAsset(target, image, layer);
            kLayer.batchDraw();
            scheduleThumbRefresh(layer.id);
          };
          image.src = asset.src;
        } else if (node.getAttr('tintKey') !== resolveTintKey(layer)) {
          // Recolour from the source the node already holds: a tint change must
          // show up on the canvas, not on the next reload.
          const source = node.getAttr('sourceImage') as HTMLImageElement | undefined;
          if (source) {
            paintLayerAsset(node, source, layer);
            kLayer.batchDraw();
            scheduleThumbRefresh(layer.id);
          }
        }
        node.setAttrs({ image: node.image(), x: asset.x + (asset.flipX ? asset.width : 0), y: asset.y + (asset.flipY ? asset.height : 0), width: asset.width, height: asset.height, rotation: asset.rotation, scaleX: asset.flipX ? -1 : 1, scaleY: asset.flipY ? -1 : 1 });
      }
      repaintOverlayNodes(konvaLayers.get(layer.id)!, layer);
    }

    // Remove any Konva layers that no longer exist in store
    for (const [id, kLayer] of konvaLayers) {
      if (!canvas.layers.find((l) => l.id === id)) {
        kLayer.destroy();
        konvaLayers.delete(id);
      }
    }

    reorderStageLayers();
  }

  function applyViewport() {
    if (!stage) return;
    const { zoom, panX, panY } = canvas.viewport;

    if (borderRect) {
      borderRect.strokeWidth(1 / zoom);
    }

    // Apply to all content layers (bg + reference + persisted mask + canvas layers), but NOT the UI layer.
    const layers = [bgLayer, refLayer, persistedMaskLayer, ...konvaLayers.values(), livePreviewLayer, contextLayer, transformLayer];
    for (const layer of layers) {
      if (!layer) continue;
      layer.scaleX(zoom);
      layer.scaleY(zoom);
      layer.x(panX);
      layer.y(panY);
    }

    refreshSelectionTransformer();

    stage.batchDraw();
  }

  // Get pointer position in canvas coordinates (accounting for zoom/pan)
  function getCanvasPos(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): { x: number; y: number } | null {
    if (!stage) return null;
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return null;

    const { zoom, panX, panY } = canvas.viewport;
    return {
      x: (pointerPos.x - panX) / zoom,
      y: (pointerPos.y - panY) / zoom,
    };
  }

  function getActiveKonvaLayer(): Konva.Layer | null {
    if (!canvas.activeLayerId) return null;
    return konvaLayers.get(canvas.activeLayerId) ?? null;
  }

  /** Masks and regions are overlays drawn on top of the picture, so the canvas
   * shows them through the overlay strength as well as their own opacity. A
   * raster layer is the picture itself and is drawn exactly as it is. Display
   * only: a run reads the layer's own opacity, never this. */
  /** How strongly a layer's own drawing is shown over the picture: a mask and a
   * region are overlays, so they pass through the display strength; a raster
   * layer is the picture itself. Display only — a run reads the layer's own
   * density, never this. */
  const overlayDisplayScale = (layer: { type: string }) =>
    layer.type === "raster" ? 1 : canvas.maskOverlayOpacity;

  /** What the canvas shows for a layer: its own density through the display
   * strength. The generation paths read layer.opacity alone. */
  const displayOpacity = (layer: { type: string; opacity: number }) =>
    layer.opacity * overlayDisplayScale(layer);

  /** The colour a stroke lands in. A mask or a region draws in its own tint, so
   * two of them can be told apart; a raster layer draws in the brush colour. */
  function drawingColor(layer: CanvasLayer | undefined): string {
    return layer && layer.type !== "raster" ? resolveTint(layer) : canvas.foregroundColor;
  }

  /** Draw a layer's image asset: recoloured into its tint for a mask or a
   * region, or as itself for a raster layer. The tint it was painted with is
   * remembered on the node, so a later colour change can repaint from the same
   * source instead of waiting for the next load. */
  function paintLayerAsset(node: Konva.Image, image: HTMLImageElement, layer: CanvasLayer) {
    if (layer.type === "raster") {
      node.image(image);
      node.setAttr("tintKey", undefined);
      return;
    }
    const pixels = document.createElement("canvas");
    pixels.width = image.naturalWidth;
    pixels.height = image.naturalHeight;
    const ctx = pixels.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, pixels.width, pixels.height);
    const color = parseHexColor(resolveTint(layer));
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i + 3] = Math.round(data.data[i] * (data.data[i + 3] / 255));
      data.data[i] = color.r;
      data.data[i + 1] = color.g;
      data.data[i + 2] = color.b;
    }
    ctx.putImageData(data, 0, 0);
    node.image(pixels);
    node.setAttr("tintKey", resolveTintKey(layer));
  }

  /** Strokes and region shapes belong to their layer's tint as well. When the
   * tint changes, the nodes drawn in the old colour follow it. */
  function repaintOverlayNodes(kLayer: Konva.Layer, layer: CanvasLayer) {
    if (layer.type === "raster") return;
    const next = resolveTint(layer);
    const previous = kLayer.getAttr("overlayTint") as string | undefined;
    kLayer.setAttr("overlayTint", next);
    if (!previous || previous === next) return;
    for (const child of kLayer.getChildren()) {
      const node = child as Konva.Shape;
      if (typeof node.stroke === "function" && node.stroke() === previous) node.stroke(next);
      if (typeof node.fill === "function" && node.fill() === previous) node.fill(next);
    }
  }

  // Right-click menu over the picture.
  let contextMenu = $state<{ x: number; y: number } | null>(null);

  function openContextMenu(event: MouseEvent) {
    if (isTypingTarget(event.target)) return;
    const rect = containerEl?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    contextMenu = {
      x: Math.max(4, Math.min(event.clientX - rect.left, rect.width - 176)),
      y: Math.max(4, Math.min(event.clientY - rect.top, rect.height - 40)),
    };
  }

  function runMenuAction(action: () => void) {
    contextMenu = null;
    action();
  }

  $effect(() => {
    if (!contextMenu) return;
    const dismiss = () => (contextMenu = null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  });

  function isInpaintMaskMode(): boolean {
    return generation.mode === "inpainting" && isMaskLayer(canvas.activeLayer);
  }

  function isInpaintingMode(): boolean {
    return generation.mode === "inpainting";
  }

  function getDrawingTargetLayer(): { layer: (typeof canvas.layers)[number]; kLayer: Konva.Layer } | null {
    if (canvas.selectedWorkspaceSection !== 'layers') return null;
    const layer = canvas.activeLayer;
    if (!layer || layer.locked || !layer.visible) return null;

    const kLayer = getActiveKonvaLayer();
    if (!kLayer) return null;

    return { layer, kLayer };
  }

  async function autoCommitMaskIfNeeded() {
    if (!isInpaintMaskMode()) return;
    try {
      await canvas.syncMaskToGeneration(getMaskCanvas(), false);
    } catch (error) {
      console.error("Failed to auto-sync inpaint mask:", error);
    }
  }

  // Regenerate the small pixel preview shown for a layer in the layer panel.
  function refreshLayerThumbnail(id: string) {
    const kLayer = konvaLayers.get(id);
    if (!kLayer) return;

    const w = canvas.canvasWidth;
    const h = canvas.canvasHeight;
    const maxDim = Math.max(w, h);
    if (maxDim <= 0) return;

    // The viewport is applied as a layer transform; reset it so the thumbnail
    // captures canvas-space pixels at a fixed scale, then restore it.
    const origScaleX = kLayer.scaleX();
    const origScaleY = kLayer.scaleY();
    const origX = kLayer.x();
    const origY = kLayer.y();
    kLayer.scaleX(1);
    kLayer.scaleY(1);
    kLayer.x(0);
    kLayer.y(0);

    let url: string | null = null;
    try {
      url = kLayer.toDataURL({
        pixelRatio: 64 / maxDim,
        width: w,
        height: h,
        x: 0,
        y: 0,
      });
    } catch (error) {
      console.error("Failed to generate layer thumbnail:", error);
    } finally {
      kLayer.scaleX(origScaleX);
      kLayer.scaleY(origScaleY);
      kLayer.x(origX);
      kLayer.y(origY);
    }

    if (url) canvas.setLayerThumbnail(id, url);
  }

  // Coalesce thumbnail regeneration to one per frame per layer so painting
  // never regenerates a thumbnail mid-stroke.
  function scheduleThumbRefresh(id: string) {
    if (thumbRafs.has(id)) return;
    const raf = requestAnimationFrame(() => {
      thumbRafs.delete(id);
      refreshLayerThumbnail(id);
      if (id === canvas.activeLayerId) void updateContextOverlay();
    });
    thumbRafs.set(id, raf);
  }

  function loadImageEl(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Re-hydrate every preserved mask/region independently after a base undo.
  // Empty snapshots intentionally clear just that layer; other layers survive.
  async function restoreSpatialLayers(snapshots: SpatialLayerSnapshot[]) {
    if (!stage) return;
    await Promise.all(snapshots.map(async (snapshot) => {
      const meta = canvas.layers.find((layer) => layer.id === snapshot.id && layer.type === snapshot.type);
      const kLayer = meta ? konvaLayers.get(meta.id) : undefined;
      if (!meta || !kLayer) return;

      if (!snapshot.contentUrl) {
        kLayer.destroyChildren();
        kLayer.batchDraw();
        scheduleThumbRefresh(meta.id);
        return;
      }

      let img: HTMLImageElement;
      try {
        img = await loadImageEl(snapshot.contentUrl);
      } catch {
        return;
      }

      // The document may have changed again while the image decoded.
      if (!stage || konvaLayers.get(meta.id) !== kLayer) return;
      kLayer.destroyChildren();
      kLayer.add(new Konva.Image({
        name: "raster-asset",
        image: img,
        x: 0,
        y: 0,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
        listening: false,
      }));
      kLayer.batchDraw();
      scheduleThumbRefresh(meta.id);
    }));
  }

  // Drawing handlers
  function handlePointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const evt = e.evt as MouseEvent;

    // A pointerdown that lands on the transformer (an anchor or its border) is
    // the resize the user asked for; it must not also start a move.
    const target = e.target as Konva.Node | null;
    if (target && (target === selectionTransformer || target.getParent?.() === selectionTransformer || target.hasName?.('_anchor'))) return;

    // Middle mouse → pan
    if (evt.button === 1) {
      isPanning = true;
      lastPointerPos = stage!.getPointerPosition();
      e.evt.preventDefault();
      return;
    }

    // Right click → ignore (context menu)
    const isTemporaryInpaintErase = evt.button === 2 && isInpaintingMode();
    if (evt.button === 2 && !isTemporaryInpaintErase) return;
    if (isTemporaryInpaintErase) e.evt.preventDefault();

    const tool = isTemporaryInpaintErase ? "eraser" : canvas.activeTool;
    const pos = getCanvasPos(e);
    if (!pos) return;

    if (tool === "view") {
      isPanning = true;
      lastPointerPos = stage!.getPointerPosition();
      return;
    }

    if (tool === "brush" || tool === "eraser") {
      const target = getDrawingTargetLayer();
      if (!target) return;
      const { layer, kLayer } = target;

      // Snapshot for undo before drawing
      canvasHistory.snapshot(layer.id);

      isDrawing = true;
      activeStrokeTool = tool;


      const color = tool === "eraser" ? "#000000" : drawingColor(layer);

      const drawOpacity = tool === "eraser" ? 1 : canvas.brushSettings.opacity;

      currentLine = new Konva.Line({
        stroke: color,
        strokeWidth: canvas.brushSettings.size,
        opacity: drawOpacity,
        globalCompositeOperation: tool === "eraser" ? "destination-out" : "source-over",
        lineCap: "round",
        lineJoin: "round",
        tension: 0,
        points: [pos.x, pos.y, pos.x, pos.y],
        listening: false,
      });

      kLayer.add(currentLine);
      kLayer.batchDraw();
    }

    if (tool === "rectFill" || tool === "ellipseFill") {
      const target = getDrawingTargetLayer();
      if (!target) return;
      const { layer } = target;

      // Snapshot for undo before rect fill
      canvasHistory.snapshot(layer.id);

      isDrawingRect = true;
      rectStartPos = pos;

      const inpaintMaskMode = isInpaintMaskMode();

      // Create preview rect on UI layer
      const color = drawingColor(layer);
      rectPreview = new Konva.Rect({
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        fill: color,
        // Preview what the commit will look like: the brush sets the fill's
        // density, and an overlay is drawn through the display strength.
        opacity: canvas.brushSettings.opacity * overlayDisplayScale(layer),
        listening: false,
      });
      uiLayer?.add(rectPreview);
    }

    if (tool === "eyedropper") {
      sampleColor(pos);
    }

    if (tool === "lasso") {
      const target = getDrawingTargetLayer();
      if (!target) return;
      const { layer } = target;

      // Snapshot for undo before committing the lasso fill.
      canvasHistory.snapshot(layer.id);

      isLasso = true;
      lassoPoints = [pos.x, pos.y];

      const color = drawingColor(layer);

      // Preview lives on the unscaled UI layer, so points are in screen space.
      const { zoom, panX, panY } = canvas.viewport;
      lassoPreviewLine = new Konva.Line({
        points: [pos.x * zoom + panX, pos.y * zoom + panY],
        stroke: color,
        strokeWidth: 1.5,
        dash: [4, 4],
        closed: false,
        listening: false,
      });
      uiLayer?.add(lassoPreviewLine);
      uiLayer?.batchDraw();
    }

    if (tool === "move") {
      const layer = canvas.activeLayer;
      if (!layer || layer.locked || !layer.visible || canvas.selectedWorkspaceSection !== "layers") return;

      const kLayer = getActiveKonvaLayer();
      if (!kLayer) return;

      canvasHistory.snapshot(layer.id);
      canvas.beginMove(layer.id, pos.x, pos.y);

      isMovingLayer = true;
      moveStartPos = pos;
      moveNodeStarts = kLayer.getChildren().map((node) => ({
        node,
        x: node.x(),
        y: node.y(),
      }));
    }
  }

  function handlePointerMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!stage) return;

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    // Update canvas cursor position
    const canvasPos = getCanvasPos(e);
    canvas.cursorPos = canvasPos;

    // Update brush cursor
    if (brushCursor && canvasPos) {
      const tool = activeStrokeTool ?? canvas.activeTool;
      const showCursor = tool === "brush" || tool === "eraser";
      brushCursor.visible(showCursor);
      if (showCursor) {
        brushCursor.x(canvasPos.x);
        brushCursor.y(canvasPos.y);
        brushCursor.radius(canvas.brushSettings.size / 2);
        brushCursor.stroke(tool === "eraser" ? "#ffffff" : canvas.foregroundColor);
        // Position brush cursor in screen space within UI layer
        const { zoom, panX, panY } = canvas.viewport;
        brushCursor.x(canvasPos.x * zoom + panX);
        brushCursor.y(canvasPos.y * zoom + panY);
        brushCursor.radius((canvas.brushSettings.size * zoom) / 2);
        brushCursor.strokeWidth(1.5);
        uiLayer?.batchDraw();
      }
    }

    // Panning
    if (isPanning && lastPointerPos) {
      const dx = pointerPos.x - lastPointerPos.x;
      const dy = pointerPos.y - lastPointerPos.y;
      canvas.viewport = {
        ...canvas.viewport,
        panX: canvas.viewport.panX + dx,
        panY: canvas.viewport.panY + dy,
      };
      canvas.viewportInitialized = true;
      lastPointerPos = pointerPos;
      scheduleViewportApply();
      return;
    }

    // Drawing
    if (isDrawing && currentLine) {
      const pos = getCanvasPos(e);
      if (!pos) return;

      const points = currentLine.points();
      currentLine.points([...points, pos.x, pos.y]);
      // Redraw the layer the stroke actually lives on. In inpaint-mask mode the
      // line is added to the mask layer, not the active layer, so redrawing the
      // active layer here would leave the in-progress stroke invisible.
      currentLine.getLayer()?.batchDraw();
    }

    // Rectangle preview
    if (isDrawingRect && rectPreview && rectStartPos) {
      const pos = getCanvasPos(e);
      if (!pos) return;

      const x = Math.min(rectStartPos.x, pos.x);
      const y = Math.min(rectStartPos.y, pos.y);
      const w = Math.abs(pos.x - rectStartPos.x);
      const h = Math.abs(pos.y - rectStartPos.y);

      // Position in screen space for UI layer
      const { zoom, panX, panY } = canvas.viewport;
      rectPreview.x(x * zoom + panX);
      rectPreview.y(y * zoom + panY);
      rectPreview.width(w * zoom);
      rectPreview.height(h * zoom);
      uiLayer?.batchDraw();
    }

    if (isMovingLayer && moveStartPos) {
      const pos = getCanvasPos(e);
      if (!pos) return;

      const dx = pos.x - moveStartPos.x;
      const dy = pos.y - moveStartPos.y;
      canvas.updateMove(pos.x, pos.y);

      for (const entry of moveNodeStarts) {
        entry.node.x(entry.x + dx);
        entry.node.y(entry.y + dy);
      }
      getActiveKonvaLayer()?.batchDraw();
      // The dashed guides move with the layer: the outline the user is dragging
      // is the outline the run will read.
      liveOverlayOffset(dx, dy);
    }

    // Lasso preview (append screen-space point to the dashed outline)
    if (isLasso && lassoPreviewLine) {
      const pos = getCanvasPos(e);
      if (!pos) return;

      lassoPoints = [...lassoPoints, pos.x, pos.y];
      const { zoom, panX, panY } = canvas.viewport;
      const prev = lassoPreviewLine.points();
      lassoPreviewLine.points([...prev, pos.x * zoom + panX, pos.y * zoom + panY]);
      uiLayer?.batchDraw();
    }

    if (tooltipRaf === null) {
      tooltipRaf = requestAnimationFrame(() => updateTooltip(e));
    }
  }

  function handlePointerUp(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (isPanning) {
      isPanning = false;
      lastPointerPos = null;
      return;
    }
    
    if (tooltipVisible) {
      tooltipVisible = false;
    }

    let shouldAutoCommitMask = false;

    if (isDrawing) {
      // Capture the layer the stroke lives on before clearing currentLine.
      const strokeLayerId = currentLine?.getLayer()?.id();
      isDrawing = false;
      currentLine = null;
      activeStrokeTool = null;
      shouldAutoCommitMask = true;
      if (strokeLayerId) scheduleThumbRefresh(strokeLayerId);
    }
    
    if (isDrawingRect && rectStartPos) {
      isDrawingRect = false;
      const pos = getCanvasPos(e);
      if (pos) {
        // Create final rect on the active Konva layer
        const target = getDrawingTargetLayer();
        if (target) {
          const { layer, kLayer } = target;
          let w = Math.abs(pos.x - rectStartPos.x);
          let h = Math.abs(pos.y - rectStartPos.y);
          // Shift keeps the fill square, the way every other editor does. The
          // drag keeps growing away from where it started.
          if (e.evt.shiftKey) {
            const side = Math.max(w, h);
            w = side;
            h = side;
          }
          const x = pos.x < rectStartPos.x ? rectStartPos.x - w : rectStartPos.x;
          const y = pos.y < rectStartPos.y ? rectStartPos.y - h : rectStartPos.y;

          if (w > 1 && h > 1) {

            const color = drawingColor(layer);
            const rect = canvas.activeTool === "ellipseFill" ? new Konva.Ellipse({
              x: x+w/2, y: y+h/2, radiusX: w/2, radiusY: h/2, fill: color,
              opacity: canvas.brushSettings.opacity, listening: false,
            }) : new Konva.Rect({
              x, y, width: w, height: h,
              fill: color,
              opacity: canvas.brushSettings.opacity,
              listening: false,
            });
            kLayer.add(rect);
            kLayer.batchDraw();
            shouldAutoCommitMask = true;
            scheduleThumbRefresh(layer.id);
          }
        }
      }

      // Remove preview from UI layer
      if (rectPreview) {
        rectPreview.destroy();
        rectPreview = null;
        uiLayer?.batchDraw();
      }
      rectStartPos = null;
    }

    if (isLasso) {
      isLasso = false;
      const target = getDrawingTargetLayer();
      if (target && lassoPoints.length >= 6) {
        const { layer, kLayer } = target;
        const color = drawingColor(layer);
        const shape = new Konva.Line({
          points: [...lassoPoints],
          closed: true,
          fill: color,
          opacity: canvas.brushSettings.opacity,
          listening: false,
        });
        kLayer.add(shape);
        kLayer.batchDraw();
        shouldAutoCommitMask = true;
        scheduleThumbRefresh(layer.id);
      }
      lassoPoints = [];
      if (lassoPreviewLine) {
        lassoPreviewLine.destroy();
        lassoPreviewLine = null;
        uiLayer?.batchDraw();
      }
    }

    if (isMovingLayer) {
      const layer = canvas.activeLayer;
      if (layer?.image) {
        const node = getActiveKonvaLayer()?.findOne('.raster-asset');
        if (node) canvas.updateLayerImage(layer.id, { x: node.x() - (layer.image.flipX ? layer.image.width : 0), y: node.y() - (layer.image.flipY ? layer.image.height : 0) });
      }
      isMovingLayer = false;
      moveStartPos = null;
      moveNodeStarts = [];
      canvas.endMove();
      resetOverlayTransform();
      selectionTransformer?.forceUpdate();
      // The handles and the guides must sit on the moved content, and a moved
      // mask is a changed mask: the run reads the pixels, not the position.
      refreshSelectionTransformer();
      void updateContextOverlay();
      if (layer) scheduleThumbRefresh(layer.id);
      if (isMaskLayer(layer)) void autoCommitMaskIfNeeded();
    }

    if (shouldAutoCommitMask) {
      // Pixels went down: the picture changed even though the layer records did
      // not, and a project has to know that before it can call itself saved.
      canvas.bumpPaintRevision();
      void autoCommitMaskIfNeeded();
    }
  }

  function handlePointerLeave() {
    tooltipVisible = false;
    canvas.isPointerOverStage = false;
    canvas.cursorPos = null;
    if (brushCursor) {
      brushCursor.visible(false);
      uiLayer?.batchDraw();
    }

    if (isSpacePanning) {
      isSpacePanning = false;
      canvas.restorePreviousTool();
    }

    if (isPanning) {
      isPanning = false;
      lastPointerPos = null;
    }

    if (isDrawing) {
      isDrawing = false;
      currentLine = null;
      activeStrokeTool = null;
    }

    if (isDrawingRect) {
      isDrawingRect = false;
      rectStartPos = null;
      if (rectPreview) {
        rectPreview.destroy();
        rectPreview = null;
        uiLayer?.batchDraw();
      }
    }

    if (isLasso) {
      isLasso = false;
      lassoPoints = [];
      if (lassoPreviewLine) {
        lassoPreviewLine.destroy();
        lassoPreviewLine = null;
        uiLayer?.batchDraw();
      }
    }

    if (isMovingLayer) {
      isMovingLayer = false;
      moveStartPos = null;
      moveNodeStarts = [];
      canvas.endMove();
      resetOverlayTransform();
      refreshSelectionTransformer();
      void updateContextOverlay();
    }
  }

  function handlePointerEnter() {
    canvas.isPointerOverStage = true;
  }

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const pointerPos = stage!.getPointerPosition();
    if (!pointerPos) return;

    // Shift scrolls the canvas sideways instead of zooming it — the modifier
    // people expect from a wheel over a picture.
    if (e.evt.shiftKey) {
      canvas.viewport = { ...canvas.viewport, panX: canvas.viewport.panX - e.evt.deltaY };
      scheduleViewportApply();
      return;
    }

    const delta = e.evt.deltaY;
    const scaleBy = 1.08;
    const oldZoom = canvas.viewport.zoom;
    const newZoom = delta > 0 ? oldZoom / scaleBy : oldZoom * scaleBy;

    canvas.setZoom(newZoom, pointerPos.x, pointerPos.y);
    scheduleViewportApply();
  }

  function sampleColor(pos: { x: number; y: number }) {
    if (!stage || pos.x < 0 || pos.y < 0 || pos.x >= canvas.canvasWidth || pos.y >= canvas.canvasHeight) return;

    // Sample document pixels only. Stage.toCanvas also contains checkerboard,
    // context guides, sampler preview and transform handles, which must never
    // influence the eyedropper.
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = canvas.canvasWidth;
    compositeCanvas.height = canvas.canvasHeight;
    const ctx = compositeCanvas.getContext('2d')!;
    if (refLayer) ctx.drawImage(captureLayer(refLayer, canvas.canvasWidth, canvas.canvasHeight), 0, 0);
    const sorted = [...canvas.layers].filter((layer) => layer.type === 'raster' && layer.visible).sort((a, b) => a.order - b.order);
    for (const layer of sorted) {
      const kLayer = konvaLayers.get(layer.id);
      if (!kLayer) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(captureLayer(kLayer, canvas.canvasWidth, canvas.canvasHeight), 0, 0);
    }
    ctx.globalAlpha = 1;
    const pixel = ctx.getImageData(Math.floor(pos.x), Math.floor(pos.y), 1, 1).data;

    if (pixel[3] > 0) {
      const hex = `#${pixel[0].toString(16).padStart(2, "0")}${pixel[1].toString(16).padStart(2, "0")}${pixel[2].toString(16).padStart(2, "0")}`;
      canvas.foregroundColor = hex;
    }
  }

  // Space bar pan support
  function handleKeyDown(e: KeyboardEvent) {
    // Typing belongs to the field: a space in a prompt must not start panning.
    if (isTypingTarget(e.target)) return;

    // Escape cancels an in-progress lasso even if the pointer left the stage.
    if (e.code === "Escape" && isLasso) {
      isLasso = false;
      lassoPoints = [];
      if (lassoPreviewLine) {
        lassoPreviewLine.destroy();
        lassoPreviewLine = null;
        uiLayer?.batchDraw();
      }
      return;
    }

    if (!canvas.isPointerOverStage) return;

    if (e.code === "Space" && !isSpacePanning && !e.repeat) {
      isSpacePanning = true;
      canvas.setTool("view");
      e.preventDefault();
    }

    // Hold Alt for a quick eyedropper; release restores the previous tool.
    // A mask or a region draws in its own tint, so there is nothing to pick
    // for one — the same rule the toolbar and the hotkey ask.
    if (e.altKey && canvas.canPickColor && !isAltEyedropper && !e.repeat && canvas.activeTool !== "eyedropper") {
      isAltEyedropper = true;
      canvas.setTool("eyedropper");
      e.preventDefault();
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === "Space" && isSpacePanning) {
      isSpacePanning = false;
      canvas.restorePreviousTool();
    }

    if (isAltEyedropper && !e.altKey) {
      isAltEyedropper = false;
      canvas.restorePreviousTool();
    }
  }

  // Reactive effects
  $effect(() => {
    void progress.previewImage;
    void progress.isGenerating;
    void generation.mode;
    void canvas.canvasWidth;
    void canvas.canvasHeight;
    updateLivePreview(progress.previewImage);
  });

  $effect(() => {
    void canvas.activeTool;
    void canvas.activeLayerId;
    void canvas.layers;
    void canvas.canvasWidth;
    void canvas.canvasHeight;
    void progress.isGenerating;
    refreshSelectionTransformer();
  });

  $effect(() => {
    // Re-sync Konva layers when canvas layers change
    void canvas.layers;
    void canvas.canvasWidth;
    void canvas.canvasHeight;
    syncKonvaLayers();
    drawCheckerboard();
    applyViewport();

    // Re-hydrate preserved masks/regions after an inpaint-base undo.
    const restoreLayers = canvas.pendingSpatialLayerRestore;
    if (restoreLayers) {
      canvas.pendingSpatialLayerRestore = null;
      void restoreSpatialLayers(restoreLayers);
    }

    // Generate an initial thumbnail for any layer we haven't captured yet.
    for (const layer of canvas.layers) {
      if (!thumbInitialized.has(layer.id) || !canvas.layerThumbnails[layer.id]) {
        thumbInitialized.add(layer.id);
        scheduleThumbRefresh(layer.id);
      }
    }
    // Forget removed layers so a re-added id regenerates and drop pending RAFs.
    for (const id of [...thumbInitialized]) {
      if (!canvas.layers.find((l) => l.id === id)) {
        thumbInitialized.delete(id);
        const raf = thumbRafs.get(id);
        if (raf !== undefined) {
          cancelAnimationFrame(raf);
          thumbRafs.delete(id);
        }
      }
    }
  });

  let historyDims = { w: 0, h: 0 };
  $effect(() => {
    // Keep undo/redo snapshot dimensions in sync with the canvas. When the
    // canvas is resized (e.g. a new image is loaded) existing snapshots no
    // longer match the new dimensions, so discard them rather than restoring
    // stretched or clipped pixels.
    const w = canvas.canvasWidth;
    const h = canvas.canvasHeight;
    if (w === historyDims.w && h === historyDims.h) return;
    const hadDims = historyDims.w !== 0 || historyDims.h !== 0;
    historyDims = { w, h };
    canvasHistory.setRefs(konvaLayers, w, h);
    if (hadDims) canvasHistory.clear();
  });

  $effect(() => {
    // Re-apply viewport when it changes (coalesced to one frame)
    void canvas.viewport;
    scheduleViewportApply();
  });

  $effect(() => {
    // Redraw checkerboard when toggle changes
    void canvas.showCheckerboard;
    if (bgLayer) {
      if (canvas.showCheckerboard) {
        drawCheckerboard();
      } else {
        bgLayer.destroyChildren();
        bgLayer.batchDraw();
      }
    }
  });

  $effect(() => {
    void canvas.effectiveReferenceImage;
    void canvas.canvasWidth;
    void canvas.canvasHeight;
    updateReferenceImage(canvas.effectiveReferenceImage);
  });

  $effect(() => {
    if (baseColorNode) {
      baseColorNode.setAttrs({ fill: canvas.baseColor, width: canvas.canvasWidth, height: canvas.canvasHeight });
      refLayer?.batchDraw();
    }
  });

  $effect(() => {
    void canvas.persistedMaskPreviewUrl;
    void canvas.maskOverlayVisible;
    void canvas.maskOverlayOpacity;
    void canvas.maskOverlayOpacity;
    void canvas.canvasWidth;
    void canvas.canvasHeight;
    updatePersistedMaskOverlay(canvas.persistedMaskPreviewUrl);
  });

  $effect(() => {
    // Every value represented by the on-canvas context overlay participates in
    // this dependency list, so the preview follows sliders without touching pixels.
    void canvas.activeLayerId;
    void canvas.layers;
    void canvas.canvasWidth;
    void canvas.canvasHeight;
    void canvas.selectedWorkspaceSection;
    void canvas.showLayerContext;
    void canvas.controlContextPreviewUrl;
    void generation.growMaskBy;
    void generation.inpaintSettings;
    void generation.controlnetStrength;
    void generation.controlnetStartPercent;
    void generation.controlnetEndPercent;
    if (stage) void updateContextOverlay();
  });

  // Public API for export
  export function getRasterComposite(): HTMLCanvasElement | null {
    if (!stage) return null;

    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.canvasWidth;
    offscreen.height = canvas.canvasHeight;
    const ctx = offscreen.getContext("2d")!;

    const sorted = [...canvas.layers]
      .filter((l) => l.type === "raster" && l.visible)
      .sort((a, b) => a.order - b.order);

    for (const layer of sorted) {
      const kLayer = konvaLayers.get(layer.id);
      if (!kLayer) continue;

      const layerCanvas = captureLayer(kLayer, canvas.canvasWidth, canvas.canvasHeight);
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(layerCanvas, 0, 0);
      ctx.globalAlpha = 1;

    }

    return offscreen;
  }

  export function getMaskCanvas(): HTMLCanvasElement | null {
    if (!stage) return null;

    // Region layers carry prompt influence only. They never grant permission
    // to change pixels, so only true inpaint masks enter the exported union.
    const maskLayers = canvas.layers.filter((l) => l.type === "mask" && l.visible);
    if (maskLayers.length === 0) return null;

    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.canvasWidth;
    offscreen.height = canvas.canvasHeight;
    const ctx = offscreen.getContext("2d")!;

    for (const layer of maskLayers) {
      const kLayer = konvaLayers.get(layer.id);
      if (!kLayer) continue;

      const layerCanvas = captureLayer(kLayer, canvas.canvasWidth, canvas.canvasHeight);
      // Coverage, not the display slider: the overlay may be drawn faint and
      // still edit at full strength.
      ctx.globalAlpha = layer.coverage ?? 1;
      ctx.drawImage(layerCanvas, 0, 0);
    }
    ctx.globalAlpha = 1;

    return offscreen;
  }

  // Get cursor style based on active tool
  function getCursorClass(): string {
    const tool = canvas.activeTool;
    if (isPanning || tool === "view") return "cursor-grab";
    if (tool === "move") return "cursor-move";
    if (tool === "eyedropper" || tool === "lasso") return "cursor-crosshair";
    if (tool === "brush" || tool === "eraser") return "cursor-none";
    return "cursor-default";
  }
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} />

<!-- The picture itself is the control; this element only hosts it and its menu. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="w-full h-full relative overflow-hidden bg-neutral-950 {getCursorClass()}"
  bind:this={containerEl}
  role="presentation"
  oncontextmenu={openContextMenu}
>
  {#if contextMenu}
    <!-- Right-click on the picture: the actions a canvas is actually asked for,
         all with the layer list's own wording. -->
    <div
      role="menu"
      tabindex="-1"
      class="absolute z-30 min-w-40 rounded-md border border-neutral-700/80 bg-neutral-950/95 p-1 text-[11px] text-neutral-200 shadow-xl backdrop-blur-md"
      style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
      onpointerdown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" class="flex h-6 w-full items-center justify-between gap-6 rounded px-2 text-left hover:bg-neutral-800 disabled:opacity-40" disabled={!canvasHistory.canUndo} onclick={() => runMenuAction(() => canvasHistory.undo())}>
        <span>{locale.t('canvas.undo')}</span><span class="text-neutral-500">Ctrl+Z</span>
      </button>
      <button type="button" role="menuitem" class="flex h-6 w-full items-center justify-between gap-6 rounded px-2 text-left hover:bg-neutral-800 disabled:opacity-40" disabled={!canvasHistory.canRedo} onclick={() => runMenuAction(() => canvasHistory.redo())}>
        <span>{locale.t('canvas.redo')}</span><span class="text-neutral-500">Ctrl+Y</span>
      </button>
      <button type="button" role="menuitem" class="flex h-6 w-full items-center rounded px-2 text-left hover:bg-neutral-800" onclick={() => runMenuAction(() => canvas.zoomToFit(canvas.viewportWidth, canvas.viewportHeight))}>
        {locale.t('canvas.fit_view')}
      </button>
      {#if canvas.activeLayer}
        <div class="my-1 h-px bg-neutral-800"></div>
        <button type="button" role="menuitem" class="flex h-6 w-full items-center rounded px-2 text-left hover:bg-neutral-800" onclick={() => runMenuAction(() => canvas.duplicateLayer(canvas.activeLayerId!))}>
          {locale.t('canvas.duplicate')}
        </button>
        <button type="button" role="menuitem" class="flex h-6 w-full items-center rounded px-2 text-left hover:bg-neutral-800" onclick={() => runMenuAction(() => canvas.clearLayer(canvas.activeLayerId!))}>
          {locale.t('canvas.clear_layer')}
        </button>
        <button type="button" role="menuitem" class="flex h-6 w-full items-center rounded px-2 text-left text-red-300 hover:bg-red-500/10 disabled:opacity-40" disabled={!canvas.canDeleteActiveLayer} onclick={() => runMenuAction(() => canvas.removeLayer(canvas.activeLayerId!))}>
          {locale.t('canvas.delete_layer')}
        </button>
      {/if}
    </div>
  {/if}
  {#if tooltipVisible}
    <div class="fixed" style="left: {tooltipPos.x}px; top: {tooltipPos.y}px; z-index: 100; pointer-events: none;">
      <ColorTooltip color={tooltipColor} />
    </div>
  {/if}
</div>
