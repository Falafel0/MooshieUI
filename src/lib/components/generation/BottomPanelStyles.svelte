<script lang="ts">
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import BottomPanelArtists from "./BottomPanelArtists.svelte";
  import StyleManager from "./StyleManager.svelte";
  import StyleCreatorPanel from "./StyleCreatorPanel.svelte";
</script>
<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center gap-2 border-b border-ui-border/60 px-3 py-1.5">
    <button type="button" aria-pressed={bottomPanel.stylesView === "saved"} onclick={() => { bottomPanel.stylesView = "saved"; }} class="ui-control rounded-lg px-3 text-xs {bottomPanel.stylesView === 'saved' ? 'bg-ui-selected text-ui-accent' : 'text-neutral-400 hover:bg-neutral-800'}">{locale.t("bottom_panel.style_library")}</button>
    <button type="button" aria-pressed={bottomPanel.stylesView === "artists"} onclick={() => { bottomPanel.stylesView = "artists"; }} class="ui-control rounded-lg px-3 text-xs {bottomPanel.stylesView === 'artists' ? 'bg-ui-selected text-ui-accent' : 'text-neutral-400 hover:bg-neutral-800'}">{locale.t("bottom_panel.tab.artists")}</button>
    <button type="button" aria-pressed={bottomPanel.stylesView === "create"} onclick={() => { bottomPanel.stylesView = "create"; }} class="ui-control ml-auto rounded-lg border border-ui-border px-3 text-xs text-neutral-300 hover:bg-neutral-800">{locale.t("bottom_panel.create_style")}</button>
  </div>
  <div class="min-h-0 flex-1 overflow-auto">
    {#if bottomPanel.stylesView === "artists"}<BottomPanelArtists />{:else if bottomPanel.stylesView === "create"}<StyleCreatorPanel />{:else}<StyleManager />{/if}
  </div>
</div>
