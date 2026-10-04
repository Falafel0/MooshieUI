<script lang="ts">
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import PromptStudioCollections from './PromptStudioCollections.svelte';
  import PromptStudioRail from './PromptStudioRail.svelte';
  import PromptStudioEditor from './PromptStudioEditor.svelte';
  import PromptStudioCustomCatalog from './PromptStudioCustomCatalog.svelte';
  import PromptStudioSources from './PromptStudioSources.svelte';
  import { Library, FolderOpen, Save, PanelLeft, X } from '@lucide/svelte';
  let { active = true }: { active?: boolean } = $props();
  let opened = $state(false);
  $effect(() => { if (active) opened = true; });
  let tab = $state<'collections' | 'catalog' | 'sets' | 'sources'>('collections');
  let showCategories = $state(false);
  let inspector = $state<HTMLDialogElement>();
  const editing = $derived(studio.catalogEntryId === 'new' || customCatalog.entries.some(entry => entry.id === studio.catalogEntryId));
  $effect(() => { if (inspector && editing && !inspector.open) inspector.showModal(); });
  function closeInspector() { inspector?.close(); studio.catalogEntryId = ''; }
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden" aria-label={locale.t('prompt_studio.v2.library')}>
  <nav aria-label={locale.t('prompt_studio.v2.library_sections')} class="flex shrink-0 flex-wrap items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-950 p-1">
    <button type="button" aria-pressed={tab === 'collections'} class="touch-target rounded-lg px-3 text-xs {tab === 'collections' ? 'bg-neutral-800 text-amber-300' : 'text-neutral-400 hover:text-neutral-200'}" onclick={() => tab = 'collections'}>{locale.t('prompt_studio.collections.title')}</button>
    <button type="button" aria-pressed={tab === 'catalog'} class="touch-target flex items-center gap-2 rounded-lg px-3 text-xs {tab === 'catalog' ? 'bg-neutral-800 text-amber-300' : 'text-neutral-400 hover:text-neutral-200'}" onclick={() => tab = 'catalog'}><Library size={16} />{locale.t('prompt_studio.v2.catalog')}<span class="rounded-md bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-500">{locale.formatInteger(customCatalog.entries.length)}</span></button>
    <button type="button" aria-pressed={tab === 'sets'} class="touch-target flex items-center gap-2 rounded-lg px-3 text-xs {tab === 'sets' ? 'bg-neutral-800 text-amber-300' : 'text-neutral-400 hover:text-neutral-200'}" onclick={() => tab = 'sets'}><Save size={16} />{locale.t('prompt_studio.v2.saved_sets')}</button>
    <button type="button" aria-pressed={tab === 'sources'} class="touch-target flex items-center gap-2 rounded-lg px-3 text-xs {tab === 'sources' ? 'bg-neutral-800 text-amber-300' : 'text-neutral-400 hover:text-neutral-200'}" onclick={() => tab = 'sources'}><FolderOpen size={16} />{locale.t('prompt_studio.v2.sources')}</button>
    {#if tab === 'catalog'}<button type="button" aria-pressed={showCategories} aria-label={locale.t('prompt_studio.v2.toggle_categories')} class="touch-target ml-auto rounded-lg p-3 text-neutral-400 sm:hidden" onclick={() => showCategories = !showCategories}><PanelLeft size={17} /></button>{/if}
  </nav>
  {#if tab === 'collections'}
    <div class="min-h-0 flex-1">{#if opened}<PromptStudioCollections />{/if}</div>
  {:else if tab === 'catalog'}
    <div class="grid min-h-0 flex-1 gap-3 overflow-hidden {showCategories ? 'grid-rows-[minmax(120px,35%)_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]'} sm:grid-rows-[minmax(0,1fr)] sm:grid-cols-[160px_minmax(0,1fr)] 2xl:grid-cols-[180px_minmax(0,1fr)]">
      <div class="min-h-0 min-w-0 {showCategories ? '' : 'hidden sm:block'}"><PromptStudioRail showTransfers={false} /></div>
      <div class="min-h-0 min-w-0"><PromptStudioEditor /></div>
      {#if editing}
        <dialog bind:this={inspector} oncancel={closeInspector} aria-label={locale.t('prompt_studio.v2.edit_tag')} class="fixed inset-0 m-auto h-[min(800px,90dvh)] max-h-[90dvh] w-[min(420px,calc(100%_-_24px))] flex-col rounded-2xl border border-neutral-700 bg-neutral-950 p-2 text-neutral-200 shadow-2xl backdrop:bg-black/70 open:flex">
          <header class="mb-2 flex shrink-0 items-center justify-between px-2"><h3 class="text-xs font-medium text-neutral-300">{locale.t('prompt_studio.v2.edit_tag')}</h3><button type="button" aria-label={locale.t('prompt_studio.v2.close_inspector')} class="touch-target rounded-lg p-2 text-neutral-400" onclick={closeInspector}><X size={17} /></button></header>
          <div class="min-h-0 flex-1"><PromptStudioCustomCatalog showSelection={false} /></div>
        </dialog>
      {/if}
    </div>
  {:else}
    <div class="min-h-0 flex-1"><PromptStudioSources view={tab === 'sets' ? 'sets' : 'sources'} /></div>
  {/if}
</section>
