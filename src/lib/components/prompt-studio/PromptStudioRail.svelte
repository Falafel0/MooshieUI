<script lang="ts">
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { CATEGORY_ICONS, fallbackIcon } from "./icons.js";
  import type { Category } from "../../prompt-studio/types.js";

  let { categories, wardrobe = false }: { categories: Category[]; wardrobe?: boolean } = $props();

  const countIn = (category: Category) => category.subs.filter((sub) => studio.chosen(sub.id)).length;
</script>

<nav class="flex gap-1 overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900 p-1.5 md:sticky md:top-0 md:flex-col md:overflow-visible" aria-label="categories">
  {#each categories as category (category.id)}
    {@const Icon = CATEGORY_ICONS[category.icon] ?? fallbackIcon}
    {@const count = countIn(category)}
    <button
      type="button"
      class="relative flex flex-1 flex-col items-center gap-1 rounded-lg border px-1.5 py-2 transition-colors md:w-full ${
        studio.activeCategoryId === category.id
          ? "border-indigo-500 bg-indigo-500/10 text-neutral-100"
          : "border-transparent text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      }"
      onclick={() => studio.selectCategory(category.id)}
      aria-pressed={studio.activeCategoryId === category.id}
      title={category.name}
    >
      <Icon size={17} strokeWidth={1.6} />
      <span class="text-[10px] leading-tight whitespace-nowrap">{category.name}</span>
      {#if count}
        <span class="absolute top-1 right-1.5 min-w-4 rounded-full bg-indigo-500 px-1 text-[9px] leading-4 font-semibold text-white">{count}</span>
      {/if}
    </button>
  {/each}
</nav>
