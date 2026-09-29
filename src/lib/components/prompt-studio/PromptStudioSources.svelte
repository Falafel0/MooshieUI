<script lang="ts">
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import { loadAnimaCatalog } from "../../utils/api.js";
  import {
    ATTIRE_SLOTS,
    SOURCES,
    groupLabel,
    normalizeCatalog,
    type SourceEntry,
    type SourceId,
  } from "../../prompt-studio/sources.js";
  import { Check, Loader2, RefreshCw, Search } from "@lucide/svelte";

  let active = $state<SourceId>("clothing");
  let entries = $state<SourceEntry[]>([]);
  let loading = $state(false);
  let error = $state("");
  let query = $state("");
  let group = $state("");
  let limit = $state(60);
  const cache = new Map<SourceId, SourceEntry[]>();

  const meta = $derived(SOURCES.find((item) => item.id === active) ?? SOURCES[0]);
  const attire = $derived(active === "attire");
  const groups = $derived([...new Set(entries.map((entry) => entry.categories[0]).filter(Boolean))] as string[]);
  const needle = $derived(query.trim().toLowerCase());
  const filtered = $derived(
    entries.filter((entry) => {
      if (group && entry.categories[0] !== group) return false;
      if (!needle) return true;
      return entry.name.toLowerCase().includes(needle) || entry.tags.some((tag) => tag.includes(needle));
    }),
  );
  const shown = $derived(filtered.slice(0, limit));

  async function open(source: SourceId) {
    active = source;
    query = "";
    group = "";
    limit = 60;
    const cached = cache.get(source);
    if (cached) {
      entries = cached;
      error = "";
      return;
    }
    loading = true;
    error = "";
    entries = [];
    try {
      const normalized = normalizeCatalog(source, await loadAnimaCatalog(source));
      if (!normalized.length) throw new Error(locale.t("prompt_studio.source_empty"));
      cache.set(source, normalized);
      entries = normalized;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  /** The theme — and for Danbooru attire, the exact catalogue slot — a pick lands in. */
  function target(entry: SourceEntry): { theme: string; sub?: string } {
    if (!attire) return { theme: meta.theme };
    const slot = ATTIRE_SLOTS.find((item) => item.slot === entry.categories[0]);
    return { theme: "wardrobe", sub: slot?.sub };
  }

  function add(entry: SourceEntry) {
    const { theme, sub } = target(entry);
    const category = sub ?? `source:${theme}`;
    studio.addMany(entry.tags.map((tag) => ({ tag, name: tag, category })));
    gallery.showToast(`${entry.name}: ${entry.tags.slice(0, 3).join(", ")}`, "success");
  }

  function groupName(value: string): string {
    const key = `prompt_studio.${value}`;
    const translated = locale.t(key);
    return translated === key ? groupLabel(value) : translated;
  }

  function subName(subId: string): string {
    for (const category of studio.categories) {
      const found = category.subs.find((item) => item.id === subId);
      if (found) return found.name;
    }
    return subId;
  }

  // The catalogue for the current source is fetched on first view.
  $effect(() => { if (!entries.length && !loading && !error) void open(active); });
</script>

<div class="mx-auto flex w-full max-w-6xl flex-col gap-3">
  <header class="flex flex-wrap gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 p-2">
    {#each SOURCES as source (source.id)}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors {active === source.id
          ? 'border-indigo-500 bg-indigo-500/10 text-neutral-100'
          : 'border-transparent text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
        onclick={() => void open(source.id)}
      >
        {locale.t(source.labelKey)}
        {#if source.multi}<span class="font-mono text-[9px] text-neutral-500">recipe</span>{/if}
      </button>
    {/each}
    <button
      type="button"
      class="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 px-2 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-200"
      title={locale.t("prompt_studio.reload")}
      onclick={() => { cache.delete(active); entries = []; void open(active); }}
    >
      <RefreshCw size={12} strokeWidth={1.8} />
    </button>
  </header>

  <div class="flex flex-wrap items-center gap-2">
    <label class="relative flex min-w-[220px] flex-1 items-center">
      <Search size={13} strokeWidth={1.8} class="absolute left-2.5 text-neutral-500" />
      <input
        class="w-full rounded-lg border border-neutral-800 bg-neutral-950 py-1.5 pr-2 pl-8 text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
        placeholder={locale.t("prompt_studio.search")}
        bind:value={query}
      />
    </label>
    <select
      class="max-w-[240px] rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-[11px] text-neutral-200"
      bind:value={group}
      disabled={!groups.length}
    >
      <option value="">{locale.t("prompt_studio.all_groups")} ({groups.length})</option>
      {#each groups as item (item)}
        <option value={item}>{groupName(item)}</option>
      {/each}
    </select>
    <span class="font-mono text-[10px] text-neutral-500">{filtered.length}</span>
  </div>

  <p class="text-[10px] leading-relaxed text-neutral-500">
    {locale.t("prompt_studio.source_theme")}: <span class="text-indigo-300">{locale.t(`prompt_studio.theme_${meta.theme}`)}</span>
    {#if attire}· {locale.t("prompt_studio.slot_theme")}{/if}
  </p>

  {#if loading}
    <div class="flex items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 py-10 text-xs text-neutral-400">
      <Loader2 size={15} strokeWidth={2} class="animate-spin" />{locale.t("prompt_studio.loading")}
    </div>
  {:else if error}
    <div class="flex flex-col gap-2 rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-xs text-red-300">
      <p class="font-semibold text-red-200">{locale.t("prompt_studio.source_error")}</p>
      <p class="font-mono text-[10px] break-all">{error}</p>
      <button
        type="button"
        class="self-start rounded-lg border border-red-800/60 px-2.5 py-1 hover:bg-red-900/30"
        onclick={() => void open(active)}
      >
        {locale.t("prompt_studio.retry")}
      </button>
    </div>
  {:else if attire}
    <div class="flex flex-wrap gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 p-2.5">
      {#each shown as entry (entry.id)}
        {@const slot = ATTIRE_SLOTS.find((item) => item.slot === entry.categories[0])}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors {studio.isChosen(entry.tags[0])
            ? 'border-indigo-500 bg-indigo-500/15 text-neutral-100'
            : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-indigo-500/60'}"
          title={slot?.sub ? `${groupName(entry.categories[0])} → ${subName(slot.sub)}` : groupName(entry.categories[0])}
          onclick={() => add(entry)}
        >
          {entry.name.replaceAll("_", " ")}
          {#if studio.isChosen(entry.tags[0])}<Check size={10} strokeWidth={2.5} class="text-indigo-400" />{/if}
        </button>
      {/each}
    </div>
  {:else}
    <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {#each shown as entry (entry.id)}
        {@const taken = entry.tags.every((tag) => studio.isChosen(tag))}
        <div class="flex gap-2.5 rounded-xl border border-neutral-800 bg-neutral-900 p-2.5">
          {#if entry.preview}
            <img
              src={entry.preview}
              alt={entry.name}
              loading="lazy"
              class="h-16 w-16 shrink-0 rounded-lg border border-neutral-800 object-cover"
            />
          {/if}
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="flex items-start gap-1.5">
              <span class="min-w-0 flex-1 truncate text-xs font-medium text-neutral-100" title={entry.name}>{entry.name}</span>
              <span class="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[9px] text-neutral-400">
                {groupName(entry.categories[0] ?? "")}
              </span>
            </div>
            <p class="line-clamp-2 text-[10px] leading-relaxed text-neutral-400">
              {entry.tags.slice(0, 6).join(", ")}{entry.tags.length > 6 ? " …" : ""}
            </p>
            {#if entry.traits.length}
              <p class="flex flex-wrap gap-1">
                {#each entry.traits.slice(0, 3) as trait (trait)}
                  <span class="rounded border border-neutral-800 px-1 py-0.5 text-[9px] text-neutral-500">{trait}</span>
                {/each}
              </p>
            {/if}
            <button
              type="button"
              class="mt-auto self-start rounded-lg border px-2 py-0.5 text-[10px] transition-colors {taken
                ? 'border-indigo-500/60 text-indigo-300'
                : 'border-neutral-700 text-neutral-300 hover:border-indigo-500 hover:text-indigo-300'}"
              onclick={() => add(entry)}
            >
              {taken ? locale.t("prompt_studio.added") : `+ ${entry.tags.length}`}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if !loading && !error && filtered.length > shown.length}
    <button
      type="button"
      class="self-center rounded-lg border border-neutral-800 px-3 py-1.5 text-[11px] text-neutral-300 hover:border-indigo-500"
      onclick={() => (limit += 120)}
    >
      {locale.t("prompt_studio.show_more")} ({filtered.length - shown.length})
    </button>
  {/if}
</div>
