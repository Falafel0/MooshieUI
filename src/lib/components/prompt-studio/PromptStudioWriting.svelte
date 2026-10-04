<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { FileText, Scale, Sparkles, LoaderCircle, Plus } from '@lucide/svelte';
  import PromptTextarea from '../generation/PromptTextarea.svelte';
  import PromptStudioConverter from './PromptStudioConverter.svelte';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { promptAssistant } from '../../stores/promptAssistant.svelte.js';
  import { generation } from '../../stores/generation.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { userScopedKey } from '../../utils/ipc.js';

  let { active = true }: { active?: boolean } = $props();
  let view = $state<'text' | 'weights'>('text');
  let assistantOpen = $state(false);
  let description = $state('');
  let length = $state<'short' | 'medium' | 'detailed'>('medium');
  let result = $state('');
  let resultScope = $state('');
  let groupName = $state('');
  let error = $state('');
  let added = $state(false);
  let composing = $state(false);
  let scope = $state(userScopedKey('mooshie.prompt-studio.writing'));
  let requestRevision = 0;
  let mounted = true;

  function resetAssistant() {
    requestRevision += 1;
    composing = false;
    result = '';
    resultScope = '';
    error = '';
    added = false;
  }

  // Hiding a view cancels its pending delivery, while completed work stays local.
  function suspendAssistant() {
    if (!composing) return;
    requestRevision += 1;
    composing = false;
  }

  function checkScope(): boolean {
    const next = userScopedKey('mooshie.prompt-studio.writing');
    if (next === scope) return true;
    resetAssistant();
    description = '';
    groupName = '';
    assistantOpen = false;
    scope = next;
    return false;
  }

  // Account loading resets these shared fields; clear local drafts at the same time.
  $effect(() => {
    void studio.selected;
    void studio.groups;
    void studio.rawPrompt;
    untrack(checkScope);
  });

  $effect(() => {
    if (!active) {
      assistantOpen = false;
      untrack(suspendAssistant);
    }
  });

  onDestroy(() => {
    mounted = false;
    requestRevision += 1;
  });

  function toggleAssistant(event: Event) {
    if (!active || !(event.currentTarget as HTMLDetailsElement).open) {
      assistantOpen = false;
      suspendAssistant();
    }
    else if (checkScope() && !groupName.trim()) groupName = locale.t('prompt_studio.v2.ai_group_default');
  }

  function selectView(next: 'text' | 'weights') {
    if (view === next) return;
    assistantOpen = false;
    suspendAssistant();
    view = next;
  }

  async function compose() {
    if (!active || !checkScope() || !description.trim() || promptAssistant.isGenerating || !promptAssistant.isAvailable) return;
    const capturedScope = scope;
    const revision = ++requestRevision;
    const currentRequest = () => mounted && active && assistantOpen && view === 'text' && revision === requestRevision && capturedScope === userScopedKey('mooshie.prompt-studio.writing');
    composing = true;
    result = '';
    error = '';
    added = false;
    try {
      const answer = await promptAssistant.compose(description.trim(), generation.modelFamily, { length });
      if (!currentRequest()) return;
      result = answer.trim();
      resultScope = capturedScope;
      if (!result) error = locale.t('prompt_assistant.couldnt_compose');
    } catch (reason) {
      if (!currentRequest()) return;
      const detail = String(reason).replace(/^Error:\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 240);
      error = detail.includes('busy_generation')
        ? locale.t('prompt_assistant.busy_generation')
        : detail.includes('no_model')
          ? locale.t('prompt_assistant.no_model')
          : `${locale.t('prompt_studio.v2.ai_failed')}${detail ? `: ${detail}` : ''}`;
    } finally {
      if (currentRequest()) composing = false;
    }
  }

  function addResult() {
    if (!active || !checkScope() || resultScope !== scope || !result.trim() || !groupName.trim()) return;
    studio.addGroup(groupName.trim(), result.trim());
    result = '';
    resultScope = '';
    added = true;
  }
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label={locale.t('prompt_studio.v2.writing_title')}>
  <nav class="flex shrink-0 items-center gap-1 border-b border-neutral-800 px-4 py-3" aria-label={locale.t('prompt_studio.v2.writing_views')}>
    <button type="button" aria-pressed={view === 'text'} class="touch-target flex items-center gap-2 rounded-lg px-3 text-sm {view === 'text' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-900'}" onclick={() => selectView('text')}><FileText size={16} />{locale.t('prompt_studio.v2.writing_text')}</button>
    <button type="button" aria-pressed={view === 'weights'} class="touch-target flex items-center gap-2 rounded-lg px-3 text-sm {view === 'weights' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-900'}" onclick={() => selectView('weights')}><Scale size={16} />{locale.t('prompt_studio.v2.writing_weights')}</button>
  </nav>

  <div class:hidden={view !== 'weights'} class="min-h-0 flex-1 overflow-y-auto overscroll-contain"><PromptStudioConverter /></div>
    <div class:hidden={view !== 'text'} class="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-5">
      <div>
        <h2 class="text-base font-medium text-neutral-100">{locale.t('prompt_studio.v2.writing_title')}</h2>
        <p class="mt-1 text-sm leading-relaxed text-neutral-400">{locale.t('prompt_studio.v2.writing_hint')}</p>
      </div>

      <div>
        {#if studio.rawPrompt !== undefined}
          <div class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2">
            <p class="min-w-40 flex-1 text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.manual_prompt_hint')}</p>
            <button type="button" class="touch-target shrink-0 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300 hover:bg-neutral-800" onclick={() => studio.editPrompt(undefined)}>{locale.t('prompt_studio.return_constructor')}</button>
          </div>
        {/if}
        <PromptTextarea bind:value={() => studio.basePrompt, value => studio.editPrompt(value)} rows={12} minHeight="min-h-72" storageKey="studio-writing-base" placeholder={locale.t('generation.prompts.positive_placeholder')} />
      </div>

      <details bind:open={assistantOpen} ontoggle={toggleAssistant} class="rounded-xl border border-neutral-800 bg-neutral-900">
        <summary class="touch-target flex cursor-pointer items-center gap-2 rounded-xl px-4 py-3 text-sm text-neutral-300 focus-visible:outline-2 focus-visible:outline-amber-400"><Sparkles size={16} class="text-neutral-400" />{locale.t('prompt_studio.v2.ai_optional')}</summary>
        <form class="space-y-3 border-t border-neutral-800 p-4" onsubmit={event => { event.preventDefault(); void compose(); }}>
          <p class="text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.v2.ai_hint')}</p>
          <label class="block">
            <span class="mb-2 block text-xs text-neutral-300">{locale.t('prompt_studio.v2.ai_description')}</span>
            <textarea bind:value={description} disabled={composing} rows="3" placeholder={locale.t('prompt_assistant.describe_placeholder')} class="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-200 outline-none focus:border-amber-400 disabled:opacity-60"></textarea>
          </label>
          <div class="flex flex-wrap items-center gap-3">
            <label class="flex items-center gap-2 text-xs text-neutral-400">
              {locale.t('prompt_assistant.length')}
              <select bind:value={length} disabled={composing} class="touch-target rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-neutral-200 outline-none focus:border-amber-400">
                {#each ['short', 'medium', 'detailed'] as option}<option value={option}>{locale.t(`prompt_assistant.length_${option}`)}</option>{/each}
              </select>
            </label>
            <button type="submit" disabled={composing || promptAssistant.isGenerating || !promptAssistant.isAvailable || !description.trim()} class="touch-target flex items-center gap-2 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40">
              {#if composing}<LoaderCircle size={15} class="animate-spin" />{locale.t('prompt_assistant.generating')}{:else}<Sparkles size={15} />{locale.t('prompt_studio.v2.ai_compose')}{/if}
            </button>
          </div>
          {#if !promptAssistant.isAvailable}<p class="text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.ai_unavailable')}</p>{/if}
          {#if error}<p role="alert" class="rounded-lg border border-red-900/60 bg-red-950/20 p-3 text-xs leading-relaxed text-red-300">{error}</p>{/if}
          {#if result && resultScope === userScopedKey('mooshie.prompt-studio.writing')}
            <div class="space-y-3 border-t border-neutral-800 pt-3">
              <label class="block">
                <span class="mb-2 block text-xs text-neutral-300">{locale.t('prompt_studio.v2.ai_result')}</span>
                <textarea bind:value={result} rows="5" class="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm leading-relaxed text-neutral-200 outline-none focus:border-amber-400"></textarea>
              </label>
              <div class="flex flex-wrap items-end gap-3">
                <label class="min-w-40 flex-1"><span class="mb-2 block text-xs text-neutral-400">{locale.t('prompt_studio.group_name')}</span><input bind:value={groupName} class="touch-target w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-200 outline-none focus:border-amber-400" /></label>
                <button type="button" disabled={!result.trim() || !groupName.trim()} class="touch-target flex items-center gap-2 rounded-lg bg-amber-400 px-3 text-xs font-medium text-neutral-950 hover:bg-amber-300 disabled:opacity-40" onclick={addResult}><Plus size={15} />{locale.t('prompt_studio.v2.ai_add_group')}</button>
              </div>
            </div>
          {/if}
          {#if added}<p role="status" class="text-xs text-amber-300">{locale.t('prompt_studio.v2.ai_added')}</p>{/if}
        </form>
      </details>
    </div>
</section>
