<script lang="ts">
  import { locale } from '../../stores/locale.svelte.js';
  import { untrack } from 'svelte';
  import { sourcePreview } from '../../prompt-studio/preview-cache.js';
  let { src, alt }: { src: string; alt: string } = $props();
  let element: HTMLDivElement | undefined = $state();
  let url = $state('');
  let error = $state(false);
  let loading = $state(false);
  let revision = 0;
  async function load() {
    const id = ++revision;
    loading = true; error = false;
    try {
      const image = await sourcePreview(src);
      if (id !== revision) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(image.blob);
    } catch { if (id === revision) error = true; }
    finally { if (id === revision) loading = false; }
  }
  $effect(() => {
    src;
    const target = element;
    untrack(() => { revision++; error = false; loading = false; if (url) URL.revokeObjectURL(url); url = ''; });
    if (!target) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
    });
    observer.observe(target);
    return () => { revision++; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  });
</script>
<div bind:this={element} class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
  {#if url}<img src={url} {alt} class="h-full w-full object-cover" />
  {:else if loading}<span role="status" aria-label={locale.t("prompt_studio.preview_loading")} class="text-xs text-neutral-500">…</span>
  {:else if error}<button type="button" class="touch-target h-full w-full text-[10px] text-neutral-400" aria-label={locale.t("prompt_studio.preview_retry_label", { name: alt })} title={locale.t("prompt_studio.preview_retry")} onclick={() => void load()}>↻</button>
  {:else}<span aria-hidden="true" class="text-neutral-600">◉</span>{/if}
</div>
