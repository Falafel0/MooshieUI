<script lang="ts">
  import { customCatalog, catalogPreview } from '../../prompt-studio/custom-catalog.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { searchDanbooru } from '../../utils/api.js';
  import { sourcePreview } from '../../prompt-studio/preview-cache.js';
  import PromptStudioCachedImage from './PromptStudioCachedImage.svelte';
  import type { DanbooruPost } from '../../types/index.js';
  import { onDestroy } from 'svelte';
  let entryId = $state('');
  let name = $state('');
  let tag = $state('');
  let preview = $state('');
  let examples = $state<DanbooruPost[]>([]);
  let busy = $state(false);
  const ready = $derived(customCatalog.ready);
  $effect(() => { void customCatalog.load(); });
  let error = $state('');
  let request = 0;
  let input: HTMLInputElement;
  let query = $state('');
  const entries = $derived(customCatalog.entries.filter(entry => entry.subId === studio.activeSubId && `${entry.name} ${entry.tag}`.toLowerCase().replaceAll('_', ' ').includes(query.trim().toLowerCase().replaceAll('_', ' '))));
  onDestroy(() => { request++; });
  $effect(() => { studio.activeSubId; request++; entryId = ''; name = ''; tag = ''; preview = ''; examples = []; error = ''; busy = false; });
  $effect(() => { tag; request++; examples = []; busy = false; error = ''; });
  async function upload(event: Event) {
    const fileInput = event.currentTarget as HTMLInputElement; const file = fileInput.files?.[0]; fileInput.value = '';
    if (!file) return;
    const id = ++request; busy = true;
    try { const result = await catalogPreview(file); if (id === request) { preview = result; error = ''; } }
    catch { if (id === request) error = locale.t('prompt_studio.import_failed'); }
    finally { if (id === request) busy = false; }
  }
  async function loadExamples() {
    const id = ++request; busy = true; error = '';
    try { const posts = await searchDanbooru(tag, 1, 12, true, 'danbooru'); if (id === request) examples = posts.filter(post => post.rating === 'g' && post.preview_file_url); }
    catch { if (id === request) error = locale.t('prompt_studio.source_error'); }
    finally { if (id === request) busy = false; }
  }
  async function chooseImage(url: string) {
    const id = ++request; busy = true; error = '';
    try { const result = await catalogPreview((await sourcePreview(url)).blob); if (id === request) preview = result; }
    catch { if (id === request) error = locale.t('prompt_studio.preview_unavailable'); }
    finally { if (id === request) busy = false; }
  }
  async function importFile(event: Event) {
    const target = event.currentTarget as HTMLInputElement; const file = target.files?.[0]; target.value = '';
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) { error = locale.t('prompt_studio.import_failed'); return; }
    const id = ++request; busy = true; error = '';
    try {
      const data = JSON.parse(await file.text());
      if (id !== request) return;
      if (!customCatalog.import(data)) throw new Error();
    }
    catch { if (id === request) error = locale.t('prompt_studio.import_failed'); }
    finally { if (id === request) busy = false; }
  }
