<script lang="ts">
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { CATEGORY_ICONS, fallbackIcon } from './icons.js';
  import PromptStudioStructure from './PromptStudioStructure.svelte';
  import { Plus, Settings2, Search } from '@lucide/svelte';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  let { management = true }: { management?: boolean } = $props();
  let query = $state(restoreTool('category-rail', { query: '' }).query);
  $effect(() => { saveTool('category-rail', { query }); });
  let editing = $state<string | undefined>();
  const categories = $derived(customCatalog.categories.filter(category => category.name.toLowerCase().includes(query.trim().toLowerCase())));
</script>
<aside class="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
  <label class="flex shrink-0 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3"><Search size={16} class="shrink-0 text-neutral-500" /><input type="search" aria-label={locale.t('prompt_studio.categories')} placeholder={locale.t('prompt_studio.search')} bind:value={query} class="ui-control min-w-0 w-full bg-transparent text-xs text-neutral-200 outline-none" /></label>
  <nav aria-label={locale.t('prompt_studio.categories')} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {#each categories as category (category.id)}
      {@const Icon = CATEGORY_ICONS[category.icon] ?? fallbackIcon}
      <div class="group mb-1 flex items-center rounded-lg {studio.activeCategoryId === category.id ? 'bg-indigo-400 text-neutral-950' : 'text-neutral-400 hover:bg-neutral-900'}">
        <button type="button" aria-pressed={studio.activeCategoryId === category.id} title={category.name} class="ui-control flex min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs" onclick={() => studio.selectCategory(category.id)}><Icon size={17} class="shrink-0" /><span class="truncate">{category.name}</span></button>
        {#if management}<button type="button" aria-label={`${locale.t('common.edit')}: ${category.name}`} class="ui-control shrink-0 rounded-lg p-2 opacity-70 hover:opacity-100" onclick={() => editing = category.id}><Settings2 size={14} /></button>{/if}
      </div>
    {/each}
    {#if customCatalog.ready && !customCatalog.categories.length}<p class="py-5 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.blank_catalog')}</p>{/if}
  </nav>
  {#if management}<button type="button" disabled={!customCatalog.ready} class="ui-control flex shrink-0 items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-200 disabled:opacity-40" onclick={() => editing = ''}><Plus size={17} />{locale.t('prompt_studio.add_category')}</button>{/if}

</aside>
{#if editing !== undefined}<PromptStudioStructure id={editing} onClose={() => editing = undefined} />{/if}
