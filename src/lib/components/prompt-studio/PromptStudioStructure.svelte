<script lang="ts">
  import { onMount } from 'svelte';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  let { id = '', categoryId = '', onClose }: { id?: string; categoryId?: string; onClose: () => void } = $props();
  const category = customCatalog.categories.find(row => row.id === id);
  const sub = customCatalog.categories.flatMap(row => row.subs).find(row => row.id === id);
  let name = $state(category?.name ?? sub?.name ?? '');
  let deleting = $state(false);
  let dialog: HTMLDialogElement;
  const title = $derived(id ? 'common.edit' : categoryId ? 'prompt_studio.add_subcategory' : 'prompt_studio.add_category');
  onMount(() => dialog.showModal());
  function save() {
    if (!name.trim()) return;
    if (id) customCatalog.rename(id, name);
    else if (categoryId) { const next = customCatalog.addSub(categoryId, name); if (next) studio.selectSub(next); }
    else { const next = customCatalog.addCategory(name); if (next) studio.selectCategory(next); }
    onClose();
  }
  function remove() {
    if (category) customCatalog.removeCategory(id); else customCatalog.removeSub(id);
    studio.ensureActive(); studio.save(); onClose();
  }
</script>
<dialog bind:this={dialog} oncancel={onClose} aria-label={locale.t(title)} class="fixed inset-0 m-auto w-[min(420px,calc(100%_-_24px))] rounded-xl border border-neutral-700 bg-neutral-900 p-5 text-neutral-200 shadow-2xl backdrop:bg-black/70">
  <form onsubmit={event => { event.preventDefault(); save(); }}>
    <h3 class="mb-4 text-sm font-semibold">{locale.t(title)}</h3>
    <input aria-label={locale.t('prompt_studio.custom_name')} placeholder={locale.t('prompt_studio.custom_name')} bind:value={name} class="touch-target w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm" />
    {#if id}<div class="mt-3 flex gap-2">
      <button type="button" class="touch-target rounded border border-neutral-700 px-3 text-xs" onclick={() => customCatalog.move(id, -1)}>{locale.t('prompt_studio.group_up')}</button>
      <button type="button" class="touch-target rounded border border-neutral-700 px-3 text-xs" onclick={() => customCatalog.move(id, 1)}>{locale.t('prompt_studio.group_down')}</button>
      <button type="button" class="touch-target ml-auto rounded px-3 text-xs text-red-300" onclick={() => deleting = !deleting}>{locale.t('prompt_studio.delete')}</button>
    </div>{/if}
    {#if deleting}<div role="alert" class="mt-3 rounded border border-red-900 bg-red-950/30 p-3 text-xs text-neutral-300">
      <p>{locale.t(category ? 'prompt_studio.delete_category_hint' : 'prompt_studio.delete_subcategory_hint')}</p>
      <button type="button" class="touch-target mt-2 rounded bg-red-900 px-3" onclick={remove}>{locale.t('common.confirm')}</button>
    </div>{/if}
    <div class="mt-4 flex justify-end gap-2">
      <button type="button" class="touch-target rounded border border-neutral-700 px-3 text-xs" onclick={onClose}>{locale.t('common.cancel')}</button>
      <button type="submit" disabled={!customCatalog.ready || !name.trim()} class="touch-target rounded bg-amber-400 px-4 text-xs font-medium text-neutral-950 disabled:opacity-40">{locale.t('common.save')}</button>
    </div>
  </form>
</dialog>
