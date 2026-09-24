<script lang="ts">
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { generation } from "../../../stores/generation.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import { gallery } from "../../../stores/gallery.svelte.js";
  import { uploadImageBytes } from "../../../utils/api.js";
  import { prepareOutputImageForEditMode } from "../../../utils/editImagePreparation.js";
  import type { OutputImage } from "../../../types/index.js";

  const editSessionImages = $derived(
    gallery.sessionImages.filter(
      (image) => image.generation_mode === "img2img" || image.generation_mode === "inpainting",
    ),
  );

  let selectingFilename = $state<string | null>(null);

  const imageKey = (image: OutputImage) => `${image.prompt_id}:${image.filename}`;

  async function previewEditResult(image: OutputImage) {
    if (generation.mode !== "inpainting") {
      if (image.url) canvas.stageImage(image.url);
      return;
    }
    if (canvas.pendingResultSourceKey === imageKey(image) && canvas.canApplyInpaintResult) return;
    let unusedPreview: string | null = null;
    let capturedSnapshot: ReturnType<typeof canvas.captureInpaintSubmission> | null = null;
    try {
      selectingFilename = image.filename;
      const prepared = await prepareOutputImageForEditMode(image, "inpainting");
      const normalized = prepared.normalized;
      if (!normalized) return;
      unusedPreview = normalized.previewUrl;

      const response = await uploadImageBytes(prepared.uploadBytes, prepared.uploadFilename);
      const remembered = canvas.getCompletedInpaintResult(imageKey(image));
      capturedSnapshot = remembered ? null : canvas.captureInpaintSubmission();
      canvas.setPendingInpaintResult({
        previewUrl: normalized.previewUrl,
        width: normalized.width,
        height: normalized.height,
        uploadedInputName: response.name,
        owned: true,
        maskUrl: remembered?.maskUrl ?? capturedSnapshot?.maskUrl ?? null,
        sourceKey: imageKey(image),
        rasterLayerIds: remembered?.rasterLayerIds ?? capturedSnapshot?.rasterLayerIds ?? [],
      });
      unusedPreview = null;
    } catch (e) {
      console.error("Failed to preview edit result:", e);
    } finally {
      if (capturedSnapshot) canvas.finishInpaintResult(capturedSnapshot);
      if (unusedPreview) URL.revokeObjectURL(unusedPreview);
      selectingFilename = null;
    }
  }
</script>

<div class="border-t border-neutral-800 bg-neutral-900/70 px-3 py-2">
  {#if generation.mode === "inpainting"}
    <div class="mb-2 flex min-h-10 items-center gap-2">
      {#if canvas.resettableInpaintPreviewImage}
        <div class="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/40 p-1 pr-2">
          <img
            src={canvas.resettableInpaintPreviewImage}
            alt={locale.t("canvas.tab_base")}
            class="h-9 w-9 rounded border border-neutral-700 object-cover"
          />
          <span class="text-[11px] text-neutral-400">{locale.t('canvas.tab_base')}</span>
        </div>
      {/if}
      {#if canvas.pendingResultPreviewUrl}
        <div class="flex items-center gap-2 rounded-md border border-indigo-500/60 bg-indigo-500/10 p-1 pr-2">
          <img
            src={canvas.pendingResultPreviewUrl}
            alt={locale.t("canvas.inpaint_result_ready")}
            class="h-9 w-9 rounded border border-indigo-500/60 object-cover"
          />
          <span class="text-[11px] text-indigo-200">{locale.t('canvas.inpaint_result_ready')}</span>
        </div>
      {/if}
      <div class="ml-auto flex items-center gap-1">
        {#if canvas.canApplyInpaintResult}
          <button
            onclick={() => canvas.applyInpaintResult()}
            class="rounded border border-emerald-600 bg-emerald-600/20 px-2 py-1 text-[11px] text-emerald-200 hover:border-emerald-400 hover:bg-emerald-600/30 hover:text-emerald-100"
            title={locale.t('canvas.apply_inpaint_title')}
          >
            {locale.t('canvas.accept')}
          </button>
        {/if}
        {#if canvas.canUndoInpaintBase}
          <button
            onclick={() => canvas.undoInpaintBase()}
            class="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-indigo-500 hover:text-indigo-300"
            title={locale.t('canvas.undo_inpaint')}
          >
            {locale.t('canvas.undo_inpaint')}
          </button>
        {/if}
        {#if canvas.currentPreparedInputImage}
          <button
            onclick={() => canvas.dismissPreparedInput()}
            class="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-red-500 hover:text-red-300"
            title={locale.t('generation.image.remove_staged')}
          >
            {locale.t('canvas.restore_original')}
          </button>
        {/if}
      </div>
    </div>
  {:else}
    <div class="mb-2 flex items-center gap-2">
      {#if canvas.currentStagingImage}
      <img
        src={canvas.currentStagingImage}
        alt={locale.t("canvas.staged_alt")}
        class="w-10 h-10 rounded border border-neutral-700 object-cover"
      />
      <span class="text-[11px] text-neutral-400">{locale.t('canvas.staging_count', { current: String(canvas.stagingIndex + 1), total: String(canvas.stagingImages.length) })}</span>
      <div class="ml-auto flex items-center gap-1">
        {#if canvas.stagingImages.length > 1}
          <button
            onclick={() => canvas.prevStaging()}
            class="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-indigo-500"
            title={locale.t('canvas.prev_staged')}
          >
            ‹
          </button>
          <button
            onclick={() => canvas.nextStaging()}
            class="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-indigo-500"
            title={locale.t('canvas.next_staged')}
          >
            ›
          </button>
        {/if}
        <button onclick={() => canvas.dismissCurrentStaging()} class="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-red-500" title={locale.t('canvas.dismiss_title')}>{locale.t('canvas.dismiss')}</button>
        <button onclick={() => canvas.clearStaging()} class="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-red-500" title={locale.t('canvas.clear_all_title')}>{locale.t('canvas.clear_all')}</button>
      </div>
    {:else}
      <span class="text-[11px] text-neutral-500">{locale.t('canvas.no_staged')}</span>
    {/if}
    </div>
  {/if}

  <div class="flex gap-2 overflow-x-auto">
    {#if editSessionImages.length === 0}
      <span class="text-[11px] text-neutral-500">{locale.t('bottom_panel.no_images')}</span>
    {:else}
      {#each editSessionImages as image}
        <button
          class="shrink-0 w-14 h-14 rounded border overflow-hidden transition-colors {selectingFilename === image.filename || canvas.pendingResultSourceKey === imageKey(image)
            ? 'border-indigo-400'
            : 'border-neutral-700 hover:border-indigo-500'}"
          onclick={() => void previewEditResult(image)}
          title={image.filename}
        >
          <img src={image.url} alt={image.filename} class="w-full h-full object-cover" />
        </button>
      {/each}
    {/if}
  </div>
</div>
