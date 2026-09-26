<script lang="ts">
  /**
   * The monbooru tab.
   *
   * Presents monbooru as two views of the same library: an artist browser
   * (artist tags from monbooru's artist category) and the image gallery. The
   * connection row owns the one thing both views share — whether the host is
   * answering at all.
   *
   * Desktop and browser mode are the same here: the monbooru client is Rust,
   * built into both, so nothing on this page is desktop-only.
   */
  import { onMount } from "svelte";
  import { monbooru } from "../store.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import type { MonbooruView } from "../types.js";
  import ArtistBrowser from "./ArtistBrowser.svelte";
  import ImageGrid from "./ImageGrid.svelte";
  import PromptArena from "../../components/monbooru/PromptArena.svelte";
  import type { PromptBlock } from "../../components/monbooru/PromptArena.svelte";
  import MacroPalette from "../../components/monbooru/MacroPalette.svelte";

  interface Props {
    /** Which view to mount with. Defaults to the artist browser. */
    initialView?: MonbooruView;
    /** Integrator hook for "insert tag into prompt". Falls through to the store's shared path. */
    oninsertTag?: (tag: string) => void;
    /** Navigate to the monbooru settings section. Falls back to the store's app request. */
    onsettings?: () => void;
    /**
     * The arena handed a composed prompt over. App.svelte switches to the
     * generation tab; the prompt itself is already written into the generation
     * store by `sendToGenerator`, so the parent only moves the user.
     */
    ongenerate?: () => void;
    /** Artist macro cross-link: open the artist gallery for this slug. */
    onopenArtist?: (slug: string) => void;
    /** Character macro cross-link: open this Animadex character slug. */
    onopenCharacter?: (slug: string) => void;
  }

  let {
    initialView = "artists",
    oninsertTag,
    onsettings,
    ongenerate,
    onopenArtist,
    onopenCharacter,
  }: Props = $props();
  let lastInitialView = $state<MonbooruView>("artists");

  $effect(() => {
    if (initialView !== lastInitialView) {
      lastInitialView = initialView;
      monbooru.view = initialView;
    }
  });

  onMount(() => {
    void (async () => {
      await monbooru.init();
      if (!monbooru.artistsLoaded) await monbooru.loadArtists();
    })();
  });

  function openSettings() {
    if (onsettings) onsettings();
    else monbooru.openSettings();
  }

  function setView(view: MonbooruView) {
    monbooru.view = view;
  }

  /** Dot colour per connection state, from theme variables so both themes work. */
  const statusColor = $derived(
    monbooru.connection === "connected"
      ? "var(--color-emerald-400)"
      : monbooru.connection === "testing"
        ? "var(--theme-accent-400)"
        : monbooru.connection === "disconnected"
          ? "var(--color-rose-400)"
          : "var(--color-neutral-500)",
  );

  const statusLabel = $derived(
    monbooru.connection === "connected"
      ? locale.t("monbooru.status.connected")
      : monbooru.connection === "testing"
        ? locale.t("monbooru.status.testing")
        : monbooru.connection === "disconnected"
          ? locale.t("monbooru.status.disconnected")
          : locale.t("monbooru.status.unknown"),
  );
  // ---- Prompt Arena ---------------------------------------------------------
  //
  // The arena is MooshieUI's own prompt authoring surface, hosted in this tab
  // because that is where its tags come from. Its draft lives here and is
  // persisted locally, so browsing monbooru never disturbs the prompt the user
  // is still composing. Only "Send to the generator" writes it into the
  // generation store, which is the one point where the two mechanics meet.

  const ARENA_KEY = "mooshieui.monbooru.arena.v1";

  type ArenaDraft = { positive: string; negative: string; blocks: PromptBlock[] };

  function loadDraft(): ArenaDraft {
    const empty: ArenaDraft = { positive: "", negative: "", blocks: [] };
    try {
      const raw = localStorage.getItem(ARENA_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) as Partial<ArenaDraft>;
      return {
        positive: typeof parsed.positive === "string" ? parsed.positive : "",
        negative: typeof parsed.negative === "string" ? parsed.negative : "",
        blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
      };
    } catch {
      return empty;
    }
  }

  let draft = $state<ArenaDraft>(loadDraft());

  $effect(() => {
    try {
      localStorage.setItem(ARENA_KEY, JSON.stringify(draft));
    } catch {
      // Storage unavailable or full: the draft still works for this session.
    }
  });

  /** Append tags, comma-separated, skipping any already in the prompt. */
  function appendTags(tags: string[]): void {
    const existing = new Set(
      draft.positive
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    );
    const add = tags
      .map((t) => t.trim())
      .filter((t) => t && !existing.has(t.toLowerCase()));
    if (add.length === 0) return;
    const body = draft.positive.trim();
    draft.positive = body ? `${body}, ${add.join(", ")}` : add.join(", ");
  }

  /** "Build from selection": pull the open monbooru image's tags into the arena. */
  function buildFromSelection(): void {
    appendTags(monbooru.selectedTags.map((t) => t.name));
  }

  /**
   * Adopt an image's generation recipe into the arena.
   *
   * monbooru already parsed these values out of the file, and MooshieUI
   * generated through ComfyUI in the first place, so this is the round trip
   * working in the direction that matters: a library image becomes a prompt
   * that can be re-rolled here. Re-rolls group together on monbooru's side
   * under one generation hash, which is why bringing the prompt back is worth
   * more than reusing the seed alone.
   */
  function usePrompt(prompt: string): void {
    appendTags([prompt]);
    monbooru.view = "arena";
  }

  function useNegative(prompt: string): void {
    const body = draft.negative.trim();
    const existing = new Set(
      body
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    );
    if (!prompt.trim() || existing.has(prompt.trim().toLowerCase())) return;
    draft.negative = body ? `${body}, ${prompt.trim()}` : prompt.trim();
    monbooru.view = "arena";
  }

  function useSeed(seed: string): void {
    if (!seed.trim()) return;
    generation.seed = seed.trim();
    generation.saveSettings();
  }

  /** Hand the composed prompt to the generator: this is the hand-off, not a copy. */
  function sendToGenerator(payload: { positive: string; negative: string }): void {
    generation.positivePrompt = payload.positive;
    generation.negativePrompt = payload.negative;
    generation.saveSettings();
    ongenerate?.();
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="shrink-0 border-b border-neutral-800">
    <div class="flex flex-wrap items-center justify-between gap-3 px-3 py-3 md:px-4">
      <h2 class="text-base font-semibold text-neutral-200">{locale.t("monbooru.title")}</h2>

      <div class="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
        <button
          type="button"
          class="rounded px-3 py-1 text-xs transition-colors {monbooru.view === 'artists' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
          onclick={() => setView("artists")}
        >
          {locale.t("monbooru.view.artists")}
        </button>
        <button
          type="button"
          class="rounded px-3 py-1 text-xs transition-colors {monbooru.view === 'images' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
          onclick={() => setView("images")}
        >
          {locale.t("monbooru.view.images")}
        </button>
        <button
          type="button"
          class="rounded px-3 py-1 text-xs transition-colors {monbooru.view === 'arena' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
          onclick={() => setView("arena")}
        >
          {locale.t("monbooru.arena.title")}
        </button>
      </div>
    </div>

    <!-- Connection row -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-neutral-800/60 px-3 py-2 md:px-4">
      <div class="flex min-w-0 items-center gap-2" role="status">
        <span
          class="h-2.5 w-2.5 shrink-0 rounded-full"
          style="background-color: {statusColor}"
          aria-hidden="true"
        ></span>
        <span class="shrink-0 text-xs text-neutral-300">{statusLabel}</span>
        {#if monbooru.version}
          <span class="shrink-0 text-[11px] text-neutral-600">{locale.t("monbooru.version", { version: monbooru.version })}</span>
        {/if}
      </div>

      <span class="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500" title={monbooru.baseUrl}>
        {monbooru.baseUrl || locale.t("monbooru.base_url_unset")}
      </span>

      <button
        type="button"
        class="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={monbooru.connection === "testing"}
        aria-busy={monbooru.connection === "testing"}
        onclick={() => monbooru.testConnection()}
      >
        {monbooru.connection === "testing"
          ? locale.t("monbooru.testing_connection")
          : locale.t("monbooru.test_connection")}
      </button>

      <button
        type="button"
        class="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 transition-colors hover:border-indigo-500"
        onclick={openSettings}
      >
        {locale.t("monbooru.open_settings")}
      </button>
    </div>

    {#if monbooru.connection === "disconnected" && monbooru.connectionError}
      <p class="border-t border-rose-900/40 bg-rose-950/40 px-3 py-1.5 text-xs text-rose-300 md:px-4">
        {monbooru.connectionError}
      </p>
    {/if}
  </header>

  <div class="min-h-0 flex-1">
    {#if monbooru.view === "artists"}
      <ArtistBrowser />
    {:else if monbooru.view === "images"}
      <ImageGrid {oninsertTag} onuseprompt={usePrompt} onusenegative={useNegative} onuseseed={useSeed} />
    {:else}
      <!-- Prompt Arena + macro palette. MooshieUI's own authoring surface, so it
           works whether or not a monbooru server is answering: only "build from
           selection" needs one. -->
      <div class="grid h-full min-h-0 gap-3 overflow-y-auto p-3 md:grid-cols-[minmax(0,1fr)_21rem] md:p-4">
        <PromptArena
          bind:positivePrompt={draft.positive}
          bind:negativePrompt={draft.negative}
          bind:blocks={draft.blocks}
          onGenerate={sendToGenerator}
          onBuildFromSelection={monbooru.selectedTags.length > 0 ? buildFromSelection : undefined}
          onOpenArtist={onopenArtist}
          onOpenCharacter={onopenCharacter}
        />
        <MacroPalette
          onInsertTags={appendTags}
          onOpenArtist={onopenArtist}
          onOpenCharacter={onopenCharacter}
        />
      </div>
    {/if}
  </div>
</div>
