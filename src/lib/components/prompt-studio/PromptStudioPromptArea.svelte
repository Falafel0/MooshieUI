<script lang="ts">
  import PromptBlockImport from "../generation/PromptBlockImport.svelte";
  import PromptTextarea from '../generation/PromptTextarea.svelte';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { promptPresets, inlineChunkToken, type PromptPreset } from '../../stores/promptPresets.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { insertPrompt } from '../../prompt-studio/insertion.js';
  import { ArrowUp, ArrowDown, Copy, Trash2 } from '@lucide/svelte';
  let { onApply, onCopy }: { onApply: () => void; onCopy: () => void } = $props();
  let active = $state('');
  let importing = $state(false);
  let macros = $state(false);
  let macroQuery = $state('');
  const filteredMacros = $derived(promptPresets.presets.filter(preset => `${preset.name} ${preset.content}`.toLowerCase().includes(macroQuery.toLowerCase())));
  let macroName = $state('');
  let macroId = $state('');
  let macroContent = $state('');
  let showPreview = $state(false);
  const group = $derived(studio.groups.find(group => group.id === active));
  const content = $derived(group?.content ?? studio.basePrompt);
  const canSaveMacro = $derived(macroName.trim() && macroContent.trim() && !promptPresets.presets.some(p => p.id !== macroId && p.name.toLowerCase() === macroName.trim().toLowerCase()));
  $effect(() => { if (active && !group) active = ''; });
  function edit(text: string) { if (group) studio.updateGroup(group.id, { content: text }); else studio.editPrompt(text); }
  function saveMacro() {
    if (!canSaveMacro) return;
    if (macroId) promptPresets.update(macroId, { name: macroName.trim(), content: macroContent.trim() });
    else promptPresets.create(macroName.trim(), macroContent.trim());
    macroId = ''; macroName = ''; macroContent = '';
  }
  function insertMacro(preset: PromptPreset) { edit(insertPrompt(content, inlineChunkToken(preset.name, preset.id), 'append')); }
</script>

