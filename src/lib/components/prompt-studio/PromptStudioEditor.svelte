<script lang="ts">
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import PromptStudioStructure from './PromptStudioStructure.svelte';
  import { Plus, Search, List, Grid2X2, Image, Check, Settings2 } from '@lucide/svelte';
  let query = $state('');
  let list = $state(false);
  let images = $state(true);
  let size = $state(160);
  let structure = $state<{ id?: string; categoryId?: string } | undefined>();
  const category = $derived(studio.currentCategory);
  const entries = $derived(customCatalog.entries.filter(entry => entry.subId === studio.activeSubId && `${entry.name} ${entry.tag} ${entry.aliases?.join(' ') ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())));
  function add() { studio.catalogEntryId = 'new'; }
</script>
<section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950" aria-label={locale.t('prompt_studio.custom_catalog')}>
  <nav aria-label={locale.t('prompt_studio.subcategories')} class="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-neutral-800 p-3">
    {#if category}
      <button type="button" aria-pressed={studio.activeSubId === category.id} class="touch-target shrink-0 rounded-lg px-3 text-xs {studio.activeSubId === category.id ? 'bg-amber-400 font-medium text-neutral-950' : 'bg-neutral-900 text-neutral-400'}" onclick={() => studio.selectSub(category.id)}>{category.name}</button>
      {#each category.subs as sub (sub.id)}
        <div class="flex shrink-0 items-center rounded-lg {studio.activeSubId === sub.id ? 'bg-amber-400 text-neutral-950' : 'bg-neutral-900 text-neutral-400'}">
          <button type="button" aria-pressed={studio.activeSubId === sub.id} class="touch-target px-3 text-xs" onclick={() => studio.selectSub(sub.id)}>{sub.name}</button>
          <button type="button" aria-label={`${locale.t('common.edit')}: ${sub.name}`} class="touch-target px-2 opacity-70" onclick={() => structure = { id: sub.id }}><Settings2 size={12} /></button>
        </div>
      {/each}
      <button type="button" disabled={!customCatalog.ready} class="touch-target shrink-0 rounded-lg border border-neutral-800 p-3 text-neutral-400" aria-label={locale.t('prompt_studio.add_subcategory')} onclick={() => structure = { categoryId: category.id }}><Plus size={18} /></button>
    {:else}<span class="touch-target flex items-center text-xs text-neutral-500">{locale.t('prompt_studio.blank_catalog')}</span>{/if}
  </nav>
  <div class="flex shrink-0 flex-wrap items-center gap-2 p-3">
    <label class="flex min-w-32 flex-1 items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3"><Search size={17} class="text-neutral-500" /><input type="search" aria-label={locale.t('prompt_studio.search')} placeholder={locale.t('prompt_studio.search')} bind:value={query} class="touch-target min-w-0 w-full bg-transparent text-xs text-neutral-200 outline-none" /></label>
    <button type="button" aria-label={locale.t('prompt_studio.list_view')} aria-pressed={list} class="touch-target rounded-lg border border-neutral-800 p-3 {list ? 'text-amber-300' : 'text-neutral-500'}" onclick={() => list = true}><List size={18} /></button>
    <button type="button" aria-label={locale.t('prompt_studio.grid_view')} aria-pressed={!list} class="touch-target rounded-lg border border-neutral-800 p-3 {!list ? 'text-amber-300' : 'text-neutral-500'}" onclick={() => list = false}><Grid2X2 size={18} /></button>
    <input type="range" min="120" max="240" step="10" bind:value={size} aria-label={locale.t('prompt_studio.card_size')} class="w-20 accent-amber-400" />
    <button type="button" aria-label={locale.t('prompt_studio.show_previews')} aria-pressed={images} class="touch-target rounded-lg border border-neutral-800 p-3 {images ? 'text-amber-300' : 'text-neutral-500'}" onclick={() => images = !images}><Image size={18} /></button>
    <button type="button" disabled={!category || !customCatalog.ready} class="touch-target flex items-center gap-2 rounded-lg bg-amber-400 px-3 text-xs font-medium text-neutral-950 disabled:opacity-40" onclick={add}><Plus size={16} />{locale.t('prompt_studio.add_tag')}</button>
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pt-0">
    {#if category}
      <div class="grid gap-3" style:grid-template-columns={list ? 'minmax(0,1fr)' : `repeat(auto-fill, minmax(min(100%, ${size}px), 1fr))`}>
        <button type="button" disabled={!customCatalog.ready} class="touch-target flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-700 bg-neutral-900 text-xs text-neutral-400 hover:border-amber-400" onclick={add}><Plus size={24} />{locale.t('prompt_studio.add_tag')}</button>
        {#each entries as entry (entry.id)}
          {@const selected = studio.isChosen(entry.tag)}
          <article class="relative flex min-w-0 overflow-hidden rounded-xl border bg-neutral-900 {list ? 'items-center' : 'flex-col'} {selected ? 'border-amber-400 ring-1 ring-amber-400/30' : 'border-neutral-800'}">
            <button type="button" class="min-w-0 flex-1 text-left {list ? 'flex items-center gap-3 p-2' : ''}" onclick={() => studio.catalogEntryId = entry.id} aria-label={`${locale.t('common.edit')}: ${entry.name}`}>
              {#if images && entry.preview}<img src={entry.preview} alt="" class="object-cover {list ? 'h-14 w-20 shrink-0 rounded-lg' : 'h-24 w-full'}" />{:else if images}<div class="flex items-center justify-center bg-neutral-800/30 text-neutral-600 {list ? 'h-14 w-20 shrink-0 rounded-lg' : 'h-24'}"><Image size={24} /></div>{/if}
              <span class="block truncate px-3 py-3 pr-12 text-xs text-neutral-200" title={entry.tag}>{entry.name}</span>
            </button>
            <button type="button" aria-pressed={selected} aria-label={`${locale.t(selected ? 'prompt_studio.remove_tag' : 'prompt_studio.add_tag')}: ${entry.name}`} class="touch-target absolute right-1 bottom-1 flex items-center justify-center rounded-lg {selected ? 'bg-amber-400 text-neutral-950' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}" onclick={() => studio.choose(entry.tag, entry.name, entry.subId)}>{#if selected}<Check size={17} />{:else}<Plus size={17} />{/if}</button>
          </article>
        {/each}
      </div>
      {#if !entries.length}<p class="mt-4 text-xs text-neutral-500">{locale.t(query.trim() ? 'prompt_studio.nothing_found' : 'prompt_studio.blank_tags')}</p>{/if}
    {/if}
  </div>
</section>
{#if structure}<PromptStudioStructure {...structure} onClose={() => structure = undefined} />{/if}
