<script lang="ts">
  import { onMount } from "svelte";
  import ShelfMore from './ShelfMore.svelte';
  import BottomPanelCardLayout from "./BottomPanelCardLayout.svelte";
  import BottomPanelIcon from "./BottomPanelIcon.svelte";
  import BottomPanelEmpty from "./BottomPanelEmpty.svelte";
  import BottomPanelToolbar from "./BottomPanelToolbar.svelte";
  import { generation } from "../../stores/generation.svelte.js";
  import { gallery, isVideoImage } from "../../stores/gallery.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { scrollCapture } from "../../utils/scrollCapture.js";
  import { lazyThumbnail } from "../../utils/lazyThumbnail.js";
  import { formatGenerationTime } from "../../utils/localeFormat.js";
  import type { OutputImage } from "../../types/index.js";
  import { H3_MAX_REF_IMAGES } from "../../utils/videoParams.js";
  import { sendImageToVideoFrame, addImageToVideoReference, videoReferenceSlotsFree } from "../../utils/galleryActions.js";
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  interface Props {
    source?: "session" | "references";
    onupscale: (image: OutputImage) => void;
    oninpaint: (image: OutputImage) => void;
    onrefine: (image: OutputImage) => void;
    oncontextmenu?: (image: OutputImage, x: number, y: number) => void;
  }

  let { onupscale, oninpaint, onrefine, oncontextmenu, source = "session" }: Props = $props();


  const isVideoMode = $derived(source === "session" && generation.mode === "video");
  const sessionOutputs = $derived.by(() => {
    if (source === "references") return [...new Map([...gallery.sessionImages, ...gallery.images].filter((image) => !isVideoImage(image)).map((image) => [image.gallery_filename ?? `${image.type}/${image.subfolder}/${image.filename}/${image.prompt_id}`, image])).values()];
    return isVideoMode ? gallery.sessionImages.filter(isVideoImage) : gallery.sessionImages;
  });
  onMount(() => { if (source === "references") void gallery.loadFromDisk(); });
  const searchText = $derived(source === "references" ? bottomPanel.referencesSearch : bottomPanel.imageSearch);
  let visibleCount = $state(64);
  $effect(() => { void searchText; void source; visibleCount = 64; });
  function setSearch(value: string) { if (source === "references") bottomPanel.referencesSearch = value; else bottomPanel.imageSearch = value; }
  function clearSearch() { setSearch(""); }
  const filteredSessionImages = $derived.by(() => {
    const q = searchText.toLowerCase().trim();
    return sessionOutputs.filter((image) => !q || image.filename.toLowerCase().includes(q));
  });
  const imageId = (image: OutputImage) => `${image.type}/${image.subfolder}/${image.filename}/${image.prompt_id}`;
  let selectedId = $state<string | null>(null);
  let cardViewportHeight = $state(0);
  const displayCardSize = $derived(bottomPanel.cardLayout === "strip" && cardViewportHeight > 0
    ? Math.min(bottomPanel.imageCardSize, Math.max(24, cardViewportHeight - 16))
    : bottomPanel.imageCardSize);
  const selectedImage = $derived(filteredSessionImages.find((image) => imageId(image) === selectedId) ?? null);
  async function deleteSelectedImage(image: OutputImage) {
    const index = filteredSessionImages.indexOf(image);
    await gallery.deleteImage(image);
    if (filteredSessionImages.includes(image)) return;
    const next = filteredSessionImages[Math.min(index, filteredSessionImages.length - 1)];
    selectedId = next ? imageId(next) : null;
  }
  async function makeVideoFromImage(image: OutputImage) {
    try {
      await sendImageToVideoFrame(image);
      gallery.showToast(locale.t("gallery.toast.loaded_video_frame"), "success");
    } catch (e) {
      console.error("Failed to load image as a video frame:", e);
      gallery.showToast(locale.t("gallery.toast.failed_load"), "error");
    }
  }

  async function addImageAsVideoReference(image: OutputImage) {
    if (videoReferenceSlotsFree() === 0) {
      gallery.showToast(
        locale.t("gallery.toast.video_refs_full", { count: H3_MAX_REF_IMAGES }),
        "error",
      );
      return;
    }
    try {
      const slot = await addImageToVideoReference(image);
      gallery.showToast(
        locale.t("gallery.toast.loaded_video_reference", { index: slot }),
        "success",
      );
    } catch (e) {
      console.error("Failed to add image as a video reference:", e);
      gallery.showToast(locale.t("gallery.toast.failed_load"), "error");
    }
  }

  function confirmDeleteAllSessionImages() {
    const count = sessionOutputs.length;
    if (count === 0) return;
    const confirmKey = isVideoMode
      ? 'bottom_panel.delete_all_videos_confirm'
      : 'bottom_panel.delete_all_confirm';
    if (!confirm(locale.t(confirmKey, { count: String(count) }))) return;
    selectedId = null;
    // In video mode the sweep is scoped to videos so any images generated
    // earlier in the same session survive.
    void gallery.deleteAllSessionImages(isVideoMode ? isVideoImage : undefined);
  }

