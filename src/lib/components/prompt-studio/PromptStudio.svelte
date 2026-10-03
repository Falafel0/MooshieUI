<script lang="ts">
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { gallery } from '../../stores/gallery.svelte.js';
  import PromptStudioPromptArea from './PromptStudioPromptArea.svelte';
  import PromptStudioSend from './PromptStudioSend.svelte';
  import PromptStudioRail from './PromptStudioRail.svelte';
  import PromptStudioEditor from './PromptStudioEditor.svelte';
  import PromptStudioCustomCatalog from './PromptStudioCustomCatalog.svelte';
  import { Redo2, Undo2 } from '@lucide/svelte';
  let { onApply, onClose }: { onApply?: () => void; onClose?: () => void } = $props();
  let sending = $state(false);
  let panel = $state<'catalog' | 'tags'>('catalog');
  $effect(() => { studio.load(); void customCatalog.load(); });
  $effect(() => { if (customCatalog.ready) studio.ensureActive(); });
  async function copy() {
    try { await navigator.clipboard.writeText(studio.prompt); gallery.showToast(locale.t('prompt_studio.copied'), 'success'); }
    catch (error) { gallery.showToast(String(error), 'error'); }
  }
</script>
<div class="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden bg-neutral-950 p-2 text-neutral-100 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-amber-400">
  <header class="flex shrink-0 items-center gap-3 px-1">
    <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-300">{locale.t('nav.prompt_studio')}</h2>
    <button type="button" class="touch-target rounded-lg p-2 text-neutral-400 disabled:opacity-30" disabled={!studio.history.length} aria-label={locale.t('prompt_studio.undo')} onclick={() => studio.undo()}><Undo2 size={16} /></button>
    <button type="button" class="touch-target rounded-lg p-2 text-neutral-400 disabled:opacity-30" disabled={!studio.future.length} aria-label={locale.t('prompt_studio.redo')} onclick={() => studio.redo()}><Redo2 size={16} /></button>
    <button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-400 xl:hidden" onclick={() => panel = panel === 'catalog' ? 'tags' : 'catalog'}>{locale.t(panel === 'catalog' ? 'prompt_studio.selected_tags' : 'prompt_studio.custom_catalog')}</button>
  </header>
  {#if studio.storageError || customCatalog.storageError}<div role="alert" class="shrink-0 rounded border border-amber-700/40 p-2 text-xs text-amber-300">{locale.t('prompt_studio.storage_error')}{#if !customCatalog.ready}<button type="button" class="touch-target ml-3 underline" onclick={() => void customCatalog.load()}>{locale.t('prompt_studio.retry')}</button>{/if}</div>{/if}
  <div class="grid min-h-0 flex-1 gap-2 overflow-hidden grid-cols-[minmax(120px,180px)_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_300px]">
    <PromptStudioRail />
    <div class="min-h-0 min-w-0 flex-col overflow-hidden {panel === 'catalog' ? 'flex' : 'hidden xl:flex'}">
      <div class="min-h-0 flex-1"><PromptStudioEditor /></div>
      <PromptStudioPromptArea onApply={() => { if (studio.prompt.trim()) sending = true; }} onCopy={copy} />
    </div>
    <div class="min-h-0 min-w-0 {panel === 'tags' || studio.catalogEntryId ? '' : 'hidden xl:block'} {panel === 'catalog' && studio.catalogEntryId ? 'fixed inset-4 z-40 overflow-auto rounded-xl bg-neutral-950 shadow-2xl xl:static xl:z-auto xl:shadow-none' : ''}"><PromptStudioCustomCatalog /></div>
  </div>
</div>
{#if sending}<PromptStudioSend onCancel={() => sending = false} onDone={() => { sending = false; (onApply ?? onClose)?.(); }} />{/if}
