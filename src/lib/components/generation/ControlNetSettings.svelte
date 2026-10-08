<script lang="ts">
  import { prepareControlnetReference } from "../../utils/controlnetReference.js";
  import { captureLayer } from "../../utils/canvasLayerExport.js";
  import { controlnetEditor as generation, controlnetEditorContext, setControlnetSourceData } from "../../stores/controlnetEditor.svelte.js";
  import { canvas } from "../../stores/canvas.svelte.js";
  import { models } from "../../stores/models.svelte.js";
  import { connection } from "../../stores/connection.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import {
    downloadModel,
    uploadImage,
    readClipboardImageSafe,
    checkNodeAvailable,
    installCustomNode,
    stopComfyui,
    startComfyui,
    generateControlnetPreprocessorPreview,
    readTempImage,
  } from "../../utils/api.js";
  import {
    CONTROLNET_PRESETS,
    getPreset,
    getPresetDefaults,
    getPresetModel,
    getPresetPreprocessor,
    modelCategory,
    type ControlNetModelEntry,
  } from "../../config/controlnet-presets.js";
  import { ipcListen, isTauri, authHeaders } from "../../utils/ipc.js";
  import { onMount, untrack } from "svelte";
  import { LatestControlnetRequest, controlnetRequestKey } from "../../utils/controlnetState.js";
  import { createComfyReadyWait } from "../../utils/comfyReadyWait.js";
  import { resolveAvailableModel } from "../../utils/modelAvailability.js";
  import InfoTip from "../ui/InfoTip.svelte";
  import { scrollCapture } from "../../utils/scrollCapture.js";

  let preprocessorAvailable = $state<boolean | null>(null);
  let animaLlliteAvailable = $state<boolean | null>(null);
  let installing = $state<"controlnet_aux" | false>(false);
  let installErrorFor = $state<{ controlnet_aux?: string | null }>({});
  let installStep = $state("");
  let installMessage = $state("");
  let preprocessorPreviewPromptId = $state<string | null>(null);
  let preprocessorPreviewStatus = $state<"idle" | "preparing" | "ready" | "failed">("idle");
  let preprocessorPreviewUrl = $state<string | null>(null);
  let downloading = $state<string | null>(null);
  let downloadError = $state<string | null>(null);
  let dlBytes = $state(0);
  let dlTotal = $state(0);
  let uploadingImage = $state(false);
  const imagePreviewUrl = $derived(generation.controlnetPreviewUrl);
  const imageRequests = new LatestControlnetRequest();
  const previewRequests = new LatestControlnetRequest();
  let previewRequest: ReturnType<LatestControlnetRequest['begin']> | null = null;
  let mounted = false;
  let imageError = $state<string | null>(null);
  const requestKey = () => JSON.stringify([controlnetEditorContext(), controlnetRequestKey(generation)]);
  const previewPreprocessor = $derived(generation.controlnetPreprocessor?.trim() || null);
  const sourceImage = $derived(generation.mode === 'image_edit' ? generation.editReferenceImages[0] ?? null : generation.mode === 'img2img' || generation.mode === 'inpainting' ? generation.inputImage : null);
  let readyWait: Awaited<ReturnType<typeof createComfyReadyWait>> | null = null;
  let controlnetDropZone = $state<HTMLElement | null>(null);
  let controlnetPasteActive = $state(false);
  const ANIMA_PRESET_IDS = ["depth", "anytest_2000", "anytest_1000", "inpainting"];

  $effect(() => {
    const el = controlnetDropZone;
    if (!el) return;
    el.addEventListener("tauri-file-drop", handleTauriFileDrop);
    return () => el.removeEventListener("tauri-file-drop", handleTauriFileDrop);
  });

  $effect(() => {
    const handler = async (event: ClipboardEvent) => {
      if (!controlnetPasteActive && !(generation.mode === "inpainting" && controlnetEditorContext())) return;
      if (controlnetEditorContext() && canvas.activeLayer?.locked) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      await handleImagePaste();
    };
    window.addEventListener("paste", handler, { capture: true });
    return () => window.removeEventListener("paste", handler, { capture: true });
  });

  const dlPercent = $derived(dlTotal > 0 ? Math.round((dlBytes / dlTotal) * 100) : 0);
  const controlnetStrengthMax = $derived(generation.isAnima ? 4 : 2);
  const visibleControlNetPresets = $derived(
    generation.isAnima
      ? CONTROLNET_PRESETS
          .filter((preset) => ANIMA_PRESET_IDS.includes(preset.id))
          .sort((a, b) => ANIMA_PRESET_IDS.indexOf(a.id) - ANIMA_PRESET_IDS.indexOf(b.id))
      : CONTROLNET_PRESETS,
  );

  // Anima routes through AnimaLLLiteApply, whose weights ModelPatchLoader reads
  // from models/model_patches/; every other architecture uses ControlNetLoader.
  const customModeModels = $derived(
    generation.isAnima ? models.modelPatches : models.controlnetModels,
  );

  const presetNeedsPreprocessor = $derived(!!previewPreprocessor);

  function beginControlEdit() { const id = controlnetEditorContext(); if (id) canvas.beginControlnetEdit(id); }
  function endControlEdit() { canvas.endControlnetEdit(); }
  let preprocessorPreviewTimeout: ReturnType<typeof setTimeout> | null = null;

  function clearPreprocessorPreviewTimeout() {
    if (preprocessorPreviewTimeout) {
      clearTimeout(preprocessorPreviewTimeout);
      preprocessorPreviewTimeout = null;
    }
  }

  onMount(() => {
    mounted = true;
    let listeners: (() => void)[] = [];
    const register = (name: string, handler: (event: any) => void) => {
      void ipcListen(name, handler).then((unlisten) => { if (!mounted) unlisten(); else listeners = [...listeners, unlisten]; }).catch((error) => console.warn('ControlNet listener failed', error));
    };
    register('download:progress', (event) => {
      const data = event.payload;
      if (!downloading || data.filename !== downloading) return;
      dlBytes = data.done ? 0 : data.downloaded; dlTotal = data.done ? 0 : data.total;
    });
    register('install:progress', (event) => {
      const data = event.payload;
      if (!installing || data.node_name !== 'comfyui_controlnet_aux') return;
      installStep = data.step; installMessage = data.message;
    });
    register('comfyui:controlnet_preprocessor', handlePreprocessorPreviewEvent);
    return () => {
      mounted = false; endControlEdit();
      for (const unlisten of listeners) unlisten();
      imageRequests.invalidate(); previewRequests.invalidate(); readyWait?.cancel();
      clearPreprocessorPreviewTimeout(); pendingPreprocessorEvents.clear();
      if (preprocessorPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(preprocessorPreviewUrl);
    };
  });
  let probe = 0;
  $effect(() => {
    const connected = connection.connected;
    const preprocessor = previewPreprocessor;
    const version = ++probe;
    preprocessorAvailable = null; animaLlliteAvailable = null;
    if (!connected) return;
    void Promise.all([
      preprocessor ? checkNodeAvailable(preprocessor).catch(() => false) : Promise.resolve(true),
      checkNodeAvailable('AnimaLLLiteApply', ['model_patch']).catch(() => false),
    ]).then(([aux, anima]) => { if (mounted && probe === version) { preprocessorAvailable = aux; animaLlliteAvailable = anima; } });
  });

  function isModelInstalled(entry: ControlNetModelEntry): boolean {
    const installed =
      modelCategory(entry) === "model_patches" ? models.modelPatches : models.controlnetModels;
    return !!resolveAvailableModel(entry.filename, installed);
  }

  function applyPresetState(presetId: string) {
    generation.controlnetPreset = presetId;
    generation.controlnetPreprocessor = getPresetPreprocessor(
      presetId,
      generation.modelFamily,
    );

    const defaults = getPresetDefaults(presetId, generation.modelFamily);
    if (defaults?.strength !== undefined) generation.controlnetStrength = defaults.strength;
    if (defaults?.startPercent !== undefined) generation.controlnetStartPercent = defaults.startPercent;
    if (defaults?.endPercent !== undefined) generation.controlnetEndPercent = defaults.endPercent;

    const model = getPresetModel(presetId, generation.modelFamily);
    generation.controlnetModel = model ? resolveAvailableModel(model.filename, modelCategory(model) === "model_patches" ? models.modelPatches : models.controlnetModels) ?? model.filename : null;
    return model;
  }

  function selectPreset(presetId: string) {
    if (!presetAvailable(presetId)) return;
    applyPresetState(presetId);
    generation.saveSettings();
  }
  async function downloadPresetModel() {
    const model = getPresetModel(generation.controlnetPreset ?? '', generation.modelFamily);
    if (!model || downloading) return;
    downloading = model.filename; downloadError = null; dlBytes = 0; dlTotal = 0;
    try { await downloadModel(model.url, modelCategory(model), model.filename); await models.refresh(); }
    catch (error) { if (mounted) downloadError = locale.t('generation.controlnet.download_failed', { error: String(error) }); }
    finally { downloading = null; }
  }

  function setPreview(file: Blob) {
    clearPreview(); generation.controlnetPreviewUrl = URL.createObjectURL(file);
  }
  function clearPreview() {
    if (generation.controlnetPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(generation.controlnetPreviewUrl);
    generation.controlnetPreviewUrl = null;
  }
  function resetPreparedPreview() {
    previewRequests.invalidate(); previewRequest = null; preprocessorPreviewPromptId = null;
    clearPreprocessorPreviewTimeout(); pendingPreprocessorEvents.clear();
    if (preprocessorPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(preprocessorPreviewUrl);
    preprocessorPreviewUrl = null; preprocessorPreviewStatus = 'idle';
  }
  function removeImage() {
    imageRequests.invalidate(); uploadingImage = false; generation.controlnetImage = null;
    clearPreview(); setControlnetSourceData(null); resetPreparedPreview(); generation.saveSettings();
  }
  async function useSourceImage() {
    if (!sourceImage) return;
    imageRequests.invalidate(); uploadingImage = false; resetPreparedPreview(); clearPreview();
    generation.controlnetImage = sourceImage;
    setControlnetSourceData(null);
    generation.saveSettings();
    // Own a separate object URL: removing the control must never revoke the source preview.
    const sourcePreview = generation.mode === 'image_edit' ? null : generation.inputPreviewUrl;
    if (!sourcePreview) return;
    const request = imageRequests.begin(requestKey());
    try {
      const response = await fetch(sourcePreview);
      const blob = await response.blob();
      if (mounted && imageRequests.current(request, requestKey())) {
        generation.controlnetPreviewUrl = URL.createObjectURL(blob);
        const reader = new FileReader(); reader.onload = () => { if (mounted && imageRequests.current(request, requestKey())) setControlnetSourceData(String(reader.result)); }; reader.readAsDataURL(blob);
      }
    } catch (error) { console.warn('ControlNet source preview failed', error); }
  }
  async function uploadControlImage(file: File) {
    const request = imageRequests.begin(requestKey()); uploadingImage = true; imageError = null;
    try {
      if (!file.type.startsWith('image/')) throw new Error(locale.t('generation.controlnet.image_type'));
      const result = await prepareControlnetReference(file);
      if (!mounted || !imageRequests.current(request, requestKey())) return;
      resetPreparedPreview(); generation.controlnetImage = result.name; setPreview(result.blob);
      if (controlnetEditorContext()) setControlnetSourceData(result.sourceData);
      generation.saveSettings();
    } catch (error) { if (mounted && imageRequests.current(request, requestKey())) imageError = locale.t('generation.controlnet.image_failed', { error: String(error) }); }
    finally { if (mounted && imageRequests.current(request, request.key)) uploadingImage = false; }
  }
  async function useRasterReference(id: string) {
    const request = imageRequests.begin(requestKey());
    const node = canvas.getStageRef()?.getLayers().find((item: { id: () => string }) => item.id() === id);
    if (!node) return;
    try {
      const captured = captureLayer(node, canvas.canvasWidth, canvas.canvasHeight);
      const blob = await new Promise<Blob>((resolve, reject) => captured.toBlob(result => result ? resolve(result) : reject(new Error('Image encode failed')), 'image/png'));
      if (mounted && imageRequests.current(request, requestKey())) await uploadControlImage(new File([blob], 'canvas-reference.png', {type:'image/png'}));
    } catch (error) { if (mounted && imageRequests.current(request, requestKey())) imageError = locale.t('generation.controlnet.image_failed', {error:String(error)}); }
  }

  async function handleImageUpload(event: Event) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (file) await uploadControlImage(file);
  }
  async function handleImagePaste() {
    const request = imageRequests.begin(requestKey());
    try {
      const bytes = await readClipboardImageSafe();
      if (mounted && imageRequests.current(request, requestKey())) await uploadControlImage(new File([new Uint8Array(bytes)], 'pasted_image.png', { type: 'image/png' }));
    } catch (error) { if (mounted && imageRequests.current(request, requestKey())) imageError = locale.t('generation.controlnet.image_failed', { error: String(error) }); }
  }
  async function handleImageDrop(event: DragEvent) {
    event.preventDefault(); const file = event.dataTransfer?.files?.[0]; if (file) await uploadControlImage(file);
  }
  async function handleTauriFileDrop(event: Event) {
    const { path, filename } = (event as CustomEvent).detail;
    const request = imageRequests.begin(requestKey()); uploadingImage = true; imageError = null;
    try {
      const result = await uploadImage(path);
      if (!mounted || !imageRequests.current(request, requestKey())) return;
      resetPreparedPreview(); generation.controlnetImage = result.name; clearPreview(); generation.saveSettings();
      const appliedKey = requestKey();
      if (isTauri) {
        const { readFile } = await import('@tauri-apps/plugin-fs'); const bytes = await readFile(path);
        if (mounted && imageRequests.current(request, appliedKey) && requestKey() === appliedKey) {
          setPreview(new File([bytes], filename, { type: 'image/png' }));
          setControlnetSourceData(`data:image/png;base64,${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}`);
        }
      }
    } catch (error) { if (mounted && imageRequests.current(request, requestKey())) imageError = locale.t('generation.controlnet.image_failed', { error: String(error) }); }
    finally { if (mounted && imageRequests.current(request, request.key)) uploadingImage = false; }
  }

  /** Generic node-package installer that handles clone → restart → verify flow */
  async function installNodePackage(
    packageId: "controlnet_aux",
    repoUrl: string,
    folderName: string,
    verifyNode: string,
    onAvailableChange: (available: boolean) => void,
  ) {
    installing = packageId;
    installErrorFor = { ...installErrorFor, [packageId]: null };
    installStep = "clone";
    installMessage = locale.t('generation.controlnet.install_starting');
    try {
      await installCustomNode(repoUrl, folderName);

      installStep = "restart";
      installMessage = locale.t('generation.controlnet.install_stopping');
      connection.connected = false;
      await stopComfyui();

      installMessage = locale.t('generation.controlnet.install_starting_nodes');
      readyWait = await createComfyReadyWait(120_000);
      if (!mounted) { readyWait.cancel(); readyWait = null; return; }
      const started = await startComfyui();
      if (started === 'already_running' || started === 'skipped') readyWait.cancel();
      installMessage = locale.t('generation.controlnet.install_waiting_ready');
      await readyWait.promise;
      if (!mounted) return;

      installStep = "verify";
      installMessage = locale.t('generation.controlnet.install_verifying');
      try {
        const available = await checkNodeAvailable(verifyNode);
        if (mounted) onAvailableChange(available);
      } catch {
        if (mounted) onAvailableChange(false);
      }

      installing = false;
      installStep = "";
      installMessage = "";
    } catch (e) {
      installErrorFor = { ...installErrorFor, [packageId]: locale.t('generation.controlnet.install_failed', { error: String(e) }) };
      installing = false;
      installStep = "";
      installMessage = "";
    } finally { readyWait?.cancel(); readyWait = null; }
  }

  async function installPreprocessors() {
    await installNodePackage(
      "controlnet_aux",
      "https://github.com/Fannovel16/comfyui_controlnet_aux.git",
      "comfyui_controlnet_aux",
      previewPreprocessor ?? "CannyEdgePreprocessor",
      (available) => { preprocessorAvailable = available; },
    );
  }

  /** Extract raw bytes + blob from a controlnet_preprocessor event payload */
  async function imageBytesFromPreprocessorEvent(data: any): Promise<{ bytes: number[]; blob: Blob } | null> {
    if (data.temp_filename) {
      try {
        if (isTauri) {
          const rawBytes = await readTempImage(data.temp_filename);
          return { bytes: rawBytes, blob: new Blob([new Uint8Array(rawBytes)], { type: "image/png" }) };
        } else {
          const resp = await fetch(
            `/internal-api/_temp_image/${encodeURIComponent(data.temp_filename)}`,
            { headers: authHeaders() },
          );
          if (!resp.ok) return null;
          const ab = await resp.arrayBuffer();
          return {
            bytes: Array.from(new Uint8Array(ab)),
            blob: new Blob([ab], { type: resp.headers.get("content-type") ?? "image/png" }),
          };
        }
      } catch {
        return null;
      }
    } else if (data.image) {
      const binary = atob(data.image);
      const bytes = Array.from(binary, (c) => c.charCodeAt(0));
      return { bytes, blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }) };
    }
    return null;
  }

  /** Buffer for events that arrive before the prompt ID is registered */
  const pendingPreprocessorEvents = new Map<string, any>();

  /** Preview is non-destructive: generation still preprocesses the original reference exactly once. */
  async function applyPreparedPreprocessorImage(data: any) {
    const request = previewRequest;
    if (!request || !previewRequests.current(request, requestKey())) return;
    clearPreprocessorPreviewTimeout();
    try {
      const result = await imageBytesFromPreprocessorEvent(data);
      if (!mounted || !previewRequests.current(request, requestKey())) return;
      if (!result) throw new Error(locale.t('generation.controlnet.no_image_data'));
      if (preprocessorPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(preprocessorPreviewUrl);
      preprocessorPreviewUrl = URL.createObjectURL(result.blob); preprocessorPreviewStatus = 'ready';
    } catch { if (previewRequests.current(request, requestKey())) preprocessorPreviewStatus = 'failed'; }
    finally { if (previewRequests.current(request, requestKey())) preprocessorPreviewPromptId = null; }
  }
  async function handlePreprocessorPreviewEvent(event: any) {
    const data = event.payload, pid = data?.prompt_id;
    if (!pid || !previewRequest || preprocessorPreviewStatus !== 'preparing' || !previewRequests.current(previewRequest, requestKey())) return;
    if (preprocessorPreviewPromptId === pid) { await applyPreparedPreprocessorImage(data); return; }
    if (!preprocessorPreviewPromptId) {
      if (pendingPreprocessorEvents.size >= 32) pendingPreprocessorEvents.delete(pendingPreprocessorEvents.keys().next().value!);
      pendingPreprocessorEvents.set(pid, data);
    }
  }
  async function preparePreprocessorImage() {
    const image = generation.controlnetImage, preprocessor = previewPreprocessor;
    if (!image || !preprocessor || preprocessorPreviewStatus === 'preparing') return;
    resetPreparedPreview(); const request = previewRequests.begin(requestKey()); previewRequest = request;
    preprocessorPreviewStatus = 'preparing';
    preprocessorPreviewTimeout = setTimeout(() => {
      if (previewRequests.current(request, requestKey())) { preprocessorPreviewStatus = 'failed'; preprocessorPreviewPromptId = null; previewRequests.invalidate(); pendingPreprocessorEvents.clear(); }
    }, 120_000);
    try {
      const result = await generateControlnetPreprocessorPreview(image, preprocessor);
      if (!mounted || !previewRequests.current(request, requestKey())) return;
      preprocessorPreviewPromptId = result.prompt_id;
      const buffered = pendingPreprocessorEvents.get(result.prompt_id); pendingPreprocessorEvents.clear();
      if (buffered) await applyPreparedPreprocessorImage(buffered);
    } catch { if (mounted && previewRequests.current(request, requestKey())) { preprocessorPreviewStatus = 'failed'; clearPreprocessorPreviewTimeout(); preprocessorPreviewPromptId = null; } }
  }

  function presetAvailable(presetId: string): boolean {
    const preset = getPreset(presetId);
    if (!preset) return false;
    if (preset.requiresMode === "inpainting" && generation.mode !== "inpainting") return false;
    return getPresetModel(presetId, generation.modelFamily) !== null;
  }

  function presetUnavailableText(presetId: string): string {
    const preset = getPreset(presetId);
    if (preset?.requiresMode === "inpainting" && generation.mode !== "inpainting") {
      return locale.t("generation.controlnet.requires_inpainting");
    }
    return locale.t("generation.controlnet.not_available");
  }

  let presetContext: { mode: string; preset: string | null; family: string; context: string } | null = null;
  $effect(() => {
    const context = controlnetEditorContext();
    const mode = generation.controlnetMode, preset = generation.controlnetPreset, family = generation.modelFamily;
    const previous = presetContext?.context === context ? presetContext : null;
    presetContext = { mode, preset, family, context };
    if (mode !== 'preset' || !preset) return;
    untrack(() => {
      const model = getPresetModel(preset, family);
      const basename = (name: string | null) => name?.replace(/\\/g, '/').split('/').pop();
      const changed = previous && (previous.family !== family || previous.preset !== preset || previous.mode !== mode);
      const mismatched = basename(generation.controlnetModel) !== basename(model?.filename ?? null);
      if (!changed && !mismatched) return;
      generation.controlnetModel = model ? resolveAvailableModel(model.filename, modelCategory(model) === 'model_patches' ? models.modelPatches : models.controlnetModels) ?? model.filename : null;
      generation.controlnetPreprocessor = getPresetPreprocessor(preset, family);
      generation.saveSettings();
    });
  });
  $effect(() => {
    const key = requestKey();
    untrack(() => {
      if (previewRequest && !previewRequests.current(previewRequest, key)) resetPreparedPreview();
      if (uploadingImage) uploadingImage = false;
    });
  });

  $effect(() => {
    canvas.controlContextPreviewUrl = generation.controlnetEnabled
      ? (preprocessorPreviewStatus === 'ready' ? preprocessorPreviewUrl : imagePreviewUrl)
      : null;
    return () => {
      canvas.controlContextPreviewUrl = null;
    };
  });

</script>

<div class="space-y-3">
  <!-- Enable toggle -->
  <div class="flex items-center justify-between">
    <label class="text-xs text-neutral-400"
      >{locale.t('generation.controlnet.title')}<InfoTip
        text={locale.t('generation.controlnet.tip')}
      /></label
    >
    {#if !controlnetEditorContext()}<button
      title={locale.t('generation.controlnet.toggle')}
      class="relative w-10 h-5 rounded-full transition-colors {generation.controlnetEnabled
        ? 'bg-indigo-600'
        : 'bg-neutral-700'}"
      onclick={() => {
        const next = !generation.controlnetEnabled;
        generation.controlnetEnabled = next;
        if (next) generation.styleTransferEnabled = false;
        generation.saveSettings();
      }}
      role="switch"
      aria-label={locale.t("generation.controlnet.toggle")}
      aria-checked={generation.controlnetEnabled}
    >
      <span
        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform {generation.controlnetEnabled
          ? 'translate-x-5'
          : ''}"
      ></span>
    </button>{/if}
  </div>

  {#if generation.controlnetEnabled || controlnetEditorContext()}
    <!--
      Anima LLLite comes from ComfyUI core (ModelPatchLoader + AnimaLLLiteApply),
      so there is nothing to install: an older ComfyUI simply cannot run it.
      Shown in custom mode too, since Anima routes through the same node there.
    -->
    {#if generation.isAnima && animaLlliteAvailable === false}
      <div class="bg-amber-900/30 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-300">
        {locale.t('generation.controlnet.anima_lllite_unsupported')}
      </div>
    {/if}

    <!-- Preprocessor warning / install progress -->
    {#if preprocessorAvailable === false && presetNeedsPreprocessor}
      <div
        class="bg-amber-900/30 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-300"
      >
        {#if installing === "controlnet_aux"}
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <div class="w-3.5 h-3.5 shrink-0 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
              <span class="font-medium">
                {#if installStep === "clone"}
                  {locale.t('generation.controlnet.clone_step')}
                {:else if installStep === "pip"}
                  {locale.t('generation.controlnet.pip_step')}
                {:else if installStep === "restart"}
                  {locale.t('generation.controlnet.restart_step')}
                {:else if installStep === "verify"}
                  {locale.t('generation.controlnet.verify_step')}
                {:else}
                  {locale.t('generation.controlnet.installing_step')}
                {/if}
              </span>
            </div>
            {#if installMessage}
              <div class="bg-neutral-900/60 rounded px-2 py-1.5 font-mono text-[10px] text-neutral-400 max-h-20 overflow-y-auto break-all">
                {installMessage}
              </div>
            {/if}
            <div class="w-full bg-amber-900/50 rounded-full h-1.5 overflow-hidden">
              <div
                class="bg-amber-400 h-full rounded-full transition-[width] duration-500"
                style="width: {installStep === 'clone' ? '25' : installStep === 'pip' ? '55' : installStep === 'restart' ? '80' : installStep === 'verify' ? '95' : '10'}%"
              ></div>
            </div>
          </div>
        {:else}
          <p class="mb-1.5">
            {locale.t('generation.controlnet.preprocessor_install')}
          </p>
          <button
            onclick={installPreprocessors}
            class="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs transition-colors"
          >
            {locale.t('generation.controlnet.install_restart')}
          </button>
        {/if}
        {#if installErrorFor["controlnet_aux"]}
          <p class="text-red-400 mt-1">{installErrorFor["controlnet_aux"]}</p>
        {/if}
      </div>
    {/if}

    <!-- Mode tabs -->
    <div class="flex rounded-lg bg-neutral-800 p-0.5">
      <button
        class="flex-1 text-xs py-1.5 rounded-md transition-colors {generation.controlnetMode ===
        'preset'
          ? 'bg-neutral-700 text-white'
          : 'text-neutral-400 hover:text-neutral-300'}"
        aria-pressed={generation.controlnetMode === "preset"} onclick={() => { generation.controlnetMode = "preset"; generation.saveSettings(); }}
      >
        {locale.t('generation.controlnet.presets')}
      </button>
      <button
        class="flex-1 text-xs py-1.5 rounded-md transition-colors {generation.controlnetMode ===
        'custom'
          ? 'bg-neutral-700 text-white'
          : 'text-neutral-400 hover:text-neutral-300'}"
        aria-pressed={generation.controlnetMode === "custom"} onclick={() => { generation.controlnetMode = "custom"; generation.saveSettings(); }}
      >
        {locale.t('generation.controlnet.custom')}
      </button>
    </div>

    {#if generation.controlnetMode === "preset"}
      <label class="block text-xs text-neutral-400">{locale.t('generation.controlnet.presets')}
        <select value={generation.controlnetPreset ?? ''} onchange={(event) => selectPreset(event.currentTarget.value)} class="ui-control mt-1 w-full rounded-lg border border-ui-border bg-ui-surface px-2 text-sm text-neutral-200">
          <option value="">{locale.t('generation.controlnet.select_preset')}</option>
          {#each visibleControlNetPresets as preset}<option value={preset.id} disabled={!presetAvailable(preset.id)}>{locale.t('generation.controlnet.preset_' + preset.id)}{presetAvailable(preset.id) ? '' : ` — ${presetUnavailableText(preset.id)}`}</option>{/each}
        </select>
      </label>
      {#if generation.controlnetPreset}
        <p class="text-xs text-neutral-500">{presetAvailable(generation.controlnetPreset) ? locale.t('generation.controlnet.preset_' + generation.controlnetPreset + '_desc') : presetUnavailableText(generation.controlnetPreset)}</p>
        {@const selectedModel = getPresetModel(generation.controlnetPreset, generation.modelFamily)}
        {#if selectedModel}<div class="rounded-lg border border-ui-border p-2 text-xs"><p class="truncate text-neutral-400" title={selectedModel.filename}>{selectedModel.filename}</p>{#if !isModelInstalled(selectedModel)}<button type="button" disabled={!!downloading} onclick={downloadPresetModel} class="ui-control mt-1 w-full rounded-md bg-ui-selected text-ui-accent disabled:opacity-40">{locale.t('generation.controlnet.download_model')}</button>{/if}</div>{/if}
      {/if}

      <!-- Download progress -->
      {#if downloading}
        <div class="bg-neutral-800/80 rounded-lg px-3 py-2">
          <div
            class="flex items-center justify-between text-[11px] text-neutral-400 mb-1"
          >
            <span class="truncate mr-2">{locale.t('generation.controlnet.downloading', { model: downloading || '' })}</span>
            {#if dlTotal > 0}
              <span class="shrink-0 tabular-nums"
                >{locale.formatBytes(dlBytes)} / {locale.formatBytes(dlTotal)} ({dlPercent}%)</span
              >
            {/if}
          </div>
          {#if dlTotal > 0}
            <div
              class="w-full bg-neutral-700 rounded-full h-1.5 overflow-hidden"
            >
              <div
                class="bg-indigo-400 h-full rounded-full transition-[width] duration-300 ease-out"
                style="width: {dlPercent}%"
              ></div>
            </div>
          {:else}
            <div
              class="w-full bg-neutral-700 rounded-full h-1.5 overflow-hidden"
            >
              <div
                class="bg-indigo-400 h-full rounded-full w-1/3 animate-pulse"
              ></div>
            </div>
          {/if}
        </div>
      {/if}
      {#if downloadError}
        <p class="text-xs text-red-400">{downloadError}</p>
      {/if}

    {:else}
      <!-- Custom mode -->
      <div>
        <label class="block text-xs text-neutral-400 mb-1"
          >{locale.t('generation.controlnet.controlnet_model')}<InfoTip
            text={locale.t('generation.controlnet.model_tip')}
          /></label
        >
        <select
          bind:value={generation.controlnetModel}
          onchange={() => generation.saveSettings()}
          class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500 transition-colors"
        >
          <option value={null}>{locale.t('generation.controlnet.select_model')}</option>
          {#each customModeModels as model}
            <option value={model}>{model}</option>
          {/each}
        </select>
      </div>

      <div class="flex items-center gap-2">
        <input
          type="checkbox"
          id="cn-use-preprocessor"
          checked={!!generation.controlnetPreprocessor}
          onchange={(e) => {
            generation.controlnetPreprocessor = (e.target as HTMLInputElement).checked
              ? "CannyEdgePreprocessor"
              : null;
            generation.saveSettings();
          }}
          class="w-4 h-4 accent-indigo-500 rounded"
        />
        <label for="cn-use-preprocessor" class="text-xs text-neutral-400">
          {locale.t('generation.controlnet.use_preprocessor')}
        </label>
      </div>

      {#if generation.controlnetPreprocessor !== null}
        <div>
          <label class="block text-xs text-neutral-400 mb-1">{locale.t('generation.controlnet.preprocessor_label')}</label>
          <input
            type="text"
            bind:value={generation.controlnetPreprocessor}
            oninput={() => generation.saveSettings()}
            placeholder={locale.t('generation.controlnet.preprocessor_placeholder')}
            class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      {/if}
    {/if}

      <!-- Preprocessor preview -->
      {#if presetNeedsPreprocessor && generation.controlnetImage && connection.connected}
        <div class="flex items-center justify-between">
          <span class="text-xs text-neutral-400">{locale.t('generation.controlnet.prepare_preprocessor')}<InfoTip text={locale.t('generation.controlnet.prepare_preprocessor_tip')} /></span>
          {#if preprocessorPreviewStatus === "preparing"}
            <span class="text-xs text-neutral-400 flex items-center gap-1">
              <div class="w-3 h-3 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin"></div>
              {locale.t('generation.controlnet.preprocessor_preparing')}
            </span>
          {:else if preprocessorPreviewStatus === "ready"}
            <div class="flex items-center gap-2">
              <span class="text-xs text-green-400">{locale.t('generation.controlnet.preprocessor_ready')}</span>
              <button onclick={preparePreprocessorImage} class="text-xs text-indigo-400 hover:text-indigo-300" title={locale.t('generation.controlnet.preprocessor_rerun')}>↺</button>
            </div>
          {:else if preprocessorPreviewStatus === "failed"}
            <div class="flex items-center gap-2">
              <span class="text-xs text-red-400">{locale.t('generation.controlnet.preprocessor_preview_failed')}</span>
              <button onclick={preparePreprocessorImage} class="text-xs text-indigo-400 hover:text-indigo-300" title={locale.t('generation.controlnet.preprocessor_retry')}>↺</button>
            </div>
          {:else}
            <button
              onclick={preparePreprocessorImage}
              class="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
            >
              {locale.t('generation.controlnet.prepare_preprocessor')}
            </button>
          {/if}
        </div>
        {#if preprocessorPreviewUrl && preprocessorPreviewStatus === "ready"}
          <div class="relative rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700">
            <img src={preprocessorPreviewUrl} alt={locale.t("controlnet.preprocessor_preview_alt")} class="w-full max-h-32 object-contain" />
          </div>
        {/if}
      {/if}

    {#if sourceImage}<button type="button" onclick={useSourceImage} class="ui-control w-full rounded-lg border border-ui-border text-xs text-neutral-300 hover:bg-ui-selected">{locale.t('generation.controlnet.use_source')}</button>{/if}
    {#if controlnetEditorContext() && canvas.layers.some(layer => layer.type === 'raster' && layer.image)}
      <select aria-label={locale.t('generation.controlnet.use_layer')} value="" onchange={event => { const id = event.currentTarget.value; event.currentTarget.value = ''; void useRasterReference(id); }} class="ui-control w-full rounded-md border border-ui-border bg-neutral-950 px-2 text-xs text-neutral-300">
        <option value="" disabled>{locale.t('generation.controlnet.use_layer')}</option>
        {#each canvas.sortedLayers.filter(layer => layer.type === 'raster' && layer.image) as layer (layer.id)}<option value={layer.id}>{layer.name}</option>{/each}
      </select>
    {/if}
    {#if imageError}<p role="alert" class="text-xs text-red-400">{imageError}</p>{/if}
    <!-- Control image upload -->
    <div>
      <label class="block text-xs text-neutral-400 mb-1"
        >{locale.t('generation.controlnet.control_image_label')}<InfoTip
          text={locale.t('generation.controlnet.image_tip')}
        /></label
      >
      {#if generation.controlnetImage}
        <div class="space-y-2">
          {#if imagePreviewUrl}
            <div class="relative rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700">
              <img
                src={imagePreviewUrl}
                alt={locale.t('generation.controlnet.control_image_alt')}
                class="w-full max-h-24 object-contain"
              />
              <div class="absolute top-1.5 right-1.5">
                <button
                  onclick={removeImage}
                  aria-label={locale.t('generation.controlnet.remove')} class="ui-icon-button flex items-center justify-center rounded bg-neutral-900/80 text-neutral-400 hover:text-red-400 transition-colors"
                  title={locale.t('generation.controlnet.remove')}
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          {/if}
          <div class="flex items-center gap-2 bg-neutral-800 rounded-lg px-3 py-2">
            <span class="text-xs text-neutral-300 truncate flex-1">{generation.controlnetImage}</span>
            {#if !imagePreviewUrl}
              <button
                onclick={removeImage}
                class="text-xs text-red-400 hover:text-red-300 shrink-0"
              >
                {locale.t('generation.controlnet.remove')}
              </button>
            {/if}
            <label class="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer shrink-0">
              {locale.t('generation.controlnet.replace')}
              <input
                type="file"
                accept="image/*"
                onchange={handleImageUpload}
                class="hidden"
              />
            </label>
          </div>
        </div>
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={controlnetDropZone}
          data-drop-zone="controlnet-image"
          class="border-2 border-dashed border-neutral-700 rounded-lg p-4 text-center hover:border-neutral-600 transition-colors"
          onmouseenter={() => (controlnetPasteActive = true)}
          onmouseleave={() => (controlnetPasteActive = false)}
          ondragenter={(e) => e.preventDefault()}
          ondragover={(e) => e.preventDefault()}
          ondrop={handleImageDrop}
        >
          {#if uploadingImage}
            <p class="text-xs text-neutral-500">{locale.t('generation.controlnet.uploading')}</p>
          {:else}
            <div class="flex items-center justify-center gap-3">
              <label class="cursor-pointer text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  onchange={handleImageUpload}
                  class="hidden"
                />
                {locale.t('generation.controlnet.browse_or_drop')}
              </label>
              <span class="text-neutral-700">|</span>
              <button
                type="button"
                onclick={handleImagePaste}
                class="flex items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                {locale.t('generation.controlnet.paste')}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Strength & range sliders -->
    <div use:scrollCapture>
      <label
        class="flex items-center justify-between text-xs text-neutral-400 mb-1"
      >
        <span>{locale.t('generation.controlnet.strength')}<InfoTip
          text={locale.t('generation.controlnet.strength_tip')}
        /></span>
        <span class="text-neutral-300"
          >{locale.formatDecimal(generation.controlnetStrength, 2)}</span
        >
      </label>
      <input
        type="range"
        onpointerdown={beginControlEdit} onpointerup={endControlEdit} onpointercancel={endControlEdit} onkeydown={beginControlEdit} onkeyup={endControlEdit} onblur={endControlEdit}
        bind:value={generation.controlnetStrength}
        aria-label={locale.t("generation.controlnet.strength")}
        onchange={() => generation.saveSettings()}
        min="0"
        max={controlnetStrengthMax}
        step="0.05"
        class="w-full accent-indigo-500"
      />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div use:scrollCapture>
        <label
          class="flex items-center justify-between text-xs text-neutral-400 mb-1"
        >
          <span>{locale.t('generation.controlnet.start_percent')}<InfoTip
            text={locale.t('generation.controlnet.start_percent_tip')}
          /></span>
          <span class="text-neutral-300"
            >{locale.formatPercent(generation.controlnetStartPercent * 100, 0)}</span
          >
        </label>
        <input
          type="range"
        onpointerdown={beginControlEdit} onpointerup={endControlEdit} onpointercancel={endControlEdit} onkeydown={beginControlEdit} onkeyup={endControlEdit} onblur={endControlEdit}
          value={generation.controlnetStartPercent}
          aria-label={locale.t('generation.controlnet.start_percent')}
          oninput={(event) => { generation.controlnetStartPercent = Math.min(event.currentTarget.valueAsNumber, Math.max(0, generation.controlnetEndPercent - 0.05)); generation.saveSettings(); }}
          min="0"
          max="1"
          step="0.05"
          class="w-full accent-indigo-500"
        />
      </div>
      <div use:scrollCapture>
        <label
          class="flex items-center justify-between text-xs text-neutral-400 mb-1"
        >
          <span>{locale.t('generation.controlnet.end_percent')}<InfoTip
            text={locale.t('generation.controlnet.end_percent_tip')}
          /></span>
          <span class="text-neutral-300"
            >{locale.formatPercent(generation.controlnetEndPercent * 100, 0)}</span
          >
        </label>
        <input
          type="range"
        onpointerdown={beginControlEdit} onpointerup={endControlEdit} onpointercancel={endControlEdit} onkeydown={beginControlEdit} onkeyup={endControlEdit} onblur={endControlEdit}
          value={generation.controlnetEndPercent}
          aria-label={locale.t('generation.controlnet.end_percent')}
          oninput={(event) => { generation.controlnetEndPercent = Math.max(event.currentTarget.valueAsNumber, Math.min(1, generation.controlnetStartPercent + 0.05)); generation.saveSettings(); }}
          min="0"
          max="1"
          step="0.05"
          class="w-full accent-indigo-500"
        />
      </div>
    </div>
  {/if}
</div>
