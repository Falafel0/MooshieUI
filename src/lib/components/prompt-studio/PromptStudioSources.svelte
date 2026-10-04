<script lang="ts">
  import { onDestroy } from 'svelte';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import PromptStudioGlobalSets from './PromptStudioGlobalSets.svelte';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { parseGlobalSet } from '../../prompt-studio/catalog-model.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { normalizeCatalog } from '../../prompt-studio/catalog-model.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { fromSnapshot, toSnapshot, type StudioSnapshotV1 } from '../../prompt-studio/presets.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { Upload, Download, Link, FolderOpen, Save, Trash2, X, Check, FileJson } from '@lucide/svelte';

  let { view = 'sources', management = false }: { view?: 'sources' | 'sets'; management?: boolean } = $props();
  let input = $state<HTMLInputElement>();
  const initial = restoreTool('sources', { url: '', setName: '', query: '', importKind: 'tags' });
  let importKind = $state(initial.importKind === 'prompt' ? 'prompt' : 'tags');
  $effect(() => { if (management && importKind !== 'tags') importKind = 'tags'; });
  let url = $state(initial.url);
  let setName = $state(initial.setName);
  let query = $state(initial.query);
  $effect(() => { saveTool('sources', { url, setName, query, importKind }); });
  let busy = $state(false);
  let error = $state('');
  let result = $state('');
  let deleting = $state('');
  let pending = $state<{ snapshot: StudioSnapshotV1; scope: string } | null>(null);
  let request = 0;
  let controller: AbortController | undefined;
  const sets = $derived(studio.presets.filter(preset => preset.name.toLowerCase().includes(query.trim().toLowerCase())));
  const replacesSet = $derived(studio.presets.some(preset => preset.name === setName.trim()));

  function cancel() {
    request++;
    controller?.abort(); controller = undefined;
    busy = false;
  }
  onDestroy(cancel);
  function start() {
    cancel(); error = ''; result = ''; pending = null;
    busy = true;
    return { id: request, scope: customCatalog.scope };
  }
  function active(operation: { id: number; scope: string }) {
    return operation.id === request && operation.scope === customCatalog.scope;
  }
  function accept(raw: unknown, scope: string, name = locale.t('prompt_studio.v2.imported_set')) {
    if (scope !== customCatalog.scope || !customCatalog.ready) return;
    const data = raw as { kind?: unknown } | null;
    if (data?.kind === 'mooshie-tag-pack' || data?.kind === 'mooshie-custom-catalog') {
      if (!customCatalog.import(raw)) throw new Error(locale.t('prompt_studio.v2.invalid_pack'));
      const imported = normalizeCatalog(raw);
      studio.ensureActive(); studio.save();
      result = locale.t('prompt_studio.v2.pack_imported', { tags: locale.formatInteger(imported.entries.length), categories: locale.formatInteger(imported.categories.length) });
      return;
    }
    if (importKind === 'tags') {
      const entries = parseGlobalSet(typeof raw === 'string' ? raw : JSON.stringify(raw), typeof raw === 'string' ? 'txt' : 'json', '');
      if (!entries.length) throw new Error(locale.t('prompt_studio.library.invalid_entries'));
      library.newSetDraft = { name, entries }; library.editingSet = ''; return;
    }
    const snapshot = fromSnapshot(raw, locale.t('prompt_studio.v2.imported_set'));
    if (!snapshot) throw new Error(locale.t('prompt_studio.v2.invalid_source'));
    pending = { snapshot: toSnapshot(snapshot), scope };
  }
  async function importFile(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0]; target.value = '';
    if (!file) return;
    const operation = start();
    try {
      const text = await file.text();
      if (!active(operation)) return;
      let raw: unknown;
      try { raw = /\.txt$/i.test(file.name) ? importKind === 'tags' ? text : { name: file.name.replace(/\.txt$/i, ''), rawPrompt: text } : JSON.parse(text); }
      catch { throw new Error(locale.t('prompt_studio.v2.invalid_json')); }
      accept(raw, operation.scope, file.name.replace(/\.(txt|json)$/i, ''));
    } catch (failure) {
      if (active(operation)) error = failure instanceof Error ? failure.message : locale.t('prompt_studio.v2.import_failed');
    } finally { if (operation.id === request) busy = false; }
  }
  function sourceUrl(value: string): URL {
    let parsed: URL;
    try { parsed = new URL(value.trim()); }
    catch { throw new Error(locale.t('prompt_studio.v2.invalid_url')); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.username || parsed.password || !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback))) throw new Error(locale.t('prompt_studio.v2.invalid_url'));
    parsed.hash = '';
    return parsed;
  }
  async function readResponse(response: Response): Promise<string> {
    if (!response.body) {
      const text = await response.text();
      return text;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return text + decoder.decode();
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      // Cancel abandoned reads and release the reader lock.
      await reader.cancel().catch(() => undefined); reader.releaseLock();
    }
  }
  async function importUrl(event: SubmitEvent) {
    event.preventDefault();
    const operation = start();
    const abort = new AbortController(); controller = abort;
    const timeout = setTimeout(() => abort.abort(), 30000);
    try {
      const parsed = sourceUrl(url);
      const response = await fetch(parsed.href, { signal: abort.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(locale.t('prompt_studio.v2.source_http_error', { status: response.status }));
      const text = await readResponse(response);
      if (!active(operation)) return;
      let raw: unknown;
      try { raw = importKind === 'tags' && /\.txt$/i.test(parsed.pathname) ? text : JSON.parse(text); }
      catch { throw new Error(locale.t('prompt_studio.v2.invalid_json')); }
      accept(raw, operation.scope);
    } catch (failure) {
      if (active(operation)) error = abort.signal.aborted ? locale.t('prompt_studio.v2.source_timeout') : failure instanceof TypeError ? locale.t('prompt_studio.v2.source_fetch_failed') : failure instanceof Error ? failure.message : locale.t('prompt_studio.v2.import_failed');
    } finally {
      clearTimeout(timeout);
      abort.abort();
      if (operation.id === request) { busy = false; controller = undefined; }
    }
  }
  function loadPending() {
    if (management || !pending || pending.scope !== customCatalog.scope) { pending = null; return; }
    const name = pending.snapshot.name;
    if (!studio.loadPreset(pending.snapshot)) { error = locale.t('prompt_studio.v2.invalid_source'); return; }
    pending = null; result = locale.t('prompt_studio.v2.set_loaded', { name });
  }
  function saveSet(event: SubmitEvent) {
    event.preventDefault(); error = ''; result = '';
    if (!setName.trim()) return;
    studio.preset(setName);
    result = locale.t('prompt_studio.v2.set_saved', { name: setName.trim() });
    setName = '';
  }
  function loadSet(snapshot: StudioSnapshotV1, name: string) {
    if (management) return;
    error = ''; result = '';
    if (studio.loadPreset(snapshot)) result = locale.t('prompt_studio.v2.set_loaded', { name });
    else error = locale.t('prompt_studio.v2.invalid_source');
  }
</script>

<section class="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950" aria-label={locale.t(view === 'sets' ? 'prompt_studio.v2.saved_sets' : 'prompt_studio.v2.sources')}>
  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
    {#if view === 'sets'}<div class="mb-5"><PromptStudioGlobalSets {management} /></div>{/if}
    {#if view === 'sources'}
      <div class="mx-auto flex max-w-2xl flex-col gap-5">
        <header><h3 class="text-sm font-semibold text-neutral-200">{locale.t('prompt_studio.v2.sources_title')}</h3><p class="mt-2 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.sources_hint')}</p></header>
        <label class="flex flex-wrap items-center gap-3 text-xs text-neutral-400">{locale.t('prompt_studio.polish.import_kind')}<select aria-label={locale.t('prompt_studio.polish.import_kind')} bind:value={importKind} disabled={busy} class="touch-target rounded-lg border border-neutral-700 bg-neutral-900 px-3"><option value="tags">{locale.t('prompt_studio.polish.import_tags')}</option>{#if !management}<option value="prompt">{locale.t('prompt_studio.polish.import_prompt')}</option>{/if}</select></label><p class="text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.polish.import_kind_hint')}</p>
        <section class="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h4 class="flex items-center gap-2 text-xs font-medium text-neutral-200"><FolderOpen size={17} class="text-amber-300" />{locale.t('prompt_studio.v2.local_source')}</h4>
          <p class="mt-2 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.local_source_hint')}</p>
          <div class="mt-4 flex flex-wrap gap-2"><button type="button" disabled={!customCatalog.ready || busy} class="touch-target flex items-center gap-2 rounded-lg bg-amber-400 px-4 text-xs font-medium text-neutral-950 disabled:opacity-40" onclick={() => input?.click()}><Upload size={15} />{locale.t('prompt_studio.v2.choose_source')}</button><button type="button" disabled={!customCatalog.ready || busy} class="touch-target flex items-center gap-2 rounded-lg border border-neutral-700 px-4 text-xs text-neutral-300 disabled:opacity-40" onclick={() => customCatalog.export()}><Download size={15} />{locale.t('prompt_studio.v2.export_library')}</button></div>
          <input type="file" accept="application/json,text/plain,.json,.txt" bind:this={input} onchange={importFile} class="hidden" />
        </section>
        <section class="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h4 class="flex items-center gap-2 text-xs font-medium text-neutral-200"><Link size={17} class="text-amber-300" />{locale.t('prompt_studio.v2.url_source')}</h4>
          <form class="mt-3 flex flex-wrap gap-2" onsubmit={importUrl}><label class="min-w-40 flex-1"><span class="sr-only">{locale.t('prompt_studio.v2.source_url')}</span><input type="url" bind:value={url} required placeholder={locale.t('prompt_studio.v2.source_url_placeholder')} class="touch-target w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200 outline-none focus:border-amber-400" /></label><button type="submit" disabled={!customCatalog.ready || busy || !url.trim()} class="touch-target flex items-center gap-2 rounded-lg border border-neutral-700 px-4 text-xs text-neutral-200 disabled:opacity-40"><Upload size={15} />{locale.t('prompt_studio.v2.import_url')}</button></form>
          <p class="mt-3 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.url_source_hint')}</p>
        </section>
        {#if pending && pending.scope === customCatalog.scope}
          <section class="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4"><h4 class="flex items-center gap-2 text-xs font-medium text-amber-300"><FileJson size={17} />{pending.snapshot.name}</h4><p class="mt-2 text-xs text-neutral-400">{locale.t('prompt_studio.v2.pending_set', { count: locale.formatInteger(pending.snapshot.selected.length) })}</p>{#if pending.snapshot.rawPrompt}<p class="mt-3 line-clamp-3 break-words rounded-lg bg-neutral-950 p-3 font-mono text-xs text-neutral-400">{pending.snapshot.rawPrompt}</p>{/if}{#each pending.snapshot.groups ?? [] as group}<p class="mt-2 break-words rounded-lg bg-neutral-950 p-3 text-xs text-neutral-400"><strong>{group.name}</strong><span class="mt-1 block line-clamp-3 whitespace-pre-wrap">{group.content}</span></p>{/each}<p class="mt-3 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.load_set_hint')}</p><div class="mt-3 flex gap-2"><button type="button" class="touch-target rounded-lg bg-amber-400 px-4 text-xs font-medium text-neutral-950" disabled={management} onclick={loadPending}>{locale.t('prompt_studio.v2.load_imported_set')}</button><button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-400" onclick={() => pending = null}>{locale.t('prompt_studio.v2.cancel')}</button></div></section>
        {/if}
      </div>
    {:else}
      <div class="mx-auto flex max-w-2xl flex-col gap-5">
        <header><h3 class="text-sm font-semibold text-neutral-200">{locale.t('prompt_studio.polish.saved_prompts')}</h3><p class="mt-2 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.saved_sets_hint')}</p></header>
        {#if !management}<form class="rounded-xl border border-neutral-800 bg-neutral-900 p-4" onsubmit={saveSet}><label class="text-xs font-medium text-neutral-300">{locale.t('prompt_studio.v2.set_name')}<input bind:value={setName} placeholder={locale.t('prompt_studio.v2.set_name_placeholder')} class="touch-target mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200 outline-none focus:border-amber-400" /></label><div class="mt-3 flex flex-wrap gap-2"><button type="submit" disabled={!setName.trim()} class="touch-target flex items-center gap-2 rounded-lg bg-amber-400 px-4 text-xs font-medium text-neutral-950 disabled:opacity-40"><Save size={15} />{locale.t(replacesSet ? 'prompt_studio.v2.update_set' : 'prompt_studio.v2.save_set')}</button><button type="button" class="touch-target flex items-center gap-2 rounded-lg border border-neutral-700 px-4 text-xs text-neutral-300" onclick={() => studio.exportPreset()}><Download size={15} />{locale.t('prompt_studio.v2.export_draft')}</button></div></form>{/if}
        {#if studio.presets.length}
          <label><span class="sr-only">{locale.t('prompt_studio.v2.search_sets')}</span><input type="search" bind:value={query} placeholder={locale.t('prompt_studio.v2.search_sets')} class="touch-target w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-xs text-neutral-200 outline-none focus:border-amber-400" /></label>
          <p class="text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.load_set_hint')}</p>
          <div class="flex flex-col gap-2">
            {#each sets as preset (preset.name)}
              <article class="rounded-xl border border-neutral-800 bg-neutral-900 p-3"><div class="mb-2 flex items-center gap-2"><FileJson size={16} class="shrink-0 text-amber-300" /><h4 class="min-w-0 flex-1 truncate text-xs font-medium text-neutral-200">{preset.name}</h4><span class="text-xs text-neutral-500">{locale.t('prompt_studio.v2.tag_results', { count: locale.formatInteger(preset.snapshot.selected?.length ?? 0) })}</span></div><div class="flex flex-wrap gap-2">{#if deleting === preset.name}<p class="w-full text-xs text-neutral-400">{locale.t('prompt_studio.v2.delete_set_hint', { name: preset.name })}</p><button type="button" class="touch-target rounded-lg border border-red-900/60 px-3 text-xs text-red-300" onclick={() => { studio.deletePreset(preset.name); deleting = ''; }}>{locale.t('prompt_studio.v2.delete_set')}</button><button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-400" onclick={() => deleting = ''}>{locale.t('prompt_studio.v2.cancel')}</button>{:else}{#if !management}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-4 text-xs text-neutral-200" onclick={() => loadSet(preset.snapshot, preset.name)}>{locale.t('prompt_studio.v2.load_set')}</button>{/if}<button type="button" aria-label={locale.t('prompt_studio.v2.export_named', { name: preset.name })} class="touch-target flex items-center gap-2 rounded-lg border border-neutral-800 px-3 text-xs text-neutral-400" onclick={() => studio.exportPreset(preset.name)}><Download size={14} />{locale.t('prompt_studio.v2.export_set')}</button><button type="button" aria-label={locale.t('prompt_studio.v2.delete_named', { name: preset.name })} class="touch-target ml-auto rounded-lg p-3 text-neutral-500 hover:text-red-300" onclick={() => deleting = preset.name}><Trash2 size={15} /></button>{/if}</div></article>
            {/each}
          </div>
          {#if !sets.length}<p class="py-5 text-center text-xs text-neutral-500">{locale.t('prompt_studio.v2.no_results_hint')}</p>{/if}
        {:else}<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-800 p-7 text-center"><Save size={27} class="text-neutral-600" /><p class="text-xs text-neutral-500">{locale.t('prompt_studio.v2.empty_sets')}</p></div>{/if}
      </div>
    {/if}
    {#if busy || error || result}<div class="mx-auto mt-5 max-w-2xl">{#if busy}<div role="status" class="flex items-center gap-3 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-400"><span class="flex-1">{locale.t('prompt_studio.v2.importing_source')}</span><button type="button" aria-label={locale.t('prompt_studio.v2.cancel')} class="touch-target rounded-lg p-2 text-neutral-400" onclick={cancel}><X size={15} /></button></div>{/if}{#if error}<p role="alert" class="rounded-lg border border-red-900/40 bg-red-950/10 p-3 text-xs leading-relaxed text-red-300">{error}</p>{/if}{#if result}<p role="status" class="flex items-start gap-2 rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3 text-xs leading-relaxed text-emerald-300"><Check size={15} class="mt-0.5 shrink-0" />{result}</p>{/if}</div>{/if}
  </div>
</section>
