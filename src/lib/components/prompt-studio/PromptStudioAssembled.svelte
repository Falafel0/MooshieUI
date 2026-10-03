<script lang="ts">
  import { promptPresets } from "../../stores/promptPresets.svelte.js";
  import { studio } from "../../prompt-studio/studio.svelte.js";
  import { autocomplete } from "../../stores/autocomplete.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import { pickArtists } from "../../prompt-studio/artists.js";
  import { classifyTag } from "../../prompt-studio/sources.js";
  import { readSnapshotFile, type StudioSnapshotV1 } from "../../prompt-studio/presets.js";
  import { Dices, Download, Plus, Trash2, Upload, Wand2, X } from "@lucide/svelte";


  let pendingAction = $state<{ label: string; run: () => void } | null>(null);
  let importing = $state(false);
  let editingTag = $state("");
  function confirm(label: string, run: () => void) { pendingAction = { label, run }; }
  function finishAction() { const action = pendingAction; pendingAction = null; action?.run(); }
  function saveGenerationPreset() {
    const name = presetName.trim();
    if (!name || !studio.prompt.trim()) return;
    const existing = promptPresets.presets.find((item) => item.name === name);
    const run = () => {
      if (existing) promptPresets.update(existing.id, { content: studio.prompt });
      else promptPresets.create(name, studio.prompt);
      gallery.showToast(`${locale.t("prompt_studio.preset_saved")}: ${name}`, "success");
    };
    if (existing) confirm(locale.t("prompt_studio.overwrite_preset", { name }), run); else run();
  }
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
    const name = presetName.trim();
    if (!name) return;
    const run = () => {
      const snapshot = studio.preset(name);
      if (!snapshot || studio.storageError) return;
      gallery.showToast(`${locale.t("prompt_studio.preset_saved")}: ${snapshot.name}`, "success");
      presetName = "";
    };
    if (studio.presets.some((item) => item.name === name)) confirm(locale.t("prompt_studio.overwrite_preset", { name }), run);
    else run();
  }

  function requestLoad(snapshot: StudioSnapshotV1) {
    if (studio.prompt.trim()) confirm(locale.t("prompt_studio.replace_draft_confirm"), () => loadPreset(snapshot));
    else loadPreset(snapshot);
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
    importing = true;
    try {
      const raw = await readSnapshotFile(file);
      const run = () => {
        const loaded = studio.importSnapshot(raw);
        gallery.showToast(loaded ? `${locale.t("prompt_studio.preset_loaded")}: ${loaded}` : locale.t("prompt_studio.import_failed"), loaded ? "success" : "error");
      };
      if (studio.prompt.trim()) confirm(locale.t("prompt_studio.replace_draft_confirm"), run); else run();
    } catch (error) { gallery.showToast(String(error), "error"); }
    finally { importing = false; }
  }

</script>

