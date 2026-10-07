<script lang="ts">
  import { tick } from "svelte";
  import { Search, ArrowUp, ArrowDown, CornerDownLeft, X } from "@lucide/svelte";
  import { commands } from "../../stores/commands.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { filterCommands, type UiCommand } from "../../utils/commands.js";

  let query = $state("");
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();
  const results = $derived(filterCommands(commands.entries, query, (key) => locale.t(key)));

  $effect(() => {
    if (commands.isOpen) { query = ""; active = 0; }
  });
  $effect(() => {
    query;
    commands.entries;
    active = 0;
  });
  $effect(() => {
    list?.querySelector(`#command-option-${active}`)?.scrollIntoView({ block: "nearest" });
  });

  function showDialog(node: HTMLDialogElement) {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => {
      if (node.isConnected) {
        node.showModal();
        input?.focus({ preventScroll: true });
      }
    });
    return { destroy() {
      node.close();
      // Svelte may detach the conditional dialog before destroying its action,
      // so restore focus explicitly when native dialog restoration cannot run.
      if (previousFocus?.isConnected && (document.activeElement === document.body || node.contains(document.activeElement))) {
        previousFocus.focus({ preventScroll: true });
      }
    } };
  }

  function run(command: UiCommand) {
    commands.close();
    command.run();
  }

  function handleKeys(event: KeyboardEvent) {
    // The dialog owns these keys; prevent underlying editors and generation
    // shortcuts from acting while the user searches or selects a command.
    event.stopPropagation();
    if (event.isComposing) return;
    handleShortcut(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape") { event.preventDefault(); commands.close(); return; }
    if (event.key === "Enter" && event.target === input) {
      event.preventDefault();
      if (results[active]) run(results[active]);
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); active = (active + 1) % results.length; }
    if (event.key === "ArrowUp") { event.preventDefault(); active = (active - 1 + results.length) % results.length; }
    if (event.key === "Home") { event.preventDefault(); active = 0; }
    if (event.key === "End") { event.preventDefault(); active = results.length - 1; }
  }

  function handleShortcut(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.repeat || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (!((key === "k" && !event.shiftKey) || (key === "p" && event.shiftKey))) return;
    // Existing dialogs keep ownership of their shortcuts and focus.
    if (!commands.isOpen && document.querySelector('[data-modal-open], dialog[open], [role="dialog"]')) return;
    event.preventDefault();
    commands.isOpen ? commands.close() : commands.show();
  }
</script>

<svelte:window onkeydown={handleShortcut} />

{#if commands.isOpen}
  <dialog
    use:showDialog
    class="fixed inset-x-0 top-0 m-auto mt-[8dvh] w-[calc(100%-2rem)] max-w-xl max-h-[80dvh] overflow-hidden rounded-2xl border border-ui-border bg-ui-surface p-0 text-neutral-200 shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-sm"
    aria-labelledby="command-palette-title"
    aria-describedby="command-palette-hint"
    data-modal-open
    onkeydown={handleKeys}
    oncancel={(event) => { event.preventDefault(); commands.close(); }}
    onclick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) commands.close();
    }}
  >
    <div class="flex max-h-[80dvh] flex-col">
      <div class="flex shrink-0 items-center justify-between px-4 pt-3">
        <h2 id="command-palette-title" class="text-sm font-semibold">{locale.t("commands.title")}</h2>
        <button type="button" class="ui-icon-button flex items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800" onclick={() => commands.close()} aria-label={locale.t("common.close")}><X size={16} /></button>
      </div>
      <div class="mx-3 mb-3 flex shrink-0 items-center gap-3 rounded-xl border border-ui-border bg-neutral-950 px-3 focus-within:border-ui-accent focus-within:ring-1 focus-within:ring-ui-accent">
        <Search size={18} class="shrink-0 text-neutral-500" />
        <input
          bind:this={input}
          bind:value={query}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="command-palette-results"
          aria-activedescendant={results[active] ? `command-option-${active}` : undefined}
          aria-label={locale.t("commands.search")}
          placeholder={locale.t("commands.search")}
          class="min-h-12 w-full min-w-0 bg-transparent px-1 text-sm text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-none!"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <div bind:this={list} id="command-palette-results" role="listbox" aria-label={locale.t("commands.navigation")} class="min-h-0 overflow-y-auto overscroll-contain border-t border-ui-border p-2">
        {#each results as command, index (command.id)}
          <button
            id={`command-option-${index}`}
            type="button"
            role="option"
            aria-selected={index === active}
            tabindex="-1"
            class="ui-control flex w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm {index === active ? 'bg-ui-selected text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800'}"
            onclick={() => run(command)}
          >
            <span>{locale.t(command.labelKey)}</span>
            {#if index === active}<CornerDownLeft size={15} class="shrink-0 text-ui-accent" />{/if}
          </button>
        {:else}
          <p class="px-3 py-6 text-center text-sm text-neutral-400" role="status">{locale.t("commands.no_results")}</p>
        {/each}
      </div>
      <p id="command-palette-hint" class="flex shrink-0 items-center gap-2 border-t border-ui-border px-4 py-3 text-xs text-neutral-500">
        <ArrowUp size={12} /><ArrowDown size={12} /><span>{locale.t("commands.hint")}</span>
      </p>
    </div>
  </dialog>
{/if}
