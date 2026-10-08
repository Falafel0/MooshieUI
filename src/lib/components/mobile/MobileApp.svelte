<script lang="ts">
  import MobileTabBar, { type MobileTab } from "./MobileTabBar.svelte";
  import MobileGeneratePage from "./MobileGeneratePage.svelte";
  import MusicPage from "../music/MusicPage.svelte";
  import MusicBottomPlayer from "../music/MusicBottomPlayer.svelte";
  import { music } from "../../stores/music.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import MobileSettingsPage from "./MobileSettingsPage.svelte";
  import GalleryPage from "../gallery/GalleryPage.svelte";
  import { ArtistGalleryPage } from "../../artist-gallery/index.js";
  import ModelHubPage from "../modelhub/ModelHubPage.svelte";
  import DownloadBanner from "../downloads/DownloadBanner.svelte";
  import { connection } from "../../stores/connection.svelte.js";
  import { characterInsert } from "../../stores/characterInsert.svelte.js";
  import CharacterInsertModal from "../../animadex/components/CharacterInsertModal.svelte";
  import type { AnimadexCharacter } from "../../animadex/types.js";
  import PromptStudio from "../prompt-studio/PromptStudio.svelte";
  import { workspace } from "../../stores/workspace.svelte.js";
  import { commands } from "../../stores/commands.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { Search } from "@lucide/svelte";
  import { availableWorkspaces } from "../../utils/workspaces.js";

  interface Props {
    canUseModelhub?: boolean;
    userRole?: string;
    onNavigate: (tab: MobileTab) => void;
  }
  let {
    canUseModelhub = false,
    userRole = "admin",
    onNavigate,
  }: Props = $props();

  const currentTitle = $derived(availableWorkspaces({ canUseModelhub, canUseVideo: !generation.isNovelAi }).find((entry) => entry.id === workspace.current)?.labelKey ?? "nav.generate");

  // Gallery actions and completion notifications have already selected a mode.
  function openGeneration() {
    workspace.open("generate");
  }

  function handleCharacterInsert(character: AnimadexCharacter) {
    characterInsert.request(character);
    if (!characterInsert.pending) {
      openGeneration();
    }
  }

  function finishCharacterInsert() {
    characterInsert.dismiss();
    openGeneration();
  }

</script>

<div class="mobile-shell flex flex-col h-full w-full bg-neutral-950 text-neutral-100 overflow-hidden tap-highlight-none">
  <DownloadBanner />
  <div class="flex shrink-0 items-center justify-between border-b border-ui-border px-3 py-1 safe-top">
    <span class="text-xs font-medium text-neutral-300">{locale.t(currentTitle)}</span>
    <button type="button" class="touch-target flex items-center justify-center rounded-lg text-neutral-400 hover:bg-ui-selected" onclick={() => commands.show()} aria-label={locale.t("commands.open")}><Search size={18} /></button>
  </div>
  <main class="flex-1 min-h-0 overflow-hidden">
    {#if workspace.current === "generate"}
      <MobileGeneratePage />
    {:else if workspace.current === "studio"}
      <PromptStudio onApply={openGeneration} />
    {:else if workspace.current === "music"}
      <MusicPage {userRole} />
    {:else if workspace.current === "gallery"}
      <GalleryPage onSwitchToGenerate={openGeneration} />
    {:else if workspace.current === "modelhub" && canUseModelhub}
      <div class="h-full overflow-hidden">
        <ModelHubPage />
      </div>
    {:else if workspace.current === "artists"}
      <div class="h-full overflow-hidden">
        <ArtistGalleryPage
          manifestUrl={connection.artistGalleryManifestUrl}
          initialTab="artists"
          oninsertCharacter={handleCharacterInsert}
        />
      </div>
    {:else if workspace.current === "characters"}
      <div class="h-full overflow-hidden">
        <ArtistGalleryPage
          manifestUrl={connection.artistGalleryManifestUrl}
          initialTab="characters"
          oninsertCharacter={handleCharacterInsert}
        />
      </div>
    {:else if workspace.current === "settings"}
      <MobileSettingsPage {userRole} />
    {/if}
  </main>
  <MusicBottomPlayer onOpen={() => { music.view = "generate"; onNavigate("music"); }} />
  <CharacterInsertModal onapplied={finishCharacterInsert} />
  <MobileTabBar
    onChange={onNavigate}
    showModelhub={canUseModelhub}
    showVideo={!generation.isNovelAi}
  />
</div>
