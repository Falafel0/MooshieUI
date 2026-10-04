<script lang="ts">
  import { library, domainCollection } from '../../prompt-studio/library.svelte.js';
  import { workspace } from '../../prompt-studio/workspace.svelte.js';
  import type { StudioKind } from '../../prompt-studio/presets.js';
  import { locale } from '../../stores/locale.svelte.js';
  let { mode }: { mode: StudioKind } = $props();
  $effect(() => { library.load(); if (library.sources[mode] === 'database') void library.fetch(domainCollection[mode]); });
</script>
<div class="flex flex-wrap items-end gap-2">
  <label class="min-w-0 flex-1 text-xs text-neutral-400">{locale.t('prompt_studio.library.global_source')}
    <select aria-label={locale.t('prompt_studio.library.global_source')} value={library.sources[mode]} onchange={event => library.select(mode, event.currentTarget.value)} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200">
      <option value="starter">{locale.t('prompt_studio.library.starter')}</option>
      <option value="database">{locale.t('prompt_studio.library.database')}</option>
      {#each library.sets(mode) as category (category.id)}<option value={category.id}>{category.name}</option>{/each}
      {#if !['starter', 'database'].includes(library.sources[mode]) && !library.sets(mode).some(row => row.id === library.sources[mode])}<option value={library.sources[mode]} disabled>{locale.t('prompt_studio.library.missing_set')}</option>{/if}
    </select>
  </label>
  <button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-400" onclick={() => workspace.setView('library')}>{locale.t('prompt_studio.library.manage')}</button>
  {#if library.failed.includes(domainCollection[mode])}<button type="button" class="touch-target text-xs text-amber-300" onclick={() => void library.fetch(domainCollection[mode])}>{locale.t('prompt_studio.retry')}</button>{/if}
</div>
