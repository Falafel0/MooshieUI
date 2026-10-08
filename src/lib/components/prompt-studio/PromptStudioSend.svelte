<script lang="ts">
  import { insertPromptBlocks } from '../../utils/promptBlocks.js';
  import { joinPromptBoxes } from '../../utils/promptSanitize.js';
  import { onMount } from 'svelte';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { generation } from '../../stores/generation.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { insertPrompt, type InsertMode } from '../../prompt-studio/insertion.js';
  let { onCancel, onDone }: { onCancel: () => void; onDone: () => void } = $props();
  let dialog: HTMLDialogElement;
  let destination = $state<'txt2img' | 'img2img' | 'inpainting'>(generation.mode === 'img2img' || generation.mode === 'inpainting' ? generation.mode : 'txt2img');
  let asBlocks = $state(false);
  let field = $state<'positive' | 'negative'>('positive');
  let method = $state<InsertMode>('append');
  // Image modes share a prompt bucket; switching from video must preview the image bucket.
  const current = $derived(generation.mode === 'video'
    ? (field === 'positive' ? generation.promptBuckets.image.positivePrompt : generation.promptBuckets.image.negativePrompt)
    : (field === 'positive' ? generation.positivePrompt : generation.negativePrompt));
  const currentBoxes = $derived(generation.mode === 'video'
    ? (field === 'positive' ? generation.promptBuckets.image.extraPositiveBoxes : generation.promptBuckets.image.extraNegativeBoxes)
    : (field === 'positive' ? generation.extraPositiveBoxes : generation.extraNegativeBoxes));
  const incomingBlocks = $derived([
    ...(studio.basePrompt.trim() ? [{ name: locale.t('prompt_studio.constructor_output'), content: studio.basePrompt }] : []),
    ...studio.groups.filter(group => group.enabled && group.content.trim()).map(group => ({ name: group.name, content: group.content })),
  ]);
  const preview = $derived(joinPromptBoxes(asBlocks
    ? [current, ...insertPromptBlocks<{ name: string; content: string }>(currentBoxes, incomingBlocks, method).map(block => block.content)]
    : [insertPrompt(current, studio.prompt, method), ...currentBoxes.map(block => block.content)]));
  onMount(() => { dialog.showModal(); });
  function send() {
    if (!studio.prompt.trim()) return;
    generation.setMode(destination);
    if (asBlocks) {
      generation.importPromptBoxes(field, incomingBlocks, method);
      onDone(); return;
    }
    const value = insertPrompt(field === 'positive' ? generation.positivePrompt : generation.negativePrompt, studio.prompt, method);
    if (field === 'positive') generation.positivePrompt = value;
    else generation.negativePrompt = value;
    void generation.saveSettings();
    onDone();
  }
</script>

<dialog bind:this={dialog} oncancel={onCancel} aria-labelledby="studio-send-title" class="fixed inset-0 m-auto max-h-[90dvh] w-[min(640px,calc(100%_-_24px))] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-5 text-neutral-200 shadow-2xl backdrop:bg-black/70">
  <h2 id="studio-send-title" class="text-base font-semibold">{locale.t('prompt_studio.apply')}</h2>
  <p class="mt-2 text-xs text-neutral-400">{locale.t('prompt_studio.send_hint')}</p>
  <div class="mt-4 grid gap-3 sm:grid-cols-3">
    <label class="text-xs text-neutral-400">{locale.t('prompt_studio.destination')}
      <select bind:value={destination} class="ui-control mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200">
        {#each ['txt2img', 'img2img', 'inpainting'] as mode}<option value={mode}>{locale.t(`gallery.mode.${mode}`)}</option>{/each}
      </select>
    </label>
    <label class="text-xs text-neutral-400">{locale.t('prompt_studio.target_field')}
      <select bind:value={field} class="ui-control mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200">
        <option value="positive">{locale.t('generation.prompts.positive')}</option>
        <option value="negative">{locale.t('generation.prompts.negative')}</option>
      </select>
    </label>
    <label class="text-xs text-neutral-400">{locale.t('prompt_studio.insert_method')}
      <select bind:value={method} class="ui-control mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200">
        {#each ['append', 'prepend', 'replace'] as value}<option value={value}>{locale.t(`prompt_studio.insert_${value}`)}</option>{/each}
      </select>
    </label>
  </div>
  <label class="mt-3 flex items-center gap-2 text-xs text-neutral-300"><input type="checkbox" bind:checked={asBlocks} />{locale.t('prompt_studio.send_as_blocks')}</label>
  {#if asBlocks}<p class="mt-2 text-xs text-neutral-400">{locale.t('prompt_studio.send_blocks_hint')}</p>{/if}
  {#if method === 'replace' && (asBlocks ? currentBoxes.length : current.trim())}<p role="status" class="mt-3 text-xs text-indigo-300">{locale.t(asBlocks ? 'prompt_studio.send_blocks_replace_hint' : 'prompt_studio.send_replace_hint')}</p>{/if}
  <label class="mt-4 block text-xs text-neutral-400" for="studio-send-preview">{locale.t('schedule.preview')}</label>
  <textarea id="studio-send-preview" readonly value={preview} class="mt-1 min-h-40 w-full resize-y rounded border border-neutral-800 bg-neutral-900 p-3 text-sm leading-relaxed text-neutral-200"></textarea>
  <div class="mt-4 flex justify-end gap-2">
    <button type="button" class="ui-control rounded border border-neutral-700 px-3 py-2 text-xs" onclick={onCancel}>{locale.t('common.cancel')}</button>
    <button type="button" class="ui-control rounded bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-40" disabled={!studio.prompt.trim()} onclick={send}>{locale.t('prompt_studio.apply')}</button>
  </div>
</dialog>
