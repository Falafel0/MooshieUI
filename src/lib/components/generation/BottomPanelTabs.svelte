<script lang="ts">
  import BottomShelfSettings from "./BottomShelfSettings.svelte";
  import BottomPanelIcon from "./BottomPanelIcon.svelte";
  import { tick } from "svelte";
  import { generation } from "../../stores/generation.svelte.js";
  import { gallery, isVideoImage } from "../../stores/gallery.svelte.js";
  import { models } from "../../stores/models.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  import { availableBottomTabs, bottomPanelContext, bottomTabLabelKey, shelfSelectionKey, shelfGroup, SHELF_GROUPS } from "../../utils/bottomPanel.js";
  import { artistFavourites } from "../../artist-gallery/favourites.svelte.js";
  import { queue } from "../../stores/queue.svelte.js";
  import { compare } from "../../stores/compare.svelte.js";
  import { videoTimeline } from "../../stores/videoTimeline.svelte.js";
  import { styles as stylesStore } from "../../stores/styles.svelte.js";
  import { promptPresets } from "../../stores/promptPresets.svelte.js";
  let { collapsed = false, onactivate, oncollapse, onbrowse, onexpand }: { collapsed?: boolean; onactivate?: () => void; oncollapse?: () => void; onbrowse?: () => void; onexpand?: () => void } = $props();
  let customizing = $state(false);
  const context = $derived(bottomPanelContext(generation.mode === "video", generation.isNovelAi));
  const isVideoMode = $derived(context === "video");
  const selectionKey = $derived(shelfSelectionKey(context, generation.mode));
  const available = $derived(availableBottomTabs(context, models.checkpoints.length > 0 || generation.devMode));
  const visibleTabs = $derived(bottomPanel.visibleTabs(selectionKey, available));
  const activeTab = $derived(bottomPanel.resolveTab(selectionKey, visibleTabs));
  const activeLoraCount = $derived(generation.loras.filter((l) => l.enabled && l.name).length);
  const sessionImageCount = $derived((isVideoMode ? gallery.sessionImages.filter(isVideoImage) : gallery.sessionImages).length);
  const favoriteCount = $derived(generation.promptHistory.filter((p) => p.favorite).length);
  const tabLabelKey = (tab: import("../../utils/bottomPanel.js").BottomTabId) => bottomTabLabelKey(tab, context);
  let tablist: HTMLDivElement;
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);
  function trackOverflow(node: HTMLDivElement) {
    const update = () => {
      canScrollLeft = node.scrollLeft > 1;
      canScrollRight = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    // The inner strip changes width with counts, locale and available tools.
    const mutation = new MutationObserver(update);
    mutation.observe(node, { subtree: true, childList: true, characterData: true });
    node.addEventListener("scroll", update);
    update();
    return { destroy() { observer.disconnect(); mutation.disconnect(); node.removeEventListener("scroll", update); } };
  }
  function scrollTabs(direction: number) {
    tablist.scrollBy({ left: direction * Math.max(160, tablist.clientWidth * 0.6) });
  }
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
    bottomPanel.selectTab(selectionKey, visibleTabs[next]);
    onactivate?.();
    const button = tablist.querySelector<HTMLElement>(`#bottom-tab-${visibleTabs[next]}`);
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
</script>
<div class="flex shrink-0 items-stretch border-b border-ui-border/60 bg-ui-surface/70">
  {#if canScrollLeft || canScrollRight}
    <button type="button" class="{collapsed ? 'size-8' : 'ui-icon-button'} flex shrink-0 items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30" disabled={!canScrollLeft} aria-label={locale.t("bottom_panel.previous_tabs")} onclick={() => scrollTabs(-1)}><BottomPanelIcon name="left" /></button>
  {/if}
  <div bind:this={tablist} use:trackOverflow role="tablist" tabindex="-1" aria-label={locale.t("bottom_panel.workspace")} class="flex min-w-0 flex-1 items-stretch px-2 shrink-0 overflow-x-auto overflow-y-hidden" onkeydown={navigateTabs}>
    {#each SHELF_GROUPS as group}
      {@const groupTabs = visibleTabs.filter((tab) => shelfGroup(tab) === group)}
      {#if groupTabs.length}
        <div class="flex shrink-0 flex-col px-1.5 {group !== shelfGroup(visibleTabs[0]) ? 'border-l border-ui-border/60' : ''}">
          {#if !collapsed}<span class="px-3 pt-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500">{locale.t(`bottom_panel.group.${group}`)}</span>{/if}
          <div class="flex items-center gap-1 {collapsed ? '' : 'pb-1'}">
          {#each groupTabs as tab (tab)}
      <button
        id={`bottom-tab-${tab}`} role="tab" aria-selected={activeTab === tab} aria-controls={`bottom-content-${tab}`} tabindex={activeTab === tab ? 0 : -1}
        onclick={() => { bottomPanel.selectTab(selectionKey, tab); onactivate?.(); }}
        class="{collapsed ? 'min-h-8 py-1' : 'ui-control'} px-3 shrink-0 whitespace-nowrap text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 {activeTab === tab
          ? 'bg-ui-selected text-ui-accent shadow-sm ring-1 ring-ui-accent/35'
          : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/60'}"
      >
        <BottomPanelIcon name={tab === "images" && isVideoMode ? "videos" : tab} />
        {locale.t(tabLabelKey(tab))}
        {#if tab === "loras" && activeLoraCount > 0}
          <span class="min-w-5 rounded-md bg-neutral-800/70 px-1.5 py-0.5 text-[10px] text-neutral-300 tabular-nums">{activeLoraCount}</span>
        {:else if tab === "images" && sessionImageCount > 0}
          <span class="min-w-5 rounded-md bg-neutral-800/70 px-1.5 py-0.5 text-[10px] text-neutral-300 tabular-nums">{sessionImageCount}</span>
        {:else if tab === "jobs" && queue.rows.length > 0}
          <span class="min-w-5 rounded-md bg-neutral-800/70 px-1.5 py-0.5 text-[10px] text-neutral-300 tabular-nums">{queue.rows.length}</span>
        {:else if tab === "prompts" && favoriteCount > 0}
          <span class="min-w-5 rounded-md bg-neutral-800/70 px-1.5 py-0.5 text-[10px] text-neutral-300 tabular-nums">{favoriteCount}</span>
        {:else if tab === "artists" && artistFavourites.count > 0}
          <span class="min-w-5 rounded-md bg-neutral-800/70 px-1.5 py-0.5 text-[10px] text-neutral-300 tabular-nums">{artistFavourites.count}</span>
        {:else if tab === "compare" && compare.enabled}
          <span class="min-w-5 rounded-md bg-neutral-800/70 px-1.5 py-0.5 text-[10px] text-neutral-300 tabular-nums">{compare.cellCount}</span>
        {:else if tab === "timeline" && videoTimeline.enabled && videoTimeline.segments.length > 0}
          <span class="min-w-5 rounded-md bg-neutral-800/70 px-1.5 py-0.5 text-[10px] text-neutral-300 tabular-nums">{videoTimeline.segments.length}</span>
        {:else if tab === "styles" && (stylesStore.activeStyles.length > 0 || promptPresets.activeEntries.length > 0)}
          <span class="min-w-5 rounded-md bg-neutral-800/70 px-1.5 py-0.5 text-[10px] text-neutral-300 tabular-nums">{stylesStore.activeStyles.length + promptPresets.activeEntries.length}</span>
        {/if}
      </button>
          {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>
  {#if canScrollLeft || canScrollRight}
    <button type="button" class="{collapsed ? 'size-8' : 'ui-icon-button'} flex shrink-0 items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30" disabled={!canScrollRight} aria-label={locale.t("bottom_panel.next_tabs")} onclick={() => scrollTabs(1)}><BottomPanelIcon name="right" /></button>
  {/if}
  <div class="flex shrink-0 items-center gap-0.5 border-l border-ui-border/60 px-1">
    <button type="button" class="{collapsed ? 'size-8' : 'ui-icon-button'} flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800" aria-label={locale.t("bottom_panel.customize")} onclick={() => { customizing = true; }}><BottomPanelIcon name="plus" /></button>
    {#if onbrowse}<button type="button" class="{collapsed ? 'size-8' : 'ui-icon-button'} flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800" aria-label={locale.t("bottom_panel.browse")} onclick={onbrowse}><BottomPanelIcon name="browse" /></button>{/if}
    {#if onexpand}<button type="button" class="{collapsed ? 'size-8' : 'ui-icon-button'} flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800" aria-label={locale.t("bottom_panel.expand")} onclick={onexpand}><BottomPanelIcon name="expand" /></button>{/if}
    {#if oncollapse}<button type="button" class="{collapsed ? 'size-8' : 'ui-icon-button'} flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800" aria-expanded={!collapsed} aria-label={locale.t(collapsed ? "generation.panel.expand_bottom" : "generation.panel.collapse_bottom")} onclick={oncollapse}><BottomPanelIcon name={collapsed ? "up" : "down"} /></button>{/if}
  </div>
</div>
{#if customizing}<BottomShelfSettings onclose={() => { customizing = false; }} {onactivate} />{/if}
