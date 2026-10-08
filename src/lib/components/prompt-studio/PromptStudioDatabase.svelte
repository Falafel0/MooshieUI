<script lang="ts">
  import { hasTemplateVariables } from '../../prompt-studio/collection-tools.js';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { workspace } from '../../prompt-studio/workspace.svelte.js';
  import { insertPrompt } from '../../prompt-studio/insertion.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import PromptStudioSetPicker from './PromptStudioSetPicker.svelte';
  import type { StudioKind } from '../../prompt-studio/presets.js';
  const initial = restoreTool('database', { mode: 'character', query: '', page: 0, opened: false });
  let opened = $state(initial.opened);
  let mode = $state<StudioKind>(initial.mode as StudioKind);
  let query = $state(initial.query), page = $state(initial.page);
  function insert(row: { tag: string; name?: string; labelKey: string; category: string }) {
    if (hasTemplateVariables(row.tag)) { void library.previewRecipe(row.name || locale.t(row.labelKey), row.tag); return; }
    if (workspace.view === 'editor' && workspace.draftPart === 'output') return;
    const chunk = workspace.view === 'editor' ? studio.groups.find(group => `chunk:${group.id}` === workspace.draftPart) : undefined;
    if (chunk) studio.updateGroup(chunk.id, { content: insertPrompt(chunk.content, row.tag, 'append') });
    else if (workspace.view === 'editor' && studio.rawPrompt !== undefined) studio.editPrompt(insertPrompt(studio.rawPrompt, row.tag, 'append'));
    else studio.choose(row.tag, row.name || locale.t(row.labelKey), row.category);
  }
  const rows = $derived(library.groups(mode).flatMap(group => group.options.map(option => ({ ...option, category: group.id }))));
  const matching = $derived(rows.filter(row => `${row.tag} ${row.name || locale.t(row.labelKey)}`.toLowerCase().includes(query.trim().toLowerCase())));
  const current = $derived(Math.min(page, Math.max(0, Math.ceil(matching.length / 60) - 1)));
  $effect(() => { saveTool('database', { mode, query, page, opened }); });
</script>
<details open={opened} ontoggle={event => opened = event.currentTarget.open} class="mb-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
  <summary class="ui-control cursor-pointer text-xs font-medium text-neutral-300">{locale.t('prompt_studio.library.insert_database')}</summary>
  <div class="mt-3 flex flex-wrap gap-1">{#each ['character', 'wardrobe', 'scene'] as domain}<button type="button" aria-pressed={mode === domain} onclick={() => mode = domain as StudioKind} class="ui-control rounded-lg px-3 text-xs {mode === domain ? 'bg-neutral-800 text-indigo-300' : 'text-neutral-400'}">{locale.t(`prompt_studio.v2.mode_${domain}`)}</button>{/each}</div>
  <PromptStudioSetPicker {mode} />
  <input type="search" aria-label={locale.t('prompt_studio.search')} placeholder={locale.t('prompt_studio.search')} bind:value={query} class="ui-control my-3 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-200" />
  <div class="flex max-h-64 flex-wrap gap-2 overflow-y-auto overscroll-contain">{#each matching.slice(current * 60, (current + 1) * 60) as row (`${row.category}:${row.tag}`)}<button type="button" aria-pressed={studio.isChosen(row.tag)} disabled={workspace.view === 'editor' && workspace.draftPart === 'output'} onclick={() => insert(row)} class="ui-control rounded-lg border px-3 text-xs disabled:opacity-40 {studio.isChosen(row.tag) ? 'border-indigo-400/50 text-indigo-300' : 'border-neutral-700 text-neutral-400'}">{row.name || locale.t(row.labelKey)}</button>{/each}</div>
  <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500"><span>{locale.formatInteger(matching.length)}</span>{#if matching.length > 60}<button type="button" disabled={!current} onclick={() => page = current - 1} class="ui-control rounded-lg border border-neutral-700 px-3 disabled:opacity-30">{locale.t('prompt_studio.v2.catalog_previous_page')}</button><span>{current + 1} / {Math.ceil(matching.length / 60)}</span><button type="button" disabled={(current + 1) * 60 >= matching.length} onclick={() => page = current + 1} class="ui-control rounded-lg border border-neutral-700 px-3 disabled:opacity-30">{locale.t('prompt_studio.v2.catalog_next_page')}</button>{/if}</div>
</details>
