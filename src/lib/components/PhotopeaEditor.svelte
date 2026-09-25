<script lang="ts">
  import { locale } from "../stores/locale.svelte.js";
  import { generation } from "../stores/generation.svelte.js";
  import { loadGalleryImagePng, saveToGalleryBytes, readImageMetadata } from "../utils/api.js";
  import { openExternalUrl } from "../utils/openExternal.js";
  import type { OutputImage } from "../types/index.js";

  interface Props {
    open: boolean;
    /** Source gallery image. Its gallery_filename must be resolved before opening. */
    image: OutputImage | null;
    onclose: () => void;
    onsaved?: (galleryFilename: string) => void;
    onimport?: (
      bytes: number[],
      target: "base" | "raster" | "mask" | "region",
      suggestedName: string,
    ) => Promise<void> | void;
  }

  let { open, image, onclose, onsaved, onimport }: Props = $props();

  const PHOTOPEA_ORIGIN = "https://www.photopea.com";

  // Hash config: empty document list, and replace File>Save (Ctrl+S) with a
  // script that flattens the document to PNG and posts it back to us as an
  // ArrayBuffer instead of triggering a browser download.
  const photopeaUrl =
    `${PHOTOPEA_ORIGIN}/#` +
    encodeURIComponent(
      JSON.stringify({
        files: [],
        environment: { customIO: { save: 'app.activeDocument.saveToOE("png");' } },
      }),
    );

  let iframeEl = $state<HTMLIFrameElement | null>(null);
  let iframeSrc = $state(photopeaUrl);
  let bootTimeout: ReturnType<typeof setTimeout> | undefined;
  // boot: waiting for Photopea's initial "done"; opening: waiting for the source
  // image to finish opening; ready: user can edit and save.
  let phase = $state<"boot" | "opening" | "ready">("boot");
  let saving = $state(false);
  let pendingAction = $state<"gallery" | "base" | "raster" | "mask" | "region" | null>(null);
  let error = $state("");

  function clearBootTimeout() {
    if (bootTimeout) clearTimeout(bootTimeout);
    bootTimeout = undefined;
  }

  function armBootTimeout() {
    clearBootTimeout();
    bootTimeout = setTimeout(() => {
      if (phase === "boot") error = locale.t("photopea.connection_timeout");
    }, 20_000);
  }

  function retryPhotopea() {
    phase = "boot";
    error = "";
    armBootTimeout();
    iframeSrc = "about:blank";
    setTimeout(() => { iframeSrc = photopeaUrl; }, 50);
  }

  function openPhotopeaExternally() {
    void openExternalUrl(PHOTOPEA_ORIGIN).catch((e) =>
      console.error("Photopea: failed to open external browser:", e),
    );
  }

  async function sendImageToPhotopea() {
    if (!image || !iframeEl?.contentWindow) return;
    try {
      // Always PNG bytes — the backend transcodes JXL sources on the way out.
      const buffer = image.sessionBlob
        ? await image.sessionBlob.arrayBuffer()
        : new Uint8Array(await loadGalleryImagePng(image.gallery_filename!)).buffer;
      iframeEl.contentWindow.postMessage(buffer, PHOTOPEA_ORIGIN);
    } catch (e) {
      error = locale.t("photopea.load_failed");
      console.error("Photopea: failed to load source image:", e);
    }
  }

  function requestSave(target: "gallery" | "base" | "raster" | "mask" | "region" = "gallery") {
    if (phase !== "ready" || saving || pendingAction) return;
    pendingAction = target;
    iframeEl?.contentWindow?.postMessage('app.activeDocument.saveToOE("png");', PHOTOPEA_ORIGIN);
  }

  async function handleSavedBuffer(buffer: ArrayBuffer) {
    if (saving) return; // serialize rapid Ctrl+S presses
    saving = true;
    error = "";
    try {
      const bytes = Array.from(new Uint8Array(buffer));
      const action = pendingAction ?? "gallery";
      pendingAction = null;
      const baseName = (image?.filename ?? "image.png").replace(/\.(jxl|webp|jpe?g)$/i, ".png");
      if (action !== "gallery") {
        if (!onimport) throw new Error("Photopea import handler is unavailable");
        await onimport(bytes, action, `photopea_${baseName}`);
        return;
      }
      // Post-edit PNG bytes carry no metadata, so forward the source's.
      let metadata: Record<string, string> | undefined;
      if (image?.gallery_filename) {
        metadata = (await readImageMetadata(image.gallery_filename)) ?? undefined;
      }
      const saved = await saveToGalleryBytes(
        bytes,
        `edit_${baseName}`,
        `photopea_${Date.now()}`, // unique promptId → unique gallery filename per save
        image?.generation_mode,
        metadata,
        generation.metadataMode,
      );
      onsaved?.(saved);
    } catch (e) {
      pendingAction = null;
      error = locale.t("photopea.save_failed");
      console.error("Photopea: failed to save edited image:", e);
    } finally {
      saving = false;
    }
  }

  // Bridge Photopea's postMessage protocol. The listener is global, so filter
  // strictly by origin AND by this iframe's contentWindow.
  $effect(() => {
    if (!open) return;
    phase = "boot";
    error = "";
    saving = false;
    pendingAction = null;
    iframeSrc = photopeaUrl;
    armBootTimeout();

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== PHOTOPEA_ORIGIN) return;
      if (!iframeEl || e.source !== iframeEl.contentWindow) return;
      if (e.data instanceof ArrayBuffer) {
        void handleSavedBuffer(e.data);
        return;
      }
      if (e.data === "done") {
        if (phase === "boot") {
          clearBootTimeout();
          error = "";
          phase = "opening";
          void sendImageToPhotopea();
        } else if (phase === "opening") {
          phase = "ready";
        }
        // Later "done"s just acknowledge completed save round-trips.
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      clearBootTimeout();
      window.removeEventListener("message", onMessage);
    };
  });
