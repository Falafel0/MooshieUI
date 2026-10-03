<script lang="ts">
  import { onMount } from 'svelte';
  import { locale } from '../../stores/locale.svelte.js';
  import { parsePromptBlocks, type ImportedPromptBlock } from '../../utils/promptBlocks.js';
  import PromptTextarea from './PromptTextarea.svelte';
  let { onImport, onClose }: { onImport: (blocks: ImportedPromptBlock[]) => void; onClose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let raw = $state('');
  let mode = $state<'paragraphs' | 'lines'>('paragraphs');
  let error = $state('');
  const blocks = $derived(parsePromptBlocks(raw, mode));
  onMount(() => dialog.showModal());
  async function readFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { error = locale.t('prompt_studio.import_failed'); return; }
    try { raw = await file.text(); error = ''; }
    catch { error = locale.t('prompt_studio.import_failed'); }
  }
</script>
<dialog bind:this={dialog} oncancel={onClose} aria-labelledby="prompt-block-import-title" class="fixed inset-0 m-auto max-h-[90dvh] w-[min(720px,calc(100%_-_24px))] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-neutral-200 backdrop:bg-black/70">
  <h2 id="prompt-block-import-title" class="text-base font-semibold">{locale.t('prompt_studio.import_blocks')}</h2>
  <p class="mt-2 text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.import_blocks_hint')}</p>
  <div class="my-3 flex flex-wrap items-center gap-3">
    <label class="text-xs text-neutral-400">{locale.t('prompt_studio.block_separator')}
      <select bind:value={mode} class="touch-target ml-2 rounded border border-neutral-700 bg-neutral-900 px-2 py-2 text-neutral-200"><option value="paragraphs">{locale.t('prompt_studio.block_paragraphs')}</option><option value="lines">{locale.t('prompt_studio.block_lines')}</option></select>
    </label>
    <label class="text-xs text-neutral-400">{locale.t('prompt_studio.import')}<input type="file" accept="text/plain,text/markdown,.txt,.md" onchange={readFile} class="ml-2 max-w-56 text-xs" /></label>
  </div>
  <PromptTextarea bind:value={raw} rows={5} minHeight="min-h-32" />
  {#if error}<p role="alert" class="mt-2 text-xs text-amber-300">{error}</p>{/if}
  <div class="my-3 flex flex-col gap-2">
    {#each blocks as block, index}<div class="rounded border border-neutral-800 bg-neutral-900 p-2"><p class="text-xs text-indigo-300">{block.name || `${locale.t('prompt_studio.group_name')} ${index + 1}`}</p><p class="line-clamp-3 whitespace-pre-wrap break-words text-xs text-neutral-400">{block.content}</p></div>{/each}
  </div>
  <div class="flex justify-end gap-2">
    <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs" onclick={onClose}>{locale.t('common.cancel')}</button>
    <button type="button" disabled={!blocks.length} class="touch-target rounded bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-40" onclick={() => onImport(blocks)}>{locale.t('prompt_studio.import_blocks')} ({blocks.length})</button>
  </div>
</dialog>
