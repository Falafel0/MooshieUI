<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { parseGlobalSet, type CatalogDomain, type CustomCatalogEntry } from '../../prompt-studio/catalog-model.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { X } from '@lucide/svelte';
  let dialog = $state<HTMLDialogElement>();
  let name = $state(''), text = $state(''), error = $state('');
  let domains = $state<CatalogDomain[]>([]);
  let busy = $state(false);
  let revision = 0;
  let view = $state<'metadata' | 'json'>('metadata');
  let draftRows = $state.raw<CustomCatalogEntry[]>([]);
  let selectedId = $state(''), search = $state(''), page = $state(0);
  let tagName = $state(''), tagValue = $state(''), description = $state(''), aliases = $state(''), modifiers = $state(''), subId = $state('');
  let dirtyTag = $state(false);
  const editing = $derived(draftRows.find(row => row.id === selectedId));
  const filtered = $derived(draftRows.filter(row => `${row.name} ${row.tag} ${row.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  const currentPage = $derived(Math.min(page, Math.max(0, Math.ceil(filtered.length / 60) - 1)));
  $effect(() => { const row = editing; untrack(() => { tagName = row?.name ?? ''; tagValue = row?.tag ?? ''; description = row?.description ?? ''; aliases = row?.aliases?.join('\n') ?? ''; modifiers = row?.contextualTags?.join('\n') ?? ''; subId = row?.subId ?? category?.id ?? ''; dirtyTag = false; }); });
  function applyTag(): boolean {
    if (!selectedId) return true;
    if (!tagValue.trim()) { error = locale.t('prompt_studio.library.invalid_entries'); return false; }
    const lines = (value: string) => [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
    if (draftRows.some(row => row.id !== selectedId && row.subId === subId && row.tag === tagValue.trim())) { error = locale.t('prompt_studio.library.duplicate_tag'); return false; }
    draftRows = draftRows.map(row => row.id === selectedId ? { ...row, name: tagName.trim() || tagValue.trim(), tag: tagValue.trim(), subId, description, aliases: lines(aliases), contextualTags: lines(modifiers) } : row);
    dirtyTag = false; error = ''; return true;
  }
  function selectTag(id: string) { if (dirtyTag && !applyTag()) return; selectedId = id; }
  function addTag() {
    if (dirtyTag && !applyTag()) return;
    const id = crypto.randomUUID();
    draftRows = [...draftRows, { id, name: '', tag: '', subId: category?.id ?? '' }];
    selectedId = id; search = ''; dirtyTag = true;
  }
  function changeView(next: 'metadata' | 'json') {
    if (view === next) return;
    if (next === 'json') { if (dirtyTag && !applyTag()) return; text = JSON.stringify(draftRows, null, 2); }
    else { try { draftRows = parseGlobalSet(text, 'json', category?.id ?? ''); } catch { error = locale.t('prompt_studio.v2.invalid_json'); return; } }
    view = next; error = '';
  }

  const category = $derived(customCatalog.categories.find(row => row.id === library.editingSet));
  const buckets = $derived(category ? new Set([category.id, ...category.subs.map(row => row.id)]) : new Set<string>());
  const owner = customCatalog.scope;
  let baseline: CustomCatalogEntry[] = [];
  $effect(() => {
    const id = library.editingSet; const modal = dialog;
    untrack(() => {
      baseline = category ? customCatalog.entries.filter(row => buckets.has(row.subId)) : library.newSetDraft?.entries ?? [];
      name = category?.name ?? library.newSetDraft?.name ?? ''; domains = [...(category?.domains ?? [])];
      draftRows = JSON.parse(JSON.stringify(baseline)); selectedId = draftRows[0]?.id ?? ''; text = ''; error = '';
      if (id !== undefined && modal && !modal.open) modal.showModal();
    });
  });
  onDestroy(() => { revision++; });
  function close() { if (busy) return; revision++; dialog?.close(); library.editingSet = undefined; }
  async function read(event: Event) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file) return;
    const current = ++revision; busy = true; error = '';
    try {
      const value = await file.text();
      if (current !== revision || owner !== customCatalog.scope) return;
      draftRows = parseGlobalSet(value, /\.txt$/i.test(file.name) ? 'txt' : 'json', category?.id ?? '', baseline);
      selectedId = draftRows[0]?.id ?? ''; if (view === 'json') text = JSON.stringify(draftRows, null, 2);
    } catch { if (current === revision) error = locale.t('prompt_studio.v2.invalid_json'); }
    finally { if (current === revision) busy = false; }
  }
  async function save() {
    if (busy || owner !== customCatalog.scope || !name.trim()) return;
    error = '';
    let rows: CustomCatalogEntry[];
    try {
      if (view === 'metadata' && dirtyTag && !applyTag()) return;
      rows = view === 'metadata' ? draftRows : parseGlobalSet(text, 'json', category?.id ?? '');
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.tag !== 'string' || !row.tag.trim() || (category && !buckets.has(row.subId)))) throw new Error();
    } catch { error = locale.t('prompt_studio.library.invalid_entries'); return; }
    const id = category?.id ?? customCatalog.addCategory(name);
    if (!id) { error = locale.t('prompt_studio.import_failed'); return; }
    if (!category) rows = rows.map(row => ({ ...row, subId: id }));
    if (!customCatalog.replaceSet(id, name, domains, rows)) { error = locale.t('prompt_studio.import_failed'); return; }
    busy = true;
    const saved = await customCatalog.flushed(); busy = false;
    if (owner !== customCatalog.scope) return;
    if (!saved) { error = locale.t('prompt_studio.storage_error'); return; }
    close();
  }
</script>
<dialog bind:this={dialog} oncancel={event => { event.preventDefault(); close(); }} aria-label={locale.t('prompt_studio.library.edit_global')} class="fixed inset-0 m-auto h-[min(900px,94dvh)] w-[min(1000px,calc(100%_-_24px))] flex-col gap-4 overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 p-4 text-neutral-200 shadow-2xl backdrop:bg-black/75 open:flex sm:p-6">
  <header class="flex shrink-0 items-center gap-3"><div class="min-w-0 flex-1"><h2 class="text-sm font-semibold">{locale.t('prompt_studio.library.edit_global')}</h2><p class="mt-1 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.library.manage_hint')}</p></div><button type="button" disabled={busy} aria-label={locale.t('common.close')} onclick={close} class="ui-control rounded-lg p-3 text-neutral-400 disabled:opacity-30"><X size={18} /></button></header>
  <label class="shrink-0 text-xs text-neutral-400">{locale.t('prompt_studio.v2.set_name')}<input bind:value={name} class="ui-control mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-200" /></label>
  <fieldset class="flex shrink-0 flex-wrap gap-4 text-xs text-neutral-400"><legend class="mb-2">{locale.t('prompt_studio.library.domains')}</legend>{#each ['character', 'wardrobe', 'scene'] as domain}<label class="ui-control flex items-center gap-2"><input type="checkbox" checked={domains.includes(domain as CatalogDomain)} onchange={event => domains = event.currentTarget.checked ? [...domains, domain as CatalogDomain] : domains.filter(row => row !== domain)} class="accent-indigo-400" />{locale.t(`prompt_studio.v2.mode_${domain}`)}</label>{/each}</fieldset>
  <nav class="flex shrink-0 gap-2"><button type="button" aria-pressed={view === 'metadata'} onclick={() => changeView('metadata')} class="ui-control rounded-lg border border-neutral-700 px-3 text-xs {view === 'metadata' ? 'bg-neutral-800 text-indigo-300' : 'text-neutral-400'}">{locale.t('prompt_studio.library.meta_editor')}</button><button type="button" aria-pressed={view === 'json'} onclick={() => changeView('json')} class="ui-control rounded-lg border border-neutral-700 px-3 text-xs {view === 'json' ? 'bg-neutral-800 text-indigo-300' : 'text-neutral-400'}">{locale.t('prompt_studio.library.bulk_editor')}</button></nav>
  {#if view === 'json'}
    <p class="shrink-0 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.library.bulk_hint')}</p>
    <label class="flex min-h-0 flex-1 flex-col gap-2 text-xs text-neutral-400">{locale.t('prompt_studio.library.entries_json')}<textarea bind:value={text} spellcheck="false" class="min-h-32 flex-1 resize-none rounded-xl border border-neutral-700 bg-neutral-900 p-3 font-mono text-xs text-neutral-200"></textarea></label>
  {:else}
    <div class="grid min-h-0 flex-1 grid-rows-[minmax(120px,35%)_minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(180px,35%)_minmax(0,1fr)] sm:grid-rows-[minmax(0,1fr)]">
      <section class="flex min-h-0 flex-col gap-2 rounded-xl border border-neutral-800 p-3"><div class="flex shrink-0 gap-2"><input type="search" bind:value={search} aria-label={locale.t('prompt_studio.search')} placeholder={locale.t('prompt_studio.search')} class="ui-control min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-xs" /><button type="button" onclick={addTag} aria-label={locale.t('prompt_studio.v2.add_tag')} class="ui-control rounded-lg border border-neutral-700 px-3 text-indigo-300">+</button></div><div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">{#each filtered.slice(currentPage * 60, (currentPage + 1) * 60) as row (row.id)}<button type="button" aria-pressed={selectedId === row.id} onclick={() => selectTag(row.id)} class="ui-control block w-full truncate rounded-lg px-2 text-left text-xs {selectedId === row.id ? 'bg-neutral-800 text-indigo-300' : 'text-neutral-400'}">{row.name || row.tag || locale.t('prompt_studio.v2.add_tag')}</button>{/each}</div><div class="flex shrink-0 flex-wrap items-center justify-between gap-1 text-xs text-neutral-500"><button type="button" aria-label={locale.t('prompt_studio.v2.catalog_previous_page')} disabled={!currentPage} onclick={() => page = currentPage - 1} class="ui-control rounded-lg px-2 disabled:opacity-30">←</button><span>{currentPage + 1} / {Math.max(1, Math.ceil(filtered.length / 60))} · {locale.formatInteger(filtered.length)}</span><button type="button" aria-label={locale.t('prompt_studio.v2.catalog_next_page')} disabled={(currentPage + 1) * 60 >= filtered.length} onclick={() => page = currentPage + 1} class="ui-control rounded-lg px-2 disabled:opacity-30">→</button></div></section>
      <section class="min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-neutral-800 p-3">{#if editing}<form class="space-y-3" oninput={() => dirtyTag = true} onsubmit={event => { event.preventDefault(); applyTag(); }}><label class="block text-xs text-neutral-400">{locale.t('prompt_studio.custom_name')}<input bind:value={tagName} class="ui-control mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-neutral-200" /></label><label class="block text-xs text-neutral-400">{locale.t('prompt_studio.custom_tag')}<input bind:value={tagValue} class="ui-control mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 font-mono text-neutral-200" /></label>{#if category}<label class="block text-xs text-neutral-400">{locale.t('prompt_studio.collections.category')}<select bind:value={subId} class="ui-control mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-neutral-200"><option value={category.id}>{category.name}</option>{#each category.subs as sub}<option value={sub.id}>{sub.name}</option>{/each}</select></label>{/if}<label class="block text-xs text-neutral-400">{locale.t('prompt_studio.description')}<textarea bind:value={description} rows={2} class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-neutral-200"></textarea></label><label class="block text-xs text-neutral-400">{locale.t('prompt_studio.aliases')}<textarea bind:value={aliases} rows={2} class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-neutral-200"></textarea></label><label class="block text-xs text-neutral-400">{locale.t('prompt_studio.contextual_tags')}<textarea bind:value={modifiers} rows={3} class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-neutral-200"></textarea></label><p class="text-xs text-neutral-500">{locale.t('prompt_studio.library.meta_hint')}</p><div class="flex flex-wrap gap-2"><button type="submit" class="ui-control rounded-lg border border-neutral-700 px-3 text-xs text-indigo-300">{locale.t('prompt_studio.library.apply_meta')}</button><button type="button" class="ui-control rounded-lg border border-red-900 px-3 text-xs text-red-300" onclick={() => { draftRows = draftRows.filter(row => row.id !== selectedId); selectedId = ''; dirtyTag = false; }}>{locale.t('prompt_studio.delete')}</button></div></form>{:else}<button type="button" onclick={addTag} class="ui-control rounded-lg border border-neutral-700 px-3 text-xs text-indigo-300">{locale.t('prompt_studio.v2.add_tag')}</button>{/if}</section>
    </div>
  {/if}
  <footer class="flex shrink-0 flex-wrap items-center gap-3"><label class="ui-control flex min-w-0 flex-1 items-center text-xs text-neutral-400">{locale.t('prompt_studio.library.read_file')}<input type="file" accept=".txt,.json,text/plain,application/json" disabled={busy} onchange={read} class="ml-2 min-w-0 w-48 text-xs" /></label><button type="button" disabled={busy} onclick={close} class="ui-control rounded-lg border border-neutral-700 px-4 text-xs">{locale.t('common.cancel')}</button><button type="button" disabled={busy || !name.trim()} onclick={() => void save()} class="ui-control rounded-lg bg-indigo-400 px-4 text-xs font-medium text-neutral-950 disabled:opacity-40">{locale.t(busy ? 'prompt_studio.loading' : 'common.save')}</button></footer>
  {#if error}<p role="alert" class="shrink-0 text-xs text-red-300">{error}</p>{/if}
</dialog>