</script>
<details class="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
  <summary class="cursor-pointer text-sm text-indigo-300">{locale.t('prompt_studio.custom_catalog')}</summary>
  <p class="mt-2 text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.custom_catalog_hint')}</p>
  <div class="mt-3 flex flex-col gap-3">
    <div class="grid gap-2 sm:grid-cols-2">
      <input aria-label={locale.t('prompt_studio.custom_name')} placeholder={locale.t('prompt_studio.custom_name')} bind:value={name} class="rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" />
      <input aria-label={locale.t('prompt_studio.custom_tag')} placeholder={locale.t('prompt_studio.custom_tag')} bind:value={tag} class="rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" />
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <label class="text-xs text-neutral-400">{locale.t('prompt_studio.custom_upload')}<input type="file" accept="image/png,image/jpeg,image/webp" onchange={upload} disabled={!ready || busy} class="ml-2 max-w-56 text-xs" /></label>
      <button type="button" disabled={busy || !tag.trim() || /[\s:\[\]|]/.test(tag)} class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" onclick={loadExamples}>{locale.t('prompt_studio.custom_examples')}</button>
      <button type="button" disabled={!ready || busy || !tag.trim()} class="touch-target rounded bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-40" onclick={() => { customCatalog.add({ id: entryId || undefined, name: name.trim() || tag.replaceAll('_', ' '), tag: tag.trim(), subId: studio.activeSubId, preview: preview || undefined }); entryId = ''; name = ''; tag = ''; preview = ''; examples = []; }}>{locale.t('common.save')}</button>
    </div>
    {#if preview}<div class="flex items-center gap-2"><img src={preview} alt={name || tag} class="h-24 w-24 rounded border border-indigo-500 object-contain" /><button type="button" disabled={busy} class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-400" onclick={() => preview = ''}>{locale.t('prompt_studio.custom_remove_preview')}</button></div>{/if}
    {#if entryId}<button type="button" disabled={busy} class="touch-target self-start text-xs text-neutral-400" onclick={() => { request++; entryId = ''; name = ''; tag = ''; preview = ''; examples = []; error = ''; }}>{locale.t('common.cancel')}</button>{/if}
    {#if busy}<p role="status" class="text-xs text-neutral-400">{locale.t('prompt_studio.loading')}</p>{/if}
    {#if error || customCatalog.storageError}<p role="alert" class="text-xs text-amber-300">{error || locale.t('prompt_studio.storage_error')}</p>{/if}
    {#if examples.length}
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {#each examples as post (post.id)}
          <div class="flex flex-col items-center gap-1 rounded border border-neutral-700 p-2"><PromptStudioCachedImage src={post.preview_file_url!} alt={`#${post.id}`} /><button type="button" disabled={busy} class="touch-target text-[10px] text-neutral-400" onclick={() => chooseImage(post.preview_file_url!)}>{locale.t('prompt_studio.custom_choose_preview', { id: post.id })}</button></div>
        {/each}
      </div>
    {/if}
    <div class="flex gap-2">
      <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" disabled={!ready || busy} onclick={() => customCatalog.export()}>{locale.t('prompt_studio.export')}</button>
      <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" disabled={!ready || busy} onclick={() => input.click()}>{locale.t('prompt_studio.import')}</button>
      <input type="file" class="hidden" accept="application/json,.json" bind:this={input} onchange={importFile} />
    </div>
    {#if !ready && customCatalog.storageError}<button type="button" class="touch-target self-start rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300" onclick={() => void customCatalog.load()}>{locale.t('prompt_studio.retry')}</button>{/if}
    <input type="search" aria-label={locale.t('prompt_studio.search')} placeholder={locale.t('prompt_studio.search')} bind:value={query} class="rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" />
    {#if ready && query.trim() && !entries.length}<p role="status" class="text-xs text-neutral-400">{locale.t('prompt_studio.nothing_found')}</p>{/if}
    {#each entries as entry (entry.id)}
      <div class="flex min-w-0 items-center gap-3 rounded border border-neutral-800 p-2">
        {#if entry.preview}<img src={entry.preview} alt={entry.name} class="h-14 w-14 shrink-0 rounded object-contain" />{/if}
        <button type="button" class="touch-target min-w-0 flex-1 break-words text-left text-xs text-neutral-200" onclick={() => studio.choose(entry.tag, entry.name, entry.subId, studio.currentSub?.mode === 'single')}>{entry.name}<span class="block text-[10px] text-neutral-500">{entry.tag}</span></button>
        <button type="button" disabled={!ready || busy} class="touch-target text-xs text-neutral-400" onclick={() => { request++; entryId = entry.id; name = entry.name; tag = entry.tag; preview = entry.preview ?? ''; examples = []; error = ''; }}>{locale.t('common.edit')}</button>
        <button type="button" disabled={!ready || busy} class="touch-target text-xs text-neutral-500" onclick={() => { customCatalog.remove(entry.id); if (entryId === entry.id) { request++; entryId = ''; name = ''; tag = ''; preview = ''; examples = []; } }}>{locale.t('prompt_studio.remove')}</button>
      </div>
    {/each}
  </div>
</details>
