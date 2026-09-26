<script lang="ts">
  import { untrack } from "svelte";
  import { locale } from "../stores/locale.svelte.js";
  import { generation } from "../stores/generation.svelte.js";
  import { isTauri, ipcListen } from "../utils/ipc.js";
  import {
    getConfig,
    getPatchyStatus,
    installPatchy,
    launchPatchy,
    loadGalleryImagePng,
    readImageMetadata,
    readPatchyDocument,
    resolvePatchyPath,
    type PatchyDocumentRead,
    saveToGalleryBytes,
    updateConfig,
    writePatchyDocument,
  } from "../utils/api.js";
  import { openExternalUrl } from "../utils/openExternal.js";
  import { fingerprint, pngDimensions, resultOriginText } from "../utils/patchyHandoff.js";
  import type { OutputImage } from "../types/index.js";
  import PatchyTransferPanel from "./patchy/PatchyTransferPanel.svelte";

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
      /** The document this dialog handed out. Mask and region targets read the
       * user's selection out of the difference between the two files. */
      sourceBytes?: number[],
      /** `false` means the handler refused and has already told the user why, so
       * the panel must not report the import as applied. */
    ) => Promise<boolean | void> | boolean | void;
  }

  let { open, image, onclose, onsaved, onimport }: Props = $props();

  // preparing: writing the document for Patchy; installing: fetching the editor
  // because it is missing; ready: the user can launch it and import the result
  // back; missing: no Patchy executable; error: preparation failed.
  type Phase = "preparing" | "installing" | "ready" | "missing" | "error";

  /** Where a read-back result can land. "gallery" saves a new gallery image. */
  type ApplyTarget = "gallery" | "base" | "raster" | "mask" | "region";

  /** How far one leg of the round-trip has got. */
  type StepState = "waiting" | "running" | "done" | "failed";

  /** What actually travels: the file on disk plus what can be read from it. */
  interface PayloadInfo {
    name: string;
    sizeBytes: number;
    /** Null when the bytes are not a PNG whose header can be read. */
    width: number | null;
    height: number | null;
  }

  /** Apply button labels per target, reused by the size-change confirmation. */
  const TARGET_LABELS: Record<ApplyTarget, string> = {
    gallery: "patchy.save_gallery",
    base: "patchy.import_base",
    raster: "patchy.import_raster",
    mask: "patchy.import_mask",
    region: "patchy.import_region",
  };

  let phase = $state<Phase>("preparing");
  let documentPath = $state<string | null>(null);
  let executablePath = $state<string | null>(null);
  let busy = $state(false);
  let launching = $state(false);
  let launched = $state(false);
  let error = $state("");
  let installPercent = $state(0);
  let installError = $state("");
  // False where the platform cannot be provisioned automatically (Linux
  // flatpak), so the dialog points at the download page instead of a button
  // that can only fail.
  let canInstall = $state(true);

  // --- transfer visibility --------------------------------------------------
  // Everything below is derived from the hand-off itself: the bytes handed out,
  // the bytes read back, and the phases the Patchy commands already report.
  let exportInfo = $state<PayloadInfo | null>(null);
  // Fingerprint of the document handed to Patchy. The hand-off file exists from
  // the moment it is written, so a read-back must be compared against what went
  // out — otherwise the panel would present our own export as the edited result.
  let exportFingerprint = $state<string | null>(null);
  // The document itself, kept so a selection can be recovered from what the
  // editor changed. Without it a mask import can only guess from luminance.
  let exportBytes = $state<number[] | null>(null);
  let importInfo = $state<PayloadInfo | null>(null);
  /** Which file the read-back came from — a layered save may not be the one we
   *  handed over, and the panel has to say so instead of implying otherwise. */
  let importOrigin = $state("");
  /** True when the last read came from a layered save, flattened for the import. */
  let importLayered = $state(false);
  /** Name of a layered save that is there but could not be read back. */
  let importLayeredFailure = $state<string | null>(null);
  // Object URL for the edited file coming back; revoked whenever it is replaced.
  let importPreviewUrl = $state<string | null>(null);
  let importError = $state("");
  let importStatus = $state<"idle" | "reading" | "ready" | "applying" | "applied">("idle");
  let lastImportTarget = $state<ApplyTarget | "read" | null>(null);
  let appliedTarget = $state<ApplyTarget | null>(null);
  // A read-back whose dimensions differ from the export is held here until the
  // user confirms: applying it resizes the document underneath their layers.
  let pendingImport = $state<{ target: ApplyTarget; bytes: number[] } | null>(null);

  const sourcePreviewUrl = $derived(image?.thumbnailUrl || image?.url || null);

  const exportStepState = $derived<StepState>(
    error ? "failed" : documentPath ? "done" : "running",
  );
  const exportStatusWord = $derived(
    exportStepState === "failed"
      ? locale.t("patchy.transfer_failed")
      : exportStepState === "done"
        ? locale.t("common.saved")
        : locale.t("common.saving"),
  );
  const exportStatusText = $derived(
    error ? error : documentPath ? locale.t("patchy.document_ready", { path: documentPath }) : "",
  );

  const importStepState = $derived<StepState>(
    importError
      ? "failed"
      : importStatus === "reading" || importStatus === "applying"
        ? "running"
        : importStatus === "applied"
          ? "done"
          : "waiting",
  );
  const importStatusWord = $derived(
    importStepState === "failed"
      ? locale.t("patchy.transfer_failed")
      : importStatus === "reading"
        ? locale.t("common.loading")
        : importStatus === "applying"
          ? locale.t("common.saving")
          : importStatus === "ready"
            ? locale.t("patchy.result_ready")
            : importStatus === "applied"
              ? locale.t("common.saved")
              : locale.t("patchy.transfer_pending"),
  );
  const importStatusText = $derived(
    importError
      ? importError
      : importStatus === "applied"
        ? appliedText()
        : importStatus === "ready"
          ? ""
          : importLayeredFailure
            ? locale.t("patchy.result_flatten_failed", { name: importLayeredFailure })
            : locale.t("patchy.result_missing"),
  );
  // Kept standing while the loaded result is a different size, so the warning is
  // visible before the user reaches for an apply button, not only after.
  const importSizeMismatch = $derived(hasSizeMismatch(importInfo, exportInfo));

  function releaseImportPreview() {
    if (importPreviewUrl) URL.revokeObjectURL(importPreviewUrl);
    importPreviewUrl = null;
  }

  function reportNoSavedResult(layeredSource: string | null) {
    importLayeredFailure = layeredSource;
    importLayered = false;
    importInfo = null;
    importOrigin = "";
    releaseImportPreview();
    importStatus = "idle";
    importError = layeredSource
      ? locale.t("patchy.result_flatten_failed", { name: layeredSource })
      : locale.t("patchy.result_missing");
  }

  function resetState() {
    phase = "preparing";
    documentPath = null;
    executablePath = null;
    busy = false;
    launching = false;
    launched = false;
    error = "";
    installPercent = 0;
    installError = "";
    exportInfo = null;
    exportFingerprint = null;
    exportBytes = null;
    importInfo = null;
    importOrigin = "";
    importLayered = false;
    importLayeredFailure = null;
    importError = "";
    importStatus = "idle";
    lastImportTarget = null;
    appliedTarget = null;
    pendingImport = null;
    releaseImportPreview();
  }

  function documentName(): string {
    const base = (image?.filename ?? "image.png").replace(/\.(jxl|webp|jpe?g|psd|psb)$/i, ".png");
    return base.includes(".") ? base : `${base}.png`;
  }

  /** Describe a file in flight: name, size, and pixel size when readable. */
  function describePayload(name: string, bytes: number[]): PayloadInfo {
    const dims = pngDimensions(bytes);
    return {
      name,
      sizeBytes: bytes.length,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    };
  }

  /** True only when both files' pixel sizes are known and they disagree. */
  function hasSizeMismatch(info: PayloadInfo | null, original: PayloadInfo | null): boolean {
    if (!info || !original) return false;
    if (
      info.width == null ||
      info.height == null ||
      original.width == null ||
      original.height == null
    ) {
      return false;
    }
    return info.width !== original.width || info.height !== original.height;
  }

  /** Past-tense line for the leg that just finished. */
  function appliedText(): string {
    switch (appliedTarget) {
      case "base":
        return locale.t("patchy.imported_base");
      case "raster":
        return locale.t("patchy.imported_raster");
      case "mask":
        return locale.t("patchy.imported_mask");
      case "region":
        return locale.t("patchy.imported_region");
      case "gallery":
        return locale.t("patchy.saved");
      default:
        return locale.t("common.done");
    }
  }

  /** Name what an import would change, in the user's terms. */
  function targetName(target: ApplyTarget | "read" | null): string {
    if (target === "gallery" || target === null || target === "read") {
      return image?.filename ?? "—";
    }
    // The canvas targets all edit the document currently open in MooshieUI.
    return locale.t("canvas.use_document_settings");
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

  /**
   * Write the hand-off document and remember exactly what went out, so the
   * export side of the panel can show it and the import side can tell our own
   * bytes apart from a result Patchy actually saved.
   */
  async function exportDocument() {
    const bytes = await sourceBytes();
    documentPath = await writePatchyDocument(bytes, documentName());
    exportInfo = describePayload(documentName(), bytes);
    exportFingerprint = fingerprint(bytes);
    exportBytes = bytes;
    phase = "ready";
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
      const [config, status] = await Promise.all([getConfig(), getPatchyStatus()]);
      canInstall = status.can_install;
      executablePath = await resolvePatchyPath(config.patchy_executable_path);
      // Install on first use, the way ComfyUI is provisioned, so the user is
      // not sent to a download page before they can edit anything.
      if (!executablePath && config.patchy_auto_install !== false) {
        await installEditor();
      }
      if (!executablePath) {
        phase = "missing";
        return;
      }
      await exportDocument();
    } catch (e) {
      phase = "error";
      error = locale.t("patchy.load_failed");
      console.error("Patchy: failed to prepare the document:", e);
    } finally {
      busy = false;
    }
  }

  /** Download the editor into the managed directory, reporting progress. */
  async function installEditor() {
    phase = "installing";
    installPercent = 0;
    installError = "";
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await ipcListen("patchy:install_progress", (event) => {
        const payload = event.payload as {
          phase?: string;
          downloaded?: number;
          total?: number;
        };
        if (payload?.phase === "downloading" && payload.total) {
          installPercent = Math.min(
            100,
            Math.round(((payload.downloaded ?? 0) / payload.total) * 100),
          );
        }
      });
      await installPatchy();
      // Resolving again picks the freshly installed copy up; the config did not
      // change, the filesystem did.
      const config = await getConfig({ force: true });
      executablePath = await resolvePatchyPath(config.patchy_executable_path);
    } catch (e) {
      installError = e instanceof Error ? e.message : String(e);
      console.error("Patchy: automatic installation failed:", e);
    } finally {
      unlisten?.();
    }
  }

  async function launch() {
    if (!documentPath || launching) return;
    launching = true;
    error = "";
    try {
      executablePath = await launchPatchy(documentPath, executablePath);
      launched = true;
    } catch (e) {
      error = locale.t("patchy.launch_failed");
      console.error("Patchy: failed to launch the editor:", e);
    } finally {
      launching = false;
    }
  }

  /**
   * Read the hand-off document and update the import side of the panel.
   * Returns the bytes when Patchy saved a new version, null when the file still
   * holds the bytes this dialog exported.
   */
  async function readImportBytes(): Promise<number[] | null> {
    if (!documentPath) return null;
    // `flattenLayered` resolves the shape a real edit takes: Patchy's flat-save
    // guard routes Save to Save As once a document has layers, so the result can
    // be a `.psd` sitting beside the hand-off file instead of the file itself.
    const read = await readPatchyDocument(documentPath, true);
    if (fingerprint(read.bytes) === exportFingerprint) {
      // Nothing new came back. When a layered save *is* there, the edit exists
      // but could not be read: that is a different situation from "not saved",
      // and the panel says which one it is.
      reportNoSavedResult(read.layered_source);
      return null;
    }
    importLayeredFailure = null;
    importLayered = read.flattened;
    importInfo = describePayload(documentName(), read.bytes);
    importOrigin = resultOriginText(read.flattened, read.layered_source, documentName());
    if (importPreviewUrl) URL.revokeObjectURL(importPreviewUrl);
    // A real object URL for the bytes that were really read back — the only
    // preview that can exist for a file that is not in the gallery yet.
    importPreviewUrl = URL.createObjectURL(
      new Blob([new Uint8Array(read.bytes)], { type: "image/png" }),
    );
    return read.bytes;
  }

  /** Re-check what Patchy has saved, without applying anything. */
  async function refreshImportResult() {
    if (!documentPath || busy) return;
    busy = true;
    importError = "";
    lastImportTarget = "read";
    importStatus = "reading";
    try {
      const bytes = await readImportBytes();
      // A fresh look invalidates a confirmation prompt held for older bytes.
      pendingImport = null;
      if (bytes) importStatus = "ready";
    } catch (e) {
      reportNoSavedResult(null);
      console.error("Patchy: no saved document to read back:", e);
    } finally {
      busy = false;
    }
  }

  /**
   * Bring the edited document back. Reading first is what makes the leg visible
   * and safe: the panel names the file that is about to land, and when it is a
   * different pixel size than the export the apply is held for confirmation —
   * replacing the canvas with a differently sized image reshapes the document
   * underneath the user's layers.
   */
  async function importResult(target: ApplyTarget) {
    if (!documentPath || busy) return;
    busy = true;
    importError = "";
    pendingImport = null;
    lastImportTarget = target;
    importStatus = "reading";
    let read: PatchyDocumentRead;
    try {
      read = await readPatchyDocument(documentPath, true);
    } catch (e) {
      reportNoSavedResult(null);
      busy = false;
      console.error("Patchy: no saved document to read back:", e);
      return;
    }
    if (fingerprint(read.bytes) === exportFingerprint) {
      // Still the file this dialog exported: Patchy has not saved over it. A
      // layered save beside it means the edit exists and could not be read —
      // the card says which of the two it is.
      reportNoSavedResult(read.layered_source);
      busy = false;
      return;
    }
    importLayeredFailure = null;
    importLayered = read.flattened;
    const bytes = read.bytes;
    importOrigin = resultOriginText(read.flattened, read.layered_source, documentName());
    importInfo = describePayload(documentName(), bytes);
    if (importPreviewUrl) URL.revokeObjectURL(importPreviewUrl);
    importPreviewUrl = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    importStatus = "ready";
    if (hasSizeMismatch(importInfo, exportInfo)) {
      pendingImport = { target, bytes };
      busy = false;
      return;
    }
    await applyImportResult(target, bytes);
  }

  /** Apply bytes that were already read back; hand-off semantics unchanged. */
  async function applyImportResult(target: ApplyTarget, bytes: number[]) {
    importStatus = "applying";
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
      } else {
        if (!onimport) throw new Error("Patchy import handler is unavailable");
        const applied = await onimport(bytes, target, `patchy_${documentName()}`, exportBytes ?? undefined);
        if (applied === false) {
          // The handler refused and explained why. Saying "applied" here would
          // contradict the message the user just got.
          pendingImport = null;
          importStatus = "ready";
          return;
        }
      }
      pendingImport = null;
      appliedTarget = target;
      importStatus = "applied";
    } catch (e) {
      importStatus = "ready";
      importError =
        target === "gallery" ? locale.t("patchy.save_failed") : locale.t("patchy.import_failed");
      console.error("Patchy: failed to bring the edited document back:", e);
    } finally {
      busy = false;
    }
  }

  /** Confirm a held import after the size-change warning. */
  async function confirmPendingImport() {
    if (!pendingImport || busy) return;
    const { target, bytes } = pendingImport;
    await applyImportResult(target, bytes);
  }

  /** Retry whatever failed on the import side, as the retry button promises. */
  async function retryImport() {
    if (busy) return;
    if (pendingImport) {
      await confirmPendingImport();
      return;
    }
    if (lastImportTarget && lastImportTarget !== "read") {
      await importResult(lastImportTarget);
      return;
    }
    await refreshImportResult();
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
      // The chosen path lives in the config, which is the only place the
      // backend resolver reads it from.
      const config = await getConfig();
      await updateConfig({ ...config, patchy_executable_path: selected });
      await prepare();
    } catch (e) {
      console.error("Patchy: failed to pick the executable:", e);
    }
  }

  /** Install the editor on request, then continue the hand-off. */
  async function installAndPrepare() {
    busy = true;
    try {
      await installEditor();
      if (!executablePath) {
        phase = "missing";
        return;
      }
      await exportDocument();
    } catch (e) {
      phase = "error";
      error = locale.t("patchy.load_failed");
      console.error("Patchy: failed to prepare the document after installing:", e);
    } finally {
      busy = false;
    }
  }

  function openDownloadPage() {
    void openExternalUrl(PATCHY_RELEASES_URL).catch((e) =>
      console.error("Patchy: failed to open the download page:", e),
    );
  }

  // Re-runs on the dialog and the image only. Everything prepare()/resetState()
  // touches is read untracked: otherwise a read-back result would re-trigger the
  // hand-off, re-export the document, and wipe the result the user just asked for.
  $effect(() => {
    const isOpen = open;
    const source = image;
    if (!isOpen || !source) {
      untrack(() => resetState());
      return;
    }
    untrack(() => {
      void prepare();
    });
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
        <p class="mt-4 text-xs text-neutral-300" role="status">{locale.t("common.loading")}</p>
      {:else if phase === "installing"}
        <div class="mt-4 rounded-lg border border-indigo-700/70 bg-indigo-950/40 px-3 py-2 text-xs">
          <p class="font-medium text-indigo-200">{locale.t("patchy.install_title")}</p>
          <p class="mt-0.5 text-neutral-300">{locale.t("patchy.install_desc")}</p>
          <p class="mt-1 text-neutral-300">
            {locale.t("patchy.install_downloading", { percent: installPercent })}
          </p>
          <div class="mt-2 h-1.5 w-full overflow-hidden rounded bg-neutral-800">
            <div
              class="h-full bg-indigo-500 transition-all duration-200"
              style={`width:${installPercent}%`}
            ></div>
          </div>
        </div>
      {:else if phase === "missing"}
        <div class="mt-4 rounded-lg border border-amber-700/70 bg-amber-950/40 px-3 py-2 text-xs">
          <p class="font-medium text-amber-200">{locale.t("patchy.not_found")}</p>
          <p class="mt-0.5 text-neutral-300">{locale.t("patchy.not_found_hint")}</p>
          {#if installError}
            <p class="mt-1 text-red-300"
              >{locale.t("patchy.install_failed", { error: installError })}</p
            >
          {:else if !canInstall}
            <p class="mt-1 text-neutral-300">{locale.t("patchy.install_unsupported")}</p>
          {/if}
          <div class="mt-2 flex flex-wrap gap-2">
            {#if canInstall}
              <button
                type="button"
                disabled={busy}
                class="rounded border border-emerald-600 px-2.5 py-1.5 text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-40"
                onclick={installAndPrepare}
              >{locale.t("patchy.install_button")}</button>
            {/if}
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
        <!-- Export failed: name the leg, the error, and retry that leg here. -->
        <div
          class="mt-4 rounded-lg border border-red-800/70 bg-red-950/40 px-3 py-2 text-xs"
          role="alert"
        >
          <p class="font-medium text-red-200">
            {locale.t("patchy.export_direction")} · {error || locale.t("patchy.load_failed")}
          </p>
          <button
            type="button"
            class="mt-2 rounded border border-neutral-600 px-2.5 py-1.5 text-neutral-100 hover:bg-neutral-800"
            onclick={prepare}
          >{locale.t("patchy.reopen")}</button>
        </div>
      {:else}
        <!-- The two legs of the round-trip, each showing its own file and state. -->
        <div class="mt-4 grid items-start gap-2 sm:grid-cols-2">
          <PatchyTransferPanel
            step="export"
            state={exportStepState}
            busy={busy || launching}
            name={exportInfo?.name ?? null}
            sizeBytes={exportInfo?.sizeBytes ?? null}
            width={exportInfo?.width ?? null}
            height={exportInfo?.height ?? null}
            previewUrl={sourcePreviewUrl}
            statusWord={exportStatusWord}
            statusText={exportStatusText}
          >
            <div class="mt-0.5">
              <button
                type="button"
                disabled={launching}
                class="h-8 rounded-md border border-indigo-500 bg-indigo-600/25 px-3 text-xs font-medium text-indigo-100 hover:bg-indigo-600/40 disabled:opacity-40"
                onclick={launch}
              >{launched ? locale.t("patchy.reopen") : locale.t("patchy.launch")}</button>
            </div>
          </PatchyTransferPanel>

          <PatchyTransferPanel
            step="import"
            state={importStepState}
            busy={busy}
            name={importInfo?.name ?? null}
            sizeBytes={importInfo?.sizeBytes ?? null}
            width={importInfo?.width ?? null}
            height={importInfo?.height ?? null}
            previewUrl={importPreviewUrl}
            statusWord={importStatusWord}
            statusText={importStatusText}
            statusRole={importStepState === "failed" ? "alert" : undefined}
          >
            {#if importOrigin}
              <p class="mb-1 text-[11px] text-neutral-500">
                {locale.t(
                  importLayered ? "patchy.import_from_layered" : "patchy.import_from",
                  { name: importOrigin },
                )}
              </p>
            {/if}
            <div class="mt-0.5">
              <button
                type="button"
                disabled={busy}
                class="flex h-7 items-center gap-1.5 rounded border border-neutral-700 px-2 text-[11px] text-neutral-200 hover:border-indigo-500 hover:bg-neutral-800 disabled:opacity-40"
                onclick={refreshImportResult}
              >
                <svg
                  class="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                {locale.t("patchy.refresh_result")}
              </button>
            </div>

            <!-- A differently sized result reshapes the document underneath the
                 user's layers, so that consequence is stated before any apply. -->
            {#if !importError && (pendingImport || importSizeMismatch)}
              <div
                class="rounded border border-amber-700/70 bg-amber-950/40 px-2 py-1.5 text-[11px]"
                role="alert"
              >
                <p class="flex flex-wrap items-center gap-1 font-medium text-amber-200">
                  <svg
                    class="h-3 w-3 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path
                      d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                    />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>
                    {locale.t("canvas.document_size")}:
                    {exportInfo && exportInfo.width != null && exportInfo.height != null
                      ? locale.t("compare.summary.dimensions", {
                          width: exportInfo.width,
                          height: exportInfo.height,
                        })
                      : "—"}
                    →
                    {importInfo && importInfo.width != null && importInfo.height != null
                      ? locale.t("compare.summary.dimensions", {
                          width: importInfo.width,
                          height: importInfo.height,
                        })
                      : "—"}
                  </span>
                </p>
                <!-- Naming the consequence matters more than the numbers: this
                     block only appears when the file coming back is a different
                     size, and applying it resizes the document under whatever
                     layers the user already painted. -->
                <p class="mt-0.5 text-neutral-400">{locale.t("patchy.size_changed_warning")}</p>
                {#if pendingImport}
                  <p class="mt-0.5 text-neutral-300">
                    <span class="text-neutral-500">{locale.t("patchy.transfer_target")}:</span>
                    {targetName(pendingImport.target)}
                  </p>
                  <div class="mt-1.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      class="h-7 rounded border border-amber-600 px-2.5 text-amber-100 hover:bg-amber-900/40 disabled:opacity-40"
                      onclick={confirmPendingImport}
                    >{locale.t(TARGET_LABELS[pendingImport.target])}</button>
                    <button
                      type="button"
                      disabled={busy}
                      class="h-7 rounded border border-neutral-600 px-2.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
                      onclick={() => (pendingImport = null)}
                    >{locale.t("common.cancel")}</button>
                  </div>
                {/if}
              </div>
            {/if}

            {#if importError}
              <div class="flex items-center gap-2">
                <!-- Naming the leg on the retry matches the export alert above:
                     a retry that does not say which direction it repeats is the
                     ambiguity this hand-off is meant to remove. -->
                <span class="text-[10px] text-neutral-500"
                  >{locale.t("patchy.import_direction")}</span
                >
                <button
                  type="button"
                  disabled={busy}
                  class="h-7 rounded border border-neutral-600 px-2.5 text-[11px] text-neutral-100 hover:bg-neutral-800 disabled:opacity-40"
                  onclick={retryImport}
                >{locale.t("common.retry")}</button>
              </div>
            {/if}

            <!-- Apply controls, grouped by the target they change on the
                 MooshieUI side, so the consequence is legible up front. -->
            <div class="space-y-1.5 border-t border-neutral-800 pt-2">
              <div>
                <p class="truncate text-[10px] text-neutral-500">
                  {locale.t("patchy.transfer_target")}:
                  <span class="text-neutral-300">{image?.filename ?? "—"}</span>
                </p>
                <button
                  type="button"
                  disabled={busy}
                  class="mt-1 h-8 rounded-md border border-emerald-700 bg-emerald-600/10 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-600/20 disabled:opacity-40"
                  onclick={() => importResult("gallery")}
                >{locale.t("patchy.save_gallery")}</button>
              </div>
              <div>
                <p class="truncate text-[10px] text-neutral-500">
                  {locale.t("patchy.transfer_target")}:
                  <span class="text-neutral-300">{locale.t("canvas.use_document_settings")}</span>
                </p>
                {#if onimport}
                  <div class="mt-1 flex flex-wrap gap-2">
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
                  </div>
                  <!-- The mask and region targets read the selection from what
                       the editor changed, so say what that means before the user
                       spends time painting in the wrong convention. -->
                  <p class="mt-1.5 text-[10px] text-neutral-500">
                    {locale.t("patchy.mask_paint_hint")}
                  </p>
                {/if}
              </div>
            </div>
          </PatchyTransferPanel>
        </div>
      {/if}
    </div>
  </div>
{/if}
