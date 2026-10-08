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
      <header class="mb-3 flex items-center justify-between"><h3 class="text-xs font-semibold text-indigo-300">{locale.t('prompt_studio.tag_info')}</h3><button type="button" aria-label={locale.t('common.close')} class="ui-control rounded p-2 text-neutral-400" onclick={() => studio.catalogEntryId = ''}><X size={15} /></button></header>
      <form class="flex flex-col gap-3" onsubmit={event => { event.preventDefault(); save(); }}>
        <input aria-label={locale.t('prompt_studio.custom_name')} placeholder={locale.t('prompt_studio.custom_name')} bind:value={name} class="ui-control rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-200" />
        <textarea aria-label={locale.t('prompt_studio.custom_tag')} placeholder={locale.t('prompt_studio.custom_tag')} bind:value={tag} rows={2} class="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs text-neutral-200"></textarea>
        <textarea aria-label={locale.t('prompt_studio.description')} placeholder={locale.t('prompt_studio.description')} bind:value={description} rows={2} class="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs text-neutral-200"></textarea>
        <label class="text-xs text-neutral-400">{locale.t('prompt_studio.aliases')}<input bind:value={aliases} class="ui-control mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-neutral-200" /></label>
        <label class="text-xs text-neutral-400">{locale.t('prompt_studio.contextual_tags')}<textarea bind:value={context} rows={2} class="mt-1 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs text-neutral-200"></textarea></label>
        <p class="text-[11px] leading-relaxed text-neutral-500">{locale.t('prompt_studio.contextual_tags_hint')}</p>
        <label class="text-xs text-neutral-400">{locale.t('prompt_studio.custom_upload')}<input type="file" accept="image/png,image/jpeg,image/webp" onchange={upload} disabled={busy} class="mt-2 w-full text-xs" /></label>
        {#if preview}<button type="button" disabled={busy} class="ui-control text-left text-xs text-neutral-500" onclick={() => preview = ''}>{locale.t('prompt_studio.custom_remove_preview')}</button>{/if}
        <div class="flex flex-wrap gap-2">
          <button type="submit" disabled={!customCatalog.ready || busy || !tag.trim()} class="ui-control rounded-lg bg-indigo-400 px-3 text-xs font-medium text-neutral-950 disabled:opacity-40">{locale.t('common.save')}</button>
          {#if entry}<button type="button" disabled={busy} class="ui-control flex items-center gap-1 rounded-lg border border-neutral-700 px-2 text-xs text-neutral-400" onclick={() => studio.catalogEntryId = customCatalog.duplicate(entry!.id) ?? ''}><Copy size={13} />{locale.t('common.duplicate')}</button><button type="button" disabled={busy} class="ui-control rounded-lg border border-red-900 px-2 text-red-300" aria-label={locale.t('prompt_studio.delete')} onclick={remove}><Trash2 size={14} /></button>{/if}
        </div>
      </form>
      {#if busy}<p role="status" class="mt-3 text-xs text-neutral-400">{locale.t('prompt_studio.loading')}</p>{/if}
      {#if error}<p role="alert" class="mt-3 text-xs text-indigo-300">{error}</p>{/if}
    </section>
  {/if}

</aside>
