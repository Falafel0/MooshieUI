<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";
  import PromptStudioPreview from "./PromptStudioPreview.svelte";
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { CLOTHING_PALETTE, DANBOORU_HUE_PALETTE, NEUTRAL_PALETTE } from "../../prompt-studio/palettes.js";
  import type { ColorWheelEntry } from "../../prompt-studio/types.js";
  import type { SubCategory, Variant } from "../../prompt-studio/types.js";
  import { Check, Info, Palette, SlidersHorizontal } from "@lucide/svelte";

  const PALETTES: Record<string, ColorWheelEntry[]> = {
    hair: DANBOORU_HUE_PALETTE,
    eyes: NEUTRAL_PALETTE,
    clothing: CLOTHING_PALETTE,
  };

  const sub = $derived(studio.currentSub);
  const category = $derived(studio.currentCategory);
  const chosenTag = $derived(sub ? studio.chosen(sub.id)?.tag : undefined);
  const detail = $derived(chosenTag ? studio.detail(chosenTag) : undefined);
  const activeVariant = $derived(sub?.variants?.find((v) => v.tag === chosenTag));
  const palette = $derived(sub?.paletteKey ? (PALETTES[sub.paletteKey] ?? CLOTHING_PALETTE) : CLOTHING_PALETTE);
  const paletteMap = $derived(new Map(palette.map((entry) => [entry.tag, entry])));

  const visibleSubs = $derived((category?.subs ?? []).filter((item) => studio.subVisible(item)));
  const sliderSteps = $derived(sub?.sliderSteps ?? []);
  const sliderIndex = $derived(sub ? studio.sliderIndex(sub) : -1);
  let variantQuery = $state('');
  let alphabetical = $state(false);
  let alternatives = $state('red|blue');
  const alternates = $derived(alternatives.split('|').map(value => value.trim()).filter(Boolean));
  const validAlternation = $derived(alternates.length >= 2 && alternates.every(value => !/[\[\]\n]/.test(value)));
  $effect(() => { sub?.id; variantQuery = ''; });
  function visibleVariants(values: Variant[]): Variant[] {
    const needle = variantQuery.trim().toLowerCase();
    const filtered = values.filter(v => v.tag && (!needle || v.name.toLowerCase().includes(needle) || v.tag.replaceAll('_', ' ').includes(needle) || v.tag.includes(needle)));
    return alphabetical ? filtered.sort((a, b) => a.name.localeCompare(b.name)) : filtered;
  }
  const tileVariants = $derived(visibleVariants(sub?.variants ?? []));

  /** Modifiers blocked by another modifier already on the same variant. */
  function modifierBlocked(variant: Variant, modTag: string): boolean {
    const taken = detail?.mods ?? [];
    if (taken.includes(modTag)) return false;
    return (variant.modifiers ?? []).some(
      (mod) => taken.includes(mod.tag) && (mod.conflictsWith ?? []).includes(modTag),
    );
  }

  function tileClass(selected: boolean) {
    return `flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-center text-[11px] leading-tight transition-colors ${
      selected
        ? "border-indigo-500 bg-indigo-500/15 text-neutral-100"
        : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700 hover:text-neutral-100"
    }`;
  }

  function stepLabel(index: number): string {
    const step = sliderSteps[index];
    return step ? step.label || step.tag.replaceAll("_", " ") : "";
  }
</script>

