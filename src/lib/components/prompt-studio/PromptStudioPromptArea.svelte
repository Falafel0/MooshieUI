<script lang="ts">
  import PromptBlockImport from "../generation/PromptBlockImport.svelte";
  import PromptStudioArena from './PromptStudioArena.svelte';
  import PromptTextarea from '../generation/PromptTextarea.svelte';
  import { workspace } from '../../prompt-studio/workspace.svelte.js';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { promptPresets, inlineChunkToken, type PromptPreset } from '../../stores/promptPresets.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { insertPrompt } from '../../prompt-studio/insertion.js';
  import { estimatePromptTokens } from '../../utils/promptTokens.js';
  import { ArrowUp, ArrowDown, CopyPlus, Trash2 } from '@lucide/svelte';
  let { previewOnly = false, large = false }: { previewOnly?: boolean; large?: boolean } = $props();
  // Restore prompt groups before validating the persisted active chunk.
  studio.load(); workspace.load();
  const initial = restoreTool('prompt-panel', { active: '', chunksOpen: false, chunkQuery: '', chunkName: '', chunkId: '', chunkContent: '', showPreview: false, helpers: false });
  let helpers = $state(initial.helpers);
  const active = $derived(workspace.draftPart);
  let importing = $state(false);
  let chunksOpen = $state(initial.chunksOpen);
  let chunkQuery = $state(initial.chunkQuery);
  const savedChunks = $derived(promptPresets.presets.filter(preset => `${preset.name} ${preset.content}`.toLowerCase().includes(chunkQuery.toLowerCase())));
  let chunkName = $state(initial.chunkName);
  let chunkId = $state(initial.chunkId);
  let chunkContent = $state(initial.chunkContent);
  $effect(() => { if (!previewOnly) saveTool('prompt-panel', { chunksOpen, chunkQuery, chunkName, chunkId, chunkContent, helpers }); });
  const group = $derived(studio.groups.find(group => `chunk:${group.id}` === active));
  const content = $derived(active === 'output' ? studio.prompt : group?.content ?? studio.basePrompt);
  const canSaveChunk = $derived(chunkName.trim() && chunkContent.trim() && !promptPresets.presets.some(p => p.id !== chunkId && p.name.toLowerCase() === chunkName.trim().toLowerCase()));
  $effect(() => { if (active.startsWith('chunk:') && !group) workspace.setDraftPart('base'); });
  function edit(text: string) { if (active === 'output') return; if (group) studio.updateGroup(group.id, { content: text }); else studio.editPrompt(text); }
  function saveChunk() {
    if (!canSaveChunk) return;
    if (chunkId) promptPresets.update(chunkId, { name: chunkName.trim(), content: chunkContent.trim() });
    else promptPresets.create(chunkName.trim(), chunkContent.trim());
    chunkId = ''; chunkName = ''; chunkContent = '';
  }
  function insertChunk(preset: PromptPreset) { edit(insertPrompt(content, inlineChunkToken(preset.name, preset.id), 'append')); }
</script>

