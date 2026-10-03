<script lang="ts">
  import { savedSources } from '../../prompt-studio/saved-sources.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { classifyTag } from '../../prompt-studio/sources.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { gallery } from '../../stores/gallery.svelte.js';
  import { readSnapshotFile } from '../../prompt-studio/presets.js';
  import PromptStudioTagImage from './PromptStudioTagImage.svelte';
  let query = $state('');
  let limit = $state(40);
  let file: HTMLInputElement;
  const matches = $derived(savedSources.entries.filter(entry => `${entry.name} ${entry.source} ${entry.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())));
  $effect(() => { query; limit = 40; });
  function addAll() { studio.addMany(matches.flatMap(entry => entry.tags.map(tag => ({ tag, ...classifyTag(tag, entry.category) })))); }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0]; input.value = '';
    if (!chosen) return;
    try { if (!savedSources.import(await readSnapshotFile(chosen))) throw new Error(locale.t('prompt_studio.import_failed')); }
    catch (error) { gallery.showToast(String(error), 'error'); }
  }
</script>
<div class="flex flex-col gap-3">
  <div class="sticky top-0 z-10 flex flex-wrap gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
    <input aria-label={locale.t('prompt_studio.search')} bind:value={query} placeholder={locale.t('prompt_studio.search')} class="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-200" />
    <button type="button" disabled={!matches.length} class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" onclick={addAll}>{locale.t('prompt_studio.add_saved_results')}</button>
    <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => savedSources.export()}>{locale.t('prompt_studio.export')}</button>
    <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => file.click()}>{locale.t('prompt_studio.import')}</button>
    <input class="hidden" type="file" accept="application/json,.json" bind:this={file} onchange={importFile} />
  </div>
  {#if savedSources.storageError}<p role="alert" class="text-xs text-amber-300">{locale.t('prompt_studio.storage_error')}</p>{/if}
  {#if !matches.length}<p role="status" class="text-sm text-neutral-500">{locale.t('prompt_studio.saved_empty')}</p>{/if}
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
    {#each matches.slice(0, limit) as entry (JSON.stringify([entry.source, entry.id]))}
      <article class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
        <PromptStudioTagImage tag={entry.tags[0]} src={entry.preview} />
        <div class="flex flex-1 flex-col gap-2 p-3">
          <h4 class="break-words text-sm text-neutral-200">{entry.name.replaceAll('_', ' ')}</h4>
          <p class="text-[10px] text-indigo-300">{entry.source}</p>
          <p class="line-clamp-3 text-xs text-neutral-500" title={entry.tags.join(', ')}>{entry.tags.join(', ')}</p>
          <button type="button" class="touch-target mt-auto rounded border border-neutral-700 px-2 py-2 text-xs text-neutral-300" onclick={() => studio.addMany(entry.tags.map(tag => ({ tag, ...classifyTag(tag, entry.category) })))}>{locale.t('prompt_studio.add_recipe', { count: entry.tags.length })}</button>
          <button type="button" class="touch-target text-xs text-neutral-500" onclick={() => savedSources.remove(entry.id, entry.source)}>{locale.t('prompt_studio.remove')}</button>
        </div>
      </article>
    {/each}
  </div>
  {#if matches.length > limit}<button type="button" class="touch-target self-center rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => limit += 40}>{locale.t('prompt_studio.show_more')}</button>{/if}
</div>
