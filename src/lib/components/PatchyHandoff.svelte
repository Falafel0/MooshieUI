<script lang="ts">
  import { locale } from "../stores/locale.svelte.js";
  import { patchy } from "../stores/patchy.svelte.js";
  import { generation } from "../stores/generation.svelte.js";
  import { isTauri } from "../utils/ipc.js";
  import {
    launchPatchy,
    loadGalleryImagePng,
    readImageMetadata,
    readPatchyDocument,
    resolvePatchyPath,
    saveToGalleryBytes,
    writePatchyDocument,
  } from "../utils/api.js";
  import { openExternalUrl } from "../utils/openExternal.js";
  import type { OutputImage } from "../types/index.js";

  const PATCHY_RELEASES_URL = "https://github.com/SethRobinson/Patchy/releases";

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

  // preparing: writing the document for Patchy; ready: the user can launch it and
  // import the result back; missing: no Patchy executable; error: preparation failed.
  type Phase = "preparing" | "ready" | "missing" | "error";

  let phase = $state<Phase>("preparing");
  let documentPath = $state<string | null>(null);
  let executablePath = $state<string | null>(null);
  let busy = $state(false);
  let launching = $state(false);
  let launched = $state(false);
  let error = $state("");

  function resetState() {
    phase = "preparing";
    documentPath = null;
    executablePath = null;
    busy = false;
    launching = false;
    launched = false;
    error = "";
  }

  function documentName(): string {
    const base = (image?.filename ?? "image.png").replace(/\.(jxl|webp|jpe?g|psd|psb)$/i, ".png");
    return base.includes(".") ? base : `${base}.png`;
  }

  /** PNG bytes for the document Patchy opens. */
  async function sourceBytes(): Promise<number[]> {
    if (!image) throw new Error("no source image");
    // Always PNG bytes — the backend transcodes JXL sources on the way out.
    const buffer = image.sessionBlob
      ? await image.sessionBlob.arrayBuffer()
      : new Uint8Array(await loadGalleryImagePng(image.gallery_filename!)).buffer;
    return Array.from(new Uint8Array(buffer));
  }

  async function prepare() {
    if (!image) return;
    resetState();
    if (!isTauri) {
      // The editor is a local application; there is nothing to hand off to from
      // a browser client.
      phase = "missing";
      return;
    }
    busy = true;
    try {
      await patchy.load();
      executablePath = await resolvePatchyPath(patchy.executablePath);
      if (!executablePath) {
        phase = "missing";
        return;
      }
      documentPath = await writePatchyDocument(await sourceBytes(), documentName());
      phase = "ready";
    } catch (e) {
      phase = "error";
      error = locale.t("patchy.load_failed");
      console.error("Patchy: failed to prepare the document:", e);
    } finally {
      busy = false;
    }
  }

  async function launch() {
    if (!documentPath || launching) return;
    launching = true;
    error = "";
    try {
      executablePath = await launchPatchy(documentPath, patchy.executablePath);
      launched = true;
    } catch (e) {
      error = locale.t("patchy.launch_failed");
      console.error("Patchy: failed to launch the editor:", e);
    } finally {
      launching = false;
    }
  }

  async function importResult(target: "gallery" | "base" | "raster" | "mask" | "region") {
    if (!documentPath || busy) return;
    busy = true;
    error = "";
    let bytes: number[];
    try {
      bytes = await readPatchyDocument(documentPath);
    } catch (e) {
      busy = false;
      error = locale.t("patchy.result_missing");
      console.error("Patchy: no saved document to read back:", e);
      return;
    }
    try {
      if (target === "gallery") {
        // Post-edit PNG bytes carry no metadata, so forward the source's.
        let metadata: Record<string, string> | undefined;
        if (image?.gallery_filename) {
          metadata = (await readImageMetadata(image.gallery_filename)) ?? undefined;
        }
        const saved = await saveToGalleryBytes(
          bytes,
          `edit_${documentName()}`,
          `patchy_${Date.now()}`, // unique promptId → unique gallery filename per save
          image?.generation_mode,
          metadata,
          generation.metadataMode,
        );
        onsaved?.(saved);
        return;
      }
      if (!onimport) throw new Error("Patchy import handler is unavailable");
      await onimport(bytes, target, `patchy_${documentName()}`);
    } catch (e) {
      error = target === "gallery" ? locale.t("patchy.save_failed") : locale.t("patchy.import_failed");
      console.error("Patchy: failed to bring the edited document back:", e);
    } finally {
      busy = false;
    }
  }

  async function locateExecutable() {
    if (!isTauri) return;
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: locale.t("patchy.set_path"),
      });
      if (typeof selected !== "string") return;
      await patchy.setExecutablePath(selected);
      await prepare();
    } catch (e) {
      console.error("Patchy: failed to pick the executable:", e);
    }
  }

  function openDownloadPage() {
    void openExternalUrl(PATCHY_RELEASES_URL).catch((e) =>
      console.error("Patchy: failed to open the download page:", e),
    );
  }

  $effect(() => {
    if (!open) {
      resetState();
      return;
    }
    void prepare();
  });
