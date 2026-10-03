<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { canvas } from "../../stores/canvas.svelte.js";
  import { onDestroy } from "svelte";
  import { autocomplete } from "../../stores/autocomplete.svelte.js";
  import { loadAnimaCatalog, loadAnimaSourceImage, searchDanbooru, uploadImageBytes } from "../../utils/api.js";
  import { groupAnimaTags, parseTagList, updateTagList, type AnimaPromptGroup } from "../../utils/animaIntegration.js";
  import ReferenceCatalogSave from './ReferenceCatalogSave.svelte';

  let { onUseGeneration }: { onUseGeneration?: () => void } = $props();

  type Entry = { id: string; name: string; tags: string; preview?: string; image?: string; group: AnimaPromptGroup; groups?: Partial<Record<AnimaPromptGroup, string>> };
  const catalogs: Record<string, AnimaPromptGroup> = { artists: "artist_tags", characters: "character_tags", clothing: "clothing_tags", backgrounds: "background_tags", poses: "pose_tags", character_details: "character_tags", attire: "clothing_tags" };
  let source = $state("danbooru");
  let query = $state("");
  let entries = $state<Entry[]>([]);
  let selected = $state<Entry | null>(null);
  let page = $state(1);
  let busy = $state(false);
  let error = $state("");
  let imported = $state(false);
  let generalOnly = $state(true);
  let requestId = 0;
  onDestroy(() => { requestId++; });
  const cache = new Map<string, Entry[]>();
  const online = $derived(source === "danbooru" || source === "safebooru");
  const filtered = $derived(online ? entries : entries.filter(e => `${e.name} ${e.tags}`.toLowerCase().includes(query.toLowerCase())));
  const visible = $derived(online ? filtered : filtered.slice((page - 1) * 48, page * 48));

  function normalize(raw: unknown, catalog: string): Entry[] {
    const group = catalogs[catalog];
    const rows: Array<[string, any]> = Array.isArray(raw) ? raw.map((r, i) => [String(i), r]) : Object.entries(raw as Record<string, unknown>);
    return rows.flatMap(([key, row]) => {
      if (Array.isArray(row)) return row.filter(x => typeof x === "string").map((tag, i) => ({ id: `${key}:${i}`, name: `${key}: ${tag}`, tags: tag, group }));
      if (!row || typeof row !== "object") return [];
      const name = String(row.name ?? row.trigger ?? key);
      const tags = Array.isArray(row.tags) ? [row.trigger, ...row.tags].filter(Boolean).join(", ") : String(row.tags ?? row.name ?? "");
      const preview = typeof row.preview === "string" && row.preview.startsWith("https://") ? row.preview : undefined;
      return [{ id: key, name, tags, preview, image: preview, group }];
    });
  }

  async function search(nextPage = 1) {
    const id = ++requestId;
    const requestedSource = source;
    busy = true; error = ""; selected = null;
    try {
      let result: Entry[];
      if (requestedSource === "danbooru" || requestedSource === "safebooru") {
        const posts = await searchDanbooru(query, nextPage, 40, generalOnly, requestedSource);
        result = posts.map(post => {
          const divided = groupAnimaTags((post.tag_string_general ?? '').split(/\s+/), autocomplete.tags);
          const groups: Partial<Record<AnimaPromptGroup, string>> = Object.fromEntries(Object.entries(divided).map(([key, tags]) => [key, tags.join(', ')]));
          groups.artist_tags = (post.tag_string_artist ?? '').split(/\s+/).filter(Boolean).join(', ');
          groups.character_tags = [groups.character_tags, (post.tag_string_character ?? '').split(/\s+/).filter(Boolean).join(', ')].filter(Boolean).join(', ');
          return { id: String(post.id), name: `#${post.id}`, tags: (post.tag_string ?? "").split(/\s+/).join(", "), preview: post.preview_file_url ?? undefined, image: post.large_file_url ?? post.file_url ?? undefined, group: "character_tags", groups };
        });
      } else {
        if (!cache.has(requestedSource)) cache.set(requestedSource, normalize(await loadAnimaCatalog(requestedSource), requestedSource));
        result = cache.get(requestedSource)!;
      }
      if (id !== requestId) return;
      entries = result; page = nextPage;
    } catch (e) { if (id === requestId) { entries = []; error = String(e).includes("403") ? locale.t("anima_sources.blocked") : String(e); } }
    finally { if (id === requestId) busy = false; }
  }

  function useTags(entry: Entry, groups: boolean) {
    if (groups) {
      generation.animaTools.enabled = true;
      for (const [group, tags] of Object.entries(entry.groups ?? { [entry.group]: entry.tags })) {
        const target = group as AnimaPromptGroup;
        for (const tag of parseTagList(tags)) generation.animaTools[target] = updateTagList(generation.animaTools[target], tag);
      }
    } else generation.positivePrompt = [generation.positivePrompt.trim(), entry.tags].filter(Boolean).join(", ");
    void generation.saveSettings();
    imported = true;
    onUseGeneration?.();
  }

  async function importImage(entry: Entry, raster: boolean) {
    if (!entry.image || busy) return;
    const id = ++requestId;
    busy = true; error = ""; imported = false;
    try {
      const bytes = await loadAnimaSourceImage(entry.image);
      if (id !== requestId) return;
      const blob = new Blob([new Uint8Array(bytes)]);
      const bitmap = await createImageBitmap(blob);
      if (id !== requestId) { bitmap.close(); return; }
      const pixels = document.createElement("canvas");
      pixels.width = bitmap.width; pixels.height = bitmap.height;
      try {
        const context = pixels.getContext("2d");
        if (!context) throw new Error('Image canvas unavailable');
        context.drawImage(bitmap, 0, 0);
      } finally { bitmap.close(); }
      const png = pixels.toDataURL("image/png");
      if (raster) {
        const layer = await canvas.addRasterImage(png, entry.name, "raster", () => id === requestId);
        if (!layer) return;
      }
      else {
        const pngBytes = new Uint8Array(await (await fetch(png)).arrayBuffer());
        const uploaded = await uploadImageBytes(Array.from(pngBytes), `source-${entry.id.replace(/[^\w-]/g, "_")}.png`);
        if (id !== requestId) return;
        generation.setModeInput("img2img", { input: uploaded.name, preview: png, mask: null, aspect: { w: pixels.width, h: pixels.height } });
        generation.setMode("img2img");
      }
      if (id !== requestId) return;
      imported = true;
      void generation.saveSettings();
      onUseGeneration?.();
    } catch (e) { if (id === requestId) error = String(e); }
    finally { if (id === requestId) busy = false; }
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap gap-2">
    <select aria-label={locale.t("anima_sources.title")} disabled={busy} class="touch-target max-w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-xs text-neutral-200" bind:value={source} onchange={() => { query = ""; entries = []; imported = false; void search(); }}>
      <option value="danbooru">Danbooru API</option><option value="safebooru">Safebooru (Danbooru API)</option>
      {#each Object.keys(catalogs) as key}<option value={key}>{locale.t(`anima_sources.${key}`)}</option>{/each}
    </select>
    <input aria-label={locale.t("anima_studio.search")} disabled={busy} class="touch-target min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-xs text-neutral-200" bind:value={query} oninput={() => { if (!online) page = 1; }} onkeydown={e => { if (e.key === "Enter" && !busy) void search(); }} placeholder={locale.t("anima_studio.search")} />
    <button type="button" class="touch-target rounded-lg bg-indigo-600 px-4 py-2 text-xs text-white disabled:opacity-50" disabled={busy} onclick={() => search()}>{busy ? locale.t("prompt_studio.loading") : locale.t("anima_studio.search")}</button>
    {#if online}<label class="flex items-center gap-2 text-xs text-neutral-300"><input type="checkbox" disabled={busy} bind:checked={generalOnly} onchange={() => { entries = []; selected = null; imported = false; void search(); }} />{locale.t("anima_studio.danbooru.safe")}</label>{/if}
  </div>
  <p class="text-xs text-neutral-500">{locale.t("anima_sources.description")}</p>
  {#if error}<p role="alert" class="break-words text-xs text-amber-300">{error}</p>{/if}
  {#if imported}<p role="status" class="text-xs text-neutral-300">{locale.t("anima_sources.imported")}</p>{/if}
  {#if selected}
    <section class="grid gap-3 rounded-xl border border-neutral-700 bg-neutral-900 p-3 md:grid-cols-2">
      {#if selected.image}<img src={selected.image} alt={selected.name} class="max-h-[55vh] w-full object-contain" referrerpolicy="no-referrer" />{/if}
      <div class="space-y-3"><h3 class="text-neutral-200">{selected.name}</h3><p class="max-h-52 overflow-auto font-mono text-xs text-neutral-400">{selected.tags}</p>
        <div class="flex flex-wrap gap-2">
          {#if !online}<button type="button" disabled={busy} class="touch-target rounded border border-neutral-600 px-3 py-2 text-xs text-neutral-200" onclick={() => { query = parseTagList(selected!.tags)[0]?.replace(/\\([()])/g, "$1").replace(/ /g, "_") ?? ""; source = "danbooru"; void search(); }}>{locale.t("anima_studio.search")} · Danbooru</button>{/if}
          <button type="button" disabled={busy} class="touch-target rounded border border-neutral-600 px-3 py-2 text-xs text-neutral-200" onclick={() => useTags(selected!, false)}>{locale.t("anima_sources.prompt")}</button>
          {#if generation.isAnima}<button type="button" disabled={busy} class="touch-target rounded border border-neutral-600 px-3 py-2 text-xs text-neutral-200" onclick={() => useTags(selected!, true)}>{locale.t("anima_sources.group")}</button>{/if}
          {#if selected.image}<button class="rounded border border-neutral-600 px-3 py-2 text-xs text-neutral-200" disabled={busy} onclick={() => importImage(selected!, false)}>img2img</button><button class="rounded border border-neutral-600 px-3 py-2 text-xs text-neutral-200" disabled={busy} onclick={() => importImage(selected!, true)}>{locale.t("canvas.import_raster")}</button>{/if}
          <button type="button" disabled={busy} class="touch-target rounded border border-neutral-600 px-3 py-2 text-xs text-neutral-400" onclick={() => selected = null}>{locale.t("common.close")}</button>
        </div>
        {#key selected.id}
          <ReferenceCatalogSave name={selected.name} tags={selected.tags} preview={selected.preview ?? selected.image} />
        {/key}
      </div>
    </section>
  {/if}
  <div class="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
    {#each visible as entry (entry.id)}
      <button type="button" disabled={busy} class="touch-target overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-left hover:border-indigo-500" onclick={() => { selected = entry; imported = false; }}>
        {#if entry.preview}<img src={entry.preview} alt={entry.name} class="aspect-square w-full object-cover" loading="lazy" referrerpolicy="no-referrer" />{/if}
        <div class="p-2"><p class="truncate text-xs text-neutral-200">{entry.name}</p><p class="line-clamp-2 text-[10px] text-neutral-500">{entry.tags}</p></div>
      </button>
    {/each}
  </div>
  {#if entries.length}<div class="flex items-center justify-center gap-4 text-neutral-300"><button type="button" class="touch-target" aria-label={locale.t("common.prev")} disabled={page <= 1 || busy} onclick={() => online ? search(page - 1) : page--}>←</button><span class="text-xs">{page}</span><button type="button" class="touch-target" aria-label={locale.t("common.next")} disabled={busy || (online ? entries.length < 40 : page * 48 >= filtered.length)} onclick={() => online ? search(page + 1) : page++}>→</button></div>{/if}
</div>
