<script lang="ts">
  import { workflow } from '../../prompt-studio/workflow.svelte.js';
  import { workflowGroups } from '../../prompt-studio/workflow-catalog.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import type { StudioKind } from '../../prompt-studio/presets.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { Check, Dices, LockKeyhole, UnlockKeyhole, Search, RotateCcw, X } from '@lucide/svelte';

  let { mode }: { mode: StudioKind } = $props();
  let query = $state('');
  const groups = $derived(workflowGroups(mode));
  const filtered = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    return groups.map(group => {
      const groupMatches = locale.t(group.labelKey).toLocaleLowerCase().includes(needle);
      return { ...group, options: group.options.filter(option => groupMatches || `${option.tag} ${locale.t(option.labelKey)}`.toLocaleLowerCase().includes(needle)) };
    }).filter(group => group.options.length);
  });
  const count = $derived(studio.selected.filter(choice => groups.some(group => group.id === choice.category || group.options.some(option => option.tag === choice.tag))).length);
  $effect(() => { workflow.load(); });
  $effect(() => { mode; query = ''; });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950" aria-label={locale.t(`prompt_studio.v2.mode_${mode}`)}>
  <div class="shrink-0 border-b border-neutral-800 bg-neutral-900/40 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex min-w-40 flex-1 items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3">
        <Search size={17} class="shrink-0 text-neutral-500" />
        <input type="search" bind:value={query} aria-label={locale.t('prompt_studio.v2.guided.search')} placeholder={locale.t('prompt_studio.v2.guided.search')} class="touch-target min-w-0 w-full bg-transparent py-2 text-sm text-neutral-200 outline-none" />
        {#if query}<button type="button" class="touch-target flex shrink-0 items-center justify-center rounded-lg text-neutral-400" aria-label={locale.t('prompt_studio.v2.guided.clear_search')} onclick={() => query = ''}><X size={15} /></button>{/if}
      </label>
      <button type="button" class="touch-target flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-xs font-semibold text-neutral-950 disabled:opacity-40" disabled={groups.every(group => workflow.locked.includes(group.id))} onclick={() => workflow.randomize(mode)}><Dices size={16} />{locale.t('prompt_studio.v2.guided.random_all')}</button>
      <button type="button" class="touch-target flex items-center justify-center gap-2 rounded-xl border border-neutral-700 px-3 py-2 text-xs text-neutral-400 hover:bg-neutral-800 disabled:opacity-40" disabled={!studio.selected.some(choice => groups.some(group => group.id === choice.category && !workflow.locked.includes(group.id)) && !studio.pinned.includes(choice.tag))} onclick={() => workflow.reset(mode)}><RotateCcw size={15} />{locale.t('prompt_studio.v2.guided.reset')}</button>
    </div>
    <div class="mt-3 flex items-start gap-3 text-xs leading-relaxed text-neutral-500">
      <p class="min-w-0 flex-1">{locale.t('prompt_studio.v2.guided.hint')}</p>
      <span class="shrink-0 rounded-full border border-neutral-800 px-2 py-1 text-neutral-300">{count} {locale.t('prompt_studio.v2.guided.selected')}</span>
    </div>
    {#if workflow.storageError}<p role="alert" class="mt-2 text-xs text-amber-300">{locale.t('prompt_studio.v2.guided.storage_error')}</p>{/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
    <div class="flex flex-col gap-3">
      {#each filtered as group (group.id)}
        {@const locked = workflow.locked.includes(group.id)}
        {@const selected = studio.selected.filter(choice => choice.category === group.id || group.options.some(option => option.tag === choice.tag))}
        <section class="rounded-xl border p-3 sm:p-4 {locked ? 'border-amber-400/30 bg-amber-400/[0.03]' : 'border-neutral-800 bg-neutral-900/30'}" aria-labelledby={`studio-guided-${group.id}`}>
          <header class="mb-3 flex min-w-0 items-center gap-2">
            <div class="min-w-0 flex-1">
              <h3 id={`studio-guided-${group.id}`} class="text-sm font-medium text-neutral-200">{locale.t(group.labelKey)}</h3>
              {#if group.multi || group.optional}<p class="mt-1 text-[11px] text-neutral-500">{locale.t(group.multi ? 'prompt_studio.v2.guided.multi' : 'prompt_studio.v2.guided.optional')}</p>{/if}
            </div>
            {#if locked}<span class="hidden text-[11px] text-amber-300 sm:block">{locale.t('prompt_studio.v2.guided.locked')}</span>{/if}
            <button type="button" aria-pressed={locked} aria-label={`${locale.t(locked ? 'prompt_studio.v2.guided.unlock' : 'prompt_studio.v2.guided.lock')}: ${locale.t(group.labelKey)}`} title={locale.t(locked ? 'prompt_studio.v2.guided.unlock' : 'prompt_studio.v2.guided.lock')} class="touch-target flex shrink-0 items-center justify-center rounded-lg border border-neutral-700 {locked ? 'text-amber-300' : 'text-neutral-500 hover:text-neutral-200'}" onclick={() => workflow.toggleLock(group.id)}>{#if locked}<LockKeyhole size={15} />{:else}<UnlockKeyhole size={15} />{/if}</button>
            <button type="button" aria-label={`${locale.t('prompt_studio.v2.guided.random_group')}: ${locale.t(group.labelKey)}`} title={locale.t('prompt_studio.v2.guided.random_group')} class="touch-target flex shrink-0 items-center justify-center rounded-lg border border-neutral-700 text-neutral-400 hover:text-neutral-200 disabled:opacity-30" disabled={locked} onclick={() => workflow.randomize(mode, group.id)}><Dices size={16} /></button>
          </header>
          <div class="flex flex-wrap gap-2">
            {#if !query.trim()}<button type="button" aria-pressed={!selected.length} class="touch-target flex items-center gap-2 rounded-lg border px-3 py-2 text-xs {!selected.length ? 'border-neutral-500 bg-neutral-800 text-neutral-200' : 'border-neutral-800 text-neutral-500 hover:border-neutral-600'}" onclick={() => workflow.clearGroup(mode, group.id)}>{locale.t('prompt_studio.v2.guided.none')}</button>{/if}
            {#each group.options as option (option.tag)}
              {@const chosen = selected.some(choice => choice.tag === option.tag)}
              {@const external = selected.some(choice => choice.tag === option.tag && choice.category !== group.id)}
              <button type="button" aria-pressed={chosen} aria-disabled={external} title={external ? `${option.tag} · ${locale.t('prompt_studio.v2.guided.selected')} · ${locale.t('prompt_studio.v2.draft')}` : option.tag} class="touch-target flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors {chosen ? 'border-amber-400/60 bg-amber-400/10 text-amber-200' : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800'}" onclick={() => workflow.choose(mode, group.id, option.tag)}>
                {#if chosen}<Check size={14} class="shrink-0" />{/if}
                {locale.t(option.labelKey)}
                {#if studio.pinned.includes(option.tag)}<LockKeyhole size={11} class="shrink-0 text-amber-300" />{/if}
              </button>
            {/each}
          </div>
        </section>
      {/each}
    </div>
    {#if !filtered.length}<p role="status" class="px-4 py-12 text-center text-sm text-neutral-500">{locale.t('prompt_studio.v2.guided.no_results')}</p>{/if}
  </div>
</section>
