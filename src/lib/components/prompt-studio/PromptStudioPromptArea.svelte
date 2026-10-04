<script lang="ts">
  import PromptBlockImport from "../generation/PromptBlockImport.svelte";
  import PromptTextarea from '../generation/PromptTextarea.svelte';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { promptPresets, inlineChunkToken, type PromptPreset } from '../../stores/promptPresets.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { insertPrompt } from '../../prompt-studio/insertion.js';
  import { ArrowUp, ArrowDown, Copy, CopyPlus, Trash2 } from '@lucide/svelte';
  let { onApply, onCopy }: { onApply: () => void; onCopy: () => void } = $props();
  const initial = restoreTool('prompt-panel', { active: '', chunksOpen: false, chunkQuery: '', chunkName: '', chunkId: '', chunkContent: '', showPreview: false });
  let active = $state(initial.active);
  let importing = $state(false);
  let chunksOpen = $state(initial.chunksOpen);
  let chunkQuery = $state(initial.chunkQuery);
  const savedChunks = $derived(promptPresets.presets.filter(preset => `${preset.name} ${preset.content}`.toLowerCase().includes(chunkQuery.toLowerCase())));
  let chunkName = $state(initial.chunkName);
  let chunkId = $state(initial.chunkId);
  let chunkContent = $state(initial.chunkContent);
  let showPreview = $state(initial.showPreview);
  $effect(() => { saveTool('prompt-panel', { active, chunksOpen, chunkQuery, chunkName, chunkId, chunkContent, showPreview }); });
  const group = $derived(studio.groups.find(group => group.id === active));
  const content = $derived(group?.content ?? studio.basePrompt);
  const canSaveChunk = $derived(chunkName.trim() && chunkContent.trim() && !promptPresets.presets.some(p => p.id !== chunkId && p.name.toLowerCase() === chunkName.trim().toLowerCase()));
  $effect(() => { if (active && !group) active = ''; });
  function edit(text: string) { if (group) studio.updateGroup(group.id, { content: text }); else studio.editPrompt(text); }
  function saveChunk() {
    if (!canSaveChunk) return;
    if (chunkId) promptPresets.update(chunkId, { name: chunkName.trim(), content: chunkContent.trim() });
    else promptPresets.create(chunkName.trim(), chunkContent.trim());
    chunkId = ''; chunkName = ''; chunkContent = '';
  }
  function insertChunk(preset: PromptPreset) { edit(insertPrompt(content, inlineChunkToken(preset.name, preset.id), 'append')); }
</script>

