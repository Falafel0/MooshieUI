<script lang="ts">
  import { Check, Copy, Lock, Palette, Plus, Shuffle, Unlock, X } from '@lucide/svelte';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { artistPrompt } from '../../prompt-studio/collection-tools.js';
  import { collectionIndex } from '../../prompt-studio/collections.js';
  import PromptStudioDatabase from './PromptStudioDatabase.svelte';
  import { restoreTool, saveTool } from '../../prompt-studio/tool-state.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { formatWeightedTag, type WeightFormat } from '../../prompt-studio/weight-converter.js';
  import { locale } from '../../stores/locale.svelte.js';

  type Family = 'medium' | 'style' | 'light' | 'local' | 'artists';
  type StyleOption = { id: string; tag: string; family: Family; key?: string; name?: string };
  type StyleChoice = StyleOption & { weight: number; locked: boolean };
  const curated: StyleOption[] = [
    { id: 'watercolor', tag: 'watercolor painting', family: 'medium', key: 'watercolor' },
    { id: 'oil', tag: 'oil painting, visible brush strokes', family: 'medium', key: 'oil' },
    { id: 'ink', tag: 'ink drawing, expressive linework', family: 'medium', key: 'ink' },
    { id: 'gouache', tag: 'gouache painting, matte colors', family: 'medium', key: 'gouache' },
    { id: 'pencil', tag: 'colored pencil drawing, paper texture', family: 'medium', key: 'pencil' },
    { id: 'pastel', tag: 'soft pastel drawing', family: 'medium', key: 'pastel' },
    { id: 'woodcut', tag: 'woodcut print, bold graphic shapes', family: 'medium', key: 'woodcut' },
    { id: 'collage', tag: 'paper collage, layered cutout shapes', family: 'medium', key: 'collage' },
    { id: 'cinematic', tag: 'cinematic composition, film grain', family: 'style', key: 'cinematic' },
    { id: 'editorial', tag: 'editorial illustration, limited color palette', family: 'style', key: 'editorial' },
    { id: 'storybook', tag: 'storybook illustration, whimsical atmosphere', family: 'style', key: 'storybook' },
    { id: 'artnouveau', tag: 'art nouveau, flowing ornamental lines', family: 'style', key: 'artnouveau' },
    { id: 'graphic', tag: 'graphic novel illustration, high contrast', family: 'style', key: 'graphic' },
    { id: 'minimal', tag: 'minimalist composition, negative space', family: 'style', key: 'minimal' },
    { id: 'retro', tag: 'retro science fiction illustration', family: 'style', key: 'retro' },
    { id: 'isometric', tag: 'isometric illustration, clean geometric shapes', family: 'style', key: 'isometric' },
    { id: 'rim', tag: 'soft rim lighting', family: 'light', key: 'rim' },
    { id: 'golden', tag: 'golden hour lighting, warm highlights', family: 'light', key: 'golden' },
    { id: 'overcast', tag: 'soft overcast lighting', family: 'light', key: 'overcast' },
    { id: 'neon', tag: 'neon lighting, colored reflections', family: 'light', key: 'neon' },
    { id: 'chiaroscuro', tag: 'chiaroscuro lighting, deep shadows', family: 'light', key: 'chiaroscuro' },
    { id: 'mist', tag: 'diffused light, atmospheric mist', family: 'light', key: 'mist' },
    { id: 'backlight', tag: 'backlighting, glowing silhouette', family: 'light', key: 'backlight' },
    { id: 'studio', tag: 'studio lighting, softbox illumination', family: 'light', key: 'studio' },
  ];
  const initial = restoreTool('mixer', { choices: [curated[0], curated[8], curated[16]].map((item, index) => ({ ...item, weight: [1, 0.85, 1.1][index], locked: false })), excluded: [] as StyleOption[], family: 'all', bucket: '', query: '', count: 3, format: 'sd', groupName: '', page: 0, artistSet: -1, artistPrefix: false, minWeight: 0.6, maxWeight: 1.3 });
  let choices = $state<StyleChoice[]>(initial.choices.filter(item => item && typeof item.tag === 'string' && Number.isFinite(item.weight)));
  let artistPrefix = $state(initial.artistPrefix), minWeight = $state(initial.minWeight), maxWeight = $state(initial.maxWeight);
  let artistSet = $state(initial.artistSet);
  let page = $state(initial.page);
  let excluded = $state<StyleOption[]>(initial.excluded);
  let family = $state<'all' | Family>(initial.family as 'all' | Family);
  let bucket = $state(initial.bucket);
  let query = $state(initial.query);
  let count = $state(initial.count);
  let format = $state<WeightFormat>(initial.format as WeightFormat);
  let groupName = $state(initial.groupName);
  let feedback = $state('');
  let failed = $state(false);
  $effect(() => { const id = library.mixerSet; if (id) { family = 'local'; bucket = id; } });
  const localOptions = $derived(customCatalog.entries
    .filter(entry => !bucket || entry.subId === bucket || customCatalog.categories.find(category => category.id === bucket)?.subs.some(sub => sub.id === entry.subId))
    .map(entry => ({ id: `local:${entry.id}`, tag: entry.tag, family: 'local' as const, name: entry.name })));
  const draftArtists = $derived(studio.selected.filter(item => item.category.startsWith('collection:artists:')).map(item => ({ id: `draft:${item.tag}`, tag: item.tag, family: 'artists' as const, name: item.name })));
  const artistOptions = $derived((library.databases.artists ?? []).filter(row => artistSet < 0 || !!((row.memberships ?? 0) & (1 << artistSet))).map(row => ({ id: `artist:${row.id}`, tag: artistPrompt(row.tag, false), family: 'artists' as const, name: row.name })));
  const styleTags = $derived((library.databases.composition ?? []).filter(row => ['style', 'medium', 'color', 'linework', 'print', 'light_effect', 'shadow'].includes(row.group)).map(row => ({ id: `composition:${row.id}`, tag: row.tag, family: 'style' as const, name: row.name })));
  const generationStyles = $derived((library.databases['generation-styles'] ?? []).map(row => ({ id: `style:${row.id}`, tag: row.tag, family: 'style' as const, name: row.name })));
  const options = $derived(family === 'artists' ? [...artistOptions, ...draftArtists.filter(row => !artistOptions.some(item => item.tag === row.tag))] : family === 'local' ? localOptions : [...curated, ...generationStyles, ...styleTags].filter(item => family === 'all' || item.family === family));
  const visible = $derived(options.filter(item => `${name(item)} ${item.tag}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const currentPage = $derived(Math.min(page, Math.max(0, Math.ceil(visible.length / 60) - 1)));
  $effect(() => { if (family === 'artists') void library.fetch('artists'); if (family === 'style' || family === 'all') { void library.fetch('generation-styles'); void library.fetch('composition'); } });
  $effect(() => { saveTool('mixer', { choices, excluded, family, bucket, query, count, format, groupName, page, artistSet, artistPrefix, minWeight, maxWeight }); });
  const lockedCount = $derived(choices.filter(item => item.locked).length);
  const pool = $derived(options.filter(item => !excluded.some(value => value.tag === item.tag) && !choices.some(value => value.locked && value.tag === item.tag)));
  const canShuffle = $derived(lockedCount < count && new Set(pool.map(item => item.tag)).size >= count - lockedCount);
  const sd = $derived(choices.map(item => formatWeightedTag(artistPrefix && item.family === 'artists' && !item.tag.startsWith('@') ? `@${item.tag}` : item.tag, item.weight, 'sd')).join(', '));
  const nai = $derived(choices.map(item => formatWeightedTag(artistPrefix && item.family === 'artists' && !item.tag.startsWith('@') ? `@${item.tag}` : item.tag, item.weight, 'nai')).join(', '));
  const output = $derived(format === 'sd' ? sd : nai);

  function name(item: StyleOption) { return item.key ? locale.t(`prompt_studio.v2.mixer.style_${item.key}`) : item.name || item.tag; }
  function selected(item: StyleOption) { return choices.some(choice => choice.tag === item.tag); }
  function clearFeedback() { feedback = ''; failed = false; }
  function choose(item: StyleOption) {
    clearFeedback();
    const existing = choices.find(choice => choice.tag === item.tag);
    if (existing) { if (existing.locked || choices.length <= 2) return; choices = choices.filter(choice => choice.tag !== item.tag); }
    else {
      if (choices.length >= 6 || excluded.some(value => value.tag === item.tag)) return;
      choices = [...choices, { ...item, weight: 1, locked: false }];
    }
    count = Math.max(2, choices.length);
  }
  function weight(tag: string, value: number) {
    if (!Number.isFinite(value)) return;
    choices = choices.map(item => item.tag === tag ? { ...item, weight: Math.max(0.1, Math.min(2, value)) } : item);
    clearFeedback();
  }
  function lock(tag: string) { choices = choices.map(item => item.tag === tag ? { ...item, locked: !item.locked } : item); clearFeedback(); }
  function shuffle() {
    if (!canShuffle) return;
    const available = [...new Map(pool.map(item => [item.tag, item])).values()];
    for (let index = available.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [available[index], available[other]] = [available[other], available[index]];
    }
    const locked = choices.filter(item => item.locked);
    const fresh = available.slice(0, count - locked.length).map(item => ({ ...item, weight: 1, locked: false }));
    // Keep locked slots in place while refreshing every unlocked slot.
    const next: StyleChoice[] = [];
    let cursor = 0;
    for (const previous of choices) {
      if (next.length >= count) break;
      if (previous.locked) next.push(previous);
      else if (cursor < fresh.length) next.push(fresh[cursor++]);
    }
    choices = [...next, ...fresh.slice(cursor)];
    clearFeedback();
  }
  function rerollWeights() {
    if (!Number.isFinite(minWeight) || !Number.isFinite(maxWeight) || minWeight < .1 || maxWeight > 2 || minWeight > maxWeight) return;
    choices = choices.map(item => item.locked ? item : { ...item, weight: Math.round((minWeight + Math.random() * (maxWeight - minWeight)) * 100) / 100 });
    clearFeedback();
  }
  function changeCount(value: number) {
    count = Math.max(lockedCount, Math.max(2, Math.min(6, value)));
    if (choices.length > count) {
      let removable = choices.length - count;
      choices = choices.filter(item => item.locked || removable-- <= 0);
    }
    clearFeedback();
  }
  function exclude(item: StyleOption) {
    if (choices.some(choice => choice.tag === item.tag && choice.locked)) return;
    excluded = excluded.some(value => value.tag === item.tag) ? excluded.filter(value => value.tag !== item.tag) : [...excluded, item];
    choices = choices.filter(choice => choice.tag !== item.tag);
    clearFeedback();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(output); feedback = locale.t('prompt_studio.copied'); failed = false; }
    catch { feedback = locale.t('prompt_studio.v2.tools.copy_failed'); failed = true; }
  }
  function add() {
    if (choices.length < 2 || choices.length > 6) return;
    studio.addGroup(groupName.trim() || locale.t('prompt_studio.v2.mixer.group_name'), output);
    feedback = locale.t('prompt_studio.v2.tools.group_added'); failed = false;
  }
</script>

<section class="h-full min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6" aria-labelledby="studio-mixer-title">
  <header class="mb-6 max-w-3xl">
    <div class="mb-2 flex items-center gap-2 text-amber-300"><Palette size={18} /><h2 id="studio-mixer-title" class="text-base font-semibold">{locale.t('prompt_studio.v2.mixer.title')}</h2></div>
    <p class="text-sm leading-relaxed text-neutral-400">{locale.t('prompt_studio.v2.mixer.description')}</p>
  </header>
  <PromptStudioDatabase />
  <div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,1fr)]">
    <section class="min-w-0 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4" aria-labelledby="studio-style-library">
      <h3 id="studio-style-library" class="text-sm font-semibold text-neutral-200">{locale.t('prompt_studio.v2.mixer.library')}</h3>
      <p class="mt-1 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.mixer.library_hint')}</p>
      <div class="mt-4 flex flex-wrap gap-2" aria-label={locale.t('prompt_studio.v2.mixer.families')}>
        {#each ['all', 'medium', 'style', 'light', 'local', 'artists'] as value}
          <button type="button" aria-pressed={family === value} class="touch-target rounded-lg border px-3 text-xs {family === value ? 'border-amber-400/60 bg-amber-400/10 text-amber-300' : 'border-neutral-800 text-neutral-400 hover:border-neutral-600'}" onclick={() => { family = value as typeof family; }}>{locale.t(`prompt_studio.v2.mixer.family_${value}`)}</button>
        {/each}
      </div>
      {#if family === 'artists'}<label class="mt-3 block text-xs text-neutral-400">{locale.t('prompt_studio.collections.artist_set')}<select bind:value={artistSet} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-xs"><option value={-1}>{locale.t('prompt_studio.collections.all_sets')}</option>{#each collectionIndex.collections.find(row => row.id === 'artists')?.sets ?? [] as set, index}<option value={index}>{locale.t(`prompt_studio.collections.set_${set.id}`)}</option>{/each}</select></label>{#if library.pending.includes('artists')}<p role="status" class="mt-3 text-xs text-neutral-500">{locale.t('prompt_studio.loading')}</p>{/if}{/if}
      {#if family === 'local'}
        <label class="mt-4 block text-xs text-neutral-400">{locale.t('prompt_studio.v2.mixer.local_category')}
          <select bind:value={bucket} class="touch-target mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-200"><option value="">{locale.t('prompt_studio.v2.mixer.local_all')}</option>{#each customCatalog.categories as category (category.id)}<option value={category.id}>{category.name}</option>{/each}</select>
        </label>
      {/if}
      {#if family === 'artists'}<label class="touch-target mt-2 flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" bind:checked={artistPrefix} class="accent-amber-400" />{locale.t('prompt_studio.collections.artist_prefix')}</label>{/if}
      <label class="mt-4 block text-xs text-neutral-400">{locale.t('prompt_studio.search')}<input type="search" bind:value={query} class="touch-target mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-200" /></label>
      <div class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {#each visible.slice(currentPage * 60, (currentPage + 1) * 60) as item (item.id)}
          {@const chosen = choices.find(choice => choice.tag === item.tag)}
          {@const banned = excluded.some(value => value.tag === item.tag)}
          <article class="flex min-w-0 rounded-xl border {chosen ? 'border-amber-400/40 bg-amber-400/5' : 'border-neutral-800 bg-neutral-950/50'} {banned ? 'opacity-50' : ''}">
            <button type="button" aria-pressed={!!chosen} disabled={banned || (chosen ? chosen.locked || choices.length <= 2 : choices.length >= 6)} class="touch-target flex min-w-0 flex-1 items-start gap-2 p-3 text-left disabled:cursor-default" onclick={() => choose(item)}>
              <span class="mt-0.5 shrink-0 text-amber-300">{#if selected(item)}<Check size={15} />{:else}<Plus size={15} />{/if}</span>
              <span class="min-w-0"><span class="block text-xs font-medium text-neutral-200">{name(item)}</span><span class="mt-1 block break-words text-[11px] leading-relaxed text-neutral-500">{item.tag}</span></span>
            </button>
            <button type="button" disabled={!!chosen?.locked} aria-label={locale.t(banned ? 'prompt_studio.v2.mixer.restore' : 'prompt_studio.v2.mixer.exclude', { name: name(item) })} title={locale.t(banned ? 'prompt_studio.v2.mixer.restore' : 'prompt_studio.v2.mixer.exclude', { name: name(item) })} class="touch-target self-start rounded-lg p-3 text-neutral-500 hover:text-neutral-200 disabled:opacity-30" onclick={() => exclude(item)}>{#if banned}<Plus size={14} />{:else}<X size={14} />{/if}</button>
          </article>
        {/each}
      </div>
      {#if visible.length > 60}<nav class="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400"><button type="button" disabled={!currentPage} onclick={() => page = currentPage - 1} class="touch-target rounded-lg border border-neutral-700 px-3 disabled:opacity-30">{locale.t('prompt_studio.v2.catalog_previous_page')}</button><span>{currentPage + 1} / {Math.ceil(visible.length / 60)}</span><button type="button" disabled={(currentPage + 1) * 60 >= visible.length} onclick={() => page = currentPage + 1} class="touch-target rounded-lg border border-neutral-700 px-3 disabled:opacity-30">{locale.t('prompt_studio.v2.catalog_next_page')}</button></nav>{/if}
      {#if !visible.length}<p class="py-8 text-center text-xs leading-relaxed text-neutral-500">{locale.t(family === 'local' && !localOptions.length ? 'prompt_studio.v2.mixer.local_empty' : 'prompt_studio.nothing_found')}</p>{/if}
      {#if excluded.length}
        <div class="mt-5 border-t border-neutral-800 pt-4"><h4 class="text-xs font-medium text-neutral-400">{locale.t('prompt_studio.v2.mixer.excluded')}</h4><div class="mt-2 flex flex-wrap gap-2">{#each excluded as item (item.id)}<button type="button" class="touch-target flex items-center gap-2 rounded-lg border border-neutral-800 px-3 text-xs text-neutral-500 hover:text-neutral-200" aria-label={locale.t('prompt_studio.v2.mixer.restore', { name: name(item) })} onclick={() => exclude(item)}>{name(item)}<Plus size={13} /></button>{/each}</div></div>
      {/if}
    </section>

    <div class="min-w-0 space-y-5">
      <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4" aria-labelledby="studio-blend-title">
        <h3 id="studio-blend-title" class="text-sm font-semibold text-neutral-200">{locale.t('prompt_studio.v2.mixer.blend')}</h3>
        <p class="mt-1 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.mixer.blend_hint')}</p>
        <div class="mt-4 flex flex-wrap items-end gap-3">
          <label class="text-xs text-neutral-400">{locale.t('prompt_studio.v2.mixer.count')}<select value={count} onchange={event => changeCount(Number(event.currentTarget.value))} class="touch-target mt-2 block min-w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-200">{#each [2, 3, 4, 5, 6] as value}<option value={value} disabled={value < lockedCount}>{value}</option>{/each}</select></label>
          <button type="button" disabled={!canShuffle} class="touch-target flex items-center gap-2 rounded-lg border border-neutral-700 px-4 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40" onclick={shuffle}><Shuffle size={15} />{locale.t('prompt_studio.v2.mixer.shuffle')}</button>
        </div>
        <details class="mt-3 rounded-xl border border-neutral-800 p-3"><summary class="touch-target cursor-pointer text-xs text-neutral-400">{locale.t('prompt_studio.library.weight_randomization')}</summary><div class="mt-2 flex flex-wrap items-end gap-2"><label class="text-xs text-neutral-400">{locale.t('prompt_studio.library.min_weight')}<input type="number" min="0.1" max="2" step="0.05" bind:value={minWeight} class="touch-target mt-1 block w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2" /></label><label class="text-xs text-neutral-400">{locale.t('prompt_studio.library.max_weight')}<input type="number" min="0.1" max="2" step="0.05" bind:value={maxWeight} class="touch-target mt-1 block w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2" /></label><button type="button" disabled={choices.every(item => item.locked) || !Number.isFinite(minWeight) || !Number.isFinite(maxWeight) || minWeight < .1 || maxWeight > 2 || minWeight > maxWeight} onclick={rerollWeights} class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300 disabled:opacity-30">{locale.t('prompt_studio.library.reroll_weights')}</button></div></details>
        <div class="mt-4 space-y-2">
          {#each choices as item, index (item.id)}
            <article class="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
              <div class="flex items-center gap-2"><span class="text-[11px] text-neutral-600">{index + 1}</span><h4 class="min-w-0 flex-1 break-words text-xs font-medium text-neutral-200">{name(item)}</h4><button type="button" aria-pressed={item.locked} aria-label={locale.t(item.locked ? 'prompt_studio.v2.mixer.unlock' : 'prompt_studio.v2.mixer.lock', { name: name(item) })} class="touch-target rounded-lg p-2 {item.locked ? 'text-amber-300' : 'text-neutral-500'}" onclick={() => lock(item.tag)}>{#if item.locked}<Lock size={15} />{:else}<Unlock size={15} />{/if}</button><button type="button" disabled={item.locked || choices.length <= 2} aria-label={locale.t('prompt_studio.v2.mixer.remove', { name: name(item) })} class="touch-target rounded-lg p-2 text-neutral-500 disabled:opacity-20" onclick={() => choose(item)}><X size={15} /></button></div>
              <label class="mt-2 flex items-center gap-3 text-[11px] text-neutral-500"><span>{locale.t('prompt_studio.weight')}</span><input type="range" min="0.1" max="2" step="0.05" value={item.weight} aria-label={locale.t('prompt_studio.v2.mixer.weight', { name: name(item) })} oninput={event => weight(item.tag, event.currentTarget.valueAsNumber)} class="min-w-0 flex-1 accent-amber-400" /><input type="number" min="0.1" max="2" step="0.05" value={item.weight} aria-label={locale.t('prompt_studio.v2.mixer.weight', { name: name(item) })} onchange={event => weight(item.tag, event.currentTarget.valueAsNumber)} class="touch-target w-20 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-sm text-neutral-200" /></label>
            </article>
          {/each}
        </div>
        {#if choices.length < 2}<p role="status" class="mt-3 text-xs text-amber-300">{locale.t('prompt_studio.v2.mixer.minimum')}</p>{/if}
        {#if !canShuffle && lockedCount < count}<p class="mt-3 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.mixer.pool_small')}</p>{/if}
      </section>
      <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4" aria-labelledby="studio-blend-preview">
        <h3 id="studio-blend-preview" class="text-sm font-semibold text-neutral-200">{locale.t('prompt_studio.v2.tools.preview')}</h3>
        <p class="mt-1 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.mixer.preview_hint')}</p>
        <div class="mt-4 space-y-3">{#each ['sd', 'nai'] as value}<div><button type="button" aria-pressed={format === value} onclick={() => { format = value as WeightFormat; clearFeedback(); }} class="touch-target flex w-full items-center gap-2 text-left text-xs {format === value ? 'text-amber-300' : 'text-neutral-400'}">{#if format === value}<Check size={14} />{:else}<span class="h-3.5 w-3.5 rounded-full border border-neutral-600"></span>{/if}{locale.t(`prompt_studio.v2.tools.format_${value}`)}</button><textarea readonly rows={3} aria-label={locale.t('prompt_studio.v2.tools.preview_format', { format: locale.t(`prompt_studio.v2.tools.format_${value}`) })} value={value === 'sd' ? sd : nai} class="w-full resize-y rounded-lg border bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-300 {format === value ? 'border-amber-400/40' : 'border-neutral-800'}"></textarea></div>{/each}</div>
        <label class="mt-4 block text-xs text-neutral-400">{locale.t('prompt_studio.v2.tools.group_name')}<input bind:value={groupName} placeholder={locale.t('prompt_studio.v2.mixer.group_name')} class="touch-target mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-200" /></label>
        <div class="mt-4 flex flex-wrap gap-2"><button type="button" disabled={choices.length < 2 || choices.length > 6} class="touch-target flex items-center gap-2 rounded-lg bg-amber-400 px-4 text-xs font-medium text-neutral-950 disabled:opacity-40" onclick={add}><Plus size={15} />{locale.t('prompt_studio.v2.tools.add_group')}</button><button type="button" disabled={!output.trim()} class="touch-target flex items-center gap-2 rounded-lg border border-neutral-700 px-4 text-xs text-neutral-300 disabled:opacity-40" onclick={() => void copy()}><Copy size={15} />{locale.t('common.copy')}</button></div>
        {#if feedback}<p role="status" class="mt-3 text-xs {failed ? 'text-red-300' : 'text-amber-300'}">{feedback}</p>{/if}
      </section>
    </div>
  </div>
</section>
