<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { customCatalog, catalogPreview } from '../../prompt-studio/custom-catalog.svelte.js';
  import { sourcePreview } from '../../prompt-studio/preview-cache.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { userScopedKey } from '../../utils/ipc.js';
  import { locale } from '../../stores/locale.svelte.js';
  import PromptTextarea from './PromptTextarea.svelte';

  let { name, tags, preview }: { name: string; tags: string; preview?: string } = $props();
  let displayName = $state('');
  let content = $state('');
  let subId = $state('');
  let includePreview = $state(false);
  let busy = $state(false);
  let saved = $state(false);
  let error = $state('');
  let request = 0;
  const categories = $derived(studio.categories.map(category => ({ ...category, subs: category.subs.filter(sub => sub.type === 'grid') })).filter(category => category.subs.length));
  const existing = $derived(customCatalog.entries.find(entry => entry.tag === content.trim() && entry.subId === subId));
  $effect(() => {
    const next = { name, tags, preview };
    untrack(() => {
      request++; displayName = next.name; content = next.tags; includePreview = !!next.preview;
      subId = categories.flatMap(category => category.subs).some(sub => sub.id === studio.activeSubId)
        ? studio.activeSubId : categories[0]?.subs[0]?.id ?? '';
      busy = false; saved = false; error = '';
    });
  });
  onDestroy(() => { request++; });
  async function save() {
    if (busy || !content.trim() || !subId) return;
    const id = ++request;
    const scope = userScopedKey('catalog-reference');
    const entry = { name: displayName.trim() || content.trim(), tag: content.trim(), subId };
    const image = includePreview ? preview : undefined;
    busy = true; saved = false; error = '';
    try {
      await customCatalog.load();
      if (id !== request || scope !== userScopedKey('catalog-reference')) return;
      if (!customCatalog.ready) throw new Error(locale.t('prompt_studio.storage_error'));
      let chosenPreview: string | undefined;
      if (image) {
        try { chosenPreview = await catalogPreview((await sourcePreview(image)).blob); }
        catch { throw new Error(locale.t('prompt_studio.preview_unavailable')); }
      }
      if (id !== request || scope !== userScopedKey('catalog-reference')) return;
      if (!customCatalog.add({ ...entry, ...(chosenPreview ? { preview: chosenPreview } : {}) })) throw new Error(locale.t('prompt_studio.import_failed'));
      saved = true;
    } catch (cause) {
      if (id === request) error = cause instanceof Error ? cause.message : String(cause);
    } finally { if (id === request) busy = false; }
  }
</script>

<details class="rounded-lg border border-neutral-700 p-3" onchange={() => saved = false}>
  <summary class="touch-target flex cursor-pointer items-center text-xs text-indigo-300">{locale.t('prompt_studio.reference_save_catalog')}</summary>
  <div class="mt-3 flex flex-col gap-3">
    <p class="text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.reference_catalog_hint')}</p>
    <input aria-label={locale.t('prompt_studio.custom_name')} placeholder={locale.t('prompt_studio.custom_name')} bind:value={displayName} disabled={busy} class="touch-target rounded border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200" />
    <label class="text-xs text-neutral-400">{locale.t('prompt_studio.catalog_destination')}
      <select bind:value={subId} disabled={busy} class="touch-target mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200">
        {#each categories as category (category.id)}
          <optgroup label={category.name}>{#each category.subs as sub (sub.id)}<option value={sub.id}>{sub.name}</option>{/each}</optgroup>
        {/each}
      </select>
    </label>
    <p class="text-xs text-neutral-400">{locale.t('prompt_studio.custom_tag')}</p>
    <div class={busy ? 'pointer-events-none opacity-50' : ''} inert={busy}>
      <PromptTextarea bind:value={content} rows={2} minHeight="min-h-20" placeholder={locale.t('prompt_studio.custom_tag')} />
    </div>
    {#if preview}<label class="touch-target flex items-center gap-2 text-xs text-neutral-300"><input type="checkbox" bind:checked={includePreview} disabled={busy} />{locale.t('prompt_studio.reference_keep_preview')}</label>{/if}
    {#if existing}<p class="text-xs text-neutral-400">{locale.t('prompt_studio.catalog_update_existing')}</p>{/if}
    <button type="button" disabled={busy || !content.trim() || !subId} class="touch-target self-start rounded bg-indigo-600 px-4 py-2 text-xs text-white disabled:opacity-40" onclick={() => void save()}>{locale.t(busy ? 'prompt_studio.loading' : 'common.save')}</button>
    {#if error || customCatalog.storageError}<p role="alert" class="break-words text-xs text-amber-300">{error || locale.t('prompt_studio.storage_error')}</p>{/if}
    {#if saved}<p role="status" class="text-xs text-indigo-300">{locale.t('prompt_studio.reference_catalog_saved')}</p>{/if}
  </div>
</details>