<section class="max-h-[45dvh] shrink-0 overflow-y-auto border-t border-neutral-800 bg-neutral-900 p-3" aria-label={locale.t('prompt_studio.prompt_editor')}>
  <div class="mb-2 flex flex-wrap items-center gap-2">
    <nav class="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label={locale.t('prompt_studio.prompt_groups')}>
      <button type="button" aria-pressed={!group} class="touch-target shrink-0 rounded-lg px-3 py-2 text-xs {!group ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800'}" onclick={() => active = ''}>{locale.t('prompt_studio.v2.draft')}</button>
      {#each studio.groups as item (item.id)}
        <button type="button" aria-pressed={active === item.id} class="touch-target max-w-40 shrink-0 truncate rounded-lg px-3 py-2 text-xs {active === item.id ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800'} {item.enabled ? '' : 'opacity-50'}" onclick={() => active = item.id}>{item.name || locale.t('prompt_studio.group_name')}</button>
      {/each}
    </nav>
    <button type="button" class="touch-target rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" disabled={!studio.prompt.trim()} onclick={onCopy} aria-label={locale.t('prompt_studio.copy')}><Copy size={16} /></button>
    <button type="button" class="touch-target rounded-lg bg-amber-400 px-4 py-2 text-xs font-medium text-neutral-950 disabled:opacity-40" disabled={!studio.prompt.trim() || !!studio.pendingConflict} onclick={onApply}>{locale.t('prompt_studio.apply')}</button>
  </div>
  {#if group}
    <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
      <input class="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-200" value={group.name} aria-label={locale.t('prompt_studio.group_name')} onchange={event => studio.updateGroup(group!.id, { name: event.currentTarget.value })} />
      <label class="flex items-center gap-2"><input type="checkbox" checked={group.enabled} onchange={event => studio.updateGroup(group!.id, { enabled: event.currentTarget.checked })} />{locale.t('prompt_studio.group_enabled')}</label>
      <button type="button" class="touch-target rounded p-2 disabled:opacity-30" disabled={studio.groups[0]?.id === group.id} aria-label={locale.t('prompt_studio.group_up')} onclick={() => studio.moveGroup(group!.id, -1)}><ArrowUp size={16} /></button>
      <button type="button" class="touch-target rounded p-2 disabled:opacity-30" disabled={studio.groups.at(-1)?.id === group.id} aria-label={locale.t('prompt_studio.group_down')} onclick={() => studio.moveGroup(group!.id, 1)}><ArrowDown size={16} /></button>
      <button type="button" class="touch-target rounded p-2 hover:text-neutral-200" aria-label={locale.t('common.duplicate')} title={locale.t('common.duplicate')} onclick={() => active = studio.duplicateGroup(group!.id) ?? active}><CopyPlus size={16} /></button>
      <button type="button" class="touch-target rounded p-2 hover:text-red-300" aria-label={locale.t('prompt_studio.remove')} onclick={() => studio.removeGroup(group!.id)}><Trash2 size={16} /></button>
    </div>
  {:else if studio.rawPrompt !== undefined}
    <div class="mb-2 flex items-center gap-3 text-xs text-amber-300">
      <p class="flex-1">{locale.t('prompt_studio.manual_prompt_hint')}</p>
      <button type="button" class="touch-target shrink-0 rounded border border-neutral-700 px-2 py-1 text-neutral-300" onclick={() => studio.editPrompt(undefined)}>{locale.t('prompt_studio.return_constructor')}</button>
    </div>
  {/if}
  {#key active}
    <PromptTextarea bind:value={() => content, value => edit(value)} rows={3} minHeight="min-h-24" storageKey={`studio-prompt-${active || 'base'}`} placeholder={locale.t('generation.prompts.positive_placeholder')} />
  {/key}
  <div class="mt-1 flex flex-wrap items-start gap-x-4">
  <details class="min-w-0 flex-1">
    <summary class="touch-target flex cursor-pointer items-center text-xs text-neutral-400">{locale.t('prompt_studio.prompt_helpers')}</summary>
    <div class="flex flex-wrap gap-2 pb-2">
    <button type="button" disabled={!content.trim()} class="touch-target rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" onclick={() => { chunkId = ''; chunkName = ''; chunkContent = content; chunksOpen = true; }}>{locale.t('prompt_studio.save_chunk')}</button>
      <button type="button" class="touch-target rounded-lg bg-neutral-800 px-3 py-2 text-xs text-neutral-300" onclick={() => active = studio.addGroup(locale.t('prompt_studio.group_name'))}>+ {locale.t('prompt_studio.prompt_groups')}</button>
      <button type="button" class="touch-target rounded-lg bg-neutral-800 px-3 py-2 text-xs text-neutral-300" onclick={() => importing = true}>{locale.t('prompt_studio.import_blocks')}</button>
      <button type="button" aria-expanded={chunksOpen} class="touch-target rounded-lg bg-neutral-800 px-3 py-2 text-xs text-neutral-300" onclick={() => chunksOpen = !chunksOpen}>{locale.t('prompt_studio.macros')}</button>
      {#if studio.groups.length}
        <button type="button" disabled={studio.groups.every(group => group.enabled)} class="touch-target rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" onclick={() => studio.setGroupsEnabled(true)}>{locale.t('prompt_studio.groups_enable_all')}</button>
        <button type="button" disabled={studio.groups.every(group => !group.enabled)} class="touch-target rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" onclick={() => studio.setGroupsEnabled(false)}>{locale.t('prompt_studio.groups_disable_all')}</button>
      {/if}
    </div>
  </details>
  <button type="button" class="touch-target mt-1 text-xs text-neutral-400" aria-expanded={showPreview} onclick={() => showPreview = !showPreview}>{locale.t('prompt_studio.combined_preview')} · {studio.groups.filter(group => group.enabled).length} {locale.t('prompt_studio.prompt_groups')}</button>
  </div>
  {#if showPreview}<p class="mt-2 whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed text-neutral-300">{studio.prompt}</p>{/if}
  {#if chunksOpen}
    <div class="mt-3 grid gap-3 border-t border-neutral-800 pt-3 md:grid-cols-2">
      <div class="flex flex-col gap-2">
        <p class="text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.macros_hint')}</p>
        <input aria-label={locale.t('prompt_studio.search_macros')} placeholder={locale.t('prompt_studio.search_macros')} bind:value={chunkQuery} class="rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" />
        {#each savedChunks as preset (preset.id)}
          <div class="flex min-w-0 gap-2">
            <button type="button" class="touch-target min-w-0 flex-1 truncate rounded border border-neutral-700 px-3 py-2 text-left text-xs text-amber-300" title={preset.content} onclick={() => insertChunk(preset)}>{inlineChunkToken(preset.name)}</button>
            <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-400" onclick={() => { chunkId = preset.id; chunkName = preset.name; chunkContent = preset.content; }}>{locale.t('common.edit')}</button>
            <button type="button" class="touch-target rounded p-2 text-neutral-500 hover:text-red-300" aria-label={locale.t('common.remove')} onclick={() => { promptPresets.remove(preset.id); if (chunkId === preset.id) { chunkId = ''; chunkName = ''; chunkContent = ''; } }}><Trash2 size={14} /></button>
          </div>
        {/each}
      </div>
      <div class="flex flex-col gap-2">
        <input aria-label={locale.t('prompt_studio.macro_name')} placeholder={locale.t('prompt_studio.macro_name')} bind:value={chunkName} class="rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" />
        <PromptTextarea bind:value={chunkContent} rows={2} minHeight="min-h-20" placeholder={locale.t('prompt_studio.macro_content')} />
        <div class="flex gap-2">
          <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => chunkContent = content}>{locale.t('prompt_studio.macro_from_group')}</button>
          <button type="button" disabled={!canSaveChunk} class="touch-target rounded bg-amber-400 px-3 py-2 text-xs text-neutral-950 disabled:opacity-40" onclick={saveChunk}>{locale.t('common.save')}</button>
          {#if chunkId}<button type="button" class="touch-target px-2 py-1 text-xs text-neutral-400" onclick={() => { chunkId = ''; chunkName = ''; chunkContent = ''; }}>{locale.t('common.cancel')}</button>{/if}
        </div>
      </div>
    </div>
  {/if}
</section>

{#if importing}<PromptBlockImport onClose={() => importing = false} onImport={blocks => { studio.importGroups(blocks.map((block, index) => ({ ...block, name: block.name || `${locale.t('prompt_studio.group_name')} ${index + 1}` }))); active = studio.groups.at(-1)?.id ?? ''; importing = false; }} />{/if}