</script>

{#if open}
  <div
    class="fixed inset-0 z-[230] flex flex-col bg-black/90 backdrop-blur-sm p-3"
    role="dialog"
    aria-modal="true"
    aria-label={locale.t("photopea.title")}
  >
    <div class="flex flex-wrap items-center gap-2 pb-2 shrink-0">
      <h2 class="text-sm font-semibold text-neutral-100 shrink-0">
        {locale.t("photopea.title")}
      </h2>
      <p class="text-xs text-neutral-400 truncate min-w-0 flex-1">
        {locale.t("photopea.save_hint")}
      </p>
      {#if saving || pendingAction}
        <span class="text-xs text-indigo-300 shrink-0">{locale.t("common.saving")}</span>
      {:else if error}
        <span class="text-xs text-red-400 shrink-0">{error}</span>
      {/if}
      <button type="button" disabled={phase !== 'ready' || saving || !!pendingAction} class="h-8 rounded-md border border-indigo-500 bg-indigo-600/25 px-3 text-xs font-medium text-indigo-100 hover:bg-indigo-600/40 disabled:opacity-40" onclick={() => requestSave('gallery')}>{locale.t('photopea.save_gallery')}</button>
      {#if onimport}
        <span class="h-5 w-px bg-neutral-700"></span>
        <button type="button" disabled={phase !== 'ready' || saving || !!pendingAction} class="h-8 rounded-md border border-emerald-700 bg-emerald-600/10 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-600/20 disabled:opacity-40" onclick={() => requestSave('base')}>{locale.t('photopea.import_base')}</button>
        <button type="button" disabled={phase !== 'ready' || saving || !!pendingAction} class="h-8 rounded-md border border-neutral-700 px-3 text-xs text-neutral-200 hover:border-indigo-500 hover:bg-neutral-800 disabled:opacity-40" onclick={() => requestSave('raster')}>{locale.t('photopea.import_raster')}</button>
        <button type="button" disabled={phase !== 'ready' || saving || !!pendingAction} class="h-8 rounded-md border border-rose-800 px-3 text-xs text-rose-200 hover:bg-rose-900/30 disabled:opacity-40" onclick={() => requestSave('mask')}>{locale.t('photopea.import_mask')}</button>
        <button type="button" disabled={phase !== 'ready' || saving || !!pendingAction} class="h-8 rounded-md border border-violet-800 px-3 text-xs text-violet-200 hover:bg-violet-900/30 disabled:opacity-40" onclick={() => requestSave('region')}>{locale.t('photopea.import_region')}</button>
      {/if}
      <button type="button" disabled={phase === 'boot'} class="h-8 rounded-md border border-neutral-700 px-3 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40" onclick={sendImageToPhotopea}>{locale.t('photopea.reload_source')}</button>
      <button
        type="button"
        class="text-neutral-400 hover:text-neutral-100 text-xl leading-none shrink-0"
        onclick={onclose}
        aria-label={locale.t("common.cancel")}
      >×</button>
    </div>
    <div class="relative min-h-0 flex-1">
      <iframe
        bind:this={iframeEl}
        src={iframeSrc}
        title={locale.t("photopea.title")}
        class="h-full w-full rounded-lg border border-neutral-700 bg-neutral-900"
      ></iframe>
      {#if error && phase === "boot"}
        <div class="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
          <div class="pointer-events-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border border-amber-700/70 bg-neutral-950/95 px-3 py-2 text-xs shadow-lg">
            <div class="min-w-48 flex-1">
              <p class="font-medium text-amber-200">{error}</p>
              <p class="mt-0.5 text-neutral-300">{locale.t("photopea.proxy_hint")}</p>
            </div>
            <button type="button" class="rounded border border-neutral-600 px-2.5 py-1.5 text-neutral-100 hover:bg-neutral-800" onclick={retryPhotopea}>{locale.t("photopea.retry")}</button>
            <button type="button" class="rounded border border-indigo-600 px-2.5 py-1.5 text-indigo-200 hover:bg-indigo-900/40" onclick={openPhotopeaExternally}>{locale.t("photopea.open_browser")}</button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
