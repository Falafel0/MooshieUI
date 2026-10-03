<script lang="ts">
  import PromptTextarea from "./PromptTextarea.svelte";
  import { promptPresets, inlineChunkToken } from "../../stores/promptPresets.svelte.js";
  import AnimaSources from "./AnimaSources.svelte";
  import { generation } from "../../stores/generation.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { autocomplete, type TagEntry } from "../../stores/autocomplete.svelte.js";
  import { styles } from "../../stores/styles.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import {
    checkNodeAvailable,
    installCustomNode,
    searchDanbooru,
  } from "../../utils/api.js";
  import type { DanbooruPost } from "../../types/index.js";
  import {
    ANIMA_PROMPT_GROUPS,
    parseTagList,
    updateTagList,
    type AnimaPromptGroup,
  } from "../../utils/animaIntegration.js";
  import {
    parseTelegramExport,
    type TelegramPromptRecipe,
  } from "../../utils/telegramPromptImport.js";

  let { onClose, initialTab = "groups" }: { onClose: () => void; initialTab?: "groups" | "composer" | "mixer" } = $props();

  type Tab = "groups" | "catalog" | "danbooru" | "telegram" | "composer" | "mixer" | "sources";
  // svelte-ignore state_referenced_locally
  // Initial tool selection; navigation owns the state after mount.
  let tab = $state<Tab>(initialTab);
  let activeGroup = $state<AnimaPromptGroup>("character_tags");
  let localQuery = $state("");
  let danbooruQuery = $state("");
  let danbooruPage = $state(1);
  let danbooruSafe = $state(true);
  let danbooruPosts = $state<DanbooruPost[]>([]);
  let danbooruLoading = $state(false);
  let danbooruError = $state("");
  let telegramRecipes = $state<TelegramPromptRecipe[]>([]);
  let telegramError = $state("");
  let toolsAvailable = $state<boolean | null>(null);
  let mixerAvailable = $state<boolean | null>(null);
  let installing = $state<"tools" | "mixer" | null>(null);
  let advancedMixer = $state(false);
  let checkedNodes = false;

  const groupMeta: Record<AnimaPromptGroup, { label: string; icon: string }> = {
    quality_prompt: { label: locale.t("anima_studio.group.quality"), icon: "✦" },
    artist_tags: { label: locale.t("anima_studio.group.artist"), icon: "◈" },
    character_tags: { label: locale.t("anima_studio.group.character"), icon: "♙" },
    clothing_tags: { label: locale.t("anima_studio.group.clothing"), icon: "◇" },
    pose_tags: { label: locale.t("anima_studio.group.pose"), icon: "⌁" },
    background_tags: { label: locale.t("anima_studio.group.background"), icon: "▧" },
  };

  const localResults = $derived(
    localQuery.trim() ? autocomplete.search(localQuery, 48) : [],
  );
  const activeArtistCount = $derived(
    styles.activeStyles.reduce((sum, style) => sum + style.artists.length, 0),
  );

  $effect(() => {
    if (checkedNodes) return;
    checkedNodes = true;
    void probeNodes();
  });

  async function probeNodes() {
    const [tools, mixer] = await Promise.all([
      checkNodeAvailable("AnimaPromptPlusClipEncode", ["clip", "quality_prompt", "artist_tags"]),
      checkNodeAvailable("AnimaArtistAdapterMixer", ["model", "artist_pack", "strength"]),
    ]);
    toolsAvailable = tools;
    mixerAvailable = mixer;
  }

  function setGroupValue(group: AnimaPromptGroup, value: string) {
    generation.animaTools[group] = value;
  }

  function addTag(tag: string, group = activeGroup) {
    const clean = tag.replace(/^@/, "").trim();
    if (!clean) return;
    setGroupValue(group, updateTagList(generation.animaTools[group], clean));
  }

  function removeTag(tag: string, group: AnimaPromptGroup) {
    setGroupValue(group, updateTagList(generation.animaTools[group], tag, true));
  }

  function classifyGeneralTag(tag: string): AnimaPromptGroup {
    const normalized = tag.toLowerCase().replace(/_/g, " ");
    if (/background|indoors|outdoors|sky|room|street|forest|beach|city|night|day|sunset|scenery/.test(normalized)) return "background_tags";
    if (/standing|sitting|lying|kneeling|looking|holding|walking|running|pose|from (above|below|side)|cowboy shot|full body|upper body/.test(normalized)) return "pose_tags";
    if (/dress|shirt|skirt|pants|shorts|jacket|coat|uniform|swimsuit|bikini|shoes|boots|socks|gloves|hat|clothes|clothing/.test(normalized)) return "clothing_tags";
    if (/quality|masterpiece|highres|absurdres|detailed|aesthetic|score/.test(normalized)) return "quality_prompt";
    return activeGroup;
  }

  function distributeTags(tags: string[]) {
    for (const raw of tags) {
      const tag = raw.trim().replace(/_/g, " ");
      if (!tag) continue;
      const entry = autocomplete.tags.find((candidate) => candidate.n === raw.trim());
      const group: AnimaPromptGroup = entry?.c === 1
        ? "artist_tags"
        : entry?.c === 4
          ? "character_tags"
          : classifyGeneralTag(tag);
      addTag(tag, group);
    }
  }

  function importPost(post: DanbooruPost) {
    distributeTags(parseTagList((post.tag_string_general ?? "").replace(/ /g, ",")));
    for (const artist of (post.tag_string_artist ?? "").split(/\s+/).filter(Boolean)) addTag(artist, "artist_tags");
    for (const character of (post.tag_string_character ?? "").split(/\s+/).filter(Boolean)) addTag(character.replace(/_/g, " "), "character_tags");
    tab = "groups";
  }

  async function runDanbooruSearch(page = 1) {
    danbooruLoading = true;
    danbooruError = "";
    try {
      danbooruPosts = await searchDanbooru(danbooruQuery, page, 24, danbooruSafe);
      danbooruPage = page;
    } catch (error) {
      danbooruError = String(error).replace(/^Error:\s*/, "");
    } finally {
      danbooruLoading = false;
    }
  }

  async function importTelegramFile(file: File) {
    telegramError = "";
    try {
      const text = await file.text();
      const parsed = parseTelegramExport(file.name, text);
      telegramRecipes = parsed;
      if (!parsed.length) telegramError = locale.t("anima_studio.telegram.empty");
    } catch (error) {
      telegramRecipes = [];
      telegramError = `${locale.t("anima_studio.telegram.error")}: ${String(error)}`;
    }
  }

  function applyTelegram(recipe: TelegramPromptRecipe, mode: "replace" | "append" | "groups") {
    if (mode === "groups") {
      distributeTags(parseTagList(recipe.positive));
      tab = "groups";
      return;
    }
    if (mode === "replace") {
      generation.positivePrompt = recipe.positive;
      if (recipe.negative) generation.negativePrompt = recipe.negative;
    } else {
      generation.positivePrompt = [generation.positivePrompt.trim(), recipe.positive]
        .filter(Boolean)
        .join(", ");
      if (recipe.negative) {
        generation.negativePrompt = [generation.negativePrompt.trim(), recipe.negative]
          .filter(Boolean)
          .join(", ");
      }
    }
  }

  async function install(kind: "tools" | "mixer") {
    installing = kind;
    try {
      if (kind === "tools") {
        await installCustomNode("https://github.com/nregret/Comfyui-Anima-Tools", "Comfyui-Anima-Tools");
      } else {
        await installCustomNode("https://github.com/An1X3R/Anima-Artist-Mixer", "Anima-Artist-Mixer");
      }
      gallery.showToast(locale.t("anima_studio.install_restart"), "success");
    } catch (error) {
      gallery.showToast(String(error), "error");
    } finally {
      installing = null;
      await probeNodes();
    }
  }

  function close() {
    void generation.saveSettings();
    onClose();
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === "Escape") close(); }} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-60 flex bg-black/80 p-3 backdrop-blur-sm" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) close(); }}>
  <div class="mx-auto flex h-full max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl" role="dialog" aria-modal="true" tabindex="-1">
    <header class="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
      <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 font-bold text-black">A</div>
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-base font-semibold text-neutral-100">{locale.t("anima_studio.title")}</h2>
        <p class="truncate text-[11px] text-neutral-500">{locale.t("anima_studio.subtitle")}</p>
      </div>
      <label class="flex items-center gap-2 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300">
        <input type="checkbox" bind:checked={generation.animaTools.enabled} />
        {locale.t("anima_studio.enable")}
      </label>
      <button class="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white" onclick={close} aria-label={locale.t("common.close")}>✕</button>
    </header>

    <nav class="flex gap-1 overflow-x-auto border-b border-neutral-800 bg-neutral-900/50 px-3 py-2">
      {#each [
        ["groups", "anima_studio.tab.groups"],
        ["catalog", "anima_studio.tab.catalog"],
        ["danbooru", "anima_studio.tab.danbooru"],
        ["sources", "anima_sources.title"],
        ["telegram", "anima_studio.tab.telegram"],
        ["composer", "anima_studio.tab.composer"],
        ["mixer", "anima_studio.tab.mixer"],
      ] as item}
        <button class="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs {tab === item[0] ? 'bg-amber-400 text-black' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'}" onclick={() => (tab = item[0] as Tab)}>{locale.t(item[1])}</button>
      {/each}
    </nav>

    <main class="min-h-0 flex-1 overflow-y-auto p-4">
      {#if toolsAvailable === false && tab !== "composer"}<button class="mb-3 w-full rounded-lg border border-sky-700 bg-sky-950/30 p-3 text-xs text-sky-200 disabled:opacity-50" disabled={installing !== null} onclick={() => install("tools")}>{installing === "tools" ? locale.t("anima_studio.installing") : locale.t("anima_studio.install_tools")}</button>{/if}
      {#if tab === "sources"}
        <AnimaSources />
      {:else if tab === "groups"}
        <nav class="mb-3 flex flex-wrap gap-2" aria-label={locale.t('anima_studio.tab.groups')}>
          {#each ANIMA_PROMPT_GROUPS as group}
            <button type="button" aria-pressed={activeGroup === group} class="touch-target rounded border px-3 py-2 text-xs {activeGroup === group ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-neutral-700 text-neutral-400'}" onclick={() => activeGroup = group}>{groupMeta[group].label} · {parseTagList(generation.animaTools[group]).length}</button>
          {/each}
        </nav>
        <section class="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <h3 class="min-w-0 flex-1 text-sm text-neutral-200">{groupMeta[activeGroup].label}</h3>
            <select aria-label={locale.t('prompt_studio.macros')} class="touch-target rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-300" value="" onchange={event => { const macro = promptPresets.getById(event.currentTarget.value); if (macro) setGroupValue(activeGroup, [generation.animaTools[activeGroup].trim(), inlineChunkToken(macro.name)].filter(Boolean).join(', ')); event.currentTarget.value = ''; }}>
              <option value="">{locale.t('prompt_studio.macros')}</option>
              {#each promptPresets.presets as macro (macro.id)}<option value={macro.id}>{macro.name}</option>{/each}
            </select>
          </div>
          {#key activeGroup}<PromptTextarea bind:value={() => generation.animaTools[activeGroup], value => setGroupValue(activeGroup, value)} rows={5} storageKey={`anima-group-${activeGroup}`} placeholder={locale.t('anima_studio.group.placeholder')} />{/key}
        </section>
        <div class="mt-4 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
          {#each ANIMA_PROMPT_GROUPS as group}
            <button type="button" class="touch-target flex w-full min-w-0 flex-col gap-1 px-3 py-3 text-left" onclick={() => activeGroup = group}>
              <span class="text-xs text-indigo-300">{groupMeta[group].label}</span>
              <span class="line-clamp-2 break-words text-xs text-neutral-500">{generation.animaTools[group] || '—'}</span>
            </button>
          {/each}
        </div>
      {:else if tab === "catalog"}
        <div class="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input bind:value={localQuery} class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-amber-500 focus:outline-none" placeholder={locale.t("anima_studio.catalog.search")} />
          <select bind:value={activeGroup} class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-200">
            {#each ANIMA_PROMPT_GROUPS as group}<option value={group}>{groupMeta[group].label}</option>{/each}
          </select>
        </div>
        {#if localQuery.trim()}
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {#each localResults as entry (entry.n)}
              <button class="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2 text-left hover:border-amber-500/60 hover:bg-neutral-800" onclick={() => addTag(entry.n.replace(/_/g, " "))}>
                <span class="min-w-0 flex-1 truncate font-mono text-xs text-neutral-200">{entry.n}</span>
                <span class="text-[10px] text-neutral-600">{entry.b ? "<50" : entry.p.toLocaleString()}</span>
                <span class="text-amber-400">＋</span>
              </button>
            {/each}
          </div>
        {:else}
          <div class="rounded-xl border border-dashed border-neutral-800 p-10 text-center text-sm text-neutral-500">{locale.t("anima_studio.catalog.hint")}</div>
        {/if}
      {:else if tab === "danbooru"}
        <div class="mb-3 flex flex-wrap gap-2">
          <input bind:value={danbooruQuery} onkeydown={(event) => { if (event.key === "Enter") void runDanbooruSearch(1); }} class="min-w-60 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-amber-500 focus:outline-none" placeholder={locale.t("anima_studio.danbooru.search")} />
          <label class="flex items-center gap-2 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300"><input type="checkbox" bind:checked={danbooruSafe} />{locale.t("anima_studio.danbooru.safe")}</label>
          <button class="rounded-lg bg-amber-400 px-4 py-2 text-xs font-medium text-black disabled:opacity-50" disabled={danbooruLoading} onclick={() => runDanbooruSearch(1)}>{danbooruLoading ? "…" : locale.t("anima_studio.search")}</button>
        </div>
        {#if danbooruError}<p class="mb-3 rounded-lg border border-red-800 bg-red-950/30 p-3 text-xs text-red-300">{danbooruError}</p>{/if}
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {#each danbooruPosts as post (post.id)}
            <button class="group overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-left hover:border-amber-500" onclick={() => importPost(post)} title={locale.t("anima_studio.danbooru.import")}>
              {#if post.preview_file_url}<img src={post.preview_file_url} alt="Danbooru #{post.id}" class="aspect-square w-full object-cover" loading="lazy" referrerpolicy="no-referrer" />{:else}<div class="aspect-square bg-neutral-800"></div>{/if}
              <div class="flex items-center justify-between px-2 py-1 text-[10px] text-neutral-500"><span>#{post.id}</span><span>{post.rating ?? "?"}</span></div>
            </button>
          {/each}
        </div>
        {#if danbooruPosts.length}
          <div class="mt-4 flex justify-center gap-2">
            <button class="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 disabled:opacity-30" disabled={danbooruPage <= 1 || danbooruLoading} onclick={() => runDanbooruSearch(danbooruPage - 1)}>←</button>
            <span class="px-2 py-1 text-xs text-neutral-500">{danbooruPage}</span>
            <button class="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 disabled:opacity-30" disabled={danbooruLoading} onclick={() => runDanbooruSearch(danbooruPage + 1)}>→</button>
          </div>
        {/if}
      {:else if tab === "telegram"}
        <div class="mb-4 rounded-xl border border-sky-900/60 bg-sky-950/20 p-4">
          <h3 class="mb-1 text-sm font-medium text-sky-200">{locale.t("anima_studio.telegram.title")}</h3>
          <p class="mb-3 text-xs leading-relaxed text-neutral-400">{locale.t("anima_studio.telegram.desc")}</p>
          <label class="inline-flex cursor-pointer rounded-lg bg-sky-500 px-4 py-2 text-xs font-medium text-black hover:bg-sky-400">
            {locale.t("anima_studio.telegram.choose")}
            <input type="file" accept=".json,.html,.htm,application/json,text/html" class="hidden" onchange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importTelegramFile(file); }} />
          </label>
        </div>
        {#if telegramError}<p class="mb-3 text-xs text-red-300">{telegramError}</p>{/if}
        <div class="space-y-2">
          {#each telegramRecipes as recipe (recipe.id)}
            <article class="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
              <div class="mb-2 flex items-center justify-between gap-2"><strong class="truncate text-xs text-neutral-200">{recipe.chat}</strong><span class="text-[10px] text-neutral-600">{recipe.date}</span></div>
              <p class="line-clamp-3 font-mono text-[11px] leading-relaxed text-neutral-400">{recipe.positive}</p>
              {#if recipe.negative}<p class="mt-1 line-clamp-2 font-mono text-[10px] text-red-400/70">− {recipe.negative}</p>{/if}
              <div class="mt-3 flex flex-wrap gap-1.5">
                <button class="rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 hover:border-amber-500" onclick={() => applyTelegram(recipe, "groups")}>{locale.t("anima_studio.telegram.to_groups")}</button>
                <button class="rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 hover:border-amber-500" onclick={() => applyTelegram(recipe, "append")}>{locale.t("prompt_assistant.append")}</button>
                <button class="rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 hover:border-amber-500" onclick={() => applyTelegram(recipe, "replace")}>{locale.t("prompt_assistant.replace")}</button>
              </div>
            </article>
          {/each}
        </div>
      {:else if tab === "composer"}
        <div class="mx-auto max-w-3xl space-y-4">
          <div class="flex items-start justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div><h3 class="text-sm font-medium text-neutral-100">{locale.t("anima_studio.composer.title")}</h3><p class="mt-1 text-xs text-neutral-500">{locale.t("anima_studio.composer.desc")}</p></div>
            <input type="checkbox" bind:checked={generation.animaTools.composer_enabled} />
          </div>
          <div class="grid gap-2 sm:grid-cols-5">
            {#each [["enable_artist", "artist"], ["enable_character", "character"], ["enable_clothing", "clothing"], ["enable_background", "background"], ["enable_pose", "pose"]] as item}
              <label class="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-xs text-neutral-300"><input type="checkbox" bind:checked={generation.animaTools[item[0] as "enable_artist"]} />{locale.t(`anima_studio.group.${item[1]}`)}</label>
            {/each}
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.composer.seed")}<input type="number" min="-1" max="2147483647" bind:value={generation.animaTools.seed} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200" /></label>
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.composer.artists")}<input type="number" min="0" max="20" bind:value={generation.animaTools.artist_count} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200" /></label>
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.composer.character_detail")}<select bind:value={generation.animaTools.character_detail} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="trigger">trigger</option><option value="trigger_tags">trigger + tags</option><option value="trigger_random_tags">trigger + random tags</option></select></label>
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.composer.clothing_source")}<select bind:value={generation.animaTools.clothing_source} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="author">author</option><option value="danbooru">danbooru</option><option value="character_tags">character tags</option><option value="random">random</option></select></label>
          </div>
          <label class="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-sm text-neutral-200"><span>{locale.t("anima_studio.multi_lora")}</span><input type="checkbox" bind:checked={generation.animaTools.multi_lora_enabled} /></label>
          {#if toolsAvailable === false}<button class="w-full rounded-lg border border-sky-700 bg-sky-950/30 p-3 text-xs text-sky-200 disabled:opacity-50" disabled={installing !== null} onclick={() => install("tools")}>{installing === "tools" ? locale.t("anima_studio.installing") : locale.t("anima_studio.install_tools")}</button>{/if}
        </div>
      {:else if tab === "mixer"}
        <div class="mx-auto max-w-4xl space-y-4">
          <div class="flex items-start justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div><h3 class="text-sm font-medium text-neutral-100">Anima Artist Mixer</h3><p class="mt-1 text-xs text-neutral-500">{locale.t("anima_studio.mixer.desc", { count: activeArtistCount })}</p></div>
            <input type="checkbox" bind:checked={generation.animaArtistMixer.enabled} disabled={activeArtistCount === 0} />
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.method")}<select bind:value={generation.animaArtistMixer.method} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="adapter">Adapter Mixer</option><option value="cross_attention">Cross Attention</option></select></label>
            <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.strength")} <span class="float-right font-mono text-amber-300">{generation.animaArtistMixer.strength.toFixed(2)}</span><input type="range" min="0" max="4" step="0.05" bind:value={generation.animaArtistMixer.strength} class="mt-2 w-full" /></label>
            {#if generation.animaArtistMixer.method === "adapter"}
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.alignment")}<select bind:value={generation.animaArtistMixer.alignment_mode} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="base_anchored">base anchored</option><option value="shared_base_ids">shared base ids</option></select></label>
              <label class="flex items-center justify-between rounded border border-neutral-800 p-3 text-xs text-neutral-300">{locale.t("anima_studio.mixer.normalize_weights")}<input type="checkbox" bind:checked={generation.animaArtistMixer.normalize_weights} /></label>
            {:else}
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.combine")}<select bind:value={generation.animaArtistMixer.combine_mode} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="concat">concat</option><option value="output_avg">output avg</option><option value="lowrank_avg">lowrank avg</option></select></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.fusion")}<select bind:value={generation.animaArtistMixer.fusion_mode} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-200"><option value="interpolate">interpolate</option><option value="concat_with_base">concat with base</option><option value="base_preserve">base preserve</option></select></label>
            {/if}
          </div>
          <button class="text-xs text-neutral-400 hover:text-neutral-100" onclick={() => (advancedMixer = !advancedMixer)}>{advancedMixer ? "▾" : "▸"} {locale.t("anima_studio.mixer.advanced")}</button>
          {#if advancedMixer}
            <div class="grid gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.start_end_percent")}<div class="mt-1 flex gap-2"><input type="number" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.start_percent} class="w-full rounded border border-neutral-700 bg-neutral-950 p-2" /><input type="number" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.end_percent} class="w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></div></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.start_end_block")}<div class="mt-1 flex gap-2"><input type="number" min="0" max="63" bind:value={generation.animaArtistMixer.start_block} class="w-full rounded border border-neutral-700 bg-neutral-950 p-2" /><input type="number" min="-1" max="63" bind:value={generation.animaArtistMixer.end_block} class="w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></div></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.style_balance")}<input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.style_balance} class="mt-3 w-full" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.structure_preserve")}<input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.structure_preserve} class="mt-3 w-full" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.delta_norm_cap")}<input type="number" min="0" max="4" step="0.1" bind:value={generation.animaArtistMixer.delta_norm_cap} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.ema_alpha")}<input type="number" min="0" max="0.95" step="0.05" bind:value={generation.animaArtistMixer.artist_ema_alpha} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.lowrank_k")}<input type="number" min="1" max="32" bind:value={generation.animaArtistMixer.lowrank_k} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.uncond_strength")}<input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.uncond_strength} class="mt-3 w-full" /></label>
              <label class="flex items-center justify-between rounded border border-neutral-800 p-3 text-xs text-neutral-300">{locale.t("anima_studio.mixer.apply_uncond")}<input type="checkbox" bind:checked={generation.animaArtistMixer.apply_to_uncond} /></label>
              <label class="flex items-center justify-between rounded border border-neutral-800 p-3 text-xs text-neutral-300">{locale.t("anima_studio.mixer.static_capture")}<input type="checkbox" bind:checked={generation.animaArtistMixer.artist_static_capture} /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.capture_k")}<input type="number" min="1" max="12" bind:value={generation.animaArtistMixer.static_capture_k} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="flex items-center justify-between rounded border border-neutral-800 p-3 text-xs text-neutral-300">{locale.t("anima_studio.mixer.anchor_enabled")}<input type="checkbox" bind:checked={generation.animaArtistMixer.artist_anchor_q} /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_seeds")}<input bind:value={generation.animaArtistMixer.anchor_seed_list} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2" placeholder="12, 42" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_seed_count")}<input type="number" min="1" max="4" bind:value={generation.animaArtistMixer.anchor_seeds_count} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_user_blend")}<input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.anchor_user_blend} class="mt-3 w-full" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_deep_layer")}<input type="number" min="-1" max="64" bind:value={generation.animaArtistMixer.anchor_deep_layer_threshold} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.stabilizer_end")}<input type="range" min="0" max="1" step="0.05" bind:value={generation.animaArtistMixer.stabilizer_end_percent} class="mt-3 w-full" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_refresh")}<select bind:value={generation.animaArtistMixer.anchor_refresh_mode} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2"><option value="once">once</option><option value="warm_cache">warm cache</option></select></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_cache_points")}<input type="number" min="2" max="12" bind:value={generation.animaArtistMixer.anchor_cache_points} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.anchor_keyframe")}<select bind:value={generation.animaArtistMixer.anchor_keyframe_mode} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2"><option value="uniform_sigma">uniform sigma</option><option value="adaptive_q">adaptive Q</option></select></label>
              <label class="text-xs text-neutral-400">{locale.t("anima_studio.mixer.layer_filter")}<input bind:value={generation.animaArtistMixer.layer_filter} class="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2" placeholder="0, 3, 5-10, -1" /></label>
            </div>
          {/if}
          {#if mixerAvailable === false}<button class="w-full rounded-lg border border-rose-700 bg-rose-950/30 p-3 text-xs text-rose-200 disabled:opacity-50" disabled={installing !== null} onclick={() => install("mixer")}>{installing === "mixer" ? locale.t("anima_studio.installing") : locale.t("anima_studio.install_mixer")}</button>{/if}
        </div>
      {/if}
    </main>

    <footer class="flex items-center justify-between border-t border-neutral-800 bg-neutral-900/70 px-4 py-2 text-[11px] text-neutral-500">
      <span>{toolsAvailable === null ? "…" : toolsAvailable ? "Anima Tools ✓" : "Anima Tools —"} · {mixerAvailable === null ? "…" : mixerAvailable ? "Artist Mixer ✓" : "Artist Mixer —"}</span>
      <button class="rounded-lg bg-amber-400 px-4 py-1.5 font-medium text-black" onclick={close}>{locale.t("common.done")}</button>
    </footer>
  </div>
</div>
