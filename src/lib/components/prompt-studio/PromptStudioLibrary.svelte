<script lang="ts">
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import { workspace, type LibrarySection } from '../../prompt-studio/workspace.svelte.js';
  workspace.load();
  const initial = restoreTool('library', { management: false, tab: 'collections', showCategories: false });
  import { library } from '../../prompt-studio/library.svelte.js';
  import PromptStudioGlobalSets from './PromptStudioGlobalSets.svelte';
  import PromptStudioGlobalSet from './PromptStudioGlobalSet.svelte';
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
  const management = $derived(workspace.libraryManagement);
  $effect(() => { if (active) opened = true; });
  const tab = $derived(workspace.librarySection);
  let showCategories = $state(initial.showCategories);
  $effect(() => { saveTool('library', { showCategories }); });
  const sections: { id: LibrarySection; label: string }[] = [{ id: 'collections', label: 'prompt_studio.collections.title' }, { id: 'catalog', label: 'prompt_studio.v2.catalog' }, { id: 'sets', label: 'prompt_studio.v2.saved_sets' }, { id: 'sources', label: 'prompt_studio.v2.sources' }];
  function navigate(event: KeyboardEvent) {
    const index = sections.findIndex(section => section.id === tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % sections.length : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); workspace.setLibrarySection(sections[next].id);
    document.getElementById(`studio-library-${sections[next].id}`)?.focus();
  }
  let inspector = $state<HTMLDialogElement>();
  const editing = $derived(studio.catalogEntryId === 'new' || customCatalog.entries.some(entry => entry.id === studio.catalogEntryId));
  $effect(() => { if (inspector && editing && !inspector.open) inspector.showModal(); });
  function closeInspector() { inspector?.close(); studio.catalogEntryId = ''; }
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden" aria-label={locale.t('prompt_studio.v2.library')}>
  <header class="flex shrink-0 flex-wrap items-center gap-3">
    <div class="inline-flex max-w-full flex-wrap rounded-xl border border-neutral-800 bg-neutral-900 p-1" aria-label={locale.t('prompt_studio.polish.library_context')}><button type="button" aria-pressed={!management} onclick={() => workspace.setLibraryManagement(false)} class="touch-target rounded-lg px-3 text-xs {!management ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400'}">{locale.t('prompt_studio.library.work')}</button><button type="button" aria-pressed={management} onclick={() => workspace.setLibraryManagement(true)} class="touch-target rounded-lg px-3 text-xs {management ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400'}">{locale.t('prompt_studio.library.manage')}</button></div>
    <p class="min-w-40 flex-1 text-xs leading-relaxed text-neutral-400">{locale.t(management ? 'prompt_studio.polish.manage_hint' : 'prompt_studio.polish.compose_hint')}</p>
  </header>
  <div role="tablist" tabindex="-1" onkeydown={navigate} aria-label={locale.t('prompt_studio.v2.library_sections')} class="grid shrink-0 grid-cols-2 items-stretch gap-1 border-b border-neutral-800 sm:flex sm:flex-wrap sm:items-center">
    {#each sections as section}<button type="button" id={`studio-library-${section.id}`} role="tab" aria-selected={tab === section.id} aria-controls="studio-library-panel" tabindex={tab === section.id ? 0 : -1} class="touch-target flex min-w-0 items-center justify-center gap-2 border-b-2 px-3 sm:justify-start text-xs {tab === section.id ? 'border-amber-400 text-amber-300' : 'border-transparent text-neutral-400 hover:text-neutral-200'}" onclick={() => workspace.setLibrarySection(section.id)}>{locale.t(section.label)}{#if section.id === 'catalog'}<span aria-hidden="true" class="rounded bg-neutral-900 px-1.5 py-0.5 text-xs tabular-nums text-neutral-500">{locale.formatInteger(customCatalog.entries.length)}</span>{/if}</button>{/each}
    {#if tab === 'catalog'}<button type="button" aria-pressed={showCategories} aria-label={locale.t('prompt_studio.v2.toggle_categories')} class="touch-target ml-auto rounded-lg p-3 text-neutral-400 sm:hidden" onclick={() => showCategories = !showCategories}><PanelLeft size={17} /></button>{/if}
  </div>
  <div id="studio-library-panel" role="tabpanel" tabindex="0" aria-labelledby={`studio-library-${tab}`} class="flex min-h-0 flex-1 flex-col gap-3">
  {#if tab === 'collections'}
    <div class="min-h-0 flex-1">{#if opened}<PromptStudioCollections {management} />{/if}</div>
  {:else if tab === 'catalog'}
    {#if management}<div class="flex shrink-0 flex-wrap gap-2"><button type="button" class="touch-target rounded-lg bg-amber-400 px-3 text-xs text-neutral-950" onclick={() => { library.newSetDraft = undefined; library.editingSet = ''; }}>{locale.t('prompt_studio.library.new_set')}</button>{#if studio.currentCategory}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300" onclick={() => library.editingSet = studio.activeCategoryId}>{locale.t('prompt_studio.library.edit_global')}</button>{/if}</div>{:else}<details class="shrink-0"><summary class="touch-target cursor-pointer text-xs text-neutral-400">{locale.t('prompt_studio.library.global_sets')}</summary><PromptStudioGlobalSets activeOnly={true} /></details>{/if}
    <div class="grid min-h-0 flex-1 gap-3 overflow-hidden {showCategories ? 'grid-rows-[minmax(120px,35%)_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]'} sm:grid-rows-[minmax(0,1fr)] sm:grid-cols-[160px_minmax(0,1fr)] 2xl:grid-cols-[180px_minmax(0,1fr)]">
      <div class="min-h-0 min-w-0 {showCategories ? '' : 'hidden sm:block'}"><PromptStudioRail {management} /></div>
      <div class="min-h-0 min-w-0"><PromptStudioEditor {management} /></div>
      {#if management && editing}
        <dialog bind:this={inspector} oncancel={closeInspector} aria-label={locale.t('prompt_studio.v2.edit_tag')} class="fixed inset-0 m-auto h-[min(800px,90dvh)] max-h-[90dvh] w-[min(420px,calc(100%_-_24px))] flex-col rounded-2xl border border-neutral-700 bg-neutral-950 p-2 text-neutral-200 shadow-2xl backdrop:bg-black/70 open:flex">
          <header class="mb-2 flex shrink-0 items-center justify-between px-2"><h3 class="text-xs font-medium text-neutral-300">{locale.t('prompt_studio.v2.edit_tag')}</h3><button type="button" aria-label={locale.t('prompt_studio.v2.close_inspector')} class="touch-target rounded-lg p-2 text-neutral-400" onclick={closeInspector}><X size={17} /></button></header>
          <div class="min-h-0 flex-1"><PromptStudioCustomCatalog /></div>
        </dialog>
      {/if}
    </div>
  {:else}
    <div class="min-h-0 flex-1"><PromptStudioSources view={tab === 'sets' ? 'sets' : 'sources'} {management} /></div>
  {/if}
  </div>
</section>
{#if library.editingSet !== undefined}<PromptStudioGlobalSet />{/if}
