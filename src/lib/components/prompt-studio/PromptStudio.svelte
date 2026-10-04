<script lang="ts">
  import { userScopedKey } from '../../utils/ipc.js';
  import { onMount } from 'svelte';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { workspace, type StudioView, type GuidedMode } from '../../prompt-studio/workspace.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { gallery } from '../../stores/gallery.svelte.js';
  import PromptStudioSend from './PromptStudioSend.svelte';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import PromptStudioCollections from './PromptStudioCollections.svelte';
  import PromptStudioGuided from './PromptStudioGuided.svelte';
  import PromptStudioMixer from './PromptStudioMixer.svelte';
  import PromptStudioWriting from './PromptStudioWriting.svelte';
  import PromptStudioLibrary from './PromptStudioLibrary.svelte';
  import PromptStudioDraft from './PromptStudioDraft.svelte';
  import { ArrowRight, BookOpen, Layers3, PanelRight, PenLine, Redo2, SlidersHorizontal, Sparkles, Undo2 } from '@lucide/svelte';
  let { onApply, onClose }: { onApply?: () => void; onClose?: () => void } = $props();
  let sending = $state(false);
  const scope = $derived(userScopedKey('mooshie.prompt-studio.workspace'));
  $effect(() => { void scope; sending = false; });
  let buildView = $state(restoreTool('build', { view: 'parameters' }).view);
  $effect(() => { saveTool('build', { view: buildView }); });
  const views = [{ id: 'build' as StudioView, icon: Layers3 }, { id: 'mix' as StudioView, icon: SlidersHorizontal }, { id: 'editor' as StudioView, icon: PenLine }, { id: 'library' as StudioView, icon: BookOpen }];
  const guidedModes: GuidedMode[] = ['character', 'wardrobe', 'scene'];
  const canSend = $derived(!!studio.prompt.trim() && !studio.pendingConflict);
  $effect(() => { studio.load(); workspace.load(); void customCatalog.load(); });
  $effect(() => { if (customCatalog.ready) studio.ensureActive(); });
  async function copy() {
    try { await navigator.clipboard.writeText(studio.prompt); gallery.showToast(locale.t('prompt_studio.copied'), 'success'); }
    catch { gallery.showToast(locale.t('prompt_studio.v2.copy_failed'), 'error'); }
  }
  function apply() { if (canSend) sending = true; }
  function switchTab(event: KeyboardEvent) {
    const index = views.findIndex(view => view.id === workspace.view);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % views.length;
    else if (event.key === 'ArrowLeft') next = (index + views.length - 1) % views.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = views.length - 1;
    else return;
    event.preventDefault(); workspace.setView(views[next].id);
    document.getElementById(`studio-tab-${views[next].id}`)?.focus();
  }
  onMount(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) studio.redo(); else studio.undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); apply(); }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });
