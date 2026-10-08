<script lang="ts">
  import { generation } from "../../stores/generation.svelte.js";
  import { models } from "../../stores/models.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  import { availableBottomTabs, bottomPanelContext, shelfSelectionKey } from "../../utils/bottomPanel.js";
  import { notes } from "../../stores/notes.svelte.js";
  import { onDestroy, untrack } from "svelte";
  import type { OutputImage } from "../../types/index.js";
  import BottomPanelTabs from "./BottomPanelTabs.svelte";
  import BottomPanelImages from "./BottomPanelImages.svelte";
  import BottomPanelPrompts from "./BottomPanelPrompts.svelte";
  import BottomPanelArtists from "./BottomPanelArtists.svelte";
  import LoraGallery from "./LoraGallery.svelte";
  import CheckpointGallery from "./CheckpointGallery.svelte";
  import CompareGrid from "./CompareGrid.svelte";
  import BottomPanelStyles from "./BottomPanelStyles.svelte";
  import QueuePanel from "../ui/QueuePanel.svelte";
  import StyleCreatorPanel from "./StyleCreatorPanel.svelte";
  import ScheduleBuilder from "./ScheduleBuilder.svelte";
  import VideoTimelinePanel from "../video/VideoTimelinePanel.svelte";
  interface Props {
    collapsed?: boolean;
    onactivate?: () => void;
    oncollapse?: () => void;
    onbrowse?: () => void;
    onexpand?: () => void;
    onupscale: (image: OutputImage) => void;
    oninpaint: (image: OutputImage) => void;
    onrefine: (image: OutputImage) => void;
    oncontextmenu?: (image: OutputImage, x: number, y: number) => void;
  }
  let { onupscale, oninpaint, onrefine, oncontextmenu, collapsed = false, onactivate, oncollapse, onbrowse, onexpand }: Props = $props();
  const context = $derived(bottomPanelContext(generation.mode === "video", generation.isNovelAi));
  const selectionKey = $derived(shelfSelectionKey(context, generation.mode));
  const available = $derived(availableBottomTabs(context, models.checkpoints.length > 0 || generation.devMode));
  const visibleTabs = $derived(bottomPanel.visibleTabs(selectionKey, available));
  const activeTab = $derived(bottomPanel.resolveTab(selectionKey, visibleTabs));
  onDestroy(() => notes.flush());
  $effect(() => { if (collapsed) untrack(() => notes.flush()); });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-neutral-950" aria-label={locale.t("bottom_panel.workspace")}>
  <BottomPanelTabs {collapsed} {onactivate} {oncollapse} {onbrowse} {onexpand} />
  <div hidden={collapsed} id={`bottom-content-${activeTab}`} role="tabpanel" aria-labelledby={`bottom-tab-${activeTab}`} tabindex="0" class="flex-1 min-h-0 min-w-0 overflow-auto [scrollbar-gutter:stable]">
    {#if !collapsed}
    {#if activeTab === "loras"}
      <LoraGallery cardSize={bottomPanel.loraCardSize} onCardSizeChange={(size) => bottomPanel.setCardSize("lora", size)} />
    {:else if activeTab === "checkpoints"}
      <CheckpointGallery />
    {:else if activeTab === "images"}
      <BottomPanelImages {onupscale} {oninpaint} {onrefine} {oncontextmenu} />
    {:else if activeTab === "references"}
      <BottomPanelImages source="references" {onupscale} {oninpaint} {onrefine} {oncontextmenu} />
    {:else if activeTab === "jobs"}
      <QueuePanel inline />
    {:else if activeTab === "prompts"}
      <BottomPanelPrompts />
    {:else if activeTab === "artists"}
      <BottomPanelArtists />
    {:else if activeTab === "compare"}
      <CompareGrid />
    {:else if activeTab === "styles"}
      <BottomPanelStyles />
    {:else if activeTab === "style_creator"}
      <StyleCreatorPanel />
    {:else if activeTab === "schedule"}
      <ScheduleBuilder />
    {:else if activeTab === "timeline"}
      <VideoTimelinePanel />
    {:else if activeTab === "notes"}
      <div class="flex h-full min-h-0 p-3">
        <textarea aria-label={locale.t("bottom_panel.tab.notes")} value={notes.text} oninput={(e) => notes.setText(e.currentTarget.value)} onblur={() => notes.flush()} placeholder={locale.t("bottom_panel.notes_placeholder")} spellcheck="false" class="flex-1 min-h-0 w-full resize-none rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-sm leading-relaxed text-neutral-100 placeholder-neutral-500 focus:border-ui-accent"></textarea>
      </div>
    {/if}
    {/if}
  </div>
</section>