<aside class="flex min-w-0 flex-col gap-2.5 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
  <header class="flex items-center justify-between gap-2">
    <div>
      <h3 class="text-sm font-semibold text-neutral-100">{locale.t("prompt_studio.assembled")}</h3>
      <p class="text-[10px] text-neutral-500">
        {studio.count} {locale.t("prompt_studio.tags_word")}{studio.autoCount ? ` · ${studio.autoCount} auto` : ""}
      </p>
    </div>
  </header>
  <details class="rounded-lg border border-neutral-800 p-3 text-xs text-neutral-400">
    <summary class="cursor-pointer">{locale.t('prompt_studio.output_options')}</summary>
    <div class="mt-3 flex flex-col gap-3">
      {#each ['readable', 'nai', 'autoTags', 'clothed'] as option}
        <label class="flex items-center justify-between gap-2">{locale.t(`prompt_studio.${option === 'autoTags' ? 'auto' : option}`)}
          <input type="checkbox" checked={studio[option as 'readable' | 'nai' | 'autoTags' | 'clothed']} onchange={event => { studio.setOption(option as 'readable' | 'nai' | 'autoTags' | 'clothed', event.currentTarget.checked); }} />
        </label>
      {/each}
    </div>
  </details>

  <!-- selected tags, grouped by theme -->
  <div class="flex max-h-[300px] min-h-[80px] flex-col gap-2 overflow-y-auto pr-0.5">
    {#if !sections.length}
      <p class="py-6 text-center text-[11px] text-neutral-500">{locale.t("prompt_studio.empty")}</p>
    {/if}
    {#each sections as section (section.theme)}
      <div>
        <p class="mb-1 font-mono text-[9px] tracking-[0.16em] text-indigo-400/80 uppercase">{locale.t(section.labelKey)}</p>
        <div class="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
          {#each section.items as item (item.tag)}
            {@const derived = studio.isDerived(item.category)}
            <div class="group px-2 py-1.5">
              <div class="flex min-w-0 items-center gap-2">
                {#if derived}
                  <span class="min-w-0 flex-1 break-words text-xs text-neutral-500">{item.tag.replaceAll('_', ' ')}</span>
                {:else}
                  <button type="button" class="touch-target min-w-0 flex-1 break-words text-left text-xs text-neutral-200" aria-expanded={editingTag === item.tag} onclick={() => editingTag = editingTag === item.tag ? '' : item.tag}>{studio.readable ? item.tag.replaceAll('_', ' ') : item.tag}{studio.pinned.includes(item.tag) ? ' · ◆' : ''}</button>
                  {#if item.weight !== 1}<span class="shrink-0 text-[10px] text-indigo-300">×{item.weight.toFixed(2)}</span>{/if}
                  <button type="button" class="touch-target shrink-0 rounded p-2 text-neutral-500 hover:text-neutral-200" aria-label={`${locale.t('prompt_studio.remove')}: ${item.name}`} onclick={() => studio.remove(item.tag)}><X size={14} /></button>
                {/if}
              </div>
              {#if !derived && editingTag === item.tag}
                <div class="flex flex-wrap items-center gap-2 rounded bg-neutral-950 p-2 text-xs">
                  <label class="flex items-center gap-2 text-neutral-400">{locale.t('prompt_studio.weight')}<input type="number" min="0.1" max="2" step="0.05" value={item.weight} class="w-16 rounded border border-neutral-700 p-2" onchange={event => studio.weight(item.tag, Number(event.currentTarget.value) || 1)} /></label>
                  <button type="button" class="touch-target rounded border border-neutral-700 p-2 text-neutral-400" aria-pressed={studio.pinned.includes(item.tag)} onclick={() => studio.pin(item.tag)}>{locale.t('prompt_studio.pin')}</button>
                  <button type="button" class="touch-target rounded border border-neutral-700 p-2 text-neutral-400" onclick={() => studio.ban(item.tag)}>{locale.t('prompt_studio.ban')}</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  {#if suggestions.length}
    <div>
      <p class="mb-1 font-mono text-[9px] tracking-[0.16em] text-indigo-400/80 uppercase">{locale.t("prompt_studio.suggests")}</p>
      <div class="flex flex-wrap gap-1">
        {#each suggestions.slice(0, 10) as tag (tag)}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-700 px-2 py-1 text-[10px] text-neutral-400 hover:border-indigo-500/60 hover:text-indigo-300"
            onclick={() => addSuggestion(tag)}
          >
            <Plus size={9} strokeWidth={2.5} />{tag.replaceAll("_", " ")}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <details class="rounded-lg border border-neutral-800 p-3">
    <summary class="cursor-pointer text-xs text-neutral-400">{locale.t('prompt_studio.prompt_helpers')}</summary>
    <div class="mt-3 flex flex-col gap-3">
  <!-- artists -->
  <div class="flex flex-wrap items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2">
    <Wand2 size={13} strokeWidth={1.8} class="text-indigo-400" />
    <span class="text-[10px] text-neutral-400">{locale.t("prompt_studio.random_artists")}</span>
    <select aria-label={locale.t("prompt_studio.random_artists")} class="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-[10px] text-neutral-200" bind:value={artistCount}>
      <option value={1}>x1</option>
      <option value={2}>x2</option>
      <option value={3}>x3</option>
    </select>
    <select aria-label={locale.t("prompt_studio.weight")} class="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-[10px] text-neutral-200" bind:value={artistWeight}>
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
      oninput={(event) => { studio.editText('prefix', (event.currentTarget as HTMLInputElement).value); }}
    />
    <label class="text-[10px] tracking-[0.12em] text-neutral-500 uppercase" for="ps-suffix">{locale.t("prompt_studio.after")}</label>
    <input
      id="ps-suffix"
      class="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
      placeholder="looking at viewer"
      value={studio.suffix}
      oninput={(event) => { studio.editText('suffix', (event.currentTarget as HTMLInputElement).value); }}
    />
  </div>

    </div>
  </details>

  <!-- presets -->
  <details class="rounded-lg border border-neutral-800 p-3">
    <summary class="cursor-pointer text-xs text-neutral-400">{locale.t("prompt_studio.presets")}</summary>
    <div class="mt-3 flex flex-col gap-2">
    <p class="font-mono text-[9px] tracking-[0.16em] text-indigo-400/80 uppercase">{locale.t("prompt_studio.presets")}</p>
    <div class="flex gap-1.5">
      <input
        class="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
        aria-label={locale.t("prompt_studio.preset_name")}
        onkeydown={(event) => { if (event.key === "Enter") savePreset(); }}
        placeholder={locale.t("prompt_studio.preset_name")}
        bind:value={presetName}
      />
      <button type="button" class="rounded-lg border border-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:border-indigo-500" aria-label={locale.t("prompt_studio.preset_save")} title={locale.t("prompt_studio.preset_save")} disabled={!presetName.trim()} onclick={savePreset}>
        <Plus size={12} strokeWidth={2} />
      </button>
      <button type="button" class="rounded-lg border border-neutral-800 px-2 py-1 text-neutral-300 hover:border-indigo-500" aria-label={locale.t("prompt_studio.export")} title={locale.t("prompt_studio.export")} onclick={() => studio.exportPreset()}>
        <Download size={12} strokeWidth={2} />
      </button>
      <button type="button" class="rounded-lg border border-neutral-800 px-2 py-1 text-neutral-300 hover:border-indigo-500" aria-label={locale.t("prompt_studio.import")} title={locale.t("prompt_studio.import")} disabled={importing} onclick={() => fileInput?.click()}>
        <Upload size={12} strokeWidth={2} />
      </button>
      <input
        class="hidden"
        type="file"
        accept="application/json,text/plain,.json,.txt"
        bind:this={fileInput}
        onchange={importFile}
      />
    </div>
    <p class="text-[11px] leading-relaxed text-neutral-400">{locale.t("prompt_studio.preset_hint")}</p>
    <button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:border-indigo-500 disabled:opacity-40" disabled={!presetName.trim() || !studio.prompt.trim()} onclick={saveGenerationPreset}>{locale.t("prompt_studio.save_generation_preset")}</button>
    {#if importing}<p role="status" class="text-xs text-neutral-400">{locale.t("prompt_studio.loading")}</p>{/if}
    {#if !studio.presets.length}<p class="text-xs text-neutral-400">{locale.t("prompt_studio.no_presets")}</p>{/if}
    {#each studio.presets as item (item.name)}
      <div class="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1">
        <button type="button" class="min-w-0 flex-1 truncate text-left text-[11px] text-neutral-300 hover:text-indigo-300" onclick={() => requestLoad(item.snapshot)}>
          {item.name}
        </button>
        <span class="font-mono text-[9px] text-neutral-600">{item.snapshot.selected?.length ?? 0}t</span>
        <button type="button" class="touch-target inline-flex min-h-6 min-w-6 items-center justify-center text-neutral-500 hover:text-neutral-200" aria-label={locale.t("prompt_studio.export")} title={locale.t("prompt_studio.export")} onclick={() => studio.exportPreset(item.name)}>
          <Download size={11} strokeWidth={2} />
        </button>
        <button type="button" class="touch-target inline-flex min-h-6 min-w-6 items-center justify-center text-neutral-500 hover:text-red-400" aria-label={locale.t("prompt_studio.remove")} title={locale.t("prompt_studio.remove")} onclick={() => confirm(`${locale.t("prompt_studio.delete")}: ${item.name}?`, () => studio.deletePreset(item.name))}>
          <Trash2 size={11} strokeWidth={2} />
        </button>
      </div>
    {/each}
    </div>
  </details>
    {#if pendingAction}
      <div role="alert" class="rounded-lg border border-indigo-500/40 bg-indigo-500/5 p-3 text-xs text-neutral-300">
        <p>{pendingAction.label}</p><div class="mt-2 flex gap-2">
          <button type="button" class="touch-target rounded-lg bg-indigo-600 px-3 py-2 text-white" onclick={finishAction}>{locale.t("common.confirm")}</button>
          <button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 py-2" onclick={() => (pendingAction = null)}>{locale.t("common.cancel")}</button>
        </div>
      </div>
    {/if}

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
