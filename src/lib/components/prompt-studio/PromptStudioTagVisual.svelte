<script lang="ts">
  import { tagPreviews } from '../../prompt-studio/tag-previews.svelte.js';
  import { tagSwatch } from '../../prompt-studio/tag-presentation.js';
  import { Image } from '@lucide/svelte';
  let { tag, group = '', preview, images = true, large = false }: { tag: string; group?: string; preview?: string; images?: boolean; large?: boolean } = $props();
  const image = $derived(images ? preview || tagPreviews.image(tag) : undefined);
  const swatch = $derived(tagSwatch(tag, group));
</script>
{#if image}
  <img src={image} alt="" loading="lazy" class="shrink-0 rounded-lg object-cover {large ? 'h-20 w-20' : 'h-10 w-10'}" />
{:else if swatch}
  <span aria-hidden="true" style:background={swatch} class="shrink-0 rounded-lg border border-white/20 {large ? 'h-20 w-20' : 'h-7 w-7'}"></span>
{:else if large}
  <span aria-hidden="true" class="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-600"><Image size={22} /></span>
{/if}
