<script lang="ts">
  import { onMount } from 'svelte';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { workflow } from '../../prompt-studio/workflow.svelte.js';
  import { tagPreviews } from '../../prompt-studio/tag-previews.svelte.js';
  import { hasTemplateVariables } from '../../prompt-studio/collection-tools.js';
  import { insertPrompt } from '../../prompt-studio/insertion.js';
  import { locale } from '../../stores/locale.svelte.js';
  import PromptStudioTagVisual from './PromptStudioTagVisual.svelte';
  let dialog: HTMLDialogElement;
  const row = $derived(library.inspectedTag);
  const chosen = $derived(!!row && studio.isChosen(row.tag));
  onMount(() => { dialog.showModal(); void tagPreviews.load(); });
  function close() { dialog.close(); library.inspectedTag = undefined; }
  function apply() {
    if (!row) return;
    if (hasTemplateVariables(row.tag)) { void library.previewRecipe(row.name, row.tag); close(); return; }
    if (chosen) { studio.remove(row.tag); close(); return; }
    if (row.mode && row.groupId) workflow.choose(row.mode, row.groupId, row.tag);
    else if (studio.rawPrompt !== undefined) studio.editPrompt(insertPrompt(studio.rawPrompt, row.tag, 'append'));
    else studio.choose(row.tag, row.name, row.group);
    close();
  }
</script>
<dialog bind:this={dialog} oncancel={close} aria-labelledby="studio-tag-details-title" class="fixed inset-0 m-auto max-h-[90dvh] w-[min(600px,calc(100%_-_24px))] overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 p-5 text-neutral-200 backdrop:bg-black/70">
  {#if row}
    <header class="flex items-start gap-4"><PromptStudioTagVisual tag={row.tag} group={row.group} preview={row.preview} large={true} /><div class="min-w-0 flex-1"><h2 id="studio-tag-details-title" class="break-words text-base font-semibold">{row.name}</h2><p class="mt-2 break-words font-mono text-xs text-neutral-400">{row.tag}</p>{#if !row.preview && tagPreviews.image(row.tag)}<p class="mt-2 text-xs text-neutral-500">{locale.t('prompt_studio.collections.blurred_preview')}</p>{/if}</div><button type="button" class="ui-control rounded-lg border border-neutral-800 px-3 text-xs text-neutral-400" onclick={close}>{locale.t('common.close')}</button></header>
    <p class="mt-5 text-sm leading-relaxed text-neutral-400">{row.description || locale.t('prompt_studio.polish.no_description')}</p>
    {#if row.aliases?.length}<section class="mt-5"><h3 class="text-xs font-medium text-neutral-300">{locale.t('prompt_studio.polish.aliases')}</h3><div class="mt-2 flex flex-wrap gap-2">{#each row.aliases as alias}<span class="rounded-lg border border-neutral-800 px-2 py-1 font-mono text-xs text-neutral-400">{alias}</span>{/each}</div></section>{/if}
    {#if row.context?.length}<section class="mt-5"><h3 class="text-xs font-medium text-neutral-300">{locale.t('prompt_studio.contextual_tags')}</h3><p class="mt-1 text-xs text-neutral-500">{locale.t('prompt_studio.polish.modifier_details')}</p><div class="mt-2 flex flex-wrap gap-2">{#each row.context as tag}<span class="rounded-lg border border-neutral-800 px-2 py-1 font-mono text-xs text-neutral-400">{tag}</span>{/each}</div></section>{/if}
    <footer class="mt-6 flex flex-wrap justify-end gap-2 border-t border-neutral-800 pt-4"><button type="button" onclick={apply} class="ui-control rounded-lg bg-indigo-400 px-4 text-xs font-medium text-neutral-950">{locale.t(chosen ? 'prompt_studio.remove_tag' : hasTemplateVariables(row.tag) ? 'prompt_studio.polish.review_template' : 'prompt_studio.polish.add_to_draft')}</button></footer>
  {/if}
</dialog>
