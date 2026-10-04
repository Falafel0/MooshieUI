<script lang="ts">
  import { hasTemplateVariables } from '../../prompt-studio/collection-tools.js';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import { untrack } from 'svelte';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import PromptStudioStructure from './PromptStudioStructure.svelte';
  import { Plus, Search, List, Grid2X2, Image, Check, Settings2, Library, ChevronLeft, ChevronRight } from '@lucide/svelte';
  let { management = false }: { management?: boolean } = $props();
  const initial = restoreTool('catalog', { query: '', list: false, images: true, size: 180, selectedOnly: false, page: 0 });
  let query = $state(initial.query);
  let list = $state(initial.list);
  let images = $state(initial.images);
  let size = $state(initial.size);
  let selectedOnly = $state(initial.selectedOnly);
  const PAGE_SIZE = 60;
  let page = $state(initial.page);
  let viewport = $state<HTMLDivElement>();
  let structure = $state<{ id?: string; categoryId?: string } | undefined>();
  const category = $derived(studio.currentCategory);
  const entries = $derived(customCatalog.entries.filter(entry => entry.subId === studio.activeSubId
    && (!selectedOnly || studio.isChosen(entry.tag))
    && [entry.name, entry.tag, entry.description, ...(entry.aliases ?? []), ...(entry.contextualTags ?? [])].join(' ').toLowerCase().includes(query.trim().toLowerCase())));
  const pageCount = $derived(Math.max(1, Math.ceil(entries.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount - 1));
  const visibleEntries = $derived(entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE));
  $effect(() => {
    query; selectedOnly; studio.activeSubId;
    untrack(() => viewport?.scrollTo({ top: 0 }));
  });
  $effect(() => { if (customCatalog.current && page >= pageCount) page = pageCount - 1; });
  $effect(() => {
    currentPage;
    untrack(() => viewport?.scrollTo({ top: 0 }));
  });
  $effect(() => { saveTool('catalog', { query, list, images, size, selectedOnly, page }); });
  function add() { studio.catalogEntryId = 'new'; }
