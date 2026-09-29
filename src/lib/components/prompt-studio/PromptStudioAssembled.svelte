<script lang="ts">
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { autocomplete } from "../../stores/autocomplete.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import { pickArtists } from "../../prompt-studio/artists.js";
  import { classifyTag } from "../../prompt-studio/sources.js";
  import { readSnapshotFile, type StudioSnapshotV1 } from "../../prompt-studio/presets.js";
  import { Ban, Copy, Dices, Download, Pin, Plus, Trash2, Upload, Wand2, X } from "@lucide/svelte";

  let { onApply, onCopy }: { onApply: () => void; onCopy: () => void } = $props();

  let presetName = $state("");
  let artistCount = $state(1);
  let artistWeight = $state(1);
  let fileInput: HTMLInputElement | undefined = $state();

  const sections = $derived(studio.sections);
  const suggestions = $derived(studio.suggestions);

  function addArtistBlock() {
    const names = pickArtists(autocomplete.tags, artistCount, studio.banned);
    if (!names.length) {
      gallery.showToast(locale.t("prompt_studio.no_artists"), "warning");
      return;
    }
    studio.addArtists(names, artistWeight);
    gallery.showToast(names.join(", "), "success");
  }

  function addSuggestion(tag: string) {
    const { category } = classifyTag(tag);
    studio.choose(tag, tag, category);
  }

  function savePreset() {
    const snapshot = studio.preset(presetName);
    if (!snapshot) return;
    gallery.showToast(`${locale.t("prompt_studio.preset_saved")}: ${snapshot.name}`, "success");
    presetName = "";
  }

  function loadPreset(snapshot: StudioSnapshotV1) {
    if (!studio.loadPreset(snapshot)) {
      gallery.showToast(locale.t("prompt_studio.import_failed"), "error");
      return;
    }
    gallery.showToast(`${locale.t("prompt_studio.preset_loaded")}: ${snapshot.name}`, "success");
  }

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const loaded = studio.importSnapshot(await readSnapshotFile(file));
      gallery.showToast(loaded ? `${locale.t("prompt_studio.preset_loaded")}: ${loaded}` : locale.t("prompt_studio.import_failed"), loaded ? "success" : "error");
    } catch (error) {
      gallery.showToast(String(error), "error");
    }
  }

  const chip = (derived: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${
      derived ? "border-neutral-800 bg-neutral-900 text-neutral-400" : "border-neutral-700 bg-neutral-800 text-neutral-100"
    }`;
</script>

<aside class="flex flex-col gap-2.5 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
  <header class="flex items-center justify-between gap-2">
    <div>
      <h3 class="text-sm font-semibold text-neutral-100">{locale.t("prompt_studio.assembled")}</h3>
      <p class="text-[10px] text-neutral-500">
        {studio.count} {locale.t("prompt_studio.tags_word")}{studio.autoCount ? ` · ${studio.autoCount} auto` : ""}
      </p>
    </div>
    <div class="flex gap-1">
      <button
        type="button"
        class="rounded-lg border px-2 py-1 text-[10px] transition-colors {studio.readable
          ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
          : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}"
        title={locale.t("prompt_studio.readable")}
        onclick={() => { studio.readable = !studio.readable; studio.save(); }}
      >
        readable
      </button>
      <button
        type="button"
        class="rounded-lg border px-2 py-1 text-[10px] transition-colors {studio.nai
          ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
          : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}"
        title={locale.t("prompt_studio.nai")}
        onclick={() => { studio.nai = !studio.nai; studio.save(); }}
      >
        NAI
      </button>
    </div>
  </header>

  <div class="flex flex-wrap gap-1.5">
    <button
      type="button"
      class="rounded-lg border px-2 py-1 text-[10px] {studio.autoTags
        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
        : 'border-neutral-800 text-neutral-400'}"
      onclick={() => { studio.autoTags = !studio.autoTags; studio.save(); }}
    >
      auto-импликации
    </button>
    <button
      type="button"
      class="rounded-lg border px-2 py-1 text-[10px] {studio.clothed
        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
        : 'border-neutral-800 text-neutral-400'}"
      onclick={() => { studio.clothed = !studio.clothed; studio.save(); }}
    >
      clothed
    </button>
  </div>

  <!-- selected tags, grouped by theme -->
  <div class="flex max-h-[300px] min-h-[80px] flex-col gap-2 overflow-y-auto pr-0.5">
    {#if !sections.length}
      <p class="py-6 text-center text-[11px] text-neutral-500">{locale.t("prompt_studio.empty")}</p>
    {/if}
    {#each sections as section (section.theme)}
      <div>
        <p class="mb-1 font-mono text-[9px] tracking-[0.16em] text-indigo-400/80 uppercase">{locale.t(section.labelKey)}</p>
        <div class="flex flex-wrap gap-1">
          {#each section.items as item (item.tag)}
            {@const derived = studio.isDerived(item.category)}
            <div class={chip(derived)}>
              <span class="max-w-[150px] truncate" title={item.tag}>{studio.readable ? item.tag.replaceAll("_", " ") : item.tag}</span>
              {#if item.weight !== 1}
                <span class="font-mono text-[9px] text-amber-300">{item.weight.toFixed(2)}</span>
              {/if}
              {#if !derived}
                <input
                  type="number"
                  class="w-9 rounded border border-neutral-700 bg-neutral-950 px-0.5 text-[9px] text-neutral-300"
                  min="0.1"
                  max="2"
                  step="0.05"
                  value={item.weight}
                  title={locale.t("prompt_studio.weight")}
                  onchange={(event) => studio.weight(item.tag, Number((event.currentTarget as HTMLInputElement).value) || 1)}
                />
              {/if}
              <button
                type="button"
                class={studio.pinned.includes(item.tag) ? "text-amber-300" : "text-neutral-500 hover:text-neutral-300"}
                title={locale.t("prompt_studio.pin")}
                onclick={() => studio.pin(item.tag)}
              >
                <Pin size={10} strokeWidth={2} />
              </button>
              {#if !derived}
                <button type="button" class="text-neutral-500 hover:text-red-400" title={locale.t("prompt_studio.ban")} onclick={() => studio.ban(item.tag)}>
                  <Ban size={10} strokeWidth={2} />
                </button>
              {/if}
              <button type="button" class="text-neutral-500 hover:text-neutral-200" title={locale.t("prompt_studio.remove")} onclick={() => studio.remove(item.tag)}>
                <X size={10} strokeWidth={2.5} />
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  {#if suggestions.length}
    <div>
      <p class="mb-1 font-mono text-[9px] tracking-[0.16em] text-fuchsia-400/80 uppercase">{locale.t("prompt_studio.suggests")}</p>
      <div class="flex flex-wrap gap-1">
        {#each suggestions.slice(0, 10) as tag (tag)}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-700 px-2 py-1 text-[10px] text-neutral-400 hover:border-fuchsia-500/60 hover:text-fuchsia-300"
            onclick={() => addSuggestion(tag)}
          >
            <Plus size={9} strokeWidth={2.5} />{tag.replaceAll("_", " ")}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- artists -->
  <div class="flex flex-wrap items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2">
    <Wand2 size={13} strokeWidth={1.8} class="text-indigo-400" />
    <span class="text-[10px] text-neutral-400">{locale.t("prompt_studio.random_artists")}</span>
    <select class="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-[10px] text-neutral-200" bind:value={artistCount}>
      <option value={1}>x1</option>
      <option value={2}>x2</option>
      <option value={3}>x3</option>
    </select>
    <select class="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-[10px] text-neutral-200" bind:value={artistWeight}>
      <option value={0.8}>0.80</option>
      <option value={1}>1.00</option>
      <option value={1.2}>1.20</option>
    </select>
    <button type="button" class="ml-auto inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-indigo-500" onclick={addArtistBlock}>
      <Dices size={11} strokeWidth={1.8} />{locale.t("prompt_studio.roll")}
    </button>
  </div>

  <!-- prefix / suffix -->
  <div class="grid gap-1.5">
    <label class="text-[10px] tracking-[0.12em] text-neutral-500 uppercase" for="ps-prefix">{locale.t("prompt_studio.before")}</label>
    <input
      id="ps-prefix"
      class="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
      placeholder="masterpiece, best quality"
      value={studio.prefix}
      oninput={(event) => { studio.prefix = (event.currentTarget as HTMLInputElement).value; studio.save(); }}
    />
    <label class="text-[10px] tracking-[0.12em] text-neutral-500 uppercase" for="ps-suffix">{locale.t("prompt_studio.after")}</label>
    <input
      id="ps-suffix"
      class="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
      placeholder="looking at viewer"
      value={studio.suffix}
      oninput={(event) => { studio.suffix = (event.currentTarget as HTMLInputElement).value; studio.save(); }}
    />
  </div>

  <!-- prompt -->
  <textarea
    class="h-24 w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950 p-2 font-mono text-[10px] leading-relaxed text-neutral-300 outline-none focus:border-indigo-500"
    readonly
    value={studio.prompt}
  ></textarea>

  <div class="flex gap-1.5">
    <button type="button" class="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500" onclick={onApply}>
      {locale.t("prompt_studio.apply")}
    </button>
    <button type="button" class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-300 hover:border-neutral-700" onclick={onCopy}>
      <Copy size={13} strokeWidth={1.8} />
    </button>
  </div>

  <!-- presets -->
  <div class="flex flex-col gap-1.5 border-t border-neutral-800 pt-2.5">
    <p class="font-mono text-[9px] tracking-[0.16em] text-indigo-400/80 uppercase">{locale.t("prompt_studio.presets")}</p>
    <div class="flex gap-1.5">
      <input
        class="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
        placeholder={locale.t("prompt_studio.preset_name")}
        bind:value={presetName}
      />
      <button type="button" class="rounded-lg border border-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:border-indigo-500" title={locale.t("prompt_studio.preset_save")} onclick={savePreset}>
        <Plus size={12} strokeWidth={2} />
      </button>
      <button type="button" class="rounded-lg border border-neutral-800 px-2 py-1 text-neutral-300 hover:border-indigo-500" title={locale.t("prompt_studio.export")} onclick={() => studio.exportPreset()}>
        <Download size={12} strokeWidth={2} />
      </button>
      <button type="button" class="rounded-lg border border-neutral-800 px-2 py-1 text-neutral-300 hover:border-indigo-500" title={locale.t("prompt_studio.import")} onclick={() => fileInput?.click()}>
        <Upload size={12} strokeWidth={2} />
      </button>
      <input
        class="hidden"
        type="file"
        accept="application/json,.json"
        bind:this={fileInput}
        onchange={importFile}
      />
    </div>
    {#each studio.presets as item (item.name)}
      <div class="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1">
        <button type="button" class="min-w-0 flex-1 truncate text-left text-[11px] text-neutral-300 hover:text-indigo-300" onclick={() => loadPreset(item.snapshot)}>
          {item.name}
        </button>
        <span class="font-mono text-[9px] text-neutral-600">{item.snapshot.selected?.length ?? 0}t</span>
        <button type="button" class="text-neutral-500 hover:text-neutral-200" title={locale.t("prompt_studio.export")} onclick={() => studio.exportPreset(item.name)}>
          <Download size={11} strokeWidth={2} />
        </button>
        <button type="button" class="text-neutral-500 hover:text-red-400" title={locale.t("prompt_studio.remove")} onclick={() => studio.deletePreset(item.name)}>
          <Trash2 size={11} strokeWidth={2} />
        </button>
      </div>
    {/each}
  </div>

  {#if studio.banned.length}
    <div class="border-t border-neutral-800 pt-2.5">
      <p class="mb-1 font-mono text-[9px] tracking-[0.16em] text-red-400/80 uppercase">{locale.t("prompt_studio.bans")}</p>
      <div class="flex flex-wrap gap-1">
        {#each studio.banned as tag (tag)}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full border border-red-900/60 bg-red-950/40 px-2 py-0.5 text-[10px] text-red-300 hover:border-red-600"
            onclick={() => studio.ban(tag)}
          >
            {tag.replaceAll("_", " ")}<X size={9} strokeWidth={2.5} />
          </button>
        {/each}
      </div>
    </div>
  {/if}
</aside>
