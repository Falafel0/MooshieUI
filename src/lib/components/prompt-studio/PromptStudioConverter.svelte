<script lang="ts">
  import { ArrowLeftRight, Copy, Plus, ScanText } from '@lucide/svelte';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { convertWeights, type WeightFormat } from '../../prompt-studio/weight-converter.js';
  import { locale } from '../../stores/locale.svelte.js';
  let input = $state('');
  let from = $state<WeightFormat>('sd');
  let to = $state<WeightFormat>('nai');
  let groupName = $state('');
  let feedback = $state('');
  let failed = $state(false);
  const result = $derived(convertWeights(input, from, to));
  function resetFeedback() { feedback = ''; failed = false; }
  function swap() { const previous = from; from = to; to = previous; resetFeedback(); }
  function add() {
    if (!result.output.trim()) return;
    studio.addGroup(groupName.trim() || locale.t('prompt_studio.v2.converter.group_name'), result.output);
    feedback = locale.t('prompt_studio.v2.tools.group_added'); failed = false;
  }
  async function copy() {
    try { await navigator.clipboard.writeText(result.output); feedback = locale.t('prompt_studio.copied'); failed = false; }
    catch { feedback = locale.t('prompt_studio.v2.tools.copy_failed'); failed = true; }
  }
</script>

<section class="h-full min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6" aria-labelledby="studio-converter-title">
  <header class="mb-6 max-w-3xl"><div class="mb-2 flex items-center gap-2 text-amber-300"><ScanText size={18} /><h2 id="studio-converter-title" class="text-base font-semibold">{locale.t('prompt_studio.v2.converter.title')}</h2></div><p class="text-sm leading-relaxed text-neutral-400">{locale.t('prompt_studio.v2.converter.description')}</p></header>
  <div class="max-w-5xl space-y-5">
    <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 md:p-5" aria-labelledby="studio-converter-source">
      <h3 id="studio-converter-source" class="text-sm font-semibold text-neutral-200">{locale.t('prompt_studio.v2.converter.source')}</h3>
      <div class="mt-4 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <label class="text-xs text-neutral-400">{locale.t('prompt_studio.v2.converter.from')}<select bind:value={from} onchange={resetFeedback} class="touch-target mt-2 block w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-200">{#each ['sd', 'nai'] as value}<option value={value}>{locale.t(`prompt_studio.v2.tools.format_${value}`)}</option>{/each}</select></label>
        <button type="button" class="touch-target flex items-center justify-center gap-2 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-400" onclick={swap}><ArrowLeftRight size={16} />{locale.t('prompt_studio.v2.converter.swap')}</button>
        <label class="text-xs text-neutral-400">{locale.t('prompt_studio.v2.converter.to')}<select bind:value={to} onchange={resetFeedback} class="touch-target mt-2 block w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-200">{#each ['sd', 'nai'] as value}<option value={value}>{locale.t(`prompt_studio.v2.tools.format_${value}`)}</option>{/each}</select></label>
      </div>
      <label for="studio-converter-input" class="mt-5 block text-xs text-neutral-400">{locale.t('prompt_studio.v2.converter.input')}</label>
      <textarea id="studio-converter-input" bind:value={input} oninput={resetFeedback} placeholder={locale.t(from === 'sd' ? 'prompt_studio.v2.converter.example_sd' : 'prompt_studio.v2.converter.example_nai')} rows={7} spellcheck={false} class="mt-2 min-h-40 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 p-4 font-mono text-sm leading-relaxed text-neutral-200 placeholder:text-neutral-600"></textarea>
      <div class="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!studio.prompt.trim()} class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300 disabled:opacity-40" onclick={() => { input = studio.prompt; resetFeedback(); }}>{locale.t('prompt_studio.v2.converter.use_draft')}</button><button type="button" disabled={!input} class="touch-target rounded-lg px-3 text-xs text-neutral-500 disabled:opacity-40" onclick={() => { input = ''; resetFeedback(); }}>{locale.t('prompt_studio.v2.converter.clear')}</button></div>
      <p class="mt-3 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.converter.syntax_hint')}</p>
    </section>
    <section class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 md:p-5" aria-labelledby="studio-converter-preview">
      <div class="flex flex-wrap items-center justify-between gap-2"><h3 id="studio-converter-preview" class="text-sm font-semibold text-neutral-200">{locale.t('prompt_studio.v2.tools.preview')}</h3><span class="text-xs text-neutral-500">{locale.t('prompt_studio.v2.converter.converted', { count: result.converted })}</span></div>
      <p class="mt-1 text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.converter.preview_hint')}</p>
      {#if result.warnings.length}
        <div role="status" class="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
          <p class="text-xs font-medium text-amber-300">{locale.t('prompt_studio.v2.converter.warnings')}</p>
          <ul class="mt-3 space-y-3 text-xs leading-relaxed text-neutral-400">
            {#each result.warnings.slice(0, 6) as warning, index (index)}
              <li><p>{locale.t(`prompt_studio.v2.converter.warning_${warning.code}`)}</p><code class="mt-1 block break-words rounded-lg bg-neutral-950/60 p-2 text-[11px] text-neutral-500">{input.slice(warning.start, Math.min(warning.end, warning.start + 120))}{warning.end - warning.start > 120 ? '…' : ''}</code></li>
            {/each}
          </ul>
          {#if result.warnings.length > 6}<p class="mt-3 text-xs text-neutral-500">{locale.t('prompt_studio.v2.converter.more_warnings', { count: result.warnings.length - 6 })}</p>{/if}
        </div>
      {/if}
      <label for="studio-converter-output" class="mt-4 block text-xs text-neutral-400">{locale.t('prompt_studio.v2.tools.preview_format', { format: locale.t(`prompt_studio.v2.tools.format_${to}`) })}</label>
      <textarea id="studio-converter-output" readonly value={result.output} rows={7} spellcheck={false} class="mt-2 min-h-40 w-full resize-y rounded-xl border border-neutral-800 bg-neutral-950 p-4 font-mono text-sm leading-relaxed text-neutral-300"></textarea>
      <label class="mt-4 block text-xs text-neutral-400">{locale.t('prompt_studio.v2.tools.group_name')}<input bind:value={groupName} placeholder={locale.t('prompt_studio.v2.converter.group_name')} class="touch-target mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-200" /></label>
      <div class="mt-4 flex flex-wrap gap-2"><button type="button" disabled={!result.output.trim()} class="touch-target flex items-center gap-2 rounded-lg bg-amber-400 px-4 text-xs font-medium text-neutral-950 disabled:opacity-40" onclick={add}><Plus size={15} />{locale.t('prompt_studio.v2.tools.add_group')}</button><button type="button" disabled={!result.output.trim()} class="touch-target flex items-center gap-2 rounded-lg border border-neutral-700 px-4 text-xs text-neutral-300 disabled:opacity-40" onclick={() => void copy()}><Copy size={15} />{locale.t('common.copy')}</button></div>
      {#if feedback}<p role="status" class="mt-3 text-xs {failed ? 'text-red-300' : 'text-amber-300'}">{feedback}</p>{/if}
    </section>
  </div>
</section>
