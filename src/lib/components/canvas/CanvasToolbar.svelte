<script lang="ts">
  import { canvas, type ToolType } from "../../stores/canvas.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { canvasHistory } from "../../stores/canvasHistory.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import BrushSettings from "./controls/BrushSettings.svelte";
  import ColorPicker from "./controls/ColorPicker.svelte";
  import { PaintBucket, Trash2, Undo2, Redo2 } from "@lucide/svelte";

  const editable = $derived(canvas.selectedWorkspaceSection === 'layers' && !!canvas.activeLayer?.visible && !canvas.activeLayer?.locked);
  const tools: { id: ToolType; labelKey: string; hotkey: string; icon: string }[] = [
    {
      id: "brush",
      labelKey: "canvas.brush",
      hotkey: "B",
      icon: `<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>`,
    },
    {
      id: "eraser",
      labelKey: "canvas.eraser",
      hotkey: "E",
      icon: `<path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L13.8 2.4c.8-.8 2-.8 2.8 0L21 6.8c.8.8.8 2 0 2.8L12 18"/>`,
    },
    {
      id: "rectFill",
      labelKey: "canvas.rectangle",
      hotkey: "U",
      icon: `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>`,
    },
    {
      id: "ellipseFill",
      labelKey: "canvas.ellipse", hotkey: "O", icon: '<ellipse cx="12" cy="12" rx="9" ry="7" />',
    },
    {
      id: "lasso",
      labelKey: "canvas.lasso",
      hotkey: "Q",
      icon: `<path d="M3 14.5A6.5 6.5 0 0 1 2 11c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12.6 12.6 0 0 1-4.7-.9"/><path d="M7 21.5a5 5 0 0 1-2-4"/><circle cx="5" cy="16" r="2"/>`,
    },
    {
      id: "eyedropper",
      labelKey: "canvas.eyedropper",
      hotkey: "I",
      icon: `<path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M14.5 5.5l4-4a1.4 1.4 0 0 1 2 2l-4 4"/>`,
    },
    {
      id: "move",
      labelKey: "canvas.move",
      hotkey: "V",
      icon: `<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>`,
    },
    {
      id: "view",
      labelKey: "canvas.pan",
      hotkey: "H",
      icon: `<path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.7-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15"/>`,
    },
  ];

  function handleToolClick(id: ToolType) {
    canvas.setTool(id);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!canvas.isPointerOverStage) return;

    // Don't trigger if typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

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
        canvasHistory.snapshot(layer.id);
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
      case "i": canvas.setTool("eyedropper"); break;
      case "v": canvas.setTool("move"); break;
      case "h": canvas.setTool("view"); break;
      case "x": canvas.swapColors(); break;
      case "d": canvas.resetColors(); break;
      case "[": canvas.adjustBrushSize(-5); break;
      case "]": canvas.adjustBrushSize(5); break;
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="flex shrink-0 flex-wrap items-center gap-1 max-h-28 overflow-auto px-2 py-1 bg-neutral-900 border-b border-neutral-800 [scrollbar-width:thin]">
  <!-- Tool buttons -->
  <div class="flex shrink-0 items-center gap-0.5">
    {#each tools.filter((tool) => tool.id !== 'eyedropper' || canvas.activeLayer?.type === 'raster') as tool}
      <button
        disabled={!editable && tool.id !== "view"}
        aria-label={locale.t(tool.labelKey)}
        onclick={() => handleToolClick(tool.id)}
        class="disabled:opacity-30 relative w-8 h-8 flex items-center justify-center rounded-md transition-colors {canvas.activeTool === tool.id
          ? 'bg-indigo-600 text-white'
          : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}"
        title="{locale.t(tool.labelKey)} ({tool.hotkey})"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {@html tool.icon}
        </svg>
      </button>
    {/each}
  </div>

  <div class="w-px h-5 shrink-0 bg-neutral-700 mx-1"></div>

  {#if editable && ['brush','eraser','rectFill','ellipseFill','lasso'].includes(canvas.activeTool)}<BrushSettings />{/if}

  <div class="w-px h-5 shrink-0 bg-neutral-700 mx-1"></div>

  {#if editable && canvas.activeLayer?.type === 'raster'}<ColorPicker />{/if}
  <button type="button" disabled={!editable} onclick={() => { if (canvas.activeLayerId) canvasHistory.snapshot(canvas.activeLayerId); canvas.fillActiveLayer(); }} class="h-8 w-8 shrink-0 flex items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30" aria-label={locale.t('canvas.fill_layer')} title={locale.t('canvas.fill_layer')}><PaintBucket size={16} /></button>
  <button type="button" disabled={!editable} onclick={() => { if (canvas.activeLayerId) { canvasHistory.snapshot(canvas.activeLayerId); canvas.clearLayer(canvas.activeLayerId); } }} class="h-8 w-8 shrink-0 flex items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-red-300 disabled:opacity-30" aria-label={locale.t('canvas.clear_layer')} title={locale.t('canvas.clear_layer')}><Trash2 size={16} /></button>

  <div class="w-px h-5 shrink-0 bg-neutral-700 mx-1"></div>

  <div class="flex items-center gap-1">
    <button
      onclick={() => canvasHistory.undo()}
      disabled={!canvasHistory.canUndo}
      class="h-8 w-8 shrink-0 flex items-center justify-center rounded transition-colors {canvasHistory.canUndo
        ? 'text-neutral-300 hover:bg-neutral-800 hover:text-indigo-300'
        : 'text-neutral-600 cursor-not-allowed'}"
      aria-label={locale.t('canvas.undo')}
      title={locale.t('canvas.undo') + ' (Ctrl+Z)'}
    >
      <Undo2 size={16} />
    </button>
    <button
      onclick={() => canvasHistory.redo()}
      disabled={!canvasHistory.canRedo}
      class="h-8 w-8 shrink-0 flex items-center justify-center rounded transition-colors {canvasHistory.canRedo
        ? 'text-neutral-300 hover:bg-neutral-800 hover:text-indigo-300'
        : 'text-neutral-600 cursor-not-allowed'}"
      aria-label={locale.t('canvas.redo')}
      title={locale.t('canvas.redo') + ' (Ctrl+Shift+Z / Ctrl+Y)'}
    >
      <Redo2 size={16} />
    </button>
  </div>

</div>
