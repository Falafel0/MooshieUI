<script lang="ts">
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { CATEGORY_ICONS, fallbackIcon } from './icons.js';
  import PromptStudioStructure from './PromptStudioStructure.svelte';
  import { Plus, Settings2, Search, Download, Upload } from '@lucide/svelte';
  let query = $state('');
  let editing = $state<string | undefined>();
  let input: HTMLInputElement;
  let busy = $state(false);
  let error = $state('');
  const categories = $derived(customCatalog.categories.filter(category => category.name.toLowerCase().includes(query.trim().toLowerCase())));
  async function importFile(event: Event) {
    const target = event.currentTarget as HTMLInputElement; const file = target.files?.[0]; target.value = '';
    if (!file) return;
    const scope = customCatalog.scope;
    busy = true; error = '';
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error();
      const data = JSON.parse(await file.text());
      if (scope !== customCatalog.scope) return;
      if (!customCatalog.import(data)) throw new Error();
      studio.ensureActive(); studio.save();
    } catch { error = locale.t('prompt_studio.import_failed'); }
    finally { busy = false; }
  }
</script>
<aside class="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
  <label class="flex shrink-0 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3"><Search size={16} class="shrink-0 text-neutral-500" /><input type="search" aria-label={locale.t('prompt_studio.categories')} placeholder={locale.t('prompt_studio.search')} bind:value={query} class="touch-target min-w-0 w-full bg-transparent text-xs text-neutral-200 outline-none" /></label>
  <nav aria-label={locale.t('prompt_studio.categories')} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {#each categories as category (category.id)}
      {@const Icon = CATEGORY_ICONS[category.icon] ?? fallbackIcon}
      <div class="group mb-1 flex items-center rounded-lg {studio.activeCategoryId === category.id ? 'bg-amber-400 text-neutral-950' : 'text-neutral-400 hover:bg-neutral-900'}">
        <button type="button" aria-pressed={studio.activeCategoryId === category.id} title={category.name} class="touch-target flex min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs" onclick={() => studio.selectCategory(category.id)}><Icon size={17} class="shrink-0" /><span class="truncate">{category.name}</span></button>
        <button type="button" aria-label={`${locale.t('common.edit')}: ${category.name}`} class="touch-target shrink-0 rounded-lg p-2 opacity-70 hover:opacity-100" onclick={() => editing = category.id}><Settings2 size={14} /></button>
      </div>
    {/each}
    {#if customCatalog.ready && !customCatalog.categories.length}<p class="py-5 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.blank_catalog')}</p>{/if}
  </nav>
  <button type="button" disabled={!customCatalog.ready} class="touch-target flex shrink-0 items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-200 disabled:opacity-40" onclick={() => editing = ''}><Plus size={17} />{locale.t('prompt_studio.add_category')}</button>
  <div class="flex shrink-0 gap-2">
    <button type="button" disabled={!customCatalog.ready || busy} class="touch-target flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-800 text-xs text-neutral-400" onclick={() => customCatalog.export()}><Download size={14} />{locale.t('prompt_studio.export_pack')}</button>
    <button type="button" disabled={!customCatalog.ready || busy} class="touch-target flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-800 text-xs text-neutral-400" onclick={() => input.click()}><Upload size={14} />{locale.t('prompt_studio.import_pack')}</button>
    <input type="file" accept="application/json,.json" bind:this={input} onchange={importFile} class="hidden" />
  </div>
  {#if studio.currentCategory}<button type="button" class="touch-target shrink-0 text-left text-xs text-neutral-500" onclick={() => customCatalog.export(studio.activeCategoryId)}>{locale.t('prompt_studio.export_category_pack')}</button>{/if}
  {#if error}<p role="alert" class="text-xs text-amber-300">{error}</p>{/if}
</aside>
{#if editing !== undefined}<PromptStudioStructure id={editing} onClose={() => editing = undefined} />{/if}
