<script lang="ts">
  import { tick } from "svelte";
  import { savedSources, type SavedSourceEntry } from "../../prompt-studio/saved-sources.svelte.js";
  import PromptStudioTagImage from "./PromptStudioTagImage.svelte";
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
  let alphabetical = $state(false);
  let requestId = 0;
  let element: HTMLDivElement | undefined = $state();
  const views = new Map<SourceId, { query: string; group: string; alphabetical: boolean; limit: number; scroll: number }>();
  const cache = new Map<SourceId, SourceEntry[]>();

  const meta = $derived(SOURCES.find((item) => item.id === active) ?? SOURCES[0]);
  const attire = $derived(active === "attire");
  const groups = $derived([...new Set(entries.map((entry) => entry.categories[0]).filter(Boolean))] as string[]);
  const needle = $derived(query.trim().toLowerCase());
  const filtered = $derived(
    entries.filter((entry) => {
      if (group && entry.categories[0] !== group) return false;
      if (!needle) return true;
      return entry.name.toLowerCase().includes(needle) || entry.tags.some((tag) => tag.toLowerCase().includes(needle));
    }),
  );
  $effect(() => { query; group; limit = 60; });
  const sorted = $derived(alphabetical ? [...filtered].sort((a, b) => a.name.localeCompare(b.name, locale.current)) : filtered);
  const shown = $derived(sorted.slice(0, limit));

  async function open(source: SourceId) {
    views.set(active, { query, group, alphabetical, limit, scroll: element?.parentElement?.scrollTop ?? 0 });
    const view = views.get(source);
    const id = ++requestId;
    active = source;
    query = view?.query ?? ''; group = view?.group ?? ''; alphabetical = view?.alphabetical ?? false;
    limit = 60;
    const cached = cache.get(source);
    loading = !cached; error = ''; entries = cached ?? [];
    try {
      if (!cached) {
        const normalized = normalizeCatalog(source, await loadAnimaCatalog(source));
        if (!normalized.length) throw new Error(locale.t('prompt_studio.source_empty'));
        cache.set(source, normalized);
        if (id === requestId) entries = normalized;
      }
      await tick();
      if (id === requestId) {
        limit = view?.limit ?? 60;
        await tick();
        if (id === requestId && element?.parentElement) element.parentElement.scrollTop = view?.scroll ?? 0;
      }
    } catch (cause) {
      if (id === requestId) error = cause instanceof Error ? cause.message : String(cause);
    } finally { if (id === requestId) loading = false; }
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

  function bookmark(entry: SourceEntry): SavedSourceEntry { return { id: entry.id, name: entry.name, source: `anima:${active}`, tags: entry.tags, preview: entry.preview }; }
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

<div bind:this={element} class="mx-auto flex w-full max-w-6xl flex-col gap-3">
  <header class="sticky top-0 z-10 flex flex-wrap gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 p-2">
    {#each SOURCES as source (source.id)}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors {active === source.id
          ? 'border-indigo-500 bg-indigo-500/10 text-neutral-100'
          : 'border-transparent text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
        aria-pressed={active === source.id}
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
      aria-label={locale.t("prompt_studio.reload")}
      disabled={loading}
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
        aria-label={locale.t("prompt_studio.search")}
        placeholder={locale.t("prompt_studio.search")}
        bind:value={query}
      />
    </label>
    <select
      class="max-w-[240px] rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-[11px] text-neutral-200"
      aria-label={locale.t("prompt_studio.all_groups")}
      bind:value={group}
      disabled={!groups.length}
    >
      <option value="">{locale.t("prompt_studio.all_groups")} ({groups.length})</option>
      {#each groups as item (item)}
        <option value={item}>{groupName(item)}</option>
      {/each}
    </select>
    <button type="button" aria-pressed={alphabetical} class="touch-target rounded border border-neutral-700 px-2 py-1.5 text-xs text-neutral-300" onclick={() => alphabetical = !alphabetical}>A → Z</button>
    <span role="status" class="font-mono text-[10px] text-neutral-500">{filtered.length}</span>
  </div>

  <button type="button" disabled={!shown.length} class="touch-target self-start rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" onclick={() => savedSources.add(filtered.map(bookmark))}>{locale.t('prompt_studio.save_catalogue')} ({filtered.length})</button>
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
      <p class="break-words text-[11px]">{error}</p>
      <button
        type="button"
        class="self-start rounded-lg border border-red-800/60 px-2.5 py-1 hover:bg-red-900/30"
        onclick={() => void open(active)}
      >
        {locale.t("prompt_studio.retry")}
      </button>
    </div>
  {:else if !filtered.length}
    <p role="status" class="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-400">{locale.t("prompt_studio.nothing_found")}</p>
  {:else}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {#each shown as entry (entry.id)}
        {@const taken = entry.tags.every(tag => studio.isChosen(tag))}
        <article class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
          <PromptStudioTagImage tag={entry.tags[0]} src={entry.preview} />
          <div class="flex flex-1 flex-col gap-2 p-3">
            <h4 class="break-words text-sm font-medium text-neutral-200">{entry.name.replaceAll('_', ' ')}</h4>
            <p class="text-[10px] text-indigo-300">{groupName(entry.categories[0] ?? '')}</p>
            <p class="line-clamp-3 text-xs leading-relaxed text-neutral-500" title={entry.tags.join(', ')}>{entry.tags.join(', ')}</p>
            <button type="button" disabled={taken} class="touch-target mt-auto rounded border border-neutral-700 px-2 py-2 text-xs text-neutral-200 disabled:border-indigo-500/50 disabled:text-indigo-300" onclick={() => add(entry)}>{taken ? locale.t('prompt_studio.added') : locale.t('prompt_studio.add_recipe', { count: entry.tags.length })}</button>
            <button type="button" aria-pressed={savedSources.has(entry.id, `anima:${active}`)} class="touch-target rounded px-2 py-1 text-xs text-neutral-400" onclick={() => savedSources.has(entry.id, `anima:${active}`) ? savedSources.remove(entry.id, `anima:${active}`) : savedSources.add([bookmark(entry)])}>{locale.t(savedSources.has(entry.id, `anima:${active}`) ? 'prompt_studio.bookmarked' : 'prompt_studio.bookmark')}</button>
          </div>
        </article>
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
