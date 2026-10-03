<script lang="ts">
  import { locale } from '../../stores/locale.svelte.js';
  import { untrack } from "svelte";
  import { tagPreview, clearPreviewCache } from '../../prompt-studio/preview-cache.js';
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { classifyTag } from '../../prompt-studio/sources.js';
  let { tag, onClose }: { tag: string; onClose?: () => void } = $props();
  let opened = $state(false);
  let url = $state('');
  let loading = $state(false);
  let error = $state('');
  let cacheNote = $state('');
  let postId = $state<number | undefined>();
  let revision = 0;
  $effect(() => {
    tag;
    untrack(() => {
      revision++; opened = false; loading = false; error = ''; cacheNote = ''; postId = undefined;
      if (url) URL.revokeObjectURL(url);
      url = '';
    });
    return () => { revision++; if (url) URL.revokeObjectURL(url); };
  });
  async function load() {
    const id = ++revision;
    opened = true; loading = true; error = '';
    try {
      const result = await tagPreview(tag);
      if (id !== revision) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(result.blob); postId = result.postId;
      cacheNote = result.cached ? 'prompt_studio.preview_cache_hit' : result.persistent ? 'prompt_studio.preview_cache_saved' : 'prompt_studio.preview_cache_session';
    } catch { if (id === revision) error = 'prompt_studio.preview_unavailable'; }
    finally { if (id === revision) loading = false; }
  }
  async function clear() {
    revision++; loading = false; opened = false;
    if (url) URL.revokeObjectURL(url); url = '';
    try { await clearPreviewCache(); cacheNote = 'prompt_studio.preview_cache_cleared'; }
    catch { error = 'prompt_studio.preview_cache_clear_error'; }
  }
</script>
<section aria-label={locale.t("prompt_studio.preview_tag", { tag })} class="rounded-xl border border-neutral-700 bg-neutral-900 p-3">
  <div class="flex flex-wrap items-center gap-2">
    <h4 class="min-w-0 flex-1 break-all text-sm text-indigo-300">{tag.replaceAll('_', ' ')}</h4>
    <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-200 disabled:opacity-50" disabled={loading} onclick={() => void load()}>{opened ? locale.t("prompt_studio.retry") : locale.t("prompt_studio.preview_show")}</button>
    <button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-200" onclick={() => { const target = classifyTag(tag); if (studio.isChosen(tag)) studio.remove(tag); else studio.addMany([{ tag, name: target.name, category: target.category }]); }}>{studio.isChosen(tag) ? locale.t("prompt_studio.remove_tag") : locale.t("prompt_studio.add_tag")}</button>
    {#if onClose}<button type="button" class="touch-target rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-400" aria-label={locale.t("prompt_studio.preview_close")} onclick={onClose}>×</button>{/if}
  </div>
  <p class="mt-2 text-[11px] text-neutral-400">{locale.t("prompt_studio.preview_hint")}</p>
  {#if loading}<p role="status" class="mt-3 text-xs text-neutral-300">{locale.t("prompt_studio.preview_loading")}</p>{/if}
  {#if error}<p role="alert" class="mt-3 text-xs text-amber-300">{locale.t(error)}</p>{/if}
  {#if url}<img src={url} alt={locale.t("prompt_studio.preview_alt", { tag, post: postId ?? "" })} class="mt-3 max-h-64 max-w-full rounded-lg object-contain" />{/if}
  {#if postId}<a href={`https://danbooru.donmai.us/posts/${postId}`} target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-xs text-indigo-300 underline">Danbooru #{postId}</a>{/if}
  <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
    {#if cacheNote}<span role="status">{locale.t(cacheNote)}</span>{/if}
    <button type="button" class="touch-target rounded px-2 py-1 hover:text-neutral-200" disabled={loading} onclick={() => void clear()}>{locale.t("prompt_studio.preview_cache_clear")}</button>
  </div>
</section>
