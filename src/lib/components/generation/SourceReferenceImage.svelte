<script lang="ts">
  import { untrack } from 'svelte';
  import { loadAnimaSourceImage } from '../../utils/api.js';
  import { sourcePreview } from '../../prompt-studio/preview-cache.js';
  import { locale } from '../../stores/locale.svelte.js';
  let { src, alt, thumbnail = false, onOpen, class: imageClass = '' }: { src: string; alt: string; thumbnail?: boolean; onOpen?: () => void; class?: string } = $props();
  let element: HTMLDivElement | undefined = $state();
  let url = $state('');
  let loading = $state(false);
  let failed = $state(false);
  let retry = $state(0);
  let revision = 0;
  $effect(() => {
    const source = src, target = element, small = thumbnail;
    retry;
    untrack(() => {
      revision++; if (url) URL.revokeObjectURL(url);
      url = ''; loading = false; failed = false;
    });
    if (!source || !target) return;
    const id = revision;
    async function load() {
      loading = true;
      try {
        const cached = small ? await sourcePreview(source) : undefined;
        const bytes = cached ? undefined : await loadAnimaSourceImage(source);
        if (id !== revision) return;
        const blob = cached?.blob ?? new Blob([new Uint8Array(bytes!)]);
        const bitmap = await createImageBitmap(blob);
        bitmap.close();
        if (id !== revision) return;
        url = URL.createObjectURL(blob);
      } catch { if (id === revision) failed = true; }
      finally { if (id === revision) loading = false; }
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
    }, { rootMargin: '120px' });
    observer.observe(target);
    return () => { revision++; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  });
</script>

<div bind:this={element} class="flex min-h-24 w-full items-center justify-center overflow-hidden bg-neutral-950">
  {#if url}
    {#if onOpen}<button type="button" class="touch-target w-full" onclick={onOpen}><img src={url} {alt} class={imageClass} /></button>
    {:else}<img src={url} {alt} class={imageClass} />{/if}
  {:else if failed}<button type="button" class="touch-target px-3 py-2 text-xs text-neutral-400" onclick={() => retry++}>{locale.t('prompt_studio.preview_retry')}</button>
  {:else if loading}<span role="status" class="p-3 text-xs text-neutral-500">{locale.t('prompt_studio.preview_loading')}</span>
  {:else}<span aria-hidden="true" class="text-neutral-600">◉</span>{/if}
</div>
