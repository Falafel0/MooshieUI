<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { customCatalog, catalogPreview } from '../../prompt-studio/custom-catalog.svelte.js';
  import { parseTagList } from '../../utils/animaIntegration.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { Image, Copy, Trash2, X } from '@lucide/svelte';
  const entry = $derived(customCatalog.entries.find(row => row.id === studio.catalogEntryId));
  let name = $state(''), tag = $state(''), description = $state(''), preview = $state('');
  let aliases = $state(''), context = $state('');
  let busy = $state(false), error = $state('');
  let request = 0;
  const editing = $derived(studio.catalogEntryId === 'new' || !!entry);
  const parts = (text: string) => [...new Set(parseTagList(text))];
  $effect(() => {
    const current = entry; const id = studio.catalogEntryId; const scope = customCatalog.scope;
    untrack(() => { request++; name = current?.name ?? ''; tag = current?.tag ?? ''; description = current?.description ?? ''; preview = current?.preview ?? ''; aliases = current?.aliases?.join(', ') ?? ''; context = current?.contextualTags?.join(', ') ?? ''; busy = false; error = ''; });
  });
  onDestroy(() => { request++; });
  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = '';
    if (!file) return;
    const id = ++request; const scope = customCatalog.scope; busy = true; error = '';
    try { const image = await catalogPreview(file); if (id === request && scope === customCatalog.scope) preview = image; }
    catch { if (id === request) error = locale.t('prompt_studio.import_failed'); }
    finally { if (id === request) busy = false; }
  }
  function save() {
    if (busy || !tag.trim()) return;
    const previous = entry;
    const row = { id: previous?.id, name: name.trim() || tag.trim(), tag: tag.trim(), subId: previous?.subId ?? studio.activeSubId, description, preview, aliases: parts(aliases), contextualTags: parts(context) };
    if (!customCatalog.add(row)) { error = locale.t('prompt_studio.import_failed'); return; }
    const saved = customCatalog.entries.find(item => item.tag === row.tag && item.subId === row.subId);
    if (previous && saved) studio.updateCatalogChoice(previous.tag, saved, previous.subId);
    studio.catalogEntryId = saved?.id ?? '';
  }
  function remove() { if (entry) customCatalog.remove(entry.id); studio.catalogEntryId = ''; }
