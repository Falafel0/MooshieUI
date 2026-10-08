<script lang="ts">
  import { canvas, type ToolType } from "../../stores/canvas.svelte.js";
  import { isTypingTarget } from "../../utils/keyboardTarget.js";
  import { canvasHistory } from "../../stores/canvasHistory.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { progress } from '../../stores/progress.svelte.js';
  import BrushSettings from "./controls/BrushSettings.svelte";
  import ColorPicker from "./controls/ColorPicker.svelte";
  import { Undo2, Redo2 } from "@lucide/svelte";

  import { Brush, Eraser, RectangleHorizontal, Ellipse, Lasso, Pipette, Move, Hand, ChevronDown, MoreHorizontal } from "@lucide/svelte";
  import ContextMenu from "../ui/ContextMenu.svelte";

  const editable = $derived(canvas.selectedWorkspaceSection === 'layers' && canvas.activeLayer?.type !== 'controlnet' && canvas.visibleLayers.some(layer => layer.id === canvas.activeLayerId) && !canvas.activeLayer?.locked);
  const shapes = [
    { id: 'rectFill' as const, key: 'canvas.rectangle_fill', hotkey: 'U', icon: RectangleHorizontal },
    { id: 'ellipseFill' as const, key: 'canvas.ellipse_fill', hotkey: 'O', icon: Ellipse },
    { id: 'lasso' as const, key: 'canvas.freeform_fill', hotkey: 'Q', icon: Lasso },
  ];
  const tools = [
    { id: 'brush' as const, key: 'canvas.brush', hotkey: 'B', icon: Brush },
    { id: 'eraser' as const, key: 'canvas.eraser', hotkey: 'E', icon: Eraser },
    { id: 'move' as const, key: 'canvas.move', hotkey: 'V', icon: Move },
    { id: 'view' as const, key: 'canvas.pan', hotkey: 'H', icon: Hand },
  ];
  let menu = $state<'shapes' | 'actions' | null>(null);
  let menuPosition = $state({ x: 0, y: 0 });
  let lastShape = $state<ToolType>('rectFill');
  const currentShape = $derived(shapes.find(shape => shape.id === canvas.activeTool) ?? shapes.find(shape => shape.id === lastShape) ?? shapes[0]);
  const painting = $derived(editable && ['brush', 'eraser', 'rectFill', 'ellipseFill', 'lasso'].includes(canvas.activeTool));
  const menuItems = $derived(menu === 'shapes' ? shapes.map(shape => ({
    label: `${locale.t(shape.key)} (${shape.hotkey})`,
    action: () => { lastShape = shape.id; canvas.setTool(shape.id); },
    disabled: !editable,
  })) : [
    { label: locale.t('canvas.fill_layer'), action: () => canvas.fillActiveLayer(), disabled: !editable },
    { label: locale.t('canvas.clear_pixels'), action: () => { if (canvas.activeLayerId) canvas.clearLayer(canvas.activeLayerId); }, disabled: !editable, destructive: true },
    { label: `${locale.t('canvas.resize_document')} (C)`, action: () => canvas.resizeDialogOpen = true, disabled: progress.isGenerating, separator: true },
    { label: locale.t('canvas.resize_document_on_canvas'), action: () => canvas.setTool('canvasResize'), disabled: progress.isGenerating },
  ]);
  function openMenu(event: MouseEvent, kind: 'shapes' | 'actions') {
    if (menu === kind) { menu = null; return; }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menuPosition = { x: rect.left, y: rect.bottom + 4 }; menu = kind;
  }
  function navigateTools(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (canvas.resizeDialogOpen) return;
    if (!canvas.isPointerOverStage) return;

    // Don't trigger if typing in a field — including a rich-text editor.
    if (isTypingTarget(e.target)) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j' && canvas.activeLayerId) {
      e.preventDefault(); canvas.duplicateLayer(canvas.activeLayerId); return;
    }

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        canvasHistory.redo();
      } else {
        canvasHistory.undo();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      canvasHistory.redo();
      return;
    }

    // Delete key — clear active layer
    if (e.key === "Delete") {
      const layer = canvas.activeLayer;
      if (editable && layer && canvas.activeLayerId) {
        canvas.clearLayer(layer.id);
      }
      return;
    }

    switch (e.key.toLowerCase()) {
      case "b": canvas.setTool("brush"); break;
      case "e": canvas.setTool("eraser"); break;
      case "u": canvas.setTool("rectFill"); break;
      case "o": canvas.setTool("ellipseFill"); break;
      case "q": canvas.setTool("lasso"); break;
      case "i": if (canvas.canPickColor) canvas.setTool("eyedropper"); break;
      case "v": canvas.setTool("move"); break;
      case "c": if (!progress.isGenerating) canvas.resizeDialogOpen = true; break;
      case "h": canvas.setTool("view"); break;
      case "x": canvas.swapColors(); break;
      case "d": canvas.resetColors(); break;
      case "[": canvas.adjustBrushSize(-5); break;
      case "]": canvas.adjustBrushSize(5); break;
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="shrink-0 border-b border-ui-border bg-ui-surface">
  <div role="toolbar" aria-label={locale.t('canvas.toolbar')} tabindex="-1" onkeydown={navigateTools} class="flex items-center gap-1 px-2 py-1">
    {#each tools as tool}
      <button type="button" disabled={!editable && tool.id !== 'view'} aria-label={locale.t(tool.key)} aria-pressed={canvas.activeTool === tool.id} title={`${locale.t(tool.key)} (${tool.hotkey})`} onclick={() => canvas.setTool(tool.id)} class="ui-focus h-8 w-8 shrink-0 rounded-md flex items-center justify-center disabled:opacity-30 {canvas.activeTool === tool.id ? 'bg-ui-selected text-ui-accent' : 'text-neutral-400 hover:bg-ui-hover hover:text-neutral-200'}">
        <tool.icon size={17} />
      </button>
      {#if tool.id === 'eraser'}
        <div class="flex shrink-0 rounded-md {shapes.some(shape => shape.id === canvas.activeTool) ? 'bg-ui-selected text-ui-accent' : 'text-neutral-400'}">
          <button type="button" disabled={!editable} aria-label={locale.t(currentShape.key)} aria-pressed={shapes.some(shape => shape.id === canvas.activeTool)} title={`${locale.t(currentShape.key)} (${currentShape.hotkey})`} onclick={() => canvas.setTool(currentShape.id)} class="ui-focus h-8 w-8 flex items-center justify-center rounded-l-md hover:bg-ui-hover disabled:opacity-30"><currentShape.icon size={17} /></button>
          <button type="button" disabled={!editable} aria-label={locale.t('canvas.fill_shapes')} aria-haspopup="menu" aria-expanded={menu === 'shapes'} onclick={(event) => openMenu(event, 'shapes')} class="ui-focus h-8 w-5 flex items-center justify-center rounded-r-md hover:bg-ui-hover disabled:opacity-30"><ChevronDown size={12} /></button>
        </div>
        <div class="mx-1 h-5 w-px bg-ui-border"></div>
      {/if}
    {/each}
    {#if canvas.canPickColor}
      <button type="button" disabled={!editable} aria-label={locale.t('canvas.eyedropper')} aria-pressed={canvas.activeTool === 'eyedropper'} title={`${locale.t('canvas.eyedropper')} (I)`} onclick={() => canvas.setTool('eyedropper')} class="ui-focus h-8 w-8 flex items-center justify-center rounded-md disabled:opacity-30 {canvas.activeTool === 'eyedropper' ? 'bg-ui-selected text-ui-accent' : 'text-neutral-400 hover:bg-ui-hover'}"><Pipette size={17} /></button>
    {/if}
    <button type="button" aria-label={locale.t('canvas.more_actions')} title={locale.t('canvas.more_actions')} aria-haspopup="menu" aria-expanded={menu === 'actions'} onclick={(event) => openMenu(event, 'actions')} class="ui-focus h-8 w-8 shrink-0 flex items-center justify-center rounded-md text-neutral-400 hover:bg-ui-hover"><MoreHorizontal size={17} /></button>
    <div class="min-w-1 flex-1"></div>
    <button type="button" onclick={() => canvasHistory.undo()} disabled={!canvasHistory.canUndo} aria-label={locale.t('canvas.undo')} title={`${locale.t('canvas.undo')} (Ctrl+Z)`} class="ui-focus h-8 w-8 shrink-0 flex items-center justify-center rounded-md text-neutral-300 hover:bg-ui-hover disabled:opacity-30"><Undo2 size={16} /></button>
    <button type="button" onclick={() => canvasHistory.redo()} disabled={!canvasHistory.canRedo} aria-label={locale.t('canvas.redo')} title={`${locale.t('canvas.redo')} (Ctrl+Shift+Z)`} class="ui-focus h-8 w-8 shrink-0 flex items-center justify-center rounded-md text-neutral-300 hover:bg-ui-hover disabled:opacity-30"><Redo2 size={16} /></button>
  </div>
  {#if painting}
    <div class="flex flex-wrap items-center gap-3 border-t border-ui-border/50 px-3 py-1.5">
      <BrushSettings />
      {#if canvas.activeLayer?.type === 'raster' && canvas.activeTool !== 'eraser'}<ColorPicker />{/if}
    </div>
  {/if}
</div>
<ContextMenu visible={menu !== null} items={menuItems} x={menuPosition.x} y={menuPosition.y} onclose={() => menu = null} />
