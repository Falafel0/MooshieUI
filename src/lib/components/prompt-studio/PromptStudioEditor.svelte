<script lang="ts">
  import { withContextOptions } from '../../prompt-studio/catalog-expansion.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { locale } from "../../stores/locale.svelte.js";
  import PromptStudioCustomCatalog from "./PromptStudioCustomCatalog.svelte";
  import PromptStudioLive from "./PromptStudioLive.svelte";
  import PromptTextarea from "../generation/PromptTextarea.svelte";
  import PromptStudioPreview from "./PromptStudioPreview.svelte";
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { CLOTHING_PALETTE, DANBOORU_HUE_PALETTE, NEUTRAL_PALETTE } from "../../prompt-studio/palettes.js";
  import type { ColorWheelEntry } from "../../prompt-studio/types.js";
  import type { SubCategory, Variant } from "../../prompt-studio/types.js";
  import { autocomplete } from "../../stores/autocomplete.svelte.js";
  import { classifyTag } from "../../prompt-studio/sources.js";
  import { Check, Info, Palette, SlidersHorizontal } from "@lucide/svelte";

  const PALETTES: Record<string, ColorWheelEntry[]> = {
    hair: DANBOORU_HUE_PALETTE,
    eyes: NEUTRAL_PALETTE,
    clothing: CLOTHING_PALETTE,
  };

  const sub = $derived(studio.currentSub);
  const category = $derived(studio.currentCategory);
  let focusedTag = $state('');
  let danbooru = $state(false);
  let extraDetail = $state('');
  const chosenTag = $derived(sub ? (studio.selected.some(v => v.category === sub.id && v.tag === focusedTag) ? focusedTag : studio.chosen(sub.id)?.tag) : undefined);
  function chooseVariant(sub: SubCategory, variant: Variant) { focusedTag = variant.tag; if (!variant.tag) studio.clearSub(sub.id); else studio.chooseVariant(sub, variant); }

  const detail = $derived(chosenTag ? studio.detail(chosenTag) : undefined);
  const savedPreview = $derived(customCatalog.entries.find(entry => entry.tag === chosenTag && entry.subId === sub?.id)?.preview);
  const activeVariant = $derived(sub?.variants?.find((v) => v.tag === chosenTag) ?? (chosenTag ? withContextOptions({ id: chosenTag, tag: chosenTag, name: chosenTag.replaceAll('_', ' ') }, sub?.id ?? '') : undefined));
  $effect(() => { chosenTag; extraDetail = ''; });
  const palette = $derived(sub?.paletteKey ? (PALETTES[sub.paletteKey] ?? CLOTHING_PALETTE) : CLOTHING_PALETTE);
  const paletteMap = $derived(new Map(palette.map((entry) => [entry.tag, entry])));

  const visibleSubs = $derived((category?.subs ?? []).filter((item) => studio.subVisible(item)));
  const sliderSteps = $derived(sub?.sliderSteps ?? []);
  const sliderIndex = $derived(sub ? studio.sliderIndex(sub) : -1);
  let variantQuery = $state('');
  let alphabetical = $state(false);
  $effect(() => { sub?.id; variantQuery = ''; });
  function visibleVariants(values: Variant[]): Variant[] {
    const needle = variantQuery.trim().toLowerCase();
    const filtered = values.filter(v => (!needle || v.name.toLowerCase().includes(needle) || v.tag.replaceAll('_', ' ').includes(needle) || v.tag.includes(needle)));
    return alphabetical ? filtered.sort((a, b) => a.name.localeCompare(b.name)) : filtered;
  }
  const tileVariants = $derived(visibleVariants(sub?.variants ?? []));
  const libraryVariants = $derived.by(() => {
    const needle = variantQuery.trim().toLowerCase();
    if (needle.length < 2) return [];
    const wardrobe = ['tops', 'bottoms', 'dresses', 'accessories', 'footwear'].includes(category?.id ?? '');
    return autocomplete.search(needle, 100).filter(entry => entry.c === 0 && (classifyTag(entry.n).category === 'source:wardrobe') === wardrobe && !sub?.variants?.some(v => v.tag === entry.n)).slice(0, 30);
  });


  /** Modifiers blocked by another modifier already on the same variant. */
  function modifierBlocked(variant: Variant, modTag: string): boolean {
    const taken = detail?.mods ?? [];
    if (taken.includes(modTag)) return false;
    return (variant.modifiers ?? []).some(
      (mod) => taken.includes(mod.tag) && (mod.conflictsWith ?? []).includes(modTag),
    );
  }

  function variantPreview(tag: string): string | undefined {
    return customCatalog.entries.find(entry => entry.tag === tag && entry.subId === sub?.id)?.preview;
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
    <div class="sticky top-0 z-10 flex flex-wrap gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 p-2">
      {#each visibleSubs as item (item.id)}
        {@const count = studio.selected.filter(value => value.category === item.id).length}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors {
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

    <PromptStudioCustomCatalog />
    <nav class="flex flex-wrap gap-2" aria-label={locale.t('prompt_studio.constructor_source')}>
      <button type="button" aria-pressed={!danbooru} class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => danbooru = false}>{locale.t('prompt_studio.curated')}</button>
      <button type="button" aria-pressed={danbooru} class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-indigo-300" onclick={() => danbooru = true}>{locale.t('prompt_studio.all_danbooru')}</button>
    </nav>
    {#if danbooru}<PromptStudioLive constructorMode />{/if}
    <div hidden={danbooru} class="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
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
                        class="{tileClass((variant.tag ? studio.isChosen(variant.tag) : !studio.chosen(sub.id)))} justify-start"
                        aria-pressed={(variant.tag ? studio.isChosen(variant.tag) : !studio.chosen(sub.id))} onclick={() => chooseVariant(sub as SubCategory, variant)}
                      >
                        <span class="h-3.5 w-3.5 shrink-0 rounded-full border border-black/30" style="background:{variant.colorHex ?? '#525252'}"></span>
                        {#if variantPreview(variant.tag)}
                          <img src={variantPreview(variant.tag)} alt="" class="h-10 w-10 shrink-0 rounded object-contain" />
                        {/if}
                        <span class="truncate">{variant.name}</span>
                      </button>
                    {:else}
                      <button type="button" class={tileClass((variant.tag ? studio.isChosen(variant.tag) : !studio.chosen(sub.id)))} aria-pressed={(variant.tag ? studio.isChosen(variant.tag) : !studio.chosen(sub.id))} onclick={() => chooseVariant(sub as SubCategory, variant)}>
                        {#if variantPreview(variant.tag)}
                          <img src={variantPreview(variant.tag)} alt="" class="h-10 w-10 shrink-0 rounded object-contain" />
                        {/if}
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
              <button type="button" class={tileClass((variant.tag ? studio.isChosen(variant.tag) : !studio.chosen(sub.id)))} aria-pressed={(variant.tag ? studio.isChosen(variant.tag) : !studio.chosen(sub.id))} onclick={() => chooseVariant(sub as SubCategory, variant)}>
                {#if variant.colorHex && (sub.variantSize === "swatch" || sub.variantSize === "icon")}
                  <span class="h-3.5 w-3.5 shrink-0 rounded-full border border-black/30" style="background:{variant.colorHex}"></span>
                {/if}
                {#if variantPreview(variant.tag)}
                  <img src={variantPreview(variant.tag)} alt="" class="h-10 w-10 shrink-0 rounded object-contain" />
                {/if}
                <span class="truncate">{variant.name}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if libraryVariants.length}
          <h5 class="mt-4 mb-2 text-xs text-neutral-400">{locale.t('prompt_studio.catalog_library')}</h5>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {#each libraryVariants as entry (entry.n)}
              <button type="button" class={tileClass(studio.isChosen(entry.n))} aria-pressed={studio.isChosen(entry.n)} onclick={() => { studio.choose(entry.n, entry.n.replaceAll('_', ' '), classifyTag(entry.n).category); }}>{entry.n.replaceAll('_', ' ')}</button>
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
              class="flex flex-col items-center gap-1 rounded-lg border px-1 py-1.5 text-[9px] transition-colors {
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
              class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition-colors {
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




    {#if sub.mode === 'multi' && studio.selected.filter(v => v.category === sub.id).length > 1}
      <label class="text-xs text-neutral-400">{locale.t('prompt_studio.detail_owner')}
        <select class="touch-target mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2" value={chosenTag} onchange={event => focusedTag = event.currentTarget.value}>
          {#each studio.selected.filter(v => v.category === sub.id) as item (item.tag)}<option value={item.tag}>{item.name}</option>{/each}
        </select>
      </label>
    {/if}
    <!-- per-variant detail: modifiers, secondary colour, quantity, nested parts -->
    {#if chosenTag && activeVariant}
      {@const variant = activeVariant}
      {#if chosenTag}
        <div class="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <p class="font-mono text-[10px] tracking-[0.16em] text-indigo-400 uppercase">{locale.t('prompt_studio.item_details', { name: variant.name })}</p>

          {#if variant.modifiers?.length}
            <div>
              <p class="mb-1.5 text-[10px] tracking-[0.12em] text-neutral-500 uppercase">{locale.t("prompt_studio.modifiers")}</p>
              <div class="flex flex-wrap gap-1.5">
                {#each variant.modifiers as mod (mod.tag)}
                  {@const blocked = modifierBlocked(variant, mod.tag)}
                  <button
                    type="button"
                    class="rounded-lg border px-2 py-1 text-[11px] transition-colors {
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
                  <Palette size={11} strokeWidth={2} /> {locale.t("prompt_studio.secondary_color")}
                </p>
                <div class="flex flex-wrap gap-1.5">
                  {#each palette as entry (entry.tag)}
                    <button
                      type="button"
                      class="h-6 w-6 rounded-full border transition-transform {
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
                <SlidersHorizontal size={11} strokeWidth={2} /> {locale.t("prompt_studio.quantity")}
              </p>
              <div class="flex flex-wrap gap-1.5">
                {#each variant.quantity as option (option.tag)}
                  <button
                    type="button"
                    class="rounded-lg border px-2 py-1 text-[11px] transition-colors {
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
              <p class="mb-1.5 text-[10px] tracking-[0.12em] text-neutral-500 uppercase">{part.name === "Color" ? locale.t("prompt_studio.garment_color") : part.name === "Material" ? locale.t("prompt_studio.garment_material") : part.name}</p>
              <div class="flex flex-wrap gap-1.5">
                {#each part.tags as option (option.tag)}
                  <button
                    type="button"
                    class="rounded-lg border px-2 py-1 text-[11px] transition-colors {
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
          <div class="border-t border-neutral-800 pt-3">
            <p class="mb-2 text-xs text-neutral-400">{locale.t('prompt_studio.additional_details')}</p>
            <PromptTextarea bind:value={extraDetail} rows={2} minHeight="min-h-16" placeholder={locale.t('prompt_studio.additional_details_hint')} />
            <button type="button" disabled={!extraDetail.trim()} class="touch-target mt-2 rounded border border-neutral-700 px-3 py-2 text-xs text-indigo-300 disabled:opacity-40" onclick={() => { studio.setPart(chosenTag!, 'Additional details', [detail?.parts['Additional details'], extraDetail.trim()].filter(Boolean).join(', ')); extraDetail = ''; }}>{locale.t('prompt_studio.add_tag')}</button>
            {#if detail?.parts['Additional details']}<p class="mt-2 break-words text-xs text-neutral-400">{detail.parts['Additional details']} <button type="button" class="touch-target rounded p-1" onclick={() => studio.setPart(chosenTag!, 'Additional details', detail!.parts['Additional details'])}>{locale.t('prompt_studio.remove')}</button></p>{/if}
          </div>
        </div>
      {/if}
    {/if}
    {#if savedPreview}<img src={savedPreview} alt={activeVariant?.name ?? chosenTag} class="max-h-64 max-w-full self-start rounded-lg border border-neutral-700 object-contain" />
    {:else if chosenTag}<PromptStudioPreview tag={chosenTag} />{/if}
  </section>
{/if}
