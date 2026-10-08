<script lang="ts">
  import { hasTemplateVariables } from '../../prompt-studio/collection-tools.js';
  import { onMount } from 'svelte';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  let dialog: HTMLDialogElement;
  const preview = $derived(library.recipePreview);
  const unresolved = $derived(!preview?.text.trim() || hasTemplateVariables(preview.text));
  onMount(() => dialog.showModal());
  function add() {
    if (!preview || unresolved || preview.scope !== customCatalog.scope) return;
    studio.addGroup(preview.name, preview.text); library.clearRecipe();
  }
</script>
<dialog bind:this={dialog} oncancel={() => library.clearRecipe()} aria-labelledby="studio-recipe-title" class="fixed inset-0 m-auto flex-col gap-4 rounded-2xl border border-neutral-700 bg-neutral-950 p-4 text-neutral-200 backdrop:bg-black/70 open:flex sm:p-6 w-[min(720px,calc(100%_-_24px))] max-h-[90dvh] overflow-y-auto">
  <h2 id="studio-recipe-title" class="text-sm font-semibold">{locale.t('prompt_studio.library.recipe_review')}: {preview?.name}</h2>
  <label class="text-xs text-neutral-400">{locale.t('prompt_studio.collections.preview')}<textarea rows={8} value={preview?.text ?? ''} oninput={event => { if (preview) library.recipePreview = { ...preview, text: event.currentTarget.value }; }} class="mt-2 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-900 p-3 font-mono text-xs text-neutral-200"></textarea></label>
  {#if unresolved}<p role="status" class="text-xs text-indigo-300">{locale.t('prompt_studio.collections.unresolved')}</p>{/if}
  <footer class="flex flex-wrap justify-end gap-2"><button type="button" onclick={() => library.clearRecipe()} class="ui-control rounded-lg border border-neutral-700 px-4 text-xs">{locale.t('common.cancel')}</button><button type="button" disabled={unresolved} onclick={add} class="ui-control rounded-lg bg-indigo-400 px-4 text-xs font-medium text-neutral-950 disabled:opacity-30">{locale.t('prompt_studio.v2.tools.add_group')}</button></footer>
</dialog>
