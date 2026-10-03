<script lang="ts">
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { CATEGORY_ICONS, fallbackIcon } from "./icons.js";
  import type { Category } from "../../prompt-studio/types.js";
  import { locale } from "../../stores/locale.svelte.js";

  let { categories }: { categories: Category[] } = $props();

  const countIn = (category: Category) => studio.selected.filter((item) => category.subs.some((sub) => sub.id === item.category)).length;
</script>

<nav class="flex gap-1 overflow-x-auto overscroll-contain md:sticky md:top-0 md:flex-col md:overflow-visible" aria-label={locale.t("prompt_studio.categories")}>
  {#each categories as category (category.id)}
    {@const Icon = CATEGORY_ICONS[category.icon] ?? fallbackIcon}
    {@const count = countIn(category)}
    <button
      type="button"
      class="touch-target relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors md:w-full {
        studio.activeCategoryId === category.id
          ? "bg-neutral-800 text-neutral-100"
          : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
      }"
      onclick={() => studio.selectCategory(category.id)}
      aria-pressed={studio.activeCategoryId === category.id}
      title={category.name}
    >
      <Icon size={17} strokeWidth={1.6} />
      <span class="text-xs leading-snug whitespace-nowrap md:whitespace-normal">{category.name}</span>
      {#if count}
        <span class="ml-auto shrink-0 text-[10px] tabular-nums text-indigo-300">{count}</span>
      {/if}
    </button>
  {/each}
</nav>
