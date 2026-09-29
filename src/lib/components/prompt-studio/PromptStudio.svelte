<script lang="ts">
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import PromptStudioHub from "./PromptStudioHub.svelte";
  import PromptStudioRail from "./PromptStudioRail.svelte";
  import PromptStudioEditor from "./PromptStudioEditor.svelte";
  import PromptStudioAssembled from "./PromptStudioAssembled.svelte";
  import PromptStudioSources from "./PromptStudioSources.svelte";
  import PromptStudioCatalog from "./PromptStudioCatalog.svelte";
  import PromptStudioAdvanced from "./PromptStudioAdvanced.svelte";
  import { ChevronLeft, Dices, Redo2, RotateCcw, Shirt, Undo2, X } from "@lucide/svelte";

  type View = "hub" | "character" | "wardrobe" | "sources" | "catalog" | "advanced";

  let { onClose, embedded = false }: { onClose?: () => void; embedded?: boolean } = $props();
  let view = $state<View>("hub");
  let mobilePanel = $state(false);

  const wardrobe = $derived(view === "wardrobe");
  const body = $derived(view === "character" || view === "wardrobe");

  const titles: Record<View, string> = {
    hub: "prompt_studio.hub",
    character: "prompt_studio.character",
    wardrobe: "prompt_studio.wardrobe",
    sources: "prompt_studio.sources",
    catalog: "prompt_studio.catalog",
    advanced: "prompt_studio.advanced",
  };

  $effect(() => { studio.load(); });
  $effect(() => { if (body) studio.ensureActive(wardrobe); });
  $effect(() => { studio.kind = wardrobe ? "wardrobe" : "character"; });
  // The picked model only decides how weights are written on export.
  $effect(() => {
    studio.model = generation.isAnima ? "Anima (Cosmos)" : generation.isNovelAi ? "NAI" : "SDXL (NoobAI)";
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(studio.prompt);
      gallery.showToast(locale.t("prompt_studio.copied"), "success");
    } catch (error) {
      gallery.showToast(String(error), "error");
    }
  }

  function apply() {
    const value = studio.prompt.trim();
    if (!value) {
      gallery.showToast(locale.t("prompt_studio.empty"), "warning");
      return;
    }
    generation.positivePrompt = value;
    void generation.saveSettings();
    gallery.showToast(locale.t("prompt_studio.apply"), "success");
    onClose?.();
  }

  function tool(active: boolean) {
    return `inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      active
        ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
        : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
    }`;
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === "Escape" && !embedded) onClose?.(); }} />

{#if embedded}
  <div class="flex h-full min-h-0 flex-col bg-neutral-950 text-neutral-100">
    {@render shell()}
  </div>
{:else}
  <div class="fixed inset-0 z-50 flex bg-black/80 p-3 backdrop-blur-sm" role="dialog" aria-modal="true">
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label={locale.t("common.close")}
      onclick={() => onClose?.()}
    ></button>
    <div class="relative z-10 m-auto flex h-full max-h-[94vh] w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl">
      {@render shell()}
    </div>
  </div>
{/if}

{#snippet shell()}
  <header class="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-2.5">
    <div class="flex min-w-0 flex-1 items-center gap-2.5">
      {#if view !== "hub"}
        <button type="button" class={tool(false)} title={locale.t("prompt_studio.back")} onclick={() => (view = "hub")}>
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
      {/if}
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[11px] font-bold text-white">PS</span>
      <div class="min-w-0">
        <h2 class="truncate text-sm font-semibold text-neutral-100">{locale.t(titles[view])}</h2>
        <p class="text-[10px] text-neutral-500">{studio.count} {locale.t("prompt_studio.tags_word")} · {studio.selected.length} {locale.t("prompt_studio.picked_word")}</p>
      </div>
    </div>

    <div class="flex items-center gap-1.5">
      {#if body}
        <button type="button" class={tool(false)} title={locale.t("prompt_studio.random")} onclick={() => studio.randomize(wardrobe)}>
          <Dices size={15} strokeWidth={1.8} />
        </button>
        <button type="button" class={tool(false)} title={locale.t("prompt_studio.random_wardrobe")} onclick={() => studio.randomize(true)}>
          <Shirt size={15} strokeWidth={1.8} />
        </button>
        <button type="button" class={tool(false)} title={locale.t("prompt_studio.reset")} onclick={() => studio.clear()}>
          <RotateCcw size={15} strokeWidth={1.8} />
        </button>
        <button type="button" class={tool(false)} disabled={!studio.history.length} title={locale.t("prompt_studio.undo")} onclick={() => studio.undo()}>
          <Undo2 size={15} strokeWidth={1.8} />
        </button>
        <button type="button" class={tool(false)} disabled={!studio.future.length} title={locale.t("prompt_studio.redo")} onclick={() => studio.redo()}>
          <Redo2 size={15} strokeWidth={1.8} />
        </button>
        <button type="button" class="{tool(false)} lg:hidden" title={locale.t("prompt_studio.assembled")} onclick={() => (mobilePanel = !mobilePanel)}>
          <span class="text-[11px] font-semibold">{studio.count}</span>
        </button>
      {/if}
      {#if !embedded}
        <button type="button" class={tool(false)} title={locale.t("common.close")} onclick={() => onClose?.()}>
          <X size={16} strokeWidth={2} />
        </button>
      {/if}
    </div>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto p-3">
    {#if view === "hub"}
      <PromptStudioHub onOpen={(next) => (view = next)} advancedEnabled={generation.isAnima} />
    {:else if body}
      <div class="grid gap-3 lg:grid-cols-[minmax(260px,330px)_116px_minmax(0,1fr)] lg:items-start">
        <div class="{mobilePanel ? "" : "hidden"} lg:block">
          <PromptStudioAssembled onApply={apply} onCopy={copy} />
        </div>
        <PromptStudioRail categories={studio.scoped(wardrobe)} {wardrobe} />
        <PromptStudioEditor />
      </div>
    {:else if view === "sources"}
      <PromptStudioSources />
    {:else if view === "catalog"}
      <PromptStudioCatalog />
    {:else}
      <PromptStudioAdvanced />
    {/if}
  </div>
{/snippet}
