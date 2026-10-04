<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { locale } from '../../stores/locale.svelte.js';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import type { StudioKind } from '../../prompt-studio/presets.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { workspace } from '../../prompt-studio/workspace.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { userScopedKey } from '../../utils/ipc.js';
  import { collectionIndex, loadCollectionAsset, type CollectionEntry, modeCollections, collectionInMode, collectionGroupKey } from '../../prompt-studio/collections.js';
  import { resolveTemplate, wardrobeCompatibility, artistPrompt, type Dictionaries, type Relations } from '../../prompt-studio/collection-tools.js';
  let scroller = $state<HTMLDivElement>();
  const previewKey = (tag: string) => tag.replaceAll(' ', '_').replace(/\\([()[\]])/g, '$1');
  let { management = false, mode }: { management?: boolean; mode?: StudioKind } = $props();
  let copying = $state(false);
  async function copyGlobal() { copying = true; try { await library.copyCollection(collection); } finally { copying = false; } }
  const initial = untrack(() => restoreTool(`collections-${mode ?? 'library'}`, { collection: mode === 'wardrobe' ? 'wardrobe' : mode === 'scene' ? 'composition' : 'characters', query: '', group: '', set: -1, page: 0, prefix: false }));
  let collection = $state(initial.collection);
  const available = $derived(collectionIndex.collections.filter(row => !mode || (modeCollections[mode] as readonly string[]).includes(row.id)));
  $effect(() => { if (!available.some(row => row.id === collection)) collection = available[0].id; });
  $effect(() => { saveTool(`collections-${mode ?? 'library'}`, { collection, query, group, set, page, prefix }); });
  let rows = $state.raw<CollectionEntry[]>([]);
  let query = $state(initial.query); let search = $state(initial.query.toLowerCase().trim()); let group = $state(initial.group); let set = $state(initial.set); let page = $state(initial.page);
  let prefix = $state(initial.prefix); let busy = $state(false); let failed = $state(false);
  let inspecting = $state<CollectionEntry>(); let preview = $state(''); let unresolved = $state(false);
  let dictionaries = $state.raw<Dictionaries>({}); let relations = $state.raw<Relations>();
  let previews = $state.raw<{ open: string[]; closed: string[]; extensions: Record<string, string>; poses: Record<string, string>; journal: { дни?: unknown[] }; status: { t?: string }; blurred: Record<string, string>; restricted: string[] }>();
  let sequence = 0; let alive = true;
  const current = $derived(collectionIndex.collections.find(item => item.id === collection)!);
  const artistSets = $derived(collectionIndex.collections.find(item => item.id === 'artists')!.sets ?? []);
  const zoneRows = $derived(rows.filter(row => collectionInMode(row, collection, mode)));
  const groups = $derived([...new Set(zoneRows.map(row => row.group))]);
  const filtered = $derived(zoneRows.filter(row => (!group || row.group === group) && (set < 0 || !!((row.memberships ?? 0) & (1 << set))) && (!search || `${row.name} ${row.tag} ${row.description ?? ''}`.toLowerCase().includes(search))));
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / 60)));
  const visible = $derived(filtered.slice(page * 60, page * 60 + 60));
  const compatibility = $derived(inspecting && relations && collection === 'wardrobe' ? wardrobeCompatibility(relations, inspecting.tag, studio.selected.map(item => item.tag)) : []);
  const profileIndex = $derived(inspecting && relations ? relations.worlds.tags.indexOf(inspecting.tag) : -1);
  const scope = $derived(userScopedKey('mooshie.prompt-studio.collections'));
  $effect(() => {
    const id = collection; const owner = scope; const revision = ++sequence;
    inspecting = undefined; busy = true; failed = false;
    library.fetch(id).then(() => { if (library.failed.includes(id)) throw new Error('Collection unavailable'); return library.databases[id] ?? []; }).then(result => { if (alive && revision === sequence && owner === userScopedKey('mooshie.prompt-studio.collections')) rows = result; }).catch(() => { if (alive && revision === sequence) failed = true; }).finally(() => { if (alive && revision === sequence) busy = false; });
  });
  $effect(() => { const value = query.toLowerCase().trim(); const timer = setTimeout(() => { search = value; }, 150); return () => clearTimeout(timer); });
  $effect(() => { if (page >= pages) page = pages - 1; });
  loadCollectionAsset<Dictionaries>('dictionaries.json').then(value => { if (alive) dictionaries = value; }).catch(() => { if (alive) failed = true; });
  loadCollectionAsset<Relations>('wardrobe-relations.json').then(value => { if (alive) relations = value; }).catch(() => {});
  loadCollectionAsset<NonNullable<typeof previews>>('preview-info.json').then(value => { if (alive) previews = value; }).catch(() => {});
  onDestroy(() => { alive = false; sequence++; });
  function review(row: CollectionEntry) {
    inspecting = row;
    const result = resolveTemplate(row.tag, dictionaries);
    preview = current.kind === 'artist' ? artistPrompt(row.tag, prefix) : result.text;
    unresolved = result.unresolved;
    void tick().then(() => scroller?.scrollTo({ top: 0 }));
  }
  function add(row: CollectionEntry) {
    if (current.kind === 'template' || /(?<!\\)\{/.test(row.tag) || collection === 'wardrobe') { review(row); return; }
    if (management) { review(row); return; }
    const tag = current.kind === 'artist' ? artistPrompt(row.tag, prefix) : row.tag;
    if (studio.selected.some(item => item.tag === tag)) studio.remove(tag);
    else studio.addMany([{ tag, name: row.name, category: `collection:${collection}:${row.group}` }]);
  }
</script>
<section class="flex h-full min-h-0 flex-col gap-3 overflow-hidden" aria-label={locale.t('prompt_studio.collections.title')}>
  <div class="flex shrink-0 flex-wrap gap-2">{#if management}<button type="button" disabled={copying || busy || failed || !customCatalog.ready} onclick={() => void copyGlobal()} class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-amber-300 disabled:opacity-30">{locale.t(copying ? 'prompt_studio.loading' : 'prompt_studio.library.copy_global')}</button>{:else}{#if ['characters', 'wardrobe', 'composition'].includes(collection)}{#each ['build', 'mix', 'editor'] as view}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300" onclick={() => { const mode = collection === 'characters' ? 'character' : collection === 'wardrobe' ? 'wardrobe' : 'scene'; library.select(mode, 'database'); workspace.setGuidedMode(mode); workspace.setView(view as 'build' | 'mix' | 'editor'); }}>{locale.t('prompt_studio.library.use_in', { mode: locale.t(`prompt_studio.v2.view_${view}`) })}</button>{/each}{/if}{/if}</div>
  <p class="shrink-0 text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.collections.hint')}</p>
  <div class="flex shrink-0 flex-wrap gap-2">
    <select bind:value={collection} aria-label={locale.t('prompt_studio.collections.choose')} class="touch-target min-w-0 max-w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-200">
      {#each available as item}<option value={item.id}>{locale.t(`prompt_studio.collections.${item.id}`)} · {locale.formatInteger(item.count)}</option>{/each}
    </select>
    <input type="search" bind:value={query} aria-label={locale.t('prompt_studio.search')} placeholder={locale.t('prompt_studio.search')} class="touch-target min-w-32 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200" />
    {#if current.kind === 'artist'}
      <select bind:value={set} aria-label={locale.t('prompt_studio.collections.artist_set')} class="touch-target min-w-0 max-w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-300"><option value={-1}>{locale.t('prompt_studio.collections.all_sets')}</option>{#each artistSets as item, i}<option value={i}>{locale.t(`prompt_studio.collections.set_${item.id}`)}</option>{/each}</select>
      <label class="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" bind:checked={prefix} class="accent-amber-400" />{locale.t('prompt_studio.collections.artist_prefix')}</label>
    {:else}
      <select bind:value={group} aria-label={locale.t('prompt_studio.collections.category')} class="touch-target min-w-0 max-w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-300"><option value="">{locale.t('prompt_studio.collections.all_categories')}</option>{#each groups as value}<option value={value}>{locale.t(collectionGroupKey(value))}</option>{/each}</select>
    {/if}
  </div>
  {#if busy}<p role="status" class="py-8 text-sm text-neutral-400">{locale.t('common.loading')}</p>
  {:else if failed}<p role="alert" class="py-8 text-sm text-red-300">{locale.t('prompt_studio.collections.failed')}</p>
  {:else}
    <div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {#if inspecting}
        <div class="mb-4 rounded-xl border border-amber-400/30 bg-neutral-900 p-4">
          <div class="flex items-start justify-between gap-3"><h3 class="break-words text-sm font-medium text-neutral-100">{inspecting.name}</h3><button type="button" class="touch-target shrink-0 px-2 text-xs text-neutral-400" onclick={() => inspecting = undefined}>{locale.t('common.close')}</button></div>
          {#if inspecting.description}<p class="mt-2 text-xs leading-relaxed text-neutral-400">{inspecting.description}</p>{/if}
          <textarea bind:value={preview} aria-label={locale.t('prompt_studio.collections.preview')} class="mt-3 min-h-24 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs text-neutral-200"></textarea>
          {#if unresolved}<p class="mt-2 text-xs text-amber-300">{locale.t('prompt_studio.collections.unresolved')}</p>{/if}
          <div class="mt-2 flex flex-wrap gap-2"><button type="button" class="touch-target rounded-lg bg-amber-400 px-3 text-xs font-medium text-neutral-950 disabled:opacity-40" disabled={management || !preview.trim() || /(?<!\\)\{(?:@|[^{}]*\|)/.test(preview)} onclick={() => studio.addGroup(inspecting!.name, preview.trim())}>{locale.t('prompt_studio.v2.tools.add_group')}</button>{#if current.kind === 'template' || /(?<!\\)\{/.test(inspecting.tag)}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300" onclick={() => review(inspecting!)}>{locale.t('prompt_studio.collections.reroll')}</button>{/if}</div>
          {#if inspecting.context?.length}<div class="mt-3"><p class="text-xs text-neutral-500">{locale.t('prompt_studio.collections.context')}</p><div class="mt-1 flex flex-wrap gap-1">{#each inspecting.context as tag}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300" disabled={management} onclick={() => studio.addMany([{ tag, category: 'collection:context' }])}>+ {tag}</button>{/each}</div></div>{/if}
          {#if inspecting.negative?.length}<p class="mt-3 text-xs text-neutral-500">{locale.t('prompt_studio.collections.negative')}</p><textarea readonly value={inspecting.negative.join(', ')} aria-label={locale.t('prompt_studio.collections.negative')} class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-400"></textarea>{/if}
          {#if collection === 'characters' && previews}<p class="mt-3 text-xs text-neutral-500">{locale.t(previews.open.includes(previewKey(inspecting.tag)) ? 'prompt_studio.collections.preview_open' : previews.closed.includes(previewKey(inspecting.tag)) ? 'prompt_studio.collections.preview_closed' : 'prompt_studio.collections.preview_missing')}</p>{/if}
          {#if collection === 'characters' && previews?.blurred[previewKey(inspecting.tag)]}<figure class="mt-3"><img src={`data:image/webp;base64,${previews.blurred[previewKey(inspecting.tag)]}`} alt={locale.t('prompt_studio.collections.blurred_preview')} width="120" height="120" class="h-28 w-28 rounded-xl object-cover" /><figcaption class="mt-1 text-xs text-neutral-500">{locale.t('prompt_studio.collections.blurred_preview')}</figcaption></figure>{/if}
          {#if collection === 'wardrobe' && profileIndex >= 0 && relations}<details class="mt-3 text-xs text-neutral-400"><summary class="touch-target cursor-pointer">{locale.t('prompt_studio.collections.profile')}</summary>{#each Object.entries(relations.worlds.axes) as [axis, values]}<div class="mt-2 flex items-center gap-3"><span class="w-24">{locale.t(`prompt_studio.collections.axis_${axis}`)}</span><progress value={values[profileIndex]} max="255" aria-label={locale.t(`prompt_studio.collections.axis_${axis}`)} class="h-1.5 min-w-0 flex-1 accent-amber-400"></progress><span class="tabular-nums">{Math.round(values[profileIndex] / 255 * 100)}%</span></div>{/each}<p class="mt-2 text-neutral-500">{locale.t('prompt_studio.collections.profile_hint')}</p></details>{/if}
          {#if compatibility.length}<div class="mt-3 border-t border-neutral-800 pt-3"><p class="mb-2 text-xs font-medium text-neutral-300">{locale.t('prompt_studio.collections.compatibility')}</p>{#each compatibility as relation}<p class="mb-1 text-xs {relation.level === 'conflict' ? 'text-amber-300' : 'text-neutral-400'}">{locale.t(`prompt_studio.collections.${relation.level}`)}: {relation.other}{#if relation.worlds} · {relation.worlds.join(' / ')}{/if}{#if relation.score !== undefined} · {relation.score.toFixed(2)}{/if}</p>{/each}<p class="mt-2 text-xs text-neutral-500">{locale.t('prompt_studio.collections.compatibility_hint')}</p></div>{/if}
        </div>
      {/if}
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
        {#each visible as row (row.id)}
          {@const chosen = studio.selected.some(item => item.tag === (current.kind === 'artist' ? artistPrompt(row.tag, prefix) : row.tag))}
          <div class="flex min-w-0 items-stretch rounded-xl border {chosen ? 'border-amber-400/50 bg-amber-400/5' : 'border-neutral-800 bg-neutral-900/40'}">
            <button type="button" aria-pressed={chosen} class="touch-target min-w-0 flex-1 rounded-l-xl p-3 text-left hover:bg-neutral-800" onclick={() => add(row)}><span class="block break-words text-xs text-neutral-200">{#if chosen}<span class="mr-1 text-amber-300">✓</span>{/if}{row.name}</span><span class="mt-1 block truncate text-[10px] text-neutral-500">{row.count != null ? `${locale.t('prompt_studio.collections.artworks')}: ${locale.formatInteger(row.count)}` : row.group.replaceAll('_', ' ')}</span></button>
            <button type="button" class="touch-target shrink-0 rounded-r-xl px-3 text-xs text-neutral-500 hover:text-amber-300" aria-label={`${locale.t('prompt_studio.collections.details')}: ${row.name}`} onclick={() => review(row)}>···</button>
          </div>
        {/each}
      </div>
      {#if !filtered.length}<p class="py-8 text-xs text-neutral-500">{locale.t('prompt_studio.nothing_found')}</p>{/if}
      <details class="mt-4 rounded-xl border border-neutral-800 p-3 text-xs text-neutral-500"><summary class="touch-target cursor-pointer">{locale.t('prompt_studio.collections.about')}</summary><p class="my-2 leading-relaxed">{locale.t('prompt_studio.collections.inventory', { files: collectionIndex.inputFiles, unique: collectionIndex.distinctContent })}</p><p class="leading-relaxed">{locale.t('prompt_studio.collections.images_hint')}</p>{#if previews}<p class="mt-2">{locale.t('prompt_studio.collections.preview_inventory', { characters: Object.keys(previews.extensions).length, poses: Object.keys(previews.poses).length, days: previews.journal.дни?.length ?? 0 })}</p>{#if previews.status.t}<p class="mt-2">{locale.t('prompt_studio.collections.updated', { date: previews.status.t.slice(0, 10) })}</p>{/if}{/if}</details>
    </div>
    <nav class="flex shrink-0 flex-wrap items-center gap-2 border-t border-neutral-800 pt-2" aria-label={locale.t('prompt_studio.v2.catalog_pagination')}><p class="mr-auto text-xs text-neutral-500">{locale.t('prompt_studio.v2.catalog_page_range', { start: filtered.length ? page * 60 + 1 : 0, end: Math.min((page + 1) * 60, filtered.length), total: locale.formatInteger(filtered.length) })}</p><button type="button" disabled={page === 0} class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300 disabled:opacity-30" onclick={() => page--}>{locale.t('prompt_studio.v2.catalog_previous_page')}</button><button type="button" disabled={page >= pages - 1} class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300 disabled:opacity-30" onclick={() => page++}>{locale.t('prompt_studio.v2.catalog_next_page')}</button></nav>
  {/if}
</section>