</script>
<div class="flex h-full min-h-0 flex-col">
{#if selectedImage}
  {@const image = selectedImage}
  {@const isVideo = isVideoImage(image)}
<div class="flex min-h-[calc(var(--ui-control-height)+12px)] shrink-0 flex-wrap items-center gap-2 border-t border-ui-border/60 bg-ui-surface/80 px-3 py-1.5" role="group" aria-label={selectedImage.filename}>
    <button type="button" class="ui-icon-button flex shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-ui-hover hover:text-neutral-100" aria-label={locale.t('bottom_panel.back_to_images')} title={locale.t('bottom_panel.back_to_images')} onclick={() => selectedId = null}><BottomPanelIcon name="left" /></button>
    <span class="min-w-0 flex-1 truncate text-xs font-medium text-neutral-200" title={image.filename}>{image.filename}</span>
    <button class="ui-control px-3 rounded-md border border-ui-accent/30 bg-ui-selected text-xs font-medium text-ui-accent hover:border-ui-accent/60" onclick={() => gallery.openLightbox(image)}>{locale.t(isVideo ? "gallery.play_video" : "bottom_panel.open")}</button>
    <div class="flex items-center gap-1">
      {#if isVideo}
        <!-- no still-image actions -->
      {:else if !image.is_upscaled}
        <button
          class="ui-icon-button gap-2 px-2 shrink-0 flex items-center justify-center rounded-md hover:bg-neutral-700/80 text-neutral-300 hover:text-white transition-colors"
          aria-label={locale.t('bottom_panel.upscale')} title={locale.t('bottom_panel.upscale')}
          onclick={() => onupscale(image)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          <span class="hidden text-xs xl:inline">{locale.t('bottom_panel.upscale')}</span>
        </button>
        <button
          class="ui-icon-button shrink-0 flex items-center justify-center rounded-md hover:bg-neutral-700/80 text-neutral-300 hover:text-white transition-colors"
          aria-label={locale.t('gallery.send_to_img2img')} title={locale.t('gallery.send_to_img2img')}
          onclick={() => onrefine(image)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
      {:else}
        <button
          class="ui-icon-button gap-2 px-2 shrink-0 flex items-center justify-center rounded-md text-neutral-300 opacity-50 pointer-events-none"
          aria-label={locale.t('bottom_panel.upscale')} title={locale.t('bottom_panel.upscale')}
          disabled
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          <span class="hidden text-xs xl:inline">{locale.t('bottom_panel.upscale')}</span>
        </button>
        <button
          class="ui-icon-button shrink-0 flex items-center justify-center rounded-md text-neutral-300 opacity-50 pointer-events-none"
          aria-label={locale.t('gallery.send_to_img2img')} title={locale.t('gallery.send_to_img2img')}
          disabled
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
      {/if}
      {#if !isVideo}
        <button
          class="ui-icon-button gap-2 px-2 shrink-0 flex items-center justify-center rounded-md hover:bg-neutral-700/80 text-neutral-300 hover:text-white transition-colors"
          aria-label={locale.t('bottom_panel.inpaint')} title={locale.t('bottom_panel.inpaint')}
          onclick={() => oninpaint(image)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
          <span class="hidden text-xs xl:inline">{locale.t('bottom_panel.inpaint')}</span>
        </button>
        <button
          class="ui-icon-button shrink-0 flex items-center justify-center rounded-md hover:bg-neutral-700/80 text-neutral-300 hover:text-white transition-colors"
          aria-label={locale.t('gallery.make_video')} title={locale.t('gallery.make_video')}
          onclick={() => makeVideoFromImage(image)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
        </button>
        <button
          class="ui-icon-button shrink-0 flex items-center justify-center rounded-md hover:bg-neutral-700/80 text-neutral-300 hover:text-white transition-colors"
          aria-label={locale.t('gallery.add_video_reference')} title={locale.t('gallery.add_video_reference')}
          onclick={() => addImageAsVideoReference(image)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        </button>
        <div class="w-px h-4 bg-neutral-700/60"></div>
      {/if}
      <button
        class="ui-icon-button shrink-0 flex items-center justify-center rounded-md hover:bg-neutral-700/80 text-neutral-300 hover:text-white transition-colors disabled:opacity-50 disabled:pointer-events-none"
        aria-label={locale.t(isVideo ? 'gallery.save_video_as' : 'bottom_panel.save_as')} title={locale.t(isVideo ? 'gallery.save_video_as' : 'bottom_panel.save_as')}
        disabled={gallery.saving}
        onclick={() => gallery.saveImageAs(image)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      {#if !isVideo}
        <button
          class="ui-icon-button shrink-0 flex items-center justify-center rounded-md hover:bg-neutral-700/80 text-neutral-300 hover:text-white transition-colors"
          aria-label={locale.t('bottom_panel.copy')} title={locale.t('bottom_panel.copy')}
          onclick={() => gallery.copyToClipboard(image)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      {/if}
      <div class="w-px h-4 bg-neutral-700/60"></div>
      <button
        class="ui-icon-button shrink-0 flex items-center justify-center rounded-md hover:bg-red-600/80 text-neutral-400 hover:text-red-200 transition-colors"
        aria-label={locale.t('bottom_panel.delete')} title={locale.t('bottom_panel.delete')}
        onclick={() => deleteSelectedImage(image)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
</div>
{:else}
  <p class="sr-only">{locale.t("bottom_panel.select_hint")}</p>
{/if}
<div class="flex-1 min-h-0 overflow-auto">
      <!-- Storage expiry warning (browser mode) -->
      {#if gallery.hasExpiry}
        <div class="mx-2 mt-1.5 mb-1 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-300 text-[11px] flex items-center gap-2 shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>
            {locale.t('gallery.expiry_warning')}
            {#if gallery.expiringWithin24h > 0}
              <strong class="text-amber-200">{locale.t('gallery.expiry_soon', { count: String(gallery.expiringWithin24h) })}</strong>
            {/if}
            {#if gallery.storageInfo}
              <span class="text-amber-400/70 ml-1">({gallery.storageLabel})</span>
            {/if}
          </span>
        </div>
      {/if}
      <!-- Session History -->
      {#if source === "references" && gallery.loading && sessionOutputs.length === 0}
        <BottomPanelEmpty icon="references" messageKey="common.loading" />
      {:else if sessionOutputs.length === 0}
        <BottomPanelEmpty icon={source === "references" ? "references" : "images"} messageKey={source === "references" ? "bottom_panel.no_references" : isVideoMode ? 'bottom_panel.no_videos' : 'bottom_panel.no_images'} />
      {:else}
        <div class="flex h-full min-h-0 flex-col">
          {#if !selectedImage}
          <BottomPanelToolbar>
            <div class="relative min-w-40 flex-1">
              <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-500"><BottomPanelIcon name="search" /></span>
              <input
              type="text"
              value={searchText} oninput={(event) => setSearch(event.currentTarget.value)}
              aria-label={locale.t(source === "references" ? "bottom_panel.reference_search" : isVideoMode ? "bottom_panel.video_search_placeholder" : "bottom_panel.image_search_placeholder")} placeholder={locale.t(source === "references" ? "bottom_panel.reference_search" : isVideoMode ? "bottom_panel.video_search_placeholder" : "bottom_panel.image_search_placeholder")}
              class="w-full ui-control pl-9 pr-12 min-w-0 bg-ui-surface border border-ui-border rounded-md text-xs text-neutral-100 placeholder-neutral-500 focus:border-ui-accent transition-colors"
            />
              {#if searchText}
                <button type="button" class="ui-icon-button absolute inset-y-0 right-1 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-100" aria-label={locale.t("bottom_panel.clear_search")} onclick={(event) => { clearSearch(); event.currentTarget.parentElement?.querySelector("input")?.focus(); }}><BottomPanelIcon name="close" class="size-3.5" /></button>
              {/if}
            </div>
            <div use:scrollCapture class="flex shrink-0 items-center gap-2 text-neutral-500" title={locale.t("bottom_panel.card_size")}><BottomPanelIcon name="grid" class="size-3.5" />
              <input
                type="range"
                min="48"
                max="160"
                value={bottomPanel.imageCardSize} oninput={(e) => bottomPanel.setCardSize("image", e.currentTarget.valueAsNumber)}
                class="w-20 h-4 accent-ui-accent cursor-pointer"
                aria-label={locale.t('bottom_panel.card_size')} title={locale.t('bottom_panel.card_size')}
              />
            </div>
            <BottomPanelCardLayout />
            {#if source === "session"}
            <button
              type="button"
              class="shrink-0 ui-icon-button flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:border-red-500 hover:text-red-300 hover:bg-red-600/10 transition-colors"
              title={locale.t('bottom_panel.delete_all')}
              aria-label={locale.t('bottom_panel.delete_all')}
              onclick={confirmDeleteAllSessionImages}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
            {/if}
<span class="shrink-0 text-xs text-neutral-500 tabular-nums" aria-label={locale.t("bottom_panel.matches", { shown: String(filteredSessionImages.length), total: String(sessionOutputs.length) })}>{locale.formatInteger(filteredSessionImages.length)}<span class="px-1 text-neutral-600">/</span>{locale.formatInteger(sessionOutputs.length)}</span>
          </BottomPanelToolbar>
          {/if}
          {#if filteredSessionImages.length === 0}
            <BottomPanelEmpty icon="images" messageKey={isVideoMode ? 'bottom_panel.no_video_results' : 'bottom_panel.no_image_results'} onreset={() => { clearSearch(); }} />
          {:else}
            <div bind:clientHeight={cardViewportHeight} class="flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable] px-2 py-2">
              <div class="grid gap-2" style={bottomPanel.cardLayout === "strip" ? `grid-auto-flow: column; grid-auto-columns: ${displayCardSize}px; align-content: start;` : `grid-template-columns: repeat(auto-fill, minmax(min(${bottomPanel.imageCardSize}px, 100%), 1fr)); align-content: start;`}>
              {#each filteredSessionImages.slice(0, visibleCount) as image (imageId(image))}
                <div
                  class="relative w-full rounded-lg overflow-hidden border bg-ui-surface transition-colors {selectedImage !== null && imageId(selectedImage) === imageId(image) ? 'border-ui-accent ring-2 ring-ui-accent/25' : 'border-ui-border/60 hover:border-neutral-500'}"
                  style="aspect-ratio: 1 / 1;"
                >
                  <button
                    class="absolute inset-0 w-full h-full"
                    title={isVideoImage(image) ? locale.t("gallery.play_video") : image.filename}
                    oncontextmenu={(e) => { if (oncontextmenu) { e.preventDefault(); oncontextmenu(image, e.clientX, e.clientY); } }}
                    aria-pressed={selectedImage !== null && imageId(selectedImage) === imageId(image)}
                    onclick={() => { selectedId = imageId(image); }}
                    ondblclick={() => gallery.openLightbox(image)}
                    onkeydown={(e) => { if (e.key === "Enter" && selectedImage !== null && imageId(selectedImage) === imageId(image)) { e.preventDefault(); gallery.openLightbox(image); } }}
                  >
                    <img
                      use:lazyThumbnail={{ image }}
                      alt={image.filename}
                      class="w-full h-full object-contain"
                    />
                  </button>
                  <span class="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-neutral-950/80 px-1.5 py-1 text-[10px] text-neutral-300">{image.filename}</span>
                  {#if selectedImage !== null && imageId(selectedImage) === imageId(image)}<span class="pointer-events-none absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-ui-accent text-ui-accent-foreground text-[10px]">✓</span>{/if}
                  {#if isVideoImage(image)}
                    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div class="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center">
                        <svg class="w-4 h-4 text-white translate-x-px" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                  {/if}
                  {#if (selectedImage !== null && imageId(selectedImage) === imageId(image) || gallery.showGenerationTime) && image.generationTimeMs != null}
                    <div
                      class="absolute top-1.5 left-1.5 flex items-center gap-1 bg-black/65 text-white text-[10px] font-medium px-1.5 py-0.5 rounded backdrop-blur-sm pointer-events-none"
                      title={locale.t("generation.gen_time_label")}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="size-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>
                      </svg>
                      {formatGenerationTime(image.generationTimeMs, locale.current)}
                    </div>
                  {/if}
                </div>
              {/each}
              <ShelfMore shown={Math.min(visibleCount, filteredSessionImages.length)} total={filteredSessionImages.length} onmore={() => visibleCount += 64} />
              </div>
            </div>
          {/if}
        </div>
      {/if}

</div>


</div>
