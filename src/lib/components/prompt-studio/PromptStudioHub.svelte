<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";
  import { studio } from "../../prompt-studio/studio.svelte.js";

  type View = "character" | "wardrobe" | "sources" | "catalog" | "advanced";

  let { onOpen, advancedEnabled = false }: {
    onOpen: (view: View) => void;
    advancedEnabled?: boolean;
  } = $props();

  const cards: { id: string; view: View; title: string; desc: string }[] = [
    { id: "studio_::01", view: "character", title: "prompt_studio.character", desc: "prompt_studio.character_desc" },
    { id: "studio_::02", view: "wardrobe", title: "prompt_studio.wardrobe", desc: "prompt_studio.wardrobe_desc" },
    { id: "studio_::03", view: "sources", title: "prompt_studio.sources", desc: "prompt_studio.sources_desc" },
    { id: "studio_::04", view: "catalog", title: "prompt_studio.catalog", desc: "prompt_studio.catalog_desc" },
    { id: "studio_::05", view: "advanced", title: "prompt_studio.advanced", desc: "prompt_studio.advanced_desc" },
  ];
</script>

<div class="mx-auto w-full max-w-6xl">
  <p class="mb-1 font-mono text-[11px] tracking-[0.2em] text-indigo-400 uppercase">{locale.t("prompt_studio.resume")}</p>
  <h3 class="mb-4 text-2xl font-semibold tracking-tight text-neutral-100">{locale.t("prompt_studio.hub")}</h3>

  {#if studio.selected.length}
    <p class="mb-4 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
      {locale.t("prompt_studio.resume")}: <span class="text-neutral-200">{studio.selected.length}</span> · {studio.prompt.slice(0, 140)}{studio.prompt.length > 140 ? "…" : ""}
    </p>
  {/if}

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {#each cards as card (card.id)}
      <button
        type="button"
        class="group flex min-h-[132px] flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-left transition-colors hover:border-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-40"
        onclick={() => onOpen(card.view)}
        disabled={card.view === "advanced" && !advancedEnabled}
      >
        <span class="flex items-center justify-between font-mono text-[10px] tracking-[0.16em] text-neutral-500 uppercase">
          {locale.t("prompt_studio.details")}
          <span class="text-indigo-400 group-hover:text-indigo-300">→</span>
        </span>
        <span class="mt-auto text-base font-semibold text-neutral-100">{locale.t(card.title)}</span>
        <span class="text-xs leading-relaxed text-neutral-400">{locale.t(card.desc)}</span>
      </button>
    {/each}
  </div>
</div>