<section class="max-h-[45dvh] shrink-0 overflow-y-auto border-t border-neutral-800 bg-neutral-900 p-3" aria-label={locale.t('prompt_studio.prompt_editor')}>
  <div class="mb-2 flex flex-wrap items-center gap-2">
    <nav class="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label={locale.t('prompt_studio.prompt_groups')}>
      <button type="button" aria-pressed={!group} class="touch-target shrink-0 rounded border px-3 py-2 text-xs {!group ? 'border-indigo-500 text-indigo-300' : 'border-neutral-700 text-neutral-400'}" onclick={() => active = ''}>{locale.t('prompt_studio.constructor_output')}</button>
      {#each studio.groups as item (item.id)}
        <button type="button" aria-pressed={active === item.id} class="touch-target max-w-40 shrink-0 truncate rounded border px-3 py-2 text-xs {active === item.id ? 'border-indigo-500 text-indigo-300' : 'border-neutral-700 text-neutral-400'} {item.enabled ? '' : 'opacity-50'}" onclick={() => active = item.id}>{item.name || locale.t('prompt_studio.group_name')}</button>
      {/each}
    </nav>
    <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => active = studio.addGroup(locale.t('prompt_studio.group_name'))}>+ {locale.t('prompt_studio.prompt_groups')}</button>
    <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => importing = true}>{locale.t('prompt_studio.import_blocks')}</button>
    <button type="button" aria-expanded={macros} class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => macros = !macros}>{locale.t('prompt_studio.macros')}</button>
    <button type="button" class="touch-target rounded border border-neutral-700 p-2 text-neutral-300" onclick={onCopy} aria-label={locale.t('prompt_studio.copy')}><Copy size={16} /></button>
    <button type="button" class="touch-target rounded bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-40" disabled={!studio.prompt.trim()} onclick={onApply}>{locale.t('prompt_studio.apply')}</button>
  </div>
  {#if group}
    <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
      <input class="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-200" value={group.name} aria-label={locale.t('prompt_studio.group_name')} onchange={event => studio.updateGroup(group!.id, { name: event.currentTarget.value })} />
      <label class="flex items-center gap-2"><input type="checkbox" checked={group.enabled} onchange={event => studio.updateGroup(group!.id, { enabled: event.currentTarget.checked })} />{locale.t('prompt_studio.group_enabled')}</label>
      <button type="button" class="touch-target rounded p-2 disabled:opacity-30" disabled={studio.groups[0]?.id === group.id} aria-label={locale.t('prompt_studio.group_up')} onclick={() => studio.moveGroup(group!.id, -1)}><ArrowUp size={16} /></button>
      <button type="button" class="touch-target rounded p-2 disabled:opacity-30" disabled={studio.groups.at(-1)?.id === group.id} aria-label={locale.t('prompt_studio.group_down')} onclick={() => studio.moveGroup(group!.id, 1)}><ArrowDown size={16} /></button>
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
  <button type="button" class="touch-target mt-1 text-xs text-neutral-400" aria-expanded={showPreview} onclick={() => showPreview = !showPreview}>{locale.t('prompt_studio.combined_preview')} · {studio.groups.filter(group => group.enabled).length} {locale.t('prompt_studio.prompt_groups')}</button>
  {#if showPreview}<p class="mt-2 whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed text-neutral-300">{studio.prompt}</p>{/if}
  {#if macros}
    <div class="mt-3 grid gap-3 border-t border-neutral-800 pt-3 md:grid-cols-2">
      <div class="flex flex-col gap-2">
        <p class="text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.macros_hint')}</p>
        <input aria-label={locale.t('prompt_studio.search_macros')} placeholder={locale.t('prompt_studio.search_macros')} bind:value={macroQuery} class="rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" />
        {#each filteredMacros as preset (preset.id)}
          <div class="flex min-w-0 gap-2">
            <button type="button" class="touch-target min-w-0 flex-1 truncate rounded border border-neutral-700 px-3 py-2 text-left text-xs text-indigo-300" title={preset.content} onclick={() => insertMacro(preset)}>{inlineChunkToken(preset.name)}</button>
            <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-400" onclick={() => { macroId = preset.id; macroName = preset.name; macroContent = preset.content; }}>{locale.t('common.edit')}</button>
            <button type="button" class="touch-target rounded p-2 text-neutral-500 hover:text-red-300" aria-label={locale.t('common.remove')} onclick={() => { promptPresets.remove(preset.id); if (macroId === preset.id) { macroId = ''; macroName = ''; macroContent = ''; } }}><Trash2 size={14} /></button>
          </div>
        {/each}
      </div>
      <div class="flex flex-col gap-2">
        <input aria-label={locale.t('prompt_studio.macro_name')} placeholder={locale.t('prompt_studio.macro_name')} bind:value={macroName} class="rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" />
        <PromptTextarea bind:value={macroContent} rows={2} minHeight="min-h-20" placeholder={locale.t('prompt_studio.macro_content')} />
        <div class="flex gap-2">
          <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => macroContent = content}>{locale.t('prompt_studio.macro_from_group')}</button>
          <button type="button" disabled={!canSaveMacro} class="touch-target rounded bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-40" onclick={saveMacro}>{locale.t('common.save')}</button>
          {#if macroId}<button type="button" class="touch-target px-2 py-1 text-xs text-neutral-400" onclick={() => { macroId = ''; macroName = ''; macroContent = ''; }}>{locale.t('common.cancel')}</button>{/if}
        </div>
      </div>
    </div>
  {/if}
</section>

{#if importing}<PromptBlockImport onClose={() => importing = false} onImport={blocks => { studio.importGroups(blocks.map((block, index) => ({ ...block, name: block.name || `${locale.t('prompt_studio.group_name')} ${index + 1}` }))); active = studio.groups.at(-1)?.id ?? ''; importing = false; }} />{/if}
