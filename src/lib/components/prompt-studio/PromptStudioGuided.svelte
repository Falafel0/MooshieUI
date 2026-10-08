<script lang="ts">
  import { appearanceSection, tagMatches, type TagLayout } from '../../prompt-studio/tag-presentation.js';
  import { tagPreviews } from '../../prompt-studio/tag-previews.svelte.js';
  import PromptStudioTagVisual from './PromptStudioTagVisual.svelte';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import { workflow } from '../../prompt-studio/workflow.svelte.js';
  import { library, domainCollection } from '../../prompt-studio/library.svelte.js';
  import PromptStudioSetPicker from './PromptStudioSetPicker.svelte';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import type { StudioKind } from '../../prompt-studio/presets.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { Check, Dices, LockKeyhole, UnlockKeyhole, Search, RotateCcw, X, ChevronDown, Info, Settings2 } from '@lucide/svelte';

  let { mode }: { mode: StudioKind } = $props();
  const initial = restoreTool('guided', { query: '', pages: {} as Record<string, number>, opened: {} as Record<string, boolean>, layout: 'chips', images: true, section: 'all', settings: false, selectedOnly: false });
  let query = $state(initial.query);
  let pages = $state<Record<string, number>>(initial.pages);
  let opened = $state(initial.opened);
  let layout = $state<TagLayout>(['chips', 'cards', 'list'].includes(initial.layout) ? initial.layout as TagLayout : 'chips');
  let images = $state(initial.images);
  let section = $state(initial.section);
  let settings = $state(initial.settings);
  let selectedOnly = $state(initial.selectedOnly);
  const metadata = $derived(new Map((library.databases[domainCollection[mode]] ?? []).map(row => [row.tag, row])));
  const sections = ['all', 'identity', 'hair', 'face', 'body', 'fantasy', 'pose'];
  function inspect(tag: string, name: string, groupId: string) { const row = metadata.get(tag); library.inspectedTag = { ...row, tag, name, group: row?.group ?? groupId.split(':').at(-1) ?? '', mode, groupId }; }
  const groups = $derived(library.groups(mode));
  const filtered = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    return groups.filter(group => mode !== 'character' || section === 'all' || appearanceSection(group.id) === section).map(group => {
      const groupMatches = (group.name || locale.t(group.labelKey)).toLocaleLowerCase().includes(needle);
      return { ...group, options: group.options.filter(option => (!selectedOnly || studio.isChosen(option.tag)) && (groupMatches || tagMatches({ ...metadata.get(option.tag), tag: option.tag, name: option.name || locale.t(option.labelKey) }, query))) };
    }).filter(group => group.options.length);
  });
  const count = $derived(studio.selected.filter(choice => groups.some(group => group.id === choice.category || group.options.some(option => option.tag === choice.tag))).length);
  $effect(() => { workflow.load(); void tagPreviews.load(); });
  $effect(() => { saveTool('guided', { query, pages, opened, layout, images, section, settings, selectedOnly }); });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950" aria-label={locale.t(`prompt_studio.v2.mode_${mode}`)}>
  <div class="shrink-0 border-b border-neutral-800 bg-neutral-900/40 p-4">
    <PromptStudioSetPicker {mode} />
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <label class="flex min-w-40 flex-1 items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3">
        <Search size={17} class="shrink-0 text-neutral-500" />
        <input type="search" bind:value={query} aria-label={locale.t('prompt_studio.v2.guided.search')} placeholder={locale.t('prompt_studio.v2.guided.search')} class="ui-control min-w-0 w-full bg-transparent py-2 text-sm text-neutral-200 outline-none" />
        {#if query}<button type="button" class="ui-control flex shrink-0 items-center justify-center rounded-lg text-neutral-400" aria-label={locale.t('prompt_studio.v2.guided.clear_search')} onclick={() => query = ''}><X size={15} /></button>{/if}
      </label>
      <button type="button" class="ui-control flex items-center justify-center gap-2 rounded-xl bg-indigo-400 px-4 py-2 text-xs font-semibold text-neutral-950 disabled:opacity-40" disabled={groups.every(group => workflow.locked.includes(group.id))} onclick={() => workflow.randomize(mode)}><Dices size={16} />{locale.t('prompt_studio.v2.guided.random_all')}</button>
      <button type="button" class="ui-control flex items-center justify-center gap-2 rounded-xl border border-neutral-700 px-3 py-2 text-xs text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" disabled={!studio.selected.some(choice => groups.some(group => group.id === choice.category && !workflow.locked.includes(group.id)) && !studio.pinned.includes(choice.tag))} onclick={() => workflow.reset(mode)}><RotateCcw size={15} />{locale.t('prompt_studio.v2.guided.reset')}</button>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      {#if mode === 'character'}<label class="flex min-w-0 flex-1 items-center gap-2 text-xs text-neutral-400">{locale.t('prompt_studio.polish.appearance')}<select aria-label={locale.t('prompt_studio.polish.appearance')} bind:value={section} class="ui-control min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3">{#each sections as value}<option value={value}>{locale.t(`prompt_studio.polish.section_${value}`)}</option>{/each}</select></label>{/if}
      <button type="button" aria-expanded={settings} class="ui-control flex items-center gap-2 rounded-lg border border-neutral-800 px-3 text-xs text-neutral-400" onclick={() => settings = !settings}><Settings2 size={16} />{locale.t('prompt_studio.polish.display_settings')}</button>
    </div>
    {#if settings}<div class="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 p-3 text-xs text-neutral-400">
      <label class="flex items-center gap-2">{locale.t('prompt_studio.polish.presentation')}<select aria-label={locale.t('prompt_studio.polish.presentation')} bind:value={layout} class="ui-control rounded-lg border border-neutral-700 bg-neutral-950 px-3">{#each ['chips', 'cards', 'list'] as value}<option value={value}>{locale.t(`prompt_studio.polish.layout_${value}`)}</option>{/each}</select></label>
      <label class="flex min-h-[var(--ui-control-height)] items-center gap-2"><input type="checkbox" bind:checked={images} class="accent-indigo-400" />{locale.t('prompt_studio.v2.show_previews')}</label>
      <label class="flex min-h-[var(--ui-control-height)] items-center gap-2"><input type="checkbox" bind:checked={selectedOnly} class="accent-indigo-400" />{locale.t('prompt_studio.v2.selected_only')}</label>
      {#if library.sources[mode] !== 'starter'}<label class="flex items-center gap-2">{locale.t('prompt_studio.library.new_detail_limit')}<select value={workflow.detailCount} onchange={event => workflow.setDetailCount(Number(event.currentTarget.value))} class="ui-control rounded-lg border border-neutral-700 bg-neutral-950 px-3">{#each [4, 8, 12, 20] as value}<option value={value}>{value}</option>{/each}</select></label>{/if}
    </div>{/if}
    <div class="mt-3 flex items-start gap-3 text-xs leading-relaxed text-neutral-500">
      <p class="min-w-0 flex-1">{locale.t('prompt_studio.v2.guided.hint')}</p>
      <span class="shrink-0 rounded-full border border-neutral-800 px-2 py-1 text-neutral-300">{count} {locale.t('prompt_studio.v2.guided.selected')}</span>
    </div>
    {#if workflow.storageError}<p role="alert" class="mt-2 text-xs text-indigo-300">{locale.t('prompt_studio.v2.guided.storage_error')}</p>{/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
    <div class="flex flex-col gap-3">
      {#each filtered as group (group.id)}
        {@const locked = workflow.locked.includes(group.id)}
        {@const selected = studio.selected.filter(choice => choice.category === group.id || group.options.some(option => option.tag === choice.tag))}
        {@const expanded = opened[group.id] ?? (!!query || groups.length <= 10 || selected.length > 0)}
        {@const currentPage = Math.max(0, Math.min(pages[group.id] || 0, Math.ceil(group.options.length / 60) - 1))}
        <details open={expanded} class="rounded-xl border p-3 sm:p-4 {locked ? 'border-indigo-400/30 bg-indigo-400/[0.03]' : 'border-neutral-800 bg-neutral-900/30'}" aria-labelledby={`studio-guided-${group.id}`}>
          <summary onclick={event => { event.preventDefault(); opened = { ...opened, [group.id]: !expanded }; }} class="ui-control mb-3 cursor-pointer flex min-w-0 items-center gap-2"><ChevronDown size={16} class="shrink-0 text-neutral-500 {expanded ? 'rotate-180' : ''}" />
            <div class="min-w-0 flex-1">
              <h3 id={`studio-guided-${group.id}`} class="text-sm font-medium text-neutral-200">{(group.name || locale.t(group.labelKey))}<span class="ml-2 text-xs font-normal text-neutral-500">{locale.formatInteger(group.options.length)}</span></h3>
              {#if group.multi || group.optional}<p class="mt-1 text-xs text-neutral-500">{locale.t(group.multi ? 'prompt_studio.v2.guided.multi' : 'prompt_studio.v2.guided.optional')}</p>{/if}
            </div>
            {#if locked}<span class="hidden text-xs text-indigo-300 sm:block">{locale.t('prompt_studio.v2.guided.locked')}</span>{/if}
            <button type="button" aria-pressed={locked} aria-label={`${locale.t(locked ? 'prompt_studio.v2.guided.unlock' : 'prompt_studio.v2.guided.lock')}: ${(group.name || locale.t(group.labelKey))}`} title={locale.t(locked ? 'prompt_studio.v2.guided.unlock' : 'prompt_studio.v2.guided.lock')} class="ui-control flex shrink-0 items-center justify-center rounded-lg border border-neutral-700 {locked ? 'text-indigo-300' : 'text-neutral-500 hover:text-neutral-200'}" onclick={event => { event.preventDefault(); event.stopPropagation(); workflow.toggleLock(group.id); }}>{#if locked}<LockKeyhole size={15} />{:else}<UnlockKeyhole size={15} />{/if}</button>
            <button type="button" aria-label={`${locale.t('prompt_studio.v2.guided.random_group')}: ${(group.name || locale.t(group.labelKey))}`} title={locale.t('prompt_studio.v2.guided.random_group')} class="ui-control flex shrink-0 items-center justify-center rounded-lg border border-neutral-700 text-neutral-400 hover:text-neutral-200 disabled:opacity-30" disabled={locked} onclick={event => { event.preventDefault(); event.stopPropagation(); workflow.randomize(mode, group.id); }}><Dices size={16} /></button>
          </summary>
          {#if expanded}<div class="{layout === 'chips' ? 'flex flex-wrap' : layout === 'cards' ? 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))]' : 'flex flex-col'} gap-2">
            {#if !query.trim()}<button type="button" aria-pressed={!selected.length} class="ui-control flex items-center gap-2 rounded-lg border px-3 py-2 text-xs {!selected.length ? 'border-neutral-500 bg-neutral-800 text-neutral-200' : 'border-neutral-800 text-neutral-500 hover:border-neutral-600'}" onclick={() => workflow.clearGroup(mode, group.id)}>{locale.t('prompt_studio.v2.guided.none')}</button>{/if}
            {#each group.options.slice(currentPage * 60, (currentPage + 1) * 60) as option (option.tag)}
              {@const chosen = selected.some(choice => choice.tag === option.tag)}
              {@const external = selected.some(choice => choice.tag === option.tag && choice.category !== group.id)}
              <div class="flex min-w-0 items-stretch rounded-lg border {chosen ? 'border-indigo-400/60 bg-indigo-400/10' : 'border-neutral-800 bg-neutral-900'}"><button type="button" aria-label={option.name || locale.t(option.labelKey)} aria-pressed={chosen} aria-disabled={external} title={external ? `${option.tag} · ${locale.t('prompt_studio.v2.guided.selected')} · ${locale.t('prompt_studio.v2.draft')}` : option.tag} class="ui-control flex min-w-0 flex-1 items-center gap-2 rounded-l-lg px-3 py-2 text-xs transition-colors {chosen ? 'text-indigo-200' : 'text-neutral-300 hover:bg-neutral-800'}" onclick={() => workflow.choose(mode, group.id, option.tag)}>
                {#if chosen}<Check size={14} class="shrink-0" />{/if}
                <PromptStudioTagVisual tag={option.tag} group={metadata.get(option.tag)?.group ?? group.id} {images} /><span class="min-w-0 break-words text-left">{(option.name || locale.t(option.labelKey))}{#if layout !== 'chips'}<span class="mt-1 block break-words font-mono text-xs text-neutral-500">{option.tag}</span>{/if}</span>
                {#if studio.pinned.includes(option.tag)}<LockKeyhole size={11} class="shrink-0 text-indigo-300" />{/if}
              </button><button type="button" class="ui-control flex shrink-0 items-center justify-center rounded-r-lg text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" aria-label={`${locale.t('prompt_studio.polish.tag_details')}: ${option.name || locale.t(option.labelKey)}`} onclick={() => inspect(option.tag, option.name || locale.t(option.labelKey), group.id)}><Info size={15} /></button></div>
            {/each}
          </div>
          {#if group.options.length > 60}<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400"><button type="button" class="ui-control rounded-lg border border-neutral-700 px-3 disabled:opacity-30" disabled={!currentPage} onclick={() => pages = { ...pages, [group.id]: currentPage - 1 }}>{locale.t('prompt_studio.v2.catalog_previous_page')}</button><span>{currentPage + 1} / {Math.ceil(group.options.length / 60)} · {locale.formatInteger(group.options.length)}</span><button type="button" class="ui-control rounded-lg border border-neutral-700 px-3 disabled:opacity-30" disabled={(currentPage + 1) * 60 >= group.options.length} onclick={() => pages = { ...pages, [group.id]: currentPage + 1 }}>{locale.t('prompt_studio.v2.catalog_next_page')}</button></div>{/if}
          {/if}
        </details>
      {/each}
    </div>
    {#if library.pending.includes(domainCollection[mode])}<p role="status" class="p-4 text-xs text-neutral-400">{locale.t('prompt_studio.loading')}</p>{/if}
    {#if !filtered.length && !library.pending.includes(domainCollection[mode])}<p role="status" class="px-4 py-12 text-center text-sm text-neutral-500">{locale.t('prompt_studio.v2.guided.no_results')}</p>{/if}
  </div>
</section>
