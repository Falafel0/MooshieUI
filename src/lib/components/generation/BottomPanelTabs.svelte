<script lang="ts">
  import { tick } from "svelte";
  import { generation } from "../../stores/generation.svelte.js";
  import { gallery, isVideoImage } from "../../stores/gallery.svelte.js";
  import { models } from "../../stores/models.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  import { availableBottomTabs, bottomPanelContext, bottomTabLabelKey } from "../../utils/bottomPanel.js";
  import { artistFavourites } from "../../artist-gallery/favourites.svelte.js";
  import { compare } from "../../stores/compare.svelte.js";
  import { videoTimeline } from "../../stores/videoTimeline.svelte.js";
  import { styles as stylesStore } from "../../stores/styles.svelte.js";
  import { promptPresets } from "../../stores/promptPresets.svelte.js";
  const context = $derived(bottomPanelContext(generation.mode === "video", generation.isNovelAi));
  const isVideoMode = $derived(context === "video");
  const visibleTabs = $derived(availableBottomTabs(context, models.checkpoints.length > 10 || generation.devMode));
  const activeTab = $derived(bottomPanel.resolveTab(context, visibleTabs));
  const activeLoraCount = $derived(generation.loras.filter((l) => l.enabled && l.name).length);
  const sessionImageCount = $derived((isVideoMode ? gallery.sessionImages.filter(isVideoImage) : gallery.sessionImages).length);
  const favoriteCount = $derived(generation.promptHistory.filter((p) => p.favorite).length);
  const tabLabelKey = (tab: import("../../utils/bottomPanel.js").BottomTabId) => bottomTabLabelKey(tab, context);
  let tablist: HTMLDivElement;
  $effect(() => {
    const selected = activeTab;
    void tick().then(() => tablist?.querySelector(`#bottom-tab-${selected}`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });
  function navigateTabs(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
    const index = visibleTabs.indexOf(activeTab);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % visibleTabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + visibleTabs.length) % visibleTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = visibleTabs.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    bottomPanel.selectTab(context, visibleTabs[next]);
    const button = tablist.querySelector<HTMLElement>(`#bottom-tab-${visibleTabs[next]}`);
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
</script>
  <!-- Tab bar (scroll horizontally when many/long tabs) -->
  <div bind:this={tablist} role="tablist" tabindex="-1" aria-label={locale.t("bottom_panel.workspace")} class="flex items-center gap-1 border-b border-ui-border bg-ui-surface px-2 py-1.5 shrink-0 overflow-x-auto overflow-y-hidden" onkeydown={navigateTabs}>
    {#each visibleTabs as tab (tab)}
      <button
        id={`bottom-tab-${tab}`} role="tab" aria-selected={activeTab === tab} aria-controls={`bottom-content-${tab}`} tabindex={activeTab === tab ? 0 : -1}
        onclick={() => bottomPanel.selectTab(context, tab)}
        class="ui-control px-3 shrink-0 whitespace-nowrap text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 {activeTab === tab
          ? 'bg-ui-selected text-ui-accent ring-1 ring-ui-accent/30'
          : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/60'}"
      >
        {#if tab === "loras"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        {:else if tab === "checkpoints"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        {:else if tab === "images" && isVideoMode}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
        {:else if tab === "images"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        {:else if tab === "prompts"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        {:else if tab === "compare"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        {:else if tab === "artists"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        {:else if tab === "styles"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 9.5 16.5 14.5 18.5 22 12 18 5.5 22 7.5 14.5 2 9.5 9 9 12 2"/></svg>
        {:else if tab === "style_creator"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/></svg>
        {:else if tab === "schedule"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        {:else if tab === "timeline"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="14" height="5" rx="1"/><rect x="6" y="15" width="14" height="5" rx="1"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
        {:else if tab === "notes"}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        {/if}
        {locale.t(tabLabelKey(tab))}
        {#if tab === "loras" && activeLoraCount > 0}
          <span class="text-[9px] px-1 py-0 rounded-full bg-indigo-600/30 text-indigo-400 tabular-nums">{activeLoraCount}</span>
        {:else if tab === "images" && sessionImageCount > 0}
          <span class="text-[9px] px-1 py-0 rounded-full bg-indigo-600/30 text-indigo-400 tabular-nums">{sessionImageCount}</span>
        {:else if tab === "prompts" && favoriteCount > 0}
          <span class="text-[9px] px-1 py-0 rounded-full bg-amber-500/30 text-amber-400 tabular-nums">{favoriteCount}</span>
        {:else if tab === "artists" && artistFavourites.count > 0}
          <span class="text-[9px] px-1 py-0 rounded-full bg-red-500/30 text-red-400 tabular-nums">{artistFavourites.count}</span>
        {:else if tab === "compare" && compare.enabled}
          <span class="text-[9px] px-1 py-0 rounded-full bg-indigo-600/30 text-indigo-400 tabular-nums">{compare.cellCount}</span>
        {:else if tab === "timeline" && videoTimeline.enabled && videoTimeline.segments.length > 0}
          <span class="text-[9px] px-1 py-0 rounded-full bg-indigo-600/30 text-indigo-400 tabular-nums">{videoTimeline.segments.length}</span>
        {:else if tab === "styles" && (stylesStore.activeStyles.length > 0 || promptPresets.activeEntries.length > 0)}
          <span class="text-[9px] px-1 py-0 rounded-full bg-indigo-600/30 text-indigo-400 tabular-nums">{stylesStore.activeStyles.length + promptPresets.activeEntries.length}</span>
        {/if}
      </button>
    {/each}
  </div>
