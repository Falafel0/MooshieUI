<script lang="ts">
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { models } from "../../stores/models.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { availableBottomTabs, bottomPanelContext, bottomTabLabelKey, shelfSelectionKey, shelfGroup, SHELF_GROUPS, type BottomTabId } from "../../utils/bottomPanel.js";
  import BottomPanelIcon from "./BottomPanelIcon.svelte";
  let { onclose, onactivate }: { onclose: () => void; onactivate?: () => void } = $props();
  const context = $derived(bottomPanelContext(generation.mode === "video", generation.isNovelAi));
  const available = $derived(availableBottomTabs(context, models.checkpoints.length > 0 || generation.devMode));
  function openDialog(node: HTMLDialogElement) {
    const previous = document.activeElement;
    node.showModal();
    return { destroy() { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); } };
  }
  function openPanel(tab: BottomTabId) {
    bottomPanel.selectTab(shelfSelectionKey(context, generation.mode), tab);
    onactivate?.();
    onclose();
  }
</script>

<dialog use:openDialog onclose={onclose} onclick={(event) => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onclose(); } }} onkeydown={(event) => event.stopPropagation()} aria-label={locale.t("bottom_panel.customize")} class="fixed inset-0 m-auto max-h-[80vh] w-[min(36rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-ui-border bg-ui-surface p-5 text-neutral-200 shadow-2xl backdrop:bg-black/60">
  <div class="mb-3 flex items-center justify-between gap-3">
    <h2 class="text-base font-semibold">{locale.t("bottom_panel.customize")}</h2>
    <button type="button" onclick={onclose} aria-label={locale.t("common.close")} class="ui-icon-button flex items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800"><BottomPanelIcon name="close" /></button>
  </div>
  <p class="mb-4 text-sm text-neutral-400">{locale.t("bottom_panel.pin_hint")}</p>
  {#each SHELF_GROUPS as group}
    {@const panels = available.filter((tab) => shelfGroup(tab) === group).sort((a, b) => (bottomPanel.pinned.indexOf(a) < 0 ? 999 : bottomPanel.pinned.indexOf(a)) - (bottomPanel.pinned.indexOf(b) < 0 ? 999 : bottomPanel.pinned.indexOf(b)))}
    {#if panels.length}
      <fieldset class="mb-3 rounded-lg border border-ui-border/60 px-3 pb-2">
        <legend class="px-1 text-xs font-medium text-neutral-400">{locale.t(`bottom_panel.group.${group}`)}</legend>
        {#each panels as tab (tab)}
          {@const pinned = bottomPanel.pinned.includes(tab)}
          {@const peers = bottomPanel.pinned.filter((id) => shelfGroup(id) === group)}
          <div class="flex items-center gap-2 py-1">
            <label class="ui-control flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" class="accent-ui-accent" checked={pinned} disabled={pinned && bottomPanel.pinned.filter((id) => available.includes(id)).length <= 1} onchange={(event) => bottomPanel.setPinned(tab, event.currentTarget.checked)} /><span class="truncate">{locale.t(bottomTabLabelKey(tab, context))}</span></label>
            {#if pinned}
              <button type="button" class="ui-icon-button flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 disabled:opacity-25" disabled={peers.indexOf(tab) === 0} aria-label={locale.t("bottom_panel.move_earlier", { name: locale.t(bottomTabLabelKey(tab, context)) })} onclick={() => bottomPanel.movePin(tab, -1)}><BottomPanelIcon name="left" /></button>
              <button type="button" class="ui-icon-button flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 disabled:opacity-25" disabled={peers.indexOf(tab) === peers.length - 1} aria-label={locale.t("bottom_panel.move_later", { name: locale.t(bottomTabLabelKey(tab, context)) })} onclick={() => bottomPanel.movePin(tab, 1)}><BottomPanelIcon name="right" /></button>
            {/if}
            <button type="button" class="ui-control rounded-md border border-ui-border px-3 text-xs text-neutral-300 hover:bg-neutral-800" aria-label={locale.t("bottom_panel.open_panel", { name: locale.t(bottomTabLabelKey(tab, context)) })} onclick={() => openPanel(tab)}>{locale.t("bottom_panel.open")}</button>
          </div>
        {/each}
      </fieldset>
    {/if}
  {/each}
</dialog>