</script>
{#key scope}
<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-950 text-neutral-200 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-amber-400" data-testid="prompt-studio">
  <header class="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-3 sm:px-5">
    <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-300"><Sparkles size={19} /></div>
    <div class="min-w-0 flex-1"><h2 class="truncate text-sm font-semibold text-neutral-100">{locale.t('nav.prompt_studio')}</h2><p class="mt-0.5 truncate text-xs text-neutral-500">{studio.name || locale.t('prompt_studio.v2.subtitle')}</p></div>
    <div class="flex items-center gap-1">
      <button type="button" class="touch-target rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 disabled:opacity-30" disabled={!studio.history.length} aria-label={locale.t('prompt_studio.undo')} title={`${locale.t('prompt_studio.undo')} · Ctrl Z`} onclick={() => studio.undo()}><Undo2 size={17} /></button>
      <button type="button" class="touch-target rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 disabled:opacity-30" disabled={!studio.future.length} aria-label={locale.t('prompt_studio.redo')} title={`${locale.t('prompt_studio.redo')} · Ctrl Shift Z`} onclick={() => studio.redo()}><Redo2 size={17} /></button>
      <button type="button" class="touch-target ml-1 flex items-center gap-2 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300 xl:hidden" aria-label={locale.t('prompt_studio.v2.draft')} aria-pressed={workspace.mobileDraft} onclick={() => workspace.mobileDraft = !workspace.mobileDraft}><PanelRight size={16} /><span class="hidden sm:inline">{locale.t('prompt_studio.v2.draft')}</span><span class="tabular-nums">{studio.selected.length}</span></button>
      <button type="button" class="touch-target ml-2 flex items-center gap-2 rounded-lg bg-amber-400 px-3 text-xs font-semibold text-neutral-950 hover:bg-amber-300 disabled:opacity-35 sm:px-4" disabled={!canSend} onclick={apply}>{locale.t('prompt_studio.v2.send')}<ArrowRight size={16} /></button>
    </div>
  </header>
  <div class="flex shrink-0 items-center border-b border-neutral-800 px-3 sm:px-5">
    <div role="tablist" tabindex="-1" aria-label={locale.t('prompt_studio.v2.workspaces')} class="flex min-w-0 flex-1 gap-1 overflow-x-auto" onkeydown={switchTab}>
      {#each views as view (view.id)}
        {@const Icon = view.icon}
        <button type="button" id={`studio-tab-${view.id}`} role="tab" aria-selected={workspace.view === view.id} aria-controls="studio-workspace" tabindex={workspace.view === view.id ? 0 : -1} class="touch-target flex shrink-0 items-center gap-2 border-b-2 px-2 py-3 text-xs font-medium sm:px-4 {workspace.view === view.id ? 'border-amber-400 text-amber-300' : 'border-transparent text-neutral-500 hover:text-neutral-200'}" onclick={() => workspace.setView(view.id)}><span class="hidden sm:block"><Icon size={16} /></span>{locale.t(`prompt_studio.v2.view_${view.id}`)}</button>
      {/each}
    </div>
    <span class="ml-3 hidden text-[11px] text-neutral-500 sm:inline">{locale.t('prompt_studio.v2.local_draft')}</span>
  </div>
  {#if studio.storageError || customCatalog.storageError || workspace.storageError}<div role="alert" class="shrink-0 border-b border-amber-700/30 bg-amber-400/5 px-5 py-2 text-xs text-amber-300">{locale.t('prompt_studio.storage_error')}{#if !customCatalog.ready}<button type="button" class="touch-target ml-3 underline" onclick={() => void customCatalog.load()}>{locale.t('prompt_studio.retry')}</button>{/if}</div>{/if}
  <div class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
    <div id="studio-workspace" role="tabpanel" tabindex="0" aria-labelledby={`studio-tab-${workspace.view}`} class="min-h-0 min-w-0 flex-col overflow-hidden {workspace.mobileDraft ? 'hidden xl:flex' : 'flex'}">
      <div class="min-h-0 flex-1 flex-col {workspace.view === 'build' ? 'flex' : 'hidden'}">
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
          <div class="inline-flex gap-1 rounded-xl border border-neutral-800 bg-neutral-900 p-1" aria-label={locale.t('prompt_studio.v2.build_modes')}>
            {#each guidedModes as mode}<button type="button" class="touch-target rounded-lg px-4 text-xs {workspace.guidedMode === mode ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'}" aria-pressed={workspace.guidedMode === mode} onclick={() => workspace.setGuidedMode(mode)}>{locale.t(`prompt_studio.v2.mode_${mode}`)}</button>{/each}
          </div>
          <p class="text-xs text-neutral-500">{locale.t('prompt_studio.v2.build_hint')}</p>
        </div>
        <div class="flex shrink-0 gap-2 px-4 pt-3 sm:px-5"><button type="button" aria-pressed={buildView === 'parameters'} class="touch-target rounded-lg border border-neutral-800 px-3 text-xs {buildView === 'parameters' ? 'bg-neutral-800 text-amber-300' : 'text-neutral-400'}" onclick={() => buildView = 'parameters'}>{locale.t('prompt_studio.library.parameters')}</button><button type="button" aria-pressed={buildView === 'collections'} class="touch-target rounded-lg border border-neutral-800 px-3 text-xs {buildView === 'collections' ? 'bg-neutral-800 text-amber-300' : 'text-neutral-400'}" onclick={() => buildView = 'collections'}>{locale.t('prompt_studio.library.zone_collections')}</button></div>
        <div class="min-h-0 flex-1 p-4 sm:p-5"><div class="h-full {buildView === 'parameters' ? '' : 'hidden'}"><PromptStudioGuided mode={workspace.guidedMode} /></div>{#each guidedModes as mode}<div class="h-full {buildView === 'collections' && workspace.guidedMode === mode ? '' : 'hidden'}">{#if buildView === 'collections'}<PromptStudioCollections {mode} />{/if}</div>{/each}</div>
      </div>
      <div class="min-h-0 flex-1 p-4 sm:p-5 {workspace.view === 'mix' ? '' : 'hidden'}"><PromptStudioMixer /></div>
      <div class="min-h-0 flex-1 p-4 sm:p-5 {workspace.view === 'editor' ? '' : 'hidden'}"><PromptStudioWriting active={workspace.view === 'editor'} /></div>
      <div class="min-h-0 flex-1 p-3 sm:p-5 {workspace.view === 'library' ? '' : 'hidden'}"><PromptStudioLibrary active={workspace.view === 'library'} /></div>
    </div>
    <div class="min-h-0 min-w-0 flex-col overflow-hidden border-neutral-800 xl:border-l {workspace.mobileDraft ? 'flex' : 'hidden xl:flex'}"><PromptStudioDraft onApply={apply} onCopy={copy} /></div>
  </div>
</div>
{#if sending}<PromptStudioSend onCancel={() => sending = false} onDone={() => { sending = false; (onApply ?? onClose)?.(); }} />{/if}

{/key}