{#if !sub || !category}
  <section class="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-400">
    <p class="font-mono text-[11px] tracking-[0.16em] text-indigo-400 uppercase">free_form</p>
    <p class="mt-2">Выберите категорию слева.</p>
  </section>
{:else}
  <section class="flex min-h-0 flex-col gap-3">
    <!-- subcategory tabs -->
    <div class="flex flex-wrap gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 p-2">
      {#each visibleSubs as item (item.id)}
        {@const count = studio.selected.filter(value => value.category === item.id).length}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
            sub.id === item.id
              ? "border-indigo-500 bg-indigo-500/10 text-neutral-100"
              : "border-transparent text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          }"
          aria-pressed={sub.id === item.id}
          onclick={() => studio.selectSub(item.id)}
        >
          {item.name}
          {#if item.mode === "multi"}<span class="text-[9px] text-neutral-500">∞</span>{/if}
          {#if count}<Check size={11} strokeWidth={2.5} class="text-indigo-400" />{/if}
        </button>
      {/each}
    </div>

    <div class="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <header class="mb-3 flex items-center gap-2">
        <h4 class="text-sm font-semibold text-neutral-100">{sub.name}</h4>
        <span class="font-mono text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
          {sub.type === "slider" ? "slider" : sub.type === "color-wheel" ? "palette" : sub.type === "blend" ? "blend" : sub.mode}
        </span>
        {#if sub.lock}<span class="text-[10px] text-amber-400">зафиксировано</span>{/if}
      </header>

      {#if sub.type === "grid"}
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <input aria-label={locale.t("prompt_studio.search_variants")} class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-xs text-neutral-200" placeholder={locale.t("prompt_studio.search_variants_hint")} bind:value={variantQuery} />
          <button type="button" aria-pressed={alphabetical} class="touch-target rounded border border-neutral-700 px-2 py-2 text-xs text-neutral-300" onclick={() => alphabetical = !alphabetical} aria-label={locale.t("prompt_studio.sort_az")}>{locale.t("prompt_studio.sort_az")}</button>
          <span role="status" class="text-xs text-neutral-500">{tileVariants.length}</span>
        </div>
        {#if !tileVariants.length}<p role="status" class="text-xs text-neutral-400">{locale.t("prompt_studio.no_variants")}</p>{/if}
        {#if sub.groups?.length}
          <div class="flex flex-col gap-3">
            {#each sub.groups as group (group.name)}
              <div>
                <p class="mb-1.5 text-[10px] tracking-[0.12em] text-neutral-500 uppercase">{group.name}</p>
                <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                  {#each visibleVariants(group.variantIds.map((id) => sub.variants?.find((v) => v.id === id)).filter((v): v is Variant => !!v)) as variant (variant.id)}
                    {#if sub.variantSize === "swatch" || sub.variantSize === "icon"}
                      <button
                        type="button"
                        class="{tileClass(studio.isChosen(variant.tag))} justify-start"
                        aria-pressed={studio.isChosen(variant.tag)} onclick={() => studio.chooseVariant(sub as SubCategory, variant)}
                      >
                        <span class="h-3.5 w-3.5 shrink-0 rounded-full border border-black/30" style="background:{variant.colorHex ?? '#525252'}"></span>
                        <span class="truncate">{variant.name}</span>
                      </button>
                    {:else}
                      <button type="button" class={tileClass(studio.isChosen(variant.tag))} aria-pressed={studio.isChosen(variant.tag)} onclick={() => studio.chooseVariant(sub as SubCategory, variant)}>
                        {variant.name}
                      </button>
                    {/if}
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
            {#each tileVariants as variant (variant.id)}
              <button type="button" class={tileClass(studio.isChosen(variant.tag))} aria-pressed={studio.isChosen(variant.tag)} onclick={() => studio.chooseVariant(sub as SubCategory, variant)}>
                {#if variant.colorHex && (sub.variantSize === "swatch" || sub.variantSize === "icon")}
                  <span class="h-3.5 w-3.5 shrink-0 rounded-full border border-black/30" style="background:{variant.colorHex}"></span>
                {/if}
                <span class="truncate">{variant.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      {:else if sub.type === "slider"}
        <div class="flex flex-col gap-2">
          <input
            type="range"
            aria-label={sub.name}
            class="w-full accent-indigo-500"
            min="0"
            max={Math.max(0, sliderSteps.length - 1)}
            value={Math.max(0, sliderIndex)}
            oninput={(event) => studio.setSlider(sub as SubCategory, Number((event.currentTarget as HTMLInputElement).value))}
          />
          <div class="flex justify-between text-[10px] text-neutral-500">
            {#each sliderSteps as step, index (step.tag + index)}
              {@const active = index === sliderIndex}
              <button
                type="button"
                class={active ? "font-semibold text-indigo-300" : "hover:text-neutral-300"}
                onclick={() => studio.setSlider(sub as SubCategory, index)}
              >
                {stepLabel(index)}
              </button>
            {/each}
          </div>
        </div>
      {:else if sub.type === "color-wheel"}
        <div class="grid grid-cols-6 gap-1.5 sm:grid-cols-8 xl:grid-cols-10">
          {#each palette as entry (entry.tag)}
            <button
              type="button"
              class="flex flex-col items-center gap-1 rounded-lg border px-1 py-1.5 text-[9px] transition-colors ${
                chosenTag === entry.tag ? "border-indigo-500 bg-indigo-500/10 text-neutral-100" : "border-neutral-800 text-neutral-400 hover:border-neutral-700"
              }"
              title={entry.name}
              onclick={() => studio.choose(entry.tag, entry.name, sub.id, true)}
            >
              <span class="h-4 w-4 rounded-full border border-black/30" style="background:{entry.hex}"></span>
              <span class="max-w-full truncate">{entry.name}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="flex flex-wrap gap-1.5">
          {#each palette as entry (entry.tag)}
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${
                chosenTag === entry.tag || detail?.secondary === entry.tag
                  ? "border-indigo-500 bg-indigo-500/10 text-neutral-100"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-700"
              }"
              onclick={() => chosenTag ? studio.setSecondary(chosenTag, entry.tag) : studio.choose(entry.tag, entry.name, sub.id, true)}
            >
              <span class="h-3 w-3 rounded-full border border-black/30" style="background:{entry.hex}"></span>
              {entry.name}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <details class="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">
      <summary class="cursor-pointer text-indigo-300">{locale.t("prompt_studio.alternation_title")}</summary>
      <form class="mt-3 flex flex-wrap gap-2" onsubmit={event => { event.preventDefault(); if (validAlternation) studio.addMany([{ tag: `[${alternates.join('|')}]`, name: alternatives, category: 'custom' }]); }}>
        <input aria-label={locale.t("prompt_studio.alternation_input")} class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-neutral-200" bind:value={alternatives} placeholder="red|blue|green" />
        <button type="submit" disabled={!validAlternation} class="touch-target rounded-lg border border-indigo-500/50 px-3 py-2 text-indigo-300 disabled:opacity-40">{locale.t("prompt_studio.add_expression", { expression: `[${alternates.join('|')}]` })}</button>
      </form>
      <p class="mt-2 leading-relaxed">{locale.t("prompt_studio.alternation_hint")}</p>
    </details>
    {#if chosenTag}<PromptStudioPreview tag={chosenTag} />{/if}

    <!-- per-variant detail: modifiers, secondary colour, quantity, nested parts -->
    {#if chosenTag && activeVariant}
      {@const variant = activeVariant}
      {#if variant.modifiers?.length || variant.quantity?.length || variant.parts?.length}
        <div class="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <p class="font-mono text-[10px] tracking-[0.16em] text-indigo-400 uppercase">detail :: {variant.name}</p>

          {#if variant.modifiers?.length}
            <div>
              <p class="mb-1.5 text-[10px] tracking-[0.12em] text-neutral-500 uppercase">модификаторы</p>
              <div class="flex flex-wrap gap-1.5">
                {#each variant.modifiers as mod (mod.tag)}
                  {@const blocked = modifierBlocked(variant, mod.tag)}
                  <button
                    type="button"
                    class="rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                      (detail?.mods ?? []).includes(mod.tag)
                        ? "border-indigo-500 bg-indigo-500/10 text-neutral-100"
                        : blocked
                          ? "border-neutral-800/60 text-neutral-600"
                          : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }"
                    disabled={blocked}
                    title={blocked ? "несовместимо с выбранным модификатором" : mod.name}
                    onclick={() => studio.toggleModifier(chosenTag as string, mod.tag)}
                  >
                    {mod.name}
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          {#if sub.type === "grid"}
            {#if (variant.modifiers ?? []).some((mod) => mod.needsColor)}
              <div>
                <p class="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.12em] text-neutral-500 uppercase">
                  <Palette size={11} strokeWidth={2} /> второй цвет
                </p>
                <div class="flex flex-wrap gap-1.5">
                  {#each palette as entry (entry.tag)}
                    <button
                      type="button"
                      class="h-6 w-6 rounded-full border transition-transform ${
                        detail?.secondary === entry.tag ? "scale-110 border-indigo-400 ring-2 ring-indigo-500/40" : "border-black/40 hover:scale-105"
                      }"
                      style="background:{entry.hex}"
                      title={entry.name}
                      onclick={() => studio.setSecondary(chosenTag as string, entry.tag)}
                    ></button>
                  {/each}
                </div>
              </div>
            {/if}
          {/if}

          {#if variant.quantity?.length}
            <div>
              <p class="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.12em] text-neutral-500 uppercase">
                <SlidersHorizontal size={11} strokeWidth={2} /> количество
              </p>
              <div class="flex flex-wrap gap-1.5">
                {#each variant.quantity as option (option.tag)}
                  <button
                    type="button"
                    class="rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                      detail?.quantity === option.tag ? "border-indigo-500 bg-indigo-500/10 text-neutral-100" : "border-neutral-800 text-neutral-400 hover:border-neutral-700"
                    }"
                    onclick={() => studio.setQuantity(chosenTag as string, option.tag)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          {#each (variant.parts ?? []) as part (part.name)}
            <div>
              <p class="mb-1.5 text-[10px] tracking-[0.12em] text-neutral-500 uppercase">{part.name}</p>
              <div class="flex flex-wrap gap-1.5">
                {#each part.tags as option (option.tag)}
                  <button
                    type="button"
                    class="rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                      detail?.parts?.[part.name] === option.tag ? "border-indigo-500 bg-indigo-500/10 text-neutral-100" : "border-neutral-800 text-neutral-400 hover:border-neutral-700"
                    }"
                    onclick={() => studio.setPart(chosenTag as string, part.name, option.tag)}
                  >
                    {option.name}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
{/if}
