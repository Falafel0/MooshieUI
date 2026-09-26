<script lang="ts">
  /**
   * Prompt Arena — the prompt authoring surface for the monbooru tab.
   *
   * Composes one prompt out of the pieces MooshieUI already has:
   *  - the large positive prompt textarea, wired to the existing autocomplete
   *    store by reusing `PromptTextarea` (the same prompt box the generation
   *    page uses) rather than reimplementing tag matching;
   *  - extra prompt blocks, mirroring `ExtraPromptBoxList` semantics;
   *  - a negative prompt;
   *  - the active macro chips, each tinted with its `MacroType` colour;
   *  - a single labelled action that hands the composed prompt to the generator.
   *
   * Everything owned by another agent arrives as a prop/callback (the generator
   * hand-off, the monbooru selection seeding, the artist/character cross-links)
   * so this file never imports a module that does not exist yet.
   */
  import PromptTextarea from "../generation/PromptTextarea.svelte";
  import { macros, MACRO_TYPE_META } from "../../stores/macros.svelte.js";
  import type { MacroType } from "../../stores/macros.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";

  /** One extra prompt block. Same shape/semantics as an `ExtraPromptBox`. */
  export interface PromptBlock {
    id: string;
    name: string;
    content: string;
  }

  interface Props {
    positivePrompt?: string;
    negativePrompt?: string;
    /** Extra prompt blocks. `$bindable` so the parent owns persistence. */
    blocks?: PromptBlock[];
    /** True while the generator is busy; disables the hand-off action. */
    generating?: boolean;
    /** Hand the composed prompt to the generator. Wired by the parent. */
    onGenerate?: (payload: { positive: string; negative: string; macroFragment: string }) => void;
    /** Artist macro cross-link: open the artist gallery for this slug. */
    onOpenArtist?: (slug: string) => void;
    /** Character macro cross-link: open this Animadex character slug. */
    onOpenCharacter?: (slug: string) => void;
    /**
     * "Build from selection": append tags from the monbooru browse selection.
     * The selection lives in the monbooru store, owned by another agent.
     */
    onBuildFromSelection?: () => void;
    buildFromSelectionLabel?: string;
  }

  let {
    positivePrompt = $bindable(""),
    negativePrompt = $bindable(""),
    blocks = $bindable([]),
    generating = false,
    onGenerate,
    onOpenArtist,
    onOpenCharacter,
    onBuildFromSelection,
    buildFromSelectionLabel = "",
  }: Props = $props();

  let confirmPending = $state(false);

  // The macro fragment that the Arena is showing but that is injected
  // downstream (in generation.toParams()), same as artist styles.
  const macroFragment = $derived(macros.buildPromptFragment());

  const activeMacroList = $derived(macros.activeMacros);

  /**
   * Prompt text the user authored: the textbox plus the extra blocks. The
   * macro fragment is deliberately NOT folded in here — macros are injected
   * downstream in `generation.toParams()` (exactly like artist styles), and
   * the parent wires that call site. Handing it over separately keeps the
   * fragment from being applied twice.
   */
  const composedPositive = $derived(
    [positivePrompt.trim(), ...blocks.map((b) => b.content.trim()).filter(Boolean)]
      .filter(Boolean)
      .join(", "),
  );

  /** True when there is something to send, from the textbox/blocks or macros. */
  const canSend = $derived(Boolean(composedPositive || macroFragment));

  function token(type: MacroType, key: "accent" | "surface" | "border" | "solid"): string {
    return `var(--macro-type-${type}-${key})`;
  }

  function addBlock() {
    const id = `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    blocks = [...blocks, { id, name: "", content: "" }];
  }

  function updateBlock(id: string, patch: Partial<Omit<PromptBlock, "id">>) {
    blocks = blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
  }

  function removeBlock(id: string) {
    blocks = blocks.filter((b) => b.id !== id);
  }

  function slugTarget(type: MacroType, slug: string): (() => void) | null {
    if (type === "artist" && onOpenArtist) return () => onOpenArtist(slug);
    if (type === "character" && onOpenCharacter) return () => onOpenCharacter(slug);
    return null;
  }

  function handOff() {
    if (!canSend || generating) return;
    if (!confirmPending) {
      confirmPending = true;
      return;
    }
    confirmPending = false;
    onGenerate?.({
      positive: composedPositive,
      negative: negativePrompt.trim(),
      macroFragment,
    });
  }
</script>

<div class="flex flex-col gap-3">
  <header class="flex items-center gap-2">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-300">
      {locale.t("monbooru.arena.title")}
    </h3>
    {#if onBuildFromSelection}
      <button
        type="button"
        class="rounded-lg border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 transition-colors hover:border-indigo-500 hover:text-indigo-200"
        title={locale.t("monbooru.arena.build_from_selection_tip")}
        onclick={() => onBuildFromSelection?.()}
      >
        {buildFromSelectionLabel || locale.t("monbooru.arena.build_from_selection")}
      </button>
    {/if}
  </header>

  <!-- Positive prompt: the existing prompt box component, so autocomplete,
       spellcheck and the clickable tag overlay all come along for free. -->
  <div>
    <label class="mb-1 block text-[11px] font-medium text-neutral-400" for="arena-positive">
      {locale.t("monbooru.arena.positive")}
    </label>
    <PromptTextarea
      bind:value={positivePrompt}
      placeholder={locale.t("monbooru.arena.positive_placeholder")}
      rows={6}
      minHeight="min-h-28"
      storageKey="mooshieui.promptHeight.arena.positive"
    />
  </div>

  <!-- Extra prompt blocks (ExtraPromptBoxList semantics). -->
  <div>
    {#each blocks as block, i (block.id)}
      <div class="mt-1 rounded-lg border border-neutral-700/60 bg-neutral-900/40 p-2 space-y-1.5">
        <div class="flex items-center gap-1.5">
          <span class="shrink-0 text-[10px] tabular-nums text-neutral-500">#{i + 1}</span>
          <input
            type="text"
            value={block.name}
            placeholder={locale.t("monbooru.arena.block_name_placeholder")}
            onchange={(e) => updateBlock(block.id, { name: e.currentTarget.value })}
            class="min-w-0 flex-1 border-b border-neutral-700 bg-transparent px-0.5 py-0 text-xs text-neutral-300 placeholder:text-neutral-600 transition-colors focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="button"
            onclick={() => removeBlock(block.id)}
            title={locale.t("common.remove")}
            aria-label={locale.t("common.remove")}
            class="shrink-0 rounded-lg border border-neutral-700 px-1.5 py-0.5 text-[11px] leading-none text-neutral-400 transition-colors hover:border-red-500/60 hover:text-red-300"
          >×</button>
        </div>
        <PromptTextarea
          bind:value={block.content}
          placeholder={locale.t("monbooru.arena.block_placeholder")}
          rows={3}
          minHeight="min-h-16"
          storageKey="mooshieui.promptHeight.arena.block.{block.id}"
        />
      </div>
    {/each}
    <button
      type="button"
      onclick={addBlock}
      class="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-700 py-1.5 text-xs text-neutral-400 transition-colors hover:border-indigo-500/60 hover:text-indigo-200"
    >
      <span class="text-sm leading-none">+</span>
      {locale.t("monbooru.arena.block_add")}
    </button>
  </div>

  <!-- Negative prompt. -->
  <div>
    <label class="mb-1 block text-[11px] font-medium text-neutral-400" for="arena-negative">
      {locale.t("monbooru.arena.negative")}
    </label>
    <PromptTextarea
      bind:value={negativePrompt}
      placeholder={locale.t("monbooru.arena.negative_placeholder")}
      rows={3}
      minHeight="min-h-16"
      storageKey="mooshieui.promptHeight.arena.negative"
    />
  </div>

  <!-- Active macro chips, next to the prompt, in their type colours. These
       tags are injected downstream and deliberately do NOT appear in the
       textbox, so the chips are the only visible trace of them. -->
  <div
    class="rounded-lg border border-neutral-700 bg-neutral-900/40 p-2"
    aria-label={locale.t("monbooru.arena.active_macros")}
  >
    <div class="mb-1.5 flex items-center gap-2">
      <span class="text-[11px] font-medium text-neutral-400">{locale.t("monbooru.arena.active_macros")}</span>
      {#if activeMacroList.length > 0}
        <button
          type="button"
          class="ml-auto rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 transition-colors hover:text-neutral-100"
          onclick={() => macros.clearActive()}
        >
          {locale.t("monbooru.arena.clear_macros")}
        </button>
      {/if}
    </div>
    {#if activeMacroList.length === 0}
      <p class="text-[11px] text-neutral-500">{locale.t("monbooru.arena.no_active_macros")}</p>
    {:else}
      <div class="flex flex-wrap gap-1.5">
        {#each activeMacroList as macro (macro.id)}
          {@const target = macro.tags.find((t) => t.slug)?.slug ?? null}
          <span
            class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
            style="border-color: {token(macro.type, 'solid')}; background: {token(macro.type, 'surface')}; color: {token(macro.type, 'accent')};"
            title={macro.name}
          >
            <span class="text-[10px] leading-none opacity-70" aria-hidden="true">{MACRO_TYPE_META[macro.type].glyph}</span>
            <span class="max-w-40 truncate">{macro.name}</span>
            <span class="text-[10px] opacity-70">{locale.t(MACRO_TYPE_META[macro.type].labelKey)}</span>
            {#if macro.tags.length > 1}
              <span class="text-[10px] tabular-nums opacity-70">×{macro.tags.length}</span>
            {/if}
            {#if target && slugTarget(macro.type, target)}
              <button
                type="button"
                class="opacity-70 transition-opacity hover:opacity-100"
                title={locale.t("monbooru.macros.open_artist", { slug: target })}
                aria-label={locale.t("monbooru.macros.open_artist", { slug: target })}
                onclick={slugTarget(macro.type, target)}
              >↗</button>
            {/if}
            <button
              type="button"
              class="opacity-70 transition-opacity hover:opacity-100"
              title={locale.t("monbooru.macros.deactivate_hint")}
              aria-label={locale.t("monbooru.macros.deactivate", { name: macro.name })}
              onclick={() => macros.deactivate(macro.id)}
            >×</button>
          </span>
        {/each}
      </div>
      {#if macroFragment}
        <p class="mt-1.5 break-words font-mono text-[10px] text-neutral-500" title={locale.t("monbooru.arena.macro_fragment_tip")}>
          {macroFragment}
        </p>
      {/if}
    {/if}
  </div>

  <!-- The hand-off. Two-step so the prompt is never sent by a stray click. -->
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-[var(--theme-accent-foreground)] transition-colors hover:bg-indigo-500 disabled:opacity-40"
      disabled={!canSend || generating}
      aria-busy={generating}
      onclick={handOff}
      onblur={() => (confirmPending = false)}
    >
      {confirmPending
        ? locale.t("monbooru.arena.send_confirm")
        : generating
          ? locale.t("monbooru.arena.sending")
          : locale.t("monbooru.arena.send_to_generator")}
    </button>
    <span class="text-[10px] text-neutral-500">{locale.t("monbooru.arena.send_tip")}</span>
  </div>
</div>
