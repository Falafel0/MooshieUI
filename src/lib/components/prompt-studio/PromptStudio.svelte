<script lang="ts">
  import { customCatalog } from "../../prompt-studio/custom-catalog.svelte.js";
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import PromptStudioPromptArea from "./PromptStudioPromptArea.svelte";
  import PromptStudioSend from "./PromptStudioSend.svelte";
  import PromptStudioBrowser from "./PromptStudioBrowser.svelte";
  import PromptStudioRail from "./PromptStudioRail.svelte";
  import PromptStudioEditor from "./PromptStudioEditor.svelte";
  import PromptStudioAssembled from "./PromptStudioAssembled.svelte";
  import PromptStudioAdvanced from "./PromptStudioAdvanced.svelte";
  import { Dices, Redo2, RotateCcw, Undo2 } from "@lucide/svelte";
  type View = "character" | "wardrobe" | "browser" | "advanced";
  let { onApply, onClose }: { onApply?: () => void; onClose?: () => void } = $props();
  let view = $state<View>("character");
  let browserVisited = $state(false);
  let mobilePanel = $state(false);
  let sending = $state(false);
  const wardrobe = $derived(view === "wardrobe");
  const body = $derived(view === "character" || view === "wardrobe");
  const titles: Record<View, string> = {
    character: "prompt_studio.character", wardrobe: "prompt_studio.wardrobe",
    browser: "prompt_studio.browser", advanced: "prompt_studio.advanced",
  };
  $effect(() => { studio.load(); void customCatalog.load(); });
  $effect(() => { if (body) studio.ensureActive(wardrobe); });
  function navigate(next: View) {
    view = next;
    if (next === "browser") browserVisited = true;
    if (next === "character" || next === "wardrobe") { studio.kind = next; studio.save(); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(studio.prompt); gallery.showToast(locale.t("prompt_studio.copied"), "success"); }
    catch (error) { gallery.showToast(String(error), "error"); }
  }
  function requestApply() { if (studio.prompt.trim()) sending = true; }
  const tool = "touch-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-40";
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-950 text-neutral-100 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-indigo-500">
  <header class="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-3">
    <div class="flex min-w-0 flex-1 items-center gap-2.5">
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-xs font-semibold text-indigo-300">PS</span>
      <div class="min-w-0">
        <h2 class="truncate text-sm font-semibold">{locale.t("nav.prompt_studio")}</h2>
        <p class="text-xs text-neutral-400">{studio.count} {locale.t("prompt_studio.tags_word")} · {studio.selected.length} {locale.t("prompt_studio.picked_word")}</p>
      </div>
    </div>
    <div class="flex items-center gap-1.5">
      {#if body}
        <button type="button" class={tool} aria-label={locale.t(wardrobe ? "prompt_studio.random_wardrobe" : "prompt_studio.random")} title={locale.t(wardrobe ? "prompt_studio.random_wardrobe" : "prompt_studio.random")} onclick={() => studio.randomize(wardrobe)}><Dices size={16} /></button>
      {/if}
      <button type="button" class={tool} disabled={!studio.selected.some((item) => !studio.pinned.includes(item.tag))} aria-label={locale.t("prompt_studio.reset")} title={locale.t("prompt_studio.reset")} onclick={() => studio.clear()}><RotateCcw size={16} /></button>
      <button type="button" class={tool} disabled={!studio.history.length} aria-label={locale.t("prompt_studio.undo")} title={locale.t("prompt_studio.undo")} onclick={() => studio.undo()}><Undo2 size={16} /></button>
      <button type="button" class={tool} disabled={!studio.future.length} aria-label={locale.t("prompt_studio.redo")} title={locale.t("prompt_studio.redo")} onclick={() => studio.redo()}><Redo2 size={16} /></button>
      <button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 py-2 text-xs text-indigo-300 lg:hidden" aria-expanded={mobilePanel} aria-controls="studio-assembled" onclick={() => (mobilePanel = !mobilePanel)}>{locale.t("prompt_studio.assembled")} ({studio.count})</button>
    </div>
  </header>
  <nav aria-label={locale.t("nav.prompt_studio")} class="flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-800 px-3 py-2">
    {#each Object.entries(titles) as [id, title] (id)}
      <button type="button" aria-current={view === id ? "page" : undefined} disabled={id === "advanced" && !generation.isAnima} class="touch-target shrink-0 rounded-lg border px-3 py-2 text-xs transition-colors {view === id ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-300' : 'border-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-40'}" onclick={() => navigate(id as View)}>{locale.t(title)}</button>
    {/each}
  </nav>
  {#if studio.storageError}
    <div role="alert" class="shrink-0 border-b border-amber-700/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">{locale.t("prompt_studio.storage_error")}</div>
  {/if}
  {#if studio.pendingConflict}
    {@const pending = studio.pendingConflict}
    <div role="alert" class="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-600/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
      <p class="min-w-0 flex-1 break-words">{locale.t("prompt_studio.conflict", { tag: pending.name, tags: pending.with.join(", ") })}</p>
      <button type="button" class="touch-target rounded-lg bg-amber-500 px-3 py-2 text-neutral-950" onclick={() => studio.resolveConflict(true)}>{locale.t("generation.controlnet.replace")}</button>
      <button type="button" class="touch-target rounded-lg border border-amber-600/40 px-3 py-2" onclick={() => studio.resolveConflict(false)}>{locale.t("common.cancel")}</button>
    </div>
  {/if}
  <div class="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:overflow-hidden">
    <div id="studio-assembled" class="min-h-0 min-w-0 border-b border-neutral-800 p-3 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-b-0 {mobilePanel ? '' : 'hidden lg:block'}">
      <PromptStudioAssembled />
    </div>
    <section aria-label={locale.t(titles[view])} class="min-h-0 min-w-0 p-3 {view === 'browser' ? 'h-[60dvh] lg:h-full overflow-hidden' : 'lg:overflow-y-auto lg:overscroll-contain'}">
      {#if body}
        <div class="grid min-w-0 gap-3 md:grid-cols-[112px_minmax(0,1fr)] md:items-start">
          <PromptStudioRail categories={studio.scoped(wardrobe)} {wardrobe} />
          <PromptStudioEditor />
        </div>
      {:else if view === "advanced"}
        <PromptStudioAdvanced />
      {/if}
      {#if browserVisited}<div hidden={view !== "browser"} class="h-full min-h-0"><PromptStudioBrowser /></div>{/if}
    </section>
  </div>
  <PromptStudioPromptArea onApply={requestApply} onCopy={copy} />
</div>

{#if sending}<PromptStudioSend onCancel={() => sending = false} onDone={() => { sending = false; (onApply ?? onClose)?.(); }} />{/if}
