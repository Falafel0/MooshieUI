<script lang="ts">
  import { locale } from '../../stores/locale.svelte.js';
  let { shown, total, onmore }: { shown: number; total: number; onmore: () => void } = $props();
  // The marker is the final grid/strip item, so either scroll direction loads
  // the next batch. Keep an explicit button for keyboard and assistive users.
  function observe(node: HTMLElement, _shown: number) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onmore();
    }, { rootMargin: '160px', threshold: 0 });
    observer.observe(node);
    return {
      update() { observer.unobserve(node); observer.observe(node); },
      destroy() { observer.disconnect(); },
    };
  }
</script>
{#if shown < total}
    <button use:observe={shown} type="button" onclick={onmore} aria-label={locale.t('common.show_more')} class="ui-focus flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border border-ui-border bg-ui-surface px-3 py-4 text-xs text-neutral-300 hover:bg-ui-hover">
      <span>{locale.t('common.show_more')}</span>
      <span class="tabular-nums text-neutral-500">{locale.formatInteger(shown)} / {locale.formatInteger(total)}</span>
    </button>
{/if}