</script>
<aside class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl border border-neutral-800 bg-neutral-950 p-3">
  {#if editing}
    <div class="flex min-h-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      {#if preview}<img src={preview} alt={name || tag} class="max-h-80 w-full object-contain" />{:else}<Image size={40} class="my-12 text-neutral-600" />{/if}
    </div>
    <section class="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <header class="mb-3 flex items-center justify-between"><h3 class="text-xs font-semibold text-amber-300">{locale.t('prompt_studio.tag_info')}</h3><button type="button" aria-label={locale.t('common.close')} class="touch-target rounded p-2 text-neutral-400" onclick={() => studio.catalogEntryId = ''}><X size={15} /></button></header>
      <form class="flex flex-col gap-3" onsubmit={event => { event.preventDefault(); save(); }}>
        <input aria-label={locale.t('prompt_studio.custom_name')} placeholder={locale.t('prompt_studio.custom_name')} bind:value={name} class="touch-target rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200" />
        <textarea aria-label={locale.t('prompt_studio.custom_tag')} placeholder={locale.t('prompt_studio.custom_tag')} bind:value={tag} rows={2} class="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs text-neutral-200"></textarea>
        <textarea aria-label={locale.t('prompt_studio.description')} placeholder={locale.t('prompt_studio.description')} bind:value={description} rows={2} class="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs text-neutral-200"></textarea>
        <label class="text-xs text-neutral-400">{locale.t('prompt_studio.aliases')}<input bind:value={aliases} class="touch-target mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-neutral-200" /></label>
        <label class="text-xs text-neutral-400">{locale.t('prompt_studio.contextual_tags')}<textarea bind:value={context} rows={2} class="mt-1 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs text-neutral-200"></textarea></label>
        <p class="text-[11px] leading-relaxed text-neutral-500">{locale.t('prompt_studio.contextual_tags_hint')}</p>
        <label class="text-xs text-neutral-400">{locale.t('prompt_studio.custom_upload')}<input type="file" accept="image/png,image/jpeg,image/webp" onchange={upload} disabled={busy} class="mt-2 w-full text-xs" /></label>
        {#if preview}<button type="button" disabled={busy} class="touch-target text-left text-xs text-neutral-500" onclick={() => preview = ''}>{locale.t('prompt_studio.custom_remove_preview')}</button>{/if}
        <div class="flex flex-wrap gap-2">
          <button type="submit" disabled={!customCatalog.ready || busy || !tag.trim()} class="touch-target rounded-lg bg-amber-400 px-3 text-xs font-medium text-neutral-950 disabled:opacity-40">{locale.t('common.save')}</button>
          {#if entry}<button type="button" disabled={busy} class="touch-target flex items-center gap-1 rounded-lg border border-neutral-700 px-2 text-xs text-neutral-400" onclick={() => studio.catalogEntryId = customCatalog.duplicate(entry!.id) ?? ''}><Copy size={13} />{locale.t('common.duplicate')}</button><button type="button" disabled={busy} class="touch-target rounded-lg border border-red-900 px-2 text-red-300" aria-label={locale.t('prompt_studio.delete')} onclick={remove}><Trash2 size={14} /></button>{/if}
        </div>
      </form>
      {#if entry && studio.isChosen(entry.tag)}
        <label class="mt-3 block text-xs text-neutral-400">{locale.t('prompt_studio.weight')}<input type="number" min="0.1" max="2" step="0.05" value={studio.selected.find(item => item.tag === entry!.tag)?.weight ?? 1} onchange={event => studio.weight(entry!.tag, Number(event.currentTarget.value))} class="touch-target mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-3" /></label>
      {/if}
      {#if entry?.contextualTags?.length}
        <div class="mt-3 flex flex-wrap gap-1 border-t border-neutral-800 pt-3">
          {#each entry.contextualTags as modifier (modifier)}<button type="button" class="touch-target rounded-lg border px-2 text-xs {studio.detail(entry.tag).mods.includes(modifier) ? 'border-amber-400 text-amber-300' : 'border-neutral-700 text-neutral-400'}" aria-pressed={studio.detail(entry.tag).mods.includes(modifier)} onclick={() => { if (!studio.isChosen(entry!.tag)) studio.choose(entry!.tag, entry!.name, entry!.subId); studio.toggleModifier(entry!.tag, modifier); }}>{modifier}</button>{/each}
        </div>
      {/if}
      {#if busy}<p role="status" class="mt-3 text-xs text-neutral-400">{locale.t('prompt_studio.loading')}</p>{/if}
      {#if error}<p role="alert" class="mt-3 text-xs text-amber-300">{error}</p>{/if}
    </section>
  {/if}
  <section class="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
    <header class="mb-3 flex items-center justify-between gap-2"><h3 class="text-xs font-semibold">{locale.t('prompt_studio.selected_tags')} ({studio.selected.length})</h3><button type="button" class="touch-target px-2 text-xs text-neutral-500" onclick={() => studio.clear()}>{locale.t('prompt_studio.reset')}</button></header>
    {#if !studio.selected.length}<p class="text-xs text-neutral-500">{locale.t('prompt_studio.empty')}</p>{/if}
    {#if !editing && studio.currentCategory}<button type="button" class="touch-target mb-3 rounded border border-neutral-700 px-3 text-xs text-neutral-400" onclick={() => studio.catalogEntryId = 'new'}>{locale.t('prompt_studio.add_tag')}</button>{/if}
    {#each studio.selected as item (item.tag)}
      {@const saved = customCatalog.entries.find(row => row.tag === item.tag && row.subId === item.category)}
      <div class="mb-2 flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
        {#if saved?.preview}<img src={saved.preview} alt="" class="h-10 w-12 shrink-0 rounded object-cover" />{/if}
        <button type="button" class="touch-target min-w-0 flex-1 break-words text-left text-xs text-neutral-300" onclick={() => { if (saved) studio.catalogEntryId = saved.id; }}>{item.name}</button>
        <button type="button" aria-label={`${locale.t('prompt_studio.remove_tag')}: ${item.name}`} class="touch-target shrink-0 rounded p-2 text-neutral-500" onclick={() => studio.remove(item.tag)}><X size={14} /></button>
      </div>
    {/each}
  </section>
</aside>
