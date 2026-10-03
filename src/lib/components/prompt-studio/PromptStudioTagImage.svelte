<script lang="ts">
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { untrack } from 'svelte';
  import { tagPreview, sourcePreview } from '../../prompt-studio/preview-cache.js';
  import { locale } from '../../stores/locale.svelte.js';
  let { tag, src, subId }: { tag: string; src?: string; subId?: string } = $props();
  const savedPreview = $derived(customCatalog.entries.find(entry => entry.tag === tag && (!subId || entry.subId === subId))?.preview);
  let element: HTMLDivElement | undefined = $state();
  let url = $state('');
  let loading = $state(false);
  let failed = $state(false);
  let revision = 0;
  async function load() {
    const id = ++revision;
    loading = true; failed = false;
    try {
      const result = src ? await sourcePreview(src) : await tagPreview(tag);
      if (id !== revision) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(result.blob);
    } catch { if (id === revision) failed = true; }
    finally { if (id === revision) loading = false; }
  }
  $effect(() => {
    tag; src; savedPreview;
    const target = element;
    untrack(() => { revision++; loading = false; failed = false; if (url) URL.revokeObjectURL(url); url = ''; });
    if (!target || savedPreview) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
    });
    observer.observe(target);
    return () => { revision++; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  });
</script>
<div bind:this={element} class="flex aspect-square w-full items-center justify-center overflow-hidden border-b border-neutral-800 bg-neutral-950">
  {#if savedPreview}<img src={savedPreview} alt={locale.t('prompt_studio.preview_tag', { tag })} class="h-full w-full object-contain" />
  {:else if url}<img src={url} alt={locale.t('prompt_studio.preview_tag', { tag })} class="h-full w-full object-contain" />
  {:else if loading}<span role="status" class="text-xs text-neutral-500">{locale.t('prompt_studio.preview_loading')}</span>
  {:else if failed}<button type="button" class="touch-target px-3 py-2 text-xs text-neutral-500" onclick={() => void load()}>{locale.t('prompt_studio.preview_retry')}</button>
  {:else}<span aria-hidden="true" class="text-neutral-600">◉</span>{/if}
</div>