<section class="shrink-0 border-t border-ui-border bg-ui-surface p-3" aria-label={locale.t(previewOnly ? 'prompt_studio.combined_preview' : 'prompt_studio.prompt_editor')}>
  <div class="mb-2 flex items-center justify-between gap-2">
    <h3 class="text-xs font-medium text-neutral-300">{locale.t('prompt_studio.combined_preview')}</h3>
    <span class="ml-auto text-[11px] tabular-nums text-neutral-500" title={locale.t('generation.prompt.tokens_tip')}>≈ {estimatePromptTokens(studio.prompt)} {locale.t('generation.prompt.tokens')}</span>
    {#if !previewOnly}<button type="button" class="ui-focus rounded px-2 py-1 text-xs text-neutral-500 hover:text-red-300 disabled:opacity-30" disabled={!studio.prompt.trim()} title={`${locale.t('prompt_studio.clear_prompt')} · Ctrl Z`} onclick={() => studio.clearPrompt()}>{locale.t('prompt_studio.clear_prompt')}</button>{/if}
  </div>
  <p class="mb-3 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.polish.output_summary', { count: studio.groups.filter(group => group.enabled).length })}</p>
  <PromptStudioArena readonly={previewOnly} {large} />
  {#if !previewOnly}
  <details open={helpers} class="mt-2 min-w-0">
    <summary onclick={event => { event.preventDefault(); helpers = !helpers; }} class="ui-control flex cursor-pointer items-center text-xs text-neutral-400">{locale.t('prompt_studio.polish.chunk_tools')}</summary>
  <label class="mb-3 flex flex-col gap-2 text-xs text-neutral-400">{locale.t('prompt_studio.polish.edit_part')}
    <select aria-label={locale.t('prompt_studio.polish.edit_part')} value={active} onchange={event => workspace.setDraftPart(event.currentTarget.value)} class="ui-control w-full min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-200">
      <option value="base">{locale.t('prompt_studio.main_prompt')}</option><option value="output">{locale.t('prompt_studio.combined_preview')}</option>
      {#each studio.groups as item (item.id)}<option value={`chunk:${item.id}`}>{item.name || locale.t('prompt_studio.library.chunk_name')}{item.enabled ? '' : ` · ${locale.t('prompt_studio.polish.disabled_chunk')}`}</option>{/each}
    </select>
  </label>
  <p class="mb-3 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.polish.output_summary', { count: studio.groups.filter(group => group.enabled).length })}</p>
  {#if group}
    <label class="mb-2 block text-xs text-neutral-400">{locale.t('prompt_studio.macro_content')}<textarea rows={3} value={group.content} onchange={event => studio.updateGroup(group!.id, { content: event.currentTarget.value })} class="mt-1 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-sm text-neutral-200"></textarea></label>
    <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
      <input class="ui-control min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-200" value={group.name} aria-label={locale.t('prompt_studio.library.chunk_name')} onchange={event => studio.updateGroup(group!.id, { name: event.currentTarget.value })} />
      <label class="flex items-center gap-2"><input type="checkbox" checked={group.enabled} onchange={event => studio.updateGroup(group!.id, { enabled: event.currentTarget.checked })} />{locale.t('prompt_studio.group_enabled')}</label>
      <button type="button" class="ui-control rounded p-2 disabled:opacity-30" disabled={studio.groups[0]?.id === group.id} aria-label={locale.t('prompt_studio.group_up')} onclick={() => studio.moveGroup(group!.id, -1)}><ArrowUp size={16} /></button>
      <button type="button" class="ui-control rounded p-2 disabled:opacity-30" disabled={studio.groups.at(-1)?.id === group.id} aria-label={locale.t('prompt_studio.group_down')} onclick={() => studio.moveGroup(group!.id, 1)}><ArrowDown size={16} /></button>
      <button type="button" class="ui-control rounded p-2 hover:text-neutral-200" aria-label={locale.t('common.duplicate')} title={locale.t('common.duplicate')} onclick={() => { const id = studio.duplicateGroup(group!.id); if (id) workspace.setDraftPart(`chunk:${id}`); }}><CopyPlus size={16} /></button>
      <button type="button" class="ui-control rounded p-2 hover:text-red-300" aria-label={locale.t('prompt_studio.remove')} onclick={() => studio.removeGroup(group!.id)}><Trash2 size={16} /></button>
    </div>
  {:else if active === 'base' && studio.rawPrompt !== undefined}
    <div class="mb-2 flex items-center gap-3 text-xs text-indigo-300">
      <p class="flex-1">{locale.t('prompt_studio.manual_prompt_hint')}</p>
      <button type="button" class="ui-control shrink-0 rounded border border-neutral-700 px-2 py-1 text-neutral-300" onclick={() => studio.editPrompt(undefined)}>{locale.t('prompt_studio.return_constructor')}</button>
    </div>
  {/if}
    <div class="flex flex-wrap gap-2 pb-2">
      {#if studio.rawPrompt === undefined}
      <label class="w-full text-xs text-neutral-400">{locale.t('prompt_studio.polish.prefix')}<input value={studio.prefix} onchange={event => studio.editText('prefix', event.currentTarget.value)} class="ui-control mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-neutral-200" /></label>
      <label class="w-full text-xs text-neutral-400">{locale.t('prompt_studio.polish.suffix')}<input value={studio.suffix} onchange={event => studio.editText('suffix', event.currentTarget.value)} class="ui-control mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-neutral-200" /></label>
      {/if}

    <button type="button" disabled={!content.trim() || active === 'output'} class="ui-control rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" onclick={() => { chunkId = ''; chunkName = ''; chunkContent = content; chunksOpen = true; }}>{locale.t('prompt_studio.save_chunk')}</button>
      <button type="button" class="ui-control rounded-lg bg-neutral-800 px-3 py-2 text-xs text-neutral-300" onclick={() => workspace.setDraftPart(`chunk:${studio.addGroup(locale.t('prompt_studio.library.chunk_name'))}`)}>+ {locale.t('prompt_studio.prompt_groups')}</button>
      <button type="button" class="ui-control rounded-lg bg-neutral-800 px-3 py-2 text-xs text-neutral-300" onclick={() => importing = true}>{locale.t('prompt_studio.library.import_chunks')}</button>
      <button type="button" aria-expanded={chunksOpen} class="ui-control rounded-lg bg-neutral-800 px-3 py-2 text-xs text-neutral-300" onclick={() => chunksOpen = !chunksOpen}>{locale.t('prompt_studio.macros')}</button>
      {#if studio.groups.length}
        <button type="button" disabled={studio.groups.every(group => group.enabled)} class="ui-control rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" onclick={() => studio.setGroupsEnabled(true)}>{locale.t('prompt_studio.groups_enable_all')}</button>
        <button type="button" disabled={studio.groups.every(group => !group.enabled)} class="ui-control rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" onclick={() => studio.setGroupsEnabled(false)}>{locale.t('prompt_studio.groups_disable_all')}</button>
      {/if}
    </div>
  {#if chunksOpen}
    <div class="mt-3 grid gap-3 border-t border-neutral-800 pt-3">
      <div class="flex flex-col gap-2">
        <p class="text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.macros_hint')}</p>
        <input aria-label={locale.t('prompt_studio.search_macros')} placeholder={locale.t('prompt_studio.search_macros')} bind:value={chunkQuery} class="rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" />
        {#each savedChunks as preset (preset.id)}
          <div class="flex min-w-0 gap-2">
            <button type="button" class="ui-control min-w-0 flex-1 truncate rounded border border-neutral-700 px-3 py-2 text-left text-xs text-indigo-300" title={preset.content} disabled={active === 'output'} onclick={() => insertChunk(preset)}>{inlineChunkToken(preset.name)}</button>
            <button type="button" class="ui-control rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-400" onclick={() => { chunkId = preset.id; chunkName = preset.name; chunkContent = preset.content; }}>{locale.t('common.edit')}</button>
            <button type="button" class="ui-control rounded p-2 text-neutral-500 hover:text-red-300" aria-label={locale.t('common.remove')} onclick={() => { promptPresets.remove(preset.id); if (chunkId === preset.id) { chunkId = ''; chunkName = ''; chunkContent = ''; } }}><Trash2 size={14} /></button>
          </div>
        {/each}
      </div>
      <div class="flex flex-col gap-2">
        <input aria-label={locale.t('prompt_studio.macro_name')} placeholder={locale.t('prompt_studio.macro_name')} bind:value={chunkName} class="rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" />
        <PromptTextarea bind:value={chunkContent} rows={2} minHeight="min-h-20" placeholder={locale.t('prompt_studio.macro_content')} />
        <div class="flex gap-2">
          <button type="button" class="ui-control rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => chunkContent = content}>{locale.t('prompt_studio.macro_from_group')}</button>
          <button type="button" disabled={!canSaveChunk} class="ui-control rounded bg-indigo-400 px-3 py-2 text-xs text-neutral-950 disabled:opacity-40" onclick={saveChunk}>{locale.t('common.save')}</button>
          {#if chunkId}<button type="button" class="ui-control px-2 py-1 text-xs text-neutral-400" onclick={() => { chunkId = ''; chunkName = ''; chunkContent = ''; }}>{locale.t('common.cancel')}</button>{/if}
        </div>
      </div>
    </div>
  {/if}
  </details>
  {/if}
</section>

{#if importing}<PromptBlockImport chunks={true} onClose={() => importing = false} onImport={blocks => { studio.importGroups(blocks.map((block, index) => ({ ...block, name: block.name || `${locale.t('prompt_studio.library.chunk_name')} ${index + 1}` }))); workspace.setDraftPart(studio.groups.length ? `chunk:${studio.groups.at(-1)!.id}` : 'base'); importing = false; }} />{/if}