</script>
<section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950" aria-label={locale.t('prompt_studio.v2.catalog')}>
  {#if category}
    <nav aria-label={locale.t('prompt_studio.v2.subcategories')} class="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-neutral-800 p-3">
      <button type="button" aria-pressed={studio.activeSubId === category.id} class="touch-target shrink-0 rounded-lg px-3 text-xs {studio.activeSubId === category.id ? 'bg-amber-400 font-medium text-neutral-950' : 'bg-neutral-900 text-neutral-400'}" onclick={() => studio.selectSub(category.id)}>{category.name}</button>
      {#each category.subs as sub (sub.id)}
        <div class="flex shrink-0 items-center rounded-lg {studio.activeSubId === sub.id ? 'bg-amber-400 text-neutral-950' : 'bg-neutral-900 text-neutral-400'}">
          <button type="button" aria-pressed={studio.activeSubId === sub.id} class="touch-target px-3 text-xs" onclick={() => studio.selectSub(sub.id)}>{sub.name}</button>
          {#if management}<button type="button" aria-label={locale.t('prompt_studio.v2.edit_named', { name: sub.name })} class="touch-target rounded-lg px-2 opacity-70 hover:opacity-100" onclick={() => structure = { id: sub.id }}><Settings2 size={13} /></button>{/if}
        </div>
      {/each}
      {#if management}<button type="button" disabled={!customCatalog.ready} class="touch-target shrink-0 rounded-lg border border-dashed border-neutral-700 px-3 text-neutral-400 hover:border-amber-400" aria-label={locale.t('prompt_studio.v2.add_subcategory')} onclick={() => structure = { categoryId: category.id }}><Plus size={17} /></button>{/if}
    </nav>
  {/if}
  <div class="flex shrink-0 flex-wrap items-center gap-2 p-3">
    <label class="flex min-w-32 flex-1 items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 focus-within:border-amber-400"><Search size={17} class="shrink-0 text-neutral-500" /><input type="search" aria-label={locale.t('prompt_studio.v2.search_tags')} placeholder={locale.t('prompt_studio.v2.search_tags')} bind:value={query} class="touch-target min-w-0 w-full bg-transparent text-xs text-neutral-200 outline-none" /></label>
    <div class="flex rounded-xl border border-neutral-800 bg-neutral-900 p-0.5">
      <button type="button" aria-label={locale.t('prompt_studio.v2.grid_view')} aria-pressed={!list} class="touch-target rounded-lg p-2 {!list ? 'bg-neutral-800 text-amber-300' : 'text-neutral-500'}" onclick={() => list = false}><Grid2X2 size={17} /></button>
      <button type="button" aria-label={locale.t('prompt_studio.v2.list_view')} aria-pressed={list} class="touch-target rounded-lg p-2 {list ? 'bg-neutral-800 text-amber-300' : 'text-neutral-500'}" onclick={() => list = true}><List size={17} /></button>
    </div>
    <button type="button" aria-label={locale.t('prompt_studio.v2.show_previews')} aria-pressed={images} class="touch-target rounded-xl border border-neutral-800 p-3 {images ? 'text-amber-300' : 'text-neutral-500'}" onclick={() => images = !images}><Image size={17} /></button>
    {#if management}<button type="button" disabled={!category || !customCatalog.ready} class="touch-target flex items-center gap-2 rounded-xl bg-amber-400 px-3 text-xs font-medium text-neutral-950 disabled:opacity-40" onclick={add}><Plus size={16} />{locale.t('prompt_studio.v2.add_tag')}</button>{/if}
  </div>
  <div class="flex shrink-0 items-center gap-3 border-b border-neutral-800 px-3 pb-3">
    <button type="button" aria-pressed={selectedOnly} class="touch-target flex items-center gap-2 rounded-lg border px-3 text-xs {selectedOnly ? 'border-amber-400/50 bg-amber-400/10 text-amber-300' : 'border-neutral-800 text-neutral-400'}" onclick={() => selectedOnly = !selectedOnly}><Check size={14} />{locale.t('prompt_studio.v2.selected_only')}</button>
    <span class="ml-auto text-[11px] text-neutral-500">{locale.t('prompt_studio.v2.tag_results', { count: locale.formatInteger(entries.length) })}</span>
    {#if !list}<input type="range" min="140" max="260" step="20" bind:value={size} aria-label={locale.t('prompt_studio.v2.card_size')} class="w-16 accent-amber-400" />{/if}
  </div>
  <div bind:this={viewport} class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
    {#if !customCatalog.ready}
      <p role="status" class="p-6 text-center text-xs text-neutral-500">{locale.t('prompt_studio.v2.loading_library')}</p>
    {:else if !category}
      <div class="flex min-h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-800 px-6 py-10 text-center"><Library size={30} class="text-amber-300" /><h3 class="text-sm font-medium text-neutral-200">{locale.t('prompt_studio.v2.empty_library_title')}</h3><p class="max-w-sm text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.empty_library_hint')}</p>{#if management}<button type="button" class="touch-target mt-2 flex items-center gap-2 rounded-lg bg-amber-400 px-4 text-xs font-medium text-neutral-950" onclick={() => structure = { id: '' }}><Plus size={15} />{locale.t('prompt_studio.v2.add_category')}</button>{/if}</div>
    {:else if !entries.length}
      <div class="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-800 px-6 py-10 text-center"><Search size={27} class="text-neutral-600" /><h3 class="text-sm font-medium text-neutral-300">{locale.t(query.trim() || selectedOnly ? 'prompt_studio.v2.no_results_title' : 'prompt_studio.v2.empty_category_title')}</h3><p class="max-w-sm text-xs leading-relaxed text-neutral-500">{locale.t(query.trim() || selectedOnly ? 'prompt_studio.v2.no_results_hint' : 'prompt_studio.v2.empty_category_hint')}</p>{#if query.trim() || selectedOnly}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-4 text-xs text-neutral-300" onclick={() => { query = ''; selectedOnly = false; }}>{locale.t('prompt_studio.v2.clear_filters')}</button>{:else if management}<button type="button" class="touch-target flex items-center gap-2 rounded-lg bg-amber-400 px-4 text-xs font-medium text-neutral-950" onclick={add}><Plus size={15} />{locale.t('prompt_studio.v2.add_tag')}</button>{/if}</div>
    {:else}
      <div class="grid gap-3" style:grid-template-columns={list ? 'minmax(0,1fr)' : `repeat(auto-fill, minmax(min(100%, ${size}px), 1fr))`}>
        {#each visibleEntries as entry (entry.id)}
          {@const selected = studio.isChosen(entry.tag)}
          <article class="group relative flex min-w-0 overflow-hidden rounded-xl border transition-colors {list ? 'items-stretch' : 'flex-col'} {selected ? 'border-amber-400/70 bg-amber-400/5 ring-1 ring-amber-400/15' : 'border-neutral-800 bg-neutral-900 hover:border-neutral-600'}">
            <button type="button" aria-pressed={selected} aria-label={locale.t(management ? 'prompt_studio.v2.edit_named' : selected ? 'prompt_studio.v2.remove_named' : 'prompt_studio.v2.select_named', { name: entry.name })} class="min-w-0 flex-1 text-left {list ? 'flex items-center gap-3 p-3 pr-14' : 'pb-3'}" onclick={() => { if (management) studio.catalogEntryId = entry.id; else if (hasTemplateVariables(entry.tag)) void library.previewRecipe(entry.name, entry.tag); else studio.choose(entry.tag, entry.name, entry.subId); }}>
              {#if images && entry.preview}<img src={entry.preview} alt="" loading="lazy" class="object-cover {list ? 'h-16 w-20 shrink-0 rounded-lg' : 'h-28 w-full'}" />{:else if images}<div class="flex items-center justify-center bg-neutral-800/30 text-neutral-600 {list ? 'h-16 w-20 shrink-0 rounded-lg' : 'h-28'}"><Image size={23} /></div>{/if}
              <span class="block min-w-0 {list ? 'flex-1' : 'px-3 pt-3'}"><span class="block truncate pr-7 text-xs font-medium text-neutral-200">{entry.name}</span><span class="mt-1 block truncate font-mono text-[10px] text-neutral-500" title={entry.tag}>{entry.tag}</span>{#if entry.description}<span class="mt-2 line-clamp-2 text-[11px] leading-relaxed text-neutral-400">{entry.description}</span>{/if}{#if entry.contextualTags?.length}<span class="mt-2 inline-block rounded-md bg-neutral-800/60 px-1.5 py-1 text-[10px] text-neutral-400">{locale.t('prompt_studio.v2.modifier_count', { count: locale.formatInteger(entry.contextualTags.length) })}</span>{/if}</span>
            </button>
            {#if selected}<span aria-hidden="true" class="pointer-events-none absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-neutral-950"><Check size={14} /></span>{/if}

          </article>
        {/each}
      </div>
    {/if}
  </div>
  {#if customCatalog.ready && category && entries.length > PAGE_SIZE}
    <nav aria-label={locale.t('prompt_studio.v2.catalog_pagination')} class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-neutral-800 p-3">
      <p aria-live="polite" aria-atomic="true" class="text-[11px] tabular-nums text-neutral-500">{locale.t('prompt_studio.v2.catalog_page_range', { start: locale.formatInteger(currentPage * PAGE_SIZE + 1), end: locale.formatInteger(Math.min((currentPage + 1) * PAGE_SIZE, entries.length)), total: locale.formatInteger(entries.length) })}</p>
      <div class="flex items-center gap-2">
        <button type="button" disabled={currentPage === 0} class="touch-target flex items-center gap-1 rounded-lg border border-neutral-800 px-3 text-xs text-neutral-300 hover:border-neutral-600 disabled:opacity-35" onclick={() => page = currentPage - 1}><ChevronLeft size={15} />{locale.t('prompt_studio.v2.catalog_previous_page')}</button>
        <button type="button" disabled={currentPage === pageCount - 1} class="touch-target flex items-center gap-1 rounded-lg border border-neutral-800 px-3 text-xs text-neutral-300 hover:border-neutral-600 disabled:opacity-35" onclick={() => page = currentPage + 1}>{locale.t('prompt_studio.v2.catalog_next_page')}<ChevronRight size={15} /></button>
      </div>
    </nav>
  {/if}
</section>
{#if structure}<PromptStudioStructure {...structure} onClose={() => structure = undefined} />{/if}
