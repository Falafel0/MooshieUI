<script lang="ts">
  /**
   * The project bar: what document is open, whether it has unsaved changes, and
   * the File menu around it (New, Open, Save, Save as, Close).
   *
   * Photoshop's shape, in one row: the name is the document, the dot is its
   * state, and nothing that throws the document away happens without asking
   * first. The settings section offers the same actions through the same store,
   * so both surfaces stand behind one guard.
   */
  import { onDestroy, onMount } from "svelte";
  import { projects } from "../../stores/projects.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { isTypingTarget } from "../../utils/keyboardTarget.js";
  import { DOCUMENT_MAX_SIZE, DOCUMENT_MIN_SIZE } from "../../utils/projectDocument.js";
  import { ChevronDown, FilePlus2, FolderOpen, Save, SaveAll, X } from "@lucide/svelte";

  let menuOpen = $state(false);
  let newOpen = $state(false);
  let saveAsOpen = $state(false);
  let nameInput = $state("");
  let saveAsName = $state("");
  let newWidth = $state(1024);
  let newHeight = $state(1024);
  let newBackground = $state("#000000");

  const sizes: Array<[number, number]> = [
    [512, 512],
    [768, 1024],
    [1024, 1024],
    [1024, 1536],
    [1536, 1536],
    [1920, 1080],
  ];

  onMount(() => {
    void projects.refreshList();
    projects.watch();
  });

  onDestroy(() => projects.unwatch());

  function clampSize(value: number): number {
    return Math.max(DOCUMENT_MIN_SIZE, Math.min(DOCUMENT_MAX_SIZE, Math.round(value)));
  }

  function openNew() {
    menuOpen = false;
    nameInput = "";
    newWidth = 1024;
    newHeight = 1024;
    newBackground = "#000000";
    newOpen = true;
  }

  function createDocument() {
    const name = nameInput.trim();
    if (!name) return;
    const width = clampSize(newWidth);
    const height = clampSize(newHeight);
    void projects.requestGuarded(async () => {
      newOpen = false;
      await projects.create(name, width, height, newBackground);
    });
  }

  function openDocument(id: string) {
    menuOpen = false;
    void projects.requestGuarded(() => projects.open(id));
  }

  function openSaveAs() {
    menuOpen = false;
    saveAsName = projects.currentName;
    saveAsOpen = true;
  }

  function confirmSaveAs() {
    const name = saveAsName.trim();
    if (!name) return;
    void projects.saveAs(name).then((saved) => {
      if (saved) saveAsOpen = false;
    });
  }

  function closeDocument() {
    menuOpen = false;
    void projects.requestGuarded(() => projects.close());
  }

  function handleShortcut(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    // Ctrl+S in a prompt field belongs to the field, not to the document.
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    if (event.shiftKey) return openSaveAs();
    if (projects.currentId) void projects.save();
    else openSaveAs();
  }
</script>

<svelte:window onkeydown={handleShortcut} />

