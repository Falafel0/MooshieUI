<script lang="ts">
  /**
   * Macro palette — the authoring surface for typed macros.
   *
   * Macros are grouped by `MacroType` in the fixed type order, and every group
   * and chip is tinted with that type's colour from MACRO_TYPE_META (one map,
   * no scattered literals). Colours are theme CSS variables, so light and dark
   * themes both work.
   *
   * A macro that is *active* (contributing tags to the current prompt) reads
   * very differently from one that is merely *listed*: active chips get the
   * type's tinted surface, a solid type ring and a filled marker; listed chips
   * are plain outlined rows. A *disabled* macro is dimmed and struck through —
   * it stays visible but will never be injected.
   *
   * Surfaces owned by other agents are callbacks, not imports: tag insertion
   * into the prompt, the artist gallery cross-link and the Animadex character
   * cross-link.
   */
  import { macros, MACRO_TYPE_ORDER, MACRO_TYPE_META, macroTypeStyleVars } from "../../stores/macros.svelte.js";
  import type { Macro, MacroType } from "../../stores/macros.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";

  interface Props {
    /** Insert this macro's tags into the prompt. Owned by the Arena/parent. */
    onInsertTags?: (tags: string[], type: MacroType) => void;
    /** Artist macro cross-link: open the artist gallery for this slug. */
    onOpenArtist?: (slug: string) => void;
    /** Character macro cross-link: open this Animadex character slug. */
    onOpenCharacter?: (slug: string) => void;
    /** Fired after create/rename/duplicate/delete so the parent can react. */
    onChanged?: (macro: Macro | null) => void;
  }

  let { onInsertTags, onOpenArtist, onOpenCharacter, onChanged }: Props = $props();

  /** The colour token for a type, referenced so the token name lives in one place. */
  function token(type: MacroType, key: "accent" | "surface" | "border" | "solid"): string {
    return `var(--macro-type-${type}-${key})`;
  }

  let groups = $derived(
    MACRO_TYPE_ORDER.map((type) => ({ type, items: macros.byType(type) })),
  );

  // ---- local editing state -------------------------------------------------

  let expandedId = $state<string | null>(null);
  let editingNameId = $state<string | null>(null);
  let editingName = $state("");
  let tagInput = $state<Record<string, string>>({});
  let createType = $state<MacroType>("style");
  let createName = $state("");
  let createOpen = $state(false);

  function typeLabel(type: MacroType): string {
    return locale.t(MACRO_TYPE_META[type].labelKey);
  }

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  function startRename(macro: Macro) {
    editingNameId = macro.id;
    editingName = macro.name;
  }

  function commitRename() {
    if (!editingNameId) return;
    macros.rename(editingNameId, editingName);
    const changed = macros.getById(editingNameId);
    editingNameId = null;
    if (changed) onChanged?.(changed);
  }

  function createMacro() {
    const created = macros.create(createType, createName);
    createName = "";
    createOpen = false;
    onChanged?.(created);
  }

  function insertTags(macro: Macro) {
    const tags = macro.tags.map((t) => t.tag).filter(Boolean);
    if (tags.length === 0) return;
    onInsertTags?.(tags, macro.type);
  }

  function addTag(macro: Macro) {
    const raw = (tagInput[macro.id] ?? "").trim();
    if (!raw) return;
    if (macros.addTag(macro.id, raw)) {
      tagInput = { ...tagInput, [macro.id]: "" };
      onChanged?.(macros.getById(macro.id));
    }
  }

  function slugTarget(macro: Macro): { slug: string; handler: (slug: string) => void; label: string } | null {
    const slug = macro.tags.find((t) => t.slug)?.slug;
    if (!slug) return null;
    if (macro.type === "artist" && onOpenArtist) {
      return { slug, handler: onOpenArtist, label: locale.t("monbooru.macros.open_artist", { slug }) };
    }
    if (macro.type === "character" && onOpenCharacter) {
      return { slug, handler: onOpenCharacter, label: locale.t("monbooru.macros.open_character", { slug }) };
    }
    return null;
  }
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-center justify-between gap-2">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-300">
      {locale.t("monbooru.macros.title")}
    </h3>
    <button
      type="button"
      class="rounded-lg border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 transition-colors hover:border-indigo-500 hover:text-indigo-200"
      onclick={() => (createOpen = !createOpen)}
    >
      {createOpen ? locale.t("common.cancel") : locale.t("monbooru.macros.create")}
    </button>
  </div>

  {#if createOpen}
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900/60 p-2">
      <select
        bind:value={createType}
        class="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
        aria-label={locale.t("monbooru.macros.type_label")}
      >
        {#each MACRO_TYPE_ORDER as type (type)}
          <option value={type}>{typeLabel(type)}</option>
        {/each}
      </select>
      <input
        type="text"
        bind:value={createName}
        placeholder={locale.t("monbooru.macros.new_name_placeholder")}
        class="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
        onkeydown={(e) => {
          if (e.key === "Enter") createMacro();
        }}
      />
      <button
        type="button"
        class="rounded-lg bg-indigo-600 px-3 py-1 text-xs text-[var(--theme-accent-foreground)] transition-colors hover:bg-indigo-500 disabled:opacity-40"
        disabled={!createName.trim()}
        onclick={createMacro}
      >
        {locale.t("monbooru.macros.create_confirm")}
      </button>
    </div>
  {/if}

  {#each groups as group (group.type)}
    <section
      class="rounded-lg border p-2"
      style="{macroTypeStyleVars(group.type)}; border-color: {token(group.type, 'border')}; background: {token(group.type, 'surface')};"
    >
      <header class="mb-2 flex items-center gap-2">
        <span
          class="grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] leading-none"
          style="background: {token(group.type, 'solid')}; color: var(--theme-background);"
          aria-hidden="true"
        >{MACRO_TYPE_META[group.type].glyph}</span>
        <span class="text-xs font-semibold" style="color: {token(group.type, 'accent')};">
          {typeLabel(group.type)}
        </span>
        <span class="text-[10px] text-neutral-400">
          {locale.t("monbooru.macros.enabled_count", {
            enabled: macros.enabledCount(group.type),
            total: group.items.length,
          })}
        </span>
        <div class="ml-auto flex items-center gap-1">
          <button
            type="button"
            class="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 transition-colors hover:text-neutral-100 disabled:opacity-40"
            style="border-color: {token(group.type, 'border')};"
            disabled={group.items.length === 0}
            onclick={() => macros.enableAll(group.type)}
          >
            {locale.t("monbooru.macros.enable_all")}
          </button>
          <button
            type="button"
            class="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 transition-colors hover:text-neutral-100 disabled:opacity-40"
            style="border-color: {token(group.type, 'border')};"
            disabled={group.items.length === 0}
            onclick={() => macros.disableAll(group.type)}
          >
            {locale.t("monbooru.macros.disable_all")}
          </button>
        </div>
      </header>

      {#if group.items.length === 0}
        <p class="px-1 py-1 text-[11px] text-neutral-500">{locale.t("monbooru.macros.empty_type")}</p>
      {:else}
        <ul class="flex flex-col gap-1.5">
          {#each group.items as macro (macro.id)}
            {@const active = macros.isActive(macro.id)}
            {@const target = slugTarget(macro)}
            <li
              class="rounded-lg border px-2 py-1.5"
              style={active
                ? `border-color: ${token(macro.type, 'solid')}; background: color-mix(in srgb, ${token(macro.type, 'border')} 55%, var(--theme-background)); box-shadow: inset 0 0 0 1px ${token(macro.type, 'solid')};`
                : `border-color: var(--theme-border-700); background: var(--theme-background);`}
            >
              <div class="flex items-center gap-1.5">
                {#if active}
                  <span
                    class="h-2 w-2 shrink-0 rounded-full"
                    style="background: {token(macro.type, 'solid')};"
                    title={locale.t("monbooru.macros.active")}
                    aria-hidden="true"
                  ></span>
                {/if}
                {#if editingNameId === macro.id}
                  <input
                    type="text"
                    bind:value={editingName}
                    class="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-100 focus:border-indigo-500 focus:outline-none"
                    onkeydown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") editingNameId = null;
                    }}
                    onblur={commitRename}
                  />
                {:else}
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left text-xs transition-colors {macro.enabled ? '' : 'line-through'}"
                    style={active
                      ? `color: ${token(macro.type, 'accent')};`
                      : `color: var(--theme-text); opacity: ${macro.enabled ? 0.85 : 0.5};`}
                    title={active ? locale.t("monbooru.macros.deactivate_hint") : locale.t("monbooru.macros.activate_hint")}
                    onclick={() => macros.toggleActive(macro.id)}
                  >
                    {macro.name}
                  </button>
                {/if}
                <span class="shrink-0 text-[10px] tabular-nums text-neutral-500">
                  {locale.t("monbooru.macros.tag_count", { count: macro.tags.length })}
                  {#if macro.overallWeight !== 1}
                    · ×{macro.overallWeight}
                  {/if}
                </span>
                <button
                  type="button"
                  class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors"
                  style="border-color: {token(macro.type, 'border')}; color: {active ? token(macro.type, 'accent') : 'var(--theme-text)'};"
                  title={macro.enabled ? locale.t("monbooru.macros.disable") : locale.t("monbooru.macros.enable")}
                  onclick={() => macros.toggleEnabled(macro.id)}
                >
                  {macro.enabled ? locale.t("monbooru.macros.enabled_short") : locale.t("monbooru.macros.disabled_short")}
                </button>
                <button
                  type="button"
                  class="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 transition-colors hover:text-neutral-100"
                  title={locale.t("common.duplicate")}
                  aria-label={locale.t("common.duplicate")}
                  onclick={() => onChanged?.(macros.duplicate(macro.id))}
                >
                  ⎘
                </button>
                <button
                  type="button"
                  class="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 transition-colors hover:text-neutral-100"
                  title={locale.t("common.edit")}
                  aria-label={locale.t("common.edit")}
                  onclick={() => startRename(macro)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  class="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] leading-none text-neutral-400 transition-colors hover:border-red-500/60 hover:text-red-300"
                  title={locale.t("common.delete")}
                  aria-label={locale.t("common.delete")}
                  onclick={() => {
                    macros.remove(macro.id);
                    onChanged?.(null);
                  }}
                >
                  ×
                </button>
                <button
                  type="button"
                  class="shrink-0 rounded border border-neutral-700 px-1 py-0.5 text-[10px] leading-none text-neutral-400 transition-colors hover:text-neutral-100"
                  title={locale.t("monbooru.macros.tags_toggle")}
                  aria-expanded={expandedId === macro.id}
                  onclick={() => toggleExpand(macro.id)}
                >
                  {expandedId === macro.id ? "▾" : "▸"}
                </button>
              </div>

              {#if expandedId === macro.id}
                <div class="mt-1.5 flex flex-col gap-1 border-t pt-1.5" style="border-color: {token(macro.type, 'border')};">
                  {#each macro.tags as tag, i (tag.tag + i)}
                    <div class="flex items-center gap-1.5">
                      <span class="min-w-0 flex-1 truncate font-mono text-[11px]" style="color: {token(macro.type, 'accent')};">
                        {tag.tag}
                      </span>
                      {#if tag.slug && target}
                        <button
                          type="button"
                          class="shrink-0 rounded border border-neutral-700 px-1 py-0.5 text-[10px] text-neutral-400 transition-colors hover:text-neutral-100"
                          title={target.label}
                          onclick={() => target.handler(target.slug)}
                        >
                          ↗
                        </button>
                      {/if}
                      <span class="shrink-0 text-[10px] tabular-nums text-neutral-500">
                        {locale.t("monbooru.macros.weight_label")}
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="3"
                        step="0.05"
                        value={tag.weight}
                        aria-label={locale.t("monbooru.macros.weight_label")}
                        class="w-14 shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-[10px] tabular-nums text-neutral-200 focus:border-indigo-500 focus:outline-none"
                        onchange={(e) => macros.setTagWeight(macro.id, i, Number(e.currentTarget.value))}
                      />
                      <button
                        type="button"
                        class="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] leading-none text-neutral-400 transition-colors hover:border-red-500/60 hover:text-red-300"
                        title={locale.t("common.remove")}
                        aria-label={locale.t("common.remove")}
                        onclick={() => macros.removeTag(macro.id, i)}
                      >
                        ×
                      </button>
                    </div>
                  {/each}
                  <div class="flex items-center gap-1.5">
                    <input
                      type="text"
                      bind:value={tagInput[macro.id]}
                      placeholder={locale.t("monbooru.macros.add_tag_placeholder")}
                      class="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[11px] text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
                      onkeydown={(e) => {
                        if (e.key === "Enter") addTag(macro);
                      }}
                    />
                    <button
                      type="button"
                      class="shrink-0 rounded border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-40"
                      style="border-color: {token(macro.type, 'border')}; color: {token(macro.type, 'accent')};"
                      disabled={!(tagInput[macro.id] ?? "").trim()}
                      onclick={() => addTag(macro)}
                    >
                      {locale.t("common.add")}
                    </button>
                    <button
                      type="button"
                      class="shrink-0 rounded border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-40"
                      style="border-color: {token(macro.type, 'border')}; color: {token(macro.type, 'accent')};"
                      disabled={macro.tags.length === 0}
                      onclick={() => insertTags(macro)}
                    >
                      {locale.t("monbooru.macros.insert_tags")}
                    </button>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</div>
