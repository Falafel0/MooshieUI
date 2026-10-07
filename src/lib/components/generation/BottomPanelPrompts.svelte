<script lang="ts">
  import { generation } from "../../stores/generation.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  // Prompt history
  const sortedPromptHistory = $derived(
    [...generation.promptHistory]
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return b.createdAt - a.createdAt;
      })
  );

  function historyLabel(ts: number): string {
    return new Date(ts).toLocaleString(locale.intlTag, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }


  const filteredPromptHistory = $derived.by(() => {
    const q = bottomPanel.promptSearch.toLowerCase().trim();
    return sortedPromptHistory.filter((entry) => !q || (entry.positivePrompt || "").toLowerCase().includes(q) || (entry.negativePrompt || "").toLowerCase().includes(q));
  });
</script>
      <!-- Prompt History & Favorites -->
      {#if sortedPromptHistory.length === 0}
        <div class="flex items-center justify-center h-full text-neutral-500 text-xs">
          <p>{locale.t('bottom_panel.no_prompts')}</p>
        </div>
      {:else}
        <div class="flex flex-col h-full">
          <div class="px-3 py-2 border-b border-ui-border shrink-0">
            <input
              type="text"
              bind:value={bottomPanel.promptSearch}
              aria-label={locale.t('bottom_panel.prompt_search_placeholder')} placeholder={locale.t('bottom_panel.prompt_search_placeholder')}
              class="w-full ui-control px-3 min-w-0 bg-ui-surface border border-ui-border rounded-md text-xs text-neutral-100 placeholder-neutral-500 focus:border-ui-accent transition-colors"
            />
          </div>
          {#if filteredPromptHistory.length === 0}
            <div class="flex items-center justify-center flex-1 text-neutral-500 text-xs">
              <p>{locale.t('bottom_panel.no_prompt_results')}</p>
            </div>
          {:else}
            <div class="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] content-start gap-2 flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable] px-2 py-2">
              {#each filteredPromptHistory as entry (entry.id)}
                <div class="shrink-0 rounded-lg border bg-neutral-900/60 overflow-hidden {entry.favorite ? 'border-amber-500/40' : 'border-neutral-800 hover:border-neutral-700'} transition-colors">
              <button
                class="w-full text-left p-2.5"
                onclick={() => generation.applyPromptHistoryEntry(entry.id)}
                title={locale.t('bottom_panel.load_prompt')}
              >
                <p class="text-[11px] text-neutral-200 leading-relaxed line-clamp-4">{entry.positivePrompt || locale.t('bottom_panel.empty_prompt')}</p>
                {#if entry.negativePrompt}
                  <p class="text-[10px] text-neutral-500 mt-1 line-clamp-1">{locale.t('bottom_panel.neg_prefix')} {entry.negativePrompt}</p>
                {/if}
              </button>
              <div class="px-2.5 pb-2 flex items-center justify-between gap-2 shrink-0">
                <div class="flex items-center gap-1.5 text-[10px] text-neutral-500">
                  <span>{historyLabel(entry.createdAt)}</span>
                  <span class="px-1 py-0.5 rounded bg-neutral-800 text-neutral-400">{entry.mode}</span>
                </div>
                <div class="flex items-center gap-1">
                  <button
                    class="ui-icon-button px-1.5 text-xs rounded border transition-colors {entry.favorite ? 'border-amber-500 text-amber-300 bg-amber-500/10' : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-300'}"
                    onclick={() => generation.togglePromptFavorite(entry.id)}
                    aria-pressed={entry.favorite}
                    aria-label={entry.favorite ? locale.t('bottom_panel.unfavorite') : locale.t('bottom_panel.favorite')}
                    title={entry.favorite ? locale.t('bottom_panel.unfavorite') : locale.t('bottom_panel.favorite')}
                  >
                    ★
                  </button>
                  <button
                    class="ui-icon-button px-1.5 text-xs rounded border border-neutral-700 text-neutral-400 hover:border-red-500 hover:text-red-300 transition-colors"
                    onclick={() => generation.removePromptHistoryEntry(entry.id)}
                    aria-label={locale.t('bottom_panel.remove')} title={locale.t('bottom_panel.remove')}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
