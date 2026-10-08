<script lang="ts">
  import { tick } from 'svelte';
  import { X, Plus } from '@lucide/svelte';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { promptTokenRanges, convertWeights } from '../../prompt-studio/weight-converter.js';
  import { locale } from '../../stores/locale.svelte.js';
  import { gallery } from '../../stores/gallery.svelte.js';
  import { autocomplete } from '../../stores/autocomplete.svelte.js';

  let { readonly = false, large = false }: { readonly?: boolean; large?: boolean } = $props();
  let arena = $state<HTMLDivElement>();
  let entry = $state('');
  const componentId = $props.id();
  const suggestionId = `${componentId}-tags`;
  const suggestions = $derived(autocomplete.enabled && /^[\p{L}\p{N}_ -]{2,}$/u.test(entry) ? autocomplete.search(entry, 12) : []);
  const tokens = $derived(studio.promptParts.flatMap(part => {
    const warnings = convertWeights(part.content, studio.nai ? 'nai' : 'sd', studio.nai ? 'sd' : 'nai').warnings.filter(warning => warning.code === 'unbalanced' || warning.code === 'invalid_weight');
    return promptTokenRanges(part.content).map(range => ({ ...range, part, warning: warnings.find(warning => warning.start < range.end && warning.end > range.start) }));
  }));
  type Token = (typeof tokens)[number];
  const diagnostics = $derived([...new Set(tokens.flatMap(token => token.warning ? [token.warning.code] : []))]);

  function sizeField(field: HTMLTextAreaElement) {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }
  function fitField(field: HTMLTextAreaElement, _value: string) {
    sizeField(field);
    return { update(_value: string) { void tick().then(() => sizeField(field)); } };
  }

  function history(event: KeyboardEvent, dirty: boolean): boolean {
    if (dirty || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return false;
    event.preventDefault();
    if (event.shiftKey) studio.redo(); else studio.undo();
    return true;
  }
  function change(token: Token, value: string, input?: HTMLTextAreaElement) {
    if (!studio.editPromptToken(token.part.id, token.start, token.end, value, token.part.content)) {
      if (input) input.value = token.text;
      gallery.showToast(locale.t('prompt_studio.library.duplicate_tag'), 'error');
    }
  }
  async function remove(token: Token, index: number) {
    change(token, '');
    await tick();
    const fields = arena?.querySelectorAll<HTMLTextAreaElement>('[data-prompt-token] textarea');
    (fields?.[Math.min(index, fields.length - 1)] ?? arena?.querySelector<HTMLInputElement>('[data-add-tag]'))?.focus();
  }
  function add() {
    if (!entry.trim()) return;
    studio.addPromptText(entry);
    entry = '';
  }
</script>

<div
  bind:this={arena}
  class="flex content-start flex-wrap items-start gap-1.5 rounded-lg border border-ui-border bg-neutral-950 p-3 focus-within:border-ui-accent {large ? 'min-h-64' : 'min-h-40'}"
  role="group"
  aria-label={locale.t('prompt_studio.combined_preview')}
  data-prompt-arena
>
  {#each tokens as token, index (`${token.part.id}:${token.start}`)}
    <div data-prompt-token class="flex max-w-full items-center rounded-md border {token.warning ? 'border-amber-500/70' : 'border-ui-accent/25'} bg-ui-selected text-sm text-neutral-200 focus-within:ring-1 focus-within:ring-ui-accent">
      {#if readonly}
        <span class="break-words px-2 py-1.5">{token.text}</span>
      {:else}
        <textarea
          rows={1}
          use:fitField={token.text}
          value={token.text}
          aria-label={`${locale.t('prompt_studio.v2.edit_tag')}: ${token.text}`}
          aria-invalid={!!token.warning}
          title={token.warning ? `${token.text} · ${locale.t(`prompt_studio.v2.converter.warning_${token.warning.code}`)}` : token.text}
          class="min-w-0 resize-none overflow-hidden rounded-l-md bg-transparent px-2 py-1.5 text-sm leading-5 text-neutral-200 outline-none"
          style={`width: ${Math.max(4, Math.min(48, [...token.text].length + 2))}ch; max-width: calc(100% - 1.75rem)`}
          oninput={(event) => sizeField(event.currentTarget)}
          onchange={(event) => change(token, event.currentTarget.value, event.currentTarget)}
          onkeydown={(event) => {
            const input = event.currentTarget;
            if (history(event, input.value !== token.text)) return;
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') return;
            if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
            else if (event.key === 'Escape') { event.preventDefault(); input.value = token.text; input.blur(); }
            else if ((event.key === 'Backspace' || event.key === 'Delete') && !input.value) { event.preventDefault(); void remove(token, index); }
          }}
        ></textarea>
        <button type="button" class="ui-focus flex size-7 shrink-0 items-center justify-center rounded-r-md text-neutral-400 hover:bg-red-500/15 hover:text-red-300" aria-label={`${locale.t('prompt_studio.remove_tag')}: ${token.text}`} title={locale.t('prompt_studio.remove_tag')} onpointerdown={(event) => event.preventDefault()} onclick={() => remove(token, index)}><X size={13} /></button>
      {/if}
    </div>
  {/each}
  {#if !readonly}
    <label class="flex min-w-32 flex-1 items-center gap-1.5 rounded-md border border-dashed border-ui-border px-2 text-neutral-500 focus-within:border-ui-accent">
      <Plus size={14} class="shrink-0" />
      <input data-add-tag type="text" list={suggestionId} autocomplete="off" bind:value={entry} aria-label={locale.t('prompt_studio.add_tag')} placeholder={locale.t('prompt_studio.add_tag')} class="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-neutral-200 outline-none" onblur={add} onkeydown={(event) => { if (history(event, !!entry)) return; if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') return; if (event.key === 'Enter') { event.preventDefault(); add(); } else if (event.key === 'Backspace' && !entry && tokens.length) { event.preventDefault(); void remove(tokens[tokens.length - 1], tokens.length - 1); } else if (event.key === 'Escape') { event.preventDefault(); entry = ''; } }} />
    </label>
    <datalist id={suggestionId}>{#each suggestions as tag (tag.n)}<option value={tag.n}></option>{/each}</datalist>
  {:else if !tokens.length}
    <p class="text-xs leading-relaxed text-neutral-500">{locale.t('prompt_studio.v2.empty_draft')}</p>
  {/if}
</div>

{#if !readonly}<p class="mt-2 text-[11px] leading-relaxed text-neutral-500">{locale.t('prompt_studio.arena_hint')}</p>{/if}
{#each diagnostics as code}<p role="status" class="mt-2 text-xs leading-relaxed text-amber-300">{locale.t(`prompt_studio.v2.converter.warning_${code}`)}</p>{/each}
