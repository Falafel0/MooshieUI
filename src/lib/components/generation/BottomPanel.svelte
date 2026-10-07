<script lang="ts">
  import { generation } from "../../stores/generation.svelte.js";
  import { models } from "../../stores/models.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { bottomPanel } from "../../stores/bottomPanel.svelte.js";
  import { availableBottomTabs, bottomPanelContext } from "../../utils/bottomPanel.js";
  import { notes } from "../../stores/notes.svelte.js";
  import { onDestroy } from "svelte";
  import type { OutputImage } from "../../types/index.js";
  import BottomPanelTabs from "./BottomPanelTabs.svelte";
  import BottomPanelImages from "./BottomPanelImages.svelte";
  import BottomPanelPrompts from "./BottomPanelPrompts.svelte";
  import BottomPanelArtists from "./BottomPanelArtists.svelte";
  import LoraGallery from "./LoraGallery.svelte";
  import CheckpointGallery from "./CheckpointGallery.svelte";
  import CompareGrid from "./CompareGrid.svelte";
  import StyleManager from "./StyleManager.svelte";
  import StyleCreatorPanel from "./StyleCreatorPanel.svelte";
  import ScheduleBuilder from "./ScheduleBuilder.svelte";
  import VideoTimelinePanel from "../video/VideoTimelinePanel.svelte";
  interface Props {
    onupscale: (image: OutputImage) => void;
    oninpaint: (image: OutputImage) => void;
    onrefine: (image: OutputImage) => void;
    oncontextmenu?: (image: OutputImage, x: number, y: number) => void;
  }
  let { onupscale, oninpaint, onrefine, oncontextmenu }: Props = $props();
  const context = $derived(bottomPanelContext(generation.mode === "video", generation.isNovelAi));
  const visibleTabs = $derived(availableBottomTabs(context, models.checkpoints.length > 10 || generation.devMode));
  const activeTab = $derived(bottomPanel.resolveTab(context, visibleTabs));
  onDestroy(() => notes.flush());
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-neutral-950" aria-label={locale.t("bottom_panel.workspace")}>
  <BottomPanelTabs />
  <div id={`bottom-content-${activeTab}`} role="tabpanel" aria-labelledby={`bottom-tab-${activeTab}`} tabindex="0" class="flex-1 min-h-0 min-w-0 overflow-auto [scrollbar-gutter:stable]">
    {#if activeTab === "loras"}
      <LoraGallery cardSize={bottomPanel.loraCardSize} onCardSizeChange={(size) => bottomPanel.setCardSize("lora", size)} />
    {:else if activeTab === "checkpoints"}
      <CheckpointGallery />
    {:else if activeTab === "images"}
      <BottomPanelImages {onupscale} {oninpaint} {onrefine} {oncontextmenu} />
    {:else if activeTab === "prompts"}
      <BottomPanelPrompts />
    {:else if activeTab === "artists"}
      <BottomPanelArtists />
    {:else if activeTab === "compare"}
      <CompareGrid />
    {:else if activeTab === "styles"}
      <StyleManager />
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
  </div>
</section>
