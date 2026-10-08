<script lang="ts">
  import PromptStudioTagVisual from './PromptStudioTagVisual.svelte';
  import { tagMatches } from '../../prompt-studio/tag-presentation.js';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { workspace } from '../../prompt-studio/workspace.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import PromptStudioPromptArea from './PromptStudioPromptArea.svelte';
  import { Ban, Pin, PinOff, X, ListFilter } from '@lucide/svelte';
  let { onApply, onCopy }: { onApply: () => void; onCopy: () => void } = $props();
  const initial = restoreTool('draft-inspector', { showTags: false, query: '' });
  let showTags = $state(initial.showTags);
  let query = $state(initial.query);
  $effect(() => { saveTool('draft-inspector', { showTags, query }); });
  const suppliedTags = $derived.by(() => { const index = new Map(); for (const id of ['characters', 'wardrobe', 'composition']) for (const row of library.databases[id] ?? []) index.set(row.tag, row); return index; });
  const selected = $derived(studio.selected.filter(item => tagMatches(item, query)));
</script>
<aside class="flex h-full min-h-0 flex-col bg-neutral-900/30" aria-label={locale.t('prompt_studio.v2.draft')}>
  <div class="shrink-0 border-b border-neutral-800 px-4 py-3">
    <div class="flex items-center justify-between gap-3"><h3 class="text-sm font-semibold text-neutral-100">{locale.t('prompt_studio.v2.draft')}</h3><span class="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs tabular-nums text-neutral-400">{locale.t('prompt_studio.v2.tag_count', { count: studio.promptTokenCount })}</span></div>
    <p class="mt-1.5 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.draft_hint')}</p>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
      <div class="inline-flex gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-1" aria-label={locale.t('prompt_studio.v2.output_format')}>
        <button type="button" aria-pressed={!studio.nai} class="ui-control rounded-md px-3 text-xs {!studio.nai ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500'}" onclick={() => studio.setOption('nai', false)}>SD</button>
        <button type="button" aria-pressed={studio.nai} class="ui-control rounded-md px-3 text-xs {studio.nai ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500'}" onclick={() => studio.setOption('nai', true)}>NAI</button>
      </div>
      <label class="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={studio.readable} class="accent-indigo-400" onchange={event => studio.setOption('readable', event.currentTarget.checked)} />{locale.t('prompt_studio.v2.readable')}</label>
    </div>
  </div>
  <div class="max-h-[55%] shrink-0 overflow-y-auto overscroll-contain">
    <PromptStudioPromptArea previewOnly={workspace.view === 'editor'} />
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-studio-tags>
  {#if studio.rawPrompt === undefined}
  <div class="px-4 py-3">
    <button type="button" aria-expanded={showTags} class="ui-control flex w-full items-center gap-2 rounded-lg text-left text-xs font-medium text-neutral-300" onclick={() => showTags = !showTags}><ListFilter size={16} />{locale.t('prompt_studio.v2.adjust_tags')}<span class="ml-auto text-neutral-500">{showTags ? '−' : '+'}</span></button>
    {#if showTags}
      <div class="mt-2 flex items-center gap-2"><input type="search" class="ui-control min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-300" aria-label={locale.t('prompt_studio.v2.search_selected')} placeholder={locale.t('prompt_studio.v2.search_selected')} bind:value={query} /><button type="button" class="ui-control px-2 text-xs text-neutral-500 disabled:opacity-30" disabled={!studio.selected.length} onclick={() => studio.clear()}>{locale.t('prompt_studio.reset')}</button></div>
      <p class="my-2 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.pin_hint')}</p>
      {#each selected as item (item.tag)}
        {@const authored = customCatalog.entries.find(row => row.tag === item.tag && row.subId === item.category)}
        {@const supplied = suppliedTags.get(item.tag)}
        {@const modifiers = [...new Set([...(authored?.contextualTags ?? supplied?.context ?? []), ...studio.detail(item.tag).mods])]}
        <div class="mb-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
          <div class="flex items-start gap-2"><PromptStudioTagVisual tag={item.tag} group={supplied?.group} preview={authored?.preview} /><div class="min-w-0 flex-1"><p class="break-words text-xs text-neutral-200">{item.name}</p>{#if item.name !== item.tag}<p class="mt-0.5 truncate text-xs text-neutral-600" title={item.tag}>{item.tag}</p>{/if}</div><button type="button" class="ui-control -mr-2 -mt-2 shrink-0 rounded-lg p-2 text-neutral-500 hover:text-neutral-200" aria-label={`${locale.t('prompt_studio.remove_tag')}: ${item.name}`} onclick={() => studio.remove(item.tag)}><X size={14} /></button></div>
          {#if modifiers.length}<div class="mt-2 rounded-lg border border-neutral-800 p-2"><p class="mb-1 text-xs text-neutral-500">{locale.t('prompt_studio.contextual_tags')}</p><div class="flex flex-wrap gap-1">{#each modifiers as modifier (modifier)}<button type="button" aria-pressed={studio.detail(item.tag).mods.includes(modifier)} class="ui-control break-words rounded-lg border px-2 text-xs {studio.detail(item.tag).mods.includes(modifier) ? 'border-indigo-400/50 bg-indigo-400/10 text-indigo-300' : 'border-neutral-700 text-neutral-400'}" onclick={() => studio.toggleModifier(item.tag, modifier)}>{modifier}</button>{/each}</div></div>{/if}
          <div class="mt-1 flex items-center gap-2">
            <label class="flex min-w-0 flex-1 items-center gap-2 text-xs text-neutral-500">{locale.t('prompt_studio.weight')}<input type="number" min="0.1" max="2" step="0.05" value={item.weight} onchange={event => studio.weight(item.tag, Number(event.currentTarget.value))} class="ui-control w-20 rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs tabular-nums text-neutral-200" /></label>
            <button type="button" aria-pressed={studio.pinned.includes(item.tag)} aria-label={`${locale.t('prompt_studio.v2.pin')}: ${item.name}`} title={locale.t('prompt_studio.v2.pin')} class="ui-control rounded-lg p-2 {studio.pinned.includes(item.tag) ? 'text-indigo-300' : 'text-neutral-500'}" onclick={() => studio.pin(item.tag)}>{#if studio.pinned.includes(item.tag)}<PinOff size={14} />{:else}<Pin size={14} />{/if}</button>
            <button type="button" aria-pressed={studio.banned.includes(item.tag)} aria-label={`${locale.t('prompt_studio.v2.exclude')}: ${item.name}`} title={locale.t('prompt_studio.v2.exclude')} class="ui-control rounded-lg p-2 {studio.banned.includes(item.tag) ? 'text-red-300' : 'text-neutral-500'}" onclick={() => studio.ban(item.tag)}><Ban size={14} /></button>
          </div>
        </div>
      {/each}
      {#if !selected.length}<p class="py-5 text-xs leading-relaxed text-neutral-500">{locale.t(studio.selected.length ? 'prompt_studio.nothing_found' : 'prompt_studio.v2.empty_draft')}</p>{/if}
      {#if studio.banned.length}<details class="mt-3 text-xs text-neutral-500"><summary class="ui-control cursor-pointer">{locale.t('prompt_studio.v2.excluded')} · {studio.banned.length}</summary><div class="flex flex-wrap gap-1 pb-3">{#each studio.banned as tag}<button type="button" class="ui-control rounded border border-neutral-800 px-2 text-xs text-neutral-400" aria-label={`${locale.t('prompt_studio.v2.restore')}: ${tag}`} onclick={() => studio.ban(tag)}>{tag}<span class="ml-1">×</span></button>{/each}</div></details>{/if}
    {:else}
      <p class="mt-2 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.pin_hint')}</p>
    {/if}
  </div>
  {/if}
  </div>
  <footer class="flex shrink-0 flex-wrap gap-2 border-t border-neutral-800 bg-neutral-950 p-3">
    <button type="button" disabled={!studio.prompt.trim()} onclick={onCopy} class="ui-control flex-1 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300 disabled:opacity-40">{locale.t('prompt_studio.copy')}</button>
    <button type="button" disabled={!studio.prompt.trim() || !!studio.pendingConflict} onclick={onApply} class="ui-control flex-1 rounded-lg bg-indigo-400 px-3 text-xs font-semibold text-neutral-950 disabled:opacity-40">{locale.t('prompt_studio.v2.send')}</button>
  </footer>
</aside>
