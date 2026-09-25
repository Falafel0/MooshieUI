<script lang="ts">
  /**
   * Full-screen comparison of an inpaint result (side B) against the base it
   * was generated from (side A), opened from the result bar or the result chip
   * on the inpainting canvas.
   *
   * Reuses ImageCompare and the gallery compare vocabulary (mode buttons, the
   * difference→slider fallback) so this surface behaves exactly like the
   * gallery's CompareViewer. The pair arrives as props instead of being read
   * from the store here: the host resolves it once through
   * getInpaintComparePair() and closes this dialog whenever that pair changes,
   * so a stale original can never be shown against a newer result.
   */
  import ImageCompare from "../ui/ImageCompare.svelte";
  import { locale } from "../../stores/locale.svelte.js";
  import { accessibility } from "../../stores/accessibility.svelte.js";
  import type { CompareMode } from "../../types/index.js";

  interface Props {
    /** Side A: the base the run was submitted from. */
    originalUrl: string;
    /** Side B: the completed inpaint result. */
    resultUrl: string;
    onclose: () => void;
  }

  let { originalUrl, resultUrl, onclose }: Props = $props();

  const MODES: { id: CompareMode; labelKey: string }[] = [
    { id: "slider", labelKey: "gallery.compare.mode_slider" },
    { id: "fade", labelKey: "gallery.compare.mode_fade" },
    { id: "difference", labelKey: "gallery.compare.mode_difference" },
    { id: "side_by_side", labelKey: "gallery.compare.mode_side_by_side" },
  ];

  let mode = $state<CompareMode>("slider");
  // Divider position in slider mode, blend amount in fade mode.
  let position = $state(50);
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let sizes = $state({ aw: 0, ah: 0, bw: 0, bh: 0 });

  const visionSimClass = $derived(
    accessibility.visionSimulatorMode === "none"
      ? ""
      : `sim-${accessibility.visionSimulatorMode}`,
  );

  const dimsKnown = $derived(sizes.aw > 0 && sizes.bw > 0);
  const dimsMatch = $derived(dimsKnown && sizes.aw === sizes.bw && sizes.ah === sizes.bh);
  const showsDivider = $derived(mode === "slider" || mode === "fade");

  // Difference blending only means anything when the pixels line up, and an
  // inpaint result is only pixel-aligned with its original when the backend
  // returns it at the same size — so drop back to the slider as soon as a
  // mismatched pair loads (same rule as the gallery's CompareViewer).
  $effect(() => {
    if (mode === "difference" && dimsKnown && !dimsMatch) mode = "slider";
  });

  // Escape closes. Wired only while this dialog is mounted, so no listener
  // lingers on the document after it is dismissed.
  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onclose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
  }
</script>

<div
  class="lightbox-backdrop fixed inset-0 z-70 flex flex-col bg-black/95 {visionSimClass}"
  role="dialog"
  aria-modal="true"
  aria-label={locale.t("canvas.compare_with_original")}
  tabindex="-1"
  use:focusOnMount
>
  <!-- Toolbar -->
  <div
    class="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-900/70 px-3 py-2"
  >
    <span class="mr-1 text-sm font-medium text-neutral-200">{locale.t("canvas.compare_with_original")}</span>
    <div class="flex flex-wrap gap-1">
      {#each MODES as candidate (candidate.id)}
        <button
          type="button"
          aria-pressed={mode === candidate.id}
          class="px-2.5 py-1 text-xs rounded border transition-colors focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed {mode ===
          candidate.id
            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
            : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'}"
          disabled={candidate.id === "difference" && dimsKnown && !dimsMatch}
          title={candidate.id === "difference" && dimsKnown && !dimsMatch
            ? locale.t("gallery.compare.difference_needs_same_size")
            : locale.t(candidate.labelKey)}
          onclick={() => (mode = candidate.id)}
        >
          {locale.t(candidate.labelKey)}
        </button>
      {/each}
    </div>

    <div class="flex-1"></div>

    {#if dimsKnown && !dimsMatch}
      <span
        class="px-2 py-0.5 rounded bg-amber-900/50 border border-amber-700/60 text-[11px] text-amber-200"
        title={locale.t("gallery.compare.difference_needs_same_size")}
      >
        {locale.t("gallery.compare.dimensions_differ")}
      </span>
    {/if}

    <button
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800/80 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-indigo-400"
      title={locale.t("gallery.compare.reset_view")}
      onclick={resetView}
    >
      ⟲
    </button>
    <button
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800/80 text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-indigo-400"
      aria-label={locale.t("gallery.compare.close")}
      title={locale.t("gallery.compare.close")}
      onclick={onclose}
    >
      ✕
    </button>
  </div>

  <!-- Viewer -->
  <div class="relative min-h-0 flex-1 p-3">
    <ImageCompare
      urlA={originalUrl}
      urlB={resultUrl}
      labelA={`${locale.t("gallery.compare.side_a")} · ${locale.t("canvas.content_original")}`}
      labelB={`${locale.t("gallery.compare.side_b")} · ${locale.t("canvas.result_layer")}`}
      ariaLabel={locale.t("gallery.compare.divider")}
      mode={mode}
      bind:position
      bind:zoom
      bind:panX
      bind:panY
      onsizes={(next) => (sizes = next)}
    />
    <!-- This dialog has no arrow-key side navigation, so it carries its own
         pointer hint instead of the gallery viewer's. -->
    <p
      class="pointer-events-none absolute bottom-4 left-4 rounded bg-black/60 px-2 py-1 text-[10px] text-neutral-300"
    >
      {locale.t("canvas.compare_original_hint")}
    </p>
  </div>

  <!-- Controls -->
  <div class="space-y-2 border-t border-neutral-800 bg-neutral-900/70 px-3 py-2">
    {#if showsDivider}
      <div class="flex items-center gap-3">
        <span class="w-16 shrink-0 text-xs text-neutral-400">
          {mode === "fade"
            ? locale.t("gallery.compare.blend")
            : locale.t("gallery.compare.position")}
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.5"
          bind:value={position}
          class="flex-1 accent-indigo-500"
          aria-label={locale.t("gallery.compare.divider")}
        />
        <span class="w-10 text-right text-xs text-neutral-500 tabular-nums"
          >{Math.round(position)}%</span
        >
      </div>
    {/if}

    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate text-xs text-neutral-300"
          >{locale.t("gallery.compare.side_a")} · {locale.t("canvas.content_original")}</span
        >
        {#if sizes.aw > 0}
          <span class="shrink-0 text-[11px] text-neutral-500 tabular-nums"
            >{sizes.aw}×{sizes.ah}</span
          >
        {/if}
      </div>
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate text-xs text-neutral-300"
          >{locale.t("gallery.compare.side_b")} · {locale.t("canvas.result_layer")}</span
        >
        {#if sizes.bw > 0}
          <span class="shrink-0 text-[11px] text-neutral-500 tabular-nums"
            >{sizes.bw}×{sizes.bh}</span
          >
        {/if}
      </div>
    </div>
  </div>
</div>