<div class="relative flex h-8 items-center gap-2 border-b border-neutral-800 bg-neutral-900/80 px-2 text-[11px]">
  <button
    type="button"
    class="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-neutral-200 hover:bg-neutral-800"
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    title={locale.t("projects.menu_tip")}
    onclick={() => (menuOpen = !menuOpen)}
  >
    <span class="min-w-0 truncate font-medium">{projects.displayName}</span>
    {#if projects.dirty}
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title={locale.t("projects.dirty")} aria-label={locale.t("projects.dirty")}></span>
    {/if}
    <ChevronDown size={12} class="shrink-0 text-neutral-500" />
  </button>

  <span class="truncate text-neutral-500">{projects.dirty ? locale.t("projects.dirty") : locale.t("projects.saved_state")}</span>
  <span class="ml-auto flex shrink-0 items-center gap-1">
    {#if projects.saving}
      <span class="text-indigo-300">{locale.t("projects.saving")}</span>
    {:else if projects.lastError}
      <span class="max-w-64 truncate text-red-400" title={projects.lastError}>{projects.lastError}</span>
    {/if}
  </span>

  {#if menuOpen}
    <!-- Clicking anywhere else closes the menu; the backdrop is inert. -->
    <button type="button" class="fixed inset-0 z-30 cursor-default" aria-label={locale.t("common.close")} onclick={() => (menuOpen = false)}></button>
    <div class="absolute left-2 top-8 z-40 w-64 overflow-hidden rounded-md border border-neutral-700 bg-neutral-950 shadow-2xl" role="menu">
      <button type="button" role="menuitem" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800" onclick={openNew}>
        <FilePlus2 size={13} class="text-neutral-500" /> {locale.t("projects.new")}
      </button>
      <button type="button" role="menuitem" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800" onclick={() => { menuOpen = false; if (projects.currentId) void projects.save(); else openSaveAs(); }}>
        <Save size={13} class="text-neutral-500" /> {locale.t("projects.save_short")}
      </button>
      <button type="button" role="menuitem" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800" onclick={openSaveAs}>
        <SaveAll size={13} class="text-neutral-500" /> {locale.t("projects.save_as")}
      </button>
      <button type="button" role="menuitem" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800" onclick={closeDocument}>
        <X size={13} class="text-neutral-500" /> {locale.t("projects.close")}
      </button>
      <div class="border-t border-neutral-800 px-3 py-1.5 text-[10px] uppercase tracking-wide text-neutral-500">{locale.t("projects.open_menu")}</div>
      {#if projects.projects.length === 0}
        <p class="px-3 pb-2 text-neutral-500">{locale.t("projects.empty")}</p>
      {:else}
        <div class="max-h-64 overflow-y-auto">
          {#each projects.projects as project (project.id)}
            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-800 {project.id === projects.currentId ? 'text-indigo-300' : 'text-neutral-200'}"
              onclick={() => openDocument(project.id)}
            >
              <FolderOpen size={13} class="shrink-0 text-neutral-500" />
              <span class="min-w-0 flex-1 truncate">{project.name}</span>
              {#if project.id === projects.currentId}
                <span class="shrink-0 text-[10px] text-indigo-400">{locale.t("projects.active")}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if newOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div class="w-full max-w-sm overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-2xl" role="dialog" aria-label={locale.t("projects.new")}>
      <div class="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span class="text-xs font-medium text-neutral-100">{locale.t("projects.new")}</span>
        <button type="button" class="text-neutral-500 hover:text-neutral-200" aria-label={locale.t("common.close")} onclick={() => (newOpen = false)}><X size={14} /></button>
      </div>
      <div class="space-y-2 p-3">
        <label class="block text-[11px] text-neutral-400">
          {locale.t("projects.name_label")}
          <input
            type="text" bind:value={nameInput} placeholder={locale.t("projects.new_name_placeholder")}
            class="mt-1 h-8 w-full rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-100 outline-none focus:border-indigo-500"
          />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="block text-[11px] text-neutral-400">
            {locale.t("generation.dimensions.width")}
            <input type="number" min={DOCUMENT_MIN_SIZE} max={DOCUMENT_MAX_SIZE} step="8" bind:value={newWidth} class="mt-1 h-8 w-full rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-100 outline-none focus:border-indigo-500" />
          </label>
          <label class="block text-[11px] text-neutral-400">
            {locale.t("generation.dimensions.height")}
            <input type="number" min={DOCUMENT_MIN_SIZE} max={DOCUMENT_MAX_SIZE} step="8" bind:value={newHeight} class="mt-1 h-8 w-full rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-100 outline-none focus:border-indigo-500" />
          </label>
        </div>
        <div class="flex flex-wrap gap-1">
          {#each sizes as [width, height]}
            <button type="button" class="rounded bg-neutral-800 px-2 py-1 text-[10px] tabular-nums text-neutral-300 hover:bg-neutral-700" onclick={() => { newWidth = width; newHeight = height; }}>{width}×{height}</button>
          {/each}
        </div>
        <label class="flex items-center justify-between gap-2 text-[11px] text-neutral-400">
          {locale.t("projects.new_background")}
          <input type="color" bind:value={newBackground} class="h-7 w-12 rounded border border-neutral-700 bg-neutral-900" />
        </label>
      </div>
      <div class="flex justify-end gap-1.5 border-t border-neutral-800 px-3 py-2">
        <button type="button" class="rounded px-2.5 py-1 text-[11px] text-neutral-400 hover:text-neutral-200" onclick={() => (newOpen = false)}>{locale.t("projects.guard_cancel")}</button>
        <button type="button" class="rounded bg-indigo-600 px-2.5 py-1 text-[11px] text-white hover:bg-indigo-500 disabled:opacity-50" disabled={!nameInput.trim()} onclick={createDocument}>{locale.t("projects.new_create")}</button>
      </div>
    </div>
  </div>
{/if}

{#if saveAsOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div class="w-full max-w-sm overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-2xl" role="dialog" aria-label={locale.t("projects.save_as")}>
      <div class="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span class="text-xs font-medium text-neutral-100">{locale.t("projects.save_as")}</span>
        <button type="button" class="text-neutral-500 hover:text-neutral-200" aria-label={locale.t("common.close")} onclick={() => (saveAsOpen = false)}><X size={14} /></button>
      </div>
      <div class="p-3">
        <label class="block text-[11px] text-neutral-400">
          {locale.t("projects.name_label")}
          <input
            type="text" bind:value={saveAsName} placeholder={locale.t("projects.name_placeholder")}
            class="mt-1 h-8 w-full rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-100 outline-none focus:border-indigo-500"
          />
        </label>
        <p class="mt-1 text-[10px] leading-snug text-neutral-500">{locale.t("projects.save_as_note")}</p>
      </div>
      <div class="flex justify-end gap-1.5 border-t border-neutral-800 px-3 py-2">
        <button type="button" class="rounded px-2.5 py-1 text-[11px] text-neutral-400 hover:text-neutral-200" onclick={() => (saveAsOpen = false)}>{locale.t("projects.guard_cancel")}</button>
        <button type="button" class="rounded bg-indigo-600 px-2.5 py-1 text-[11px] text-white hover:bg-indigo-500 disabled:opacity-50" disabled={!saveAsName.trim() || projects.saving} onclick={confirmSaveAs}>{locale.t("projects.save_short")}</button>
      </div>
    </div>
  </div>
{/if}