</script>

{#if open}
  <div
    class="fixed inset-0 z-[230] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label={locale.t("patchy.title")}
  >
    <div class="w-full max-w-2xl rounded-xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl">
      <div class="flex items-start gap-2">
        <h2 class="text-sm font-semibold text-neutral-100">{locale.t("patchy.title")}</h2>
        <button
          type="button"
          class="ml-auto text-xl leading-none text-neutral-400 hover:text-neutral-100"
          onclick={onclose}
          aria-label={locale.t("common.cancel")}
        >×</button>
      </div>

      <p class="mt-1 text-xs text-neutral-400">{locale.t("patchy.save_hint")}</p>

      {#if phase === "preparing"}
        <p class="mt-4 text-xs text-neutral-300">{locale.t("common.loading")}</p>
      {:else if phase === "missing"}
        <div class="mt-4 rounded-lg border border-amber-700/70 bg-amber-950/40 px-3 py-2 text-xs">
          <p class="font-medium text-amber-200">{locale.t("patchy.not_found")}</p>
          <p class="mt-0.5 text-neutral-300">{locale.t("patchy.not_found_hint")}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded border border-neutral-600 px-2.5 py-1.5 text-neutral-100 hover:bg-neutral-800"
              onclick={locateExecutable}
            >{locale.t("patchy.set_path")}</button>
            <button
              type="button"
              class="rounded border border-indigo-600 px-2.5 py-1.5 text-indigo-200 hover:bg-indigo-900/40"
              onclick={openDownloadPage}
            >{locale.t("patchy.download")}</button>
          </div>
        </div>
      {:else if phase === "error"}
        <div class="mt-4 rounded-lg border border-red-800/70 bg-red-950/40 px-3 py-2 text-xs">
          <p class="text-red-200">{error || locale.t("patchy.load_failed")}</p>
          <button
            type="button"
            class="mt-2 rounded border border-neutral-600 px-2.5 py-1.5 text-neutral-100 hover:bg-neutral-800"
            onclick={prepare}
          >{locale.t("patchy.reopen")}</button>
        </div>
      {:else}
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={launching}
            class="h-8 rounded-md border border-indigo-500 bg-indigo-600/25 px-3 text-xs font-medium text-indigo-100 hover:bg-indigo-600/40 disabled:opacity-40"
            onclick={launch}
          >{launched ? locale.t("patchy.reopen") : locale.t("patchy.launch")}</button>

          <span class="h-5 w-px bg-neutral-700"></span>

          <button
            type="button"
            disabled={busy}
            class="h-8 rounded-md border border-emerald-700 bg-emerald-600/10 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-600/20 disabled:opacity-40"
            onclick={() => importResult("gallery")}
          >{locale.t("patchy.save_gallery")}</button>

          {#if onimport}
            <span class="h-5 w-px bg-neutral-700"></span>
            <button
              type="button"
              disabled={busy}
              class="h-8 rounded-md border border-emerald-700 bg-emerald-600/10 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-600/20 disabled:opacity-40"
              onclick={() => importResult("base")}
            >{locale.t("patchy.import_base")}</button>
            <button
              type="button"
              disabled={busy}
              class="h-8 rounded-md border border-neutral-700 px-3 text-xs text-neutral-200 hover:border-indigo-500 hover:bg-neutral-800 disabled:opacity-40"
              onclick={() => importResult("raster")}
            >{locale.t("patchy.import_raster")}</button>
            <button
              type="button"
              disabled={busy}
              class="h-8 rounded-md border border-rose-800 px-3 text-xs text-rose-200 hover:bg-rose-900/30 disabled:opacity-40"
              onclick={() => importResult("mask")}
            >{locale.t("patchy.import_mask")}</button>
            <button
              type="button"
              disabled={busy}
              class="h-8 rounded-md border border-violet-800 px-3 text-xs text-violet-200 hover:bg-violet-900/30 disabled:opacity-40"
              onclick={() => importResult("region")}
            >{locale.t("patchy.import_region")}</button>
          {/if}
        </div>

        {#if error}
          <p class="mt-2 text-xs text-red-400">{error}</p>
        {:else if busy}
          <p class="mt-2 text-xs text-indigo-300">{locale.t("common.saving")}</p>
        {:else if documentPath}
          <p class="mt-2 truncate text-[11px] text-neutral-500" title={documentPath}>
            {locale.t("patchy.document_ready", { path: documentPath })}
          </p>
        {/if}
      {/if}
    </div>
  </div>
{/if}
