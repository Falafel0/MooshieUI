<script lang="ts">
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import BottomPanelIcon from "./BottomPanelIcon.svelte";
</script>
<div class="flex shrink-0 items-center gap-0.5 rounded-lg border border-ui-border/60 p-0.5" role="group" aria-label={locale.t("bottom_panel.card_layout")}>
  {#each ["strip", "grid"] as layout}
    <button type="button" aria-pressed={bottomPanel.cardLayout === layout} aria-label={locale.t(layout === "strip" ? "bottom_panel.horizontal_cards" : "bottom_panel.grid_cards")} onclick={() => bottomPanel.setCardLayout(layout as "strip" | "grid")} class="ui-icon-button flex items-center justify-center rounded-md {bottomPanel.cardLayout === layout ? 'bg-ui-selected text-ui-accent' : 'text-neutral-500 hover:text-neutral-200'}"><BottomPanelIcon name={layout === "strip" ? "strip" : "grid"} /></button>
  {/each}
</div>
