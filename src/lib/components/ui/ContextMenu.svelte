<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { locale } from "../../stores/locale.svelte.js";

  export interface ContextMenuItem {
    label: string;
    icon?: Snippet;
    action: () => void;
    separator?: boolean;
    destructive?: boolean;
    disabled?: boolean;
  }

  interface Props {
    items: ContextMenuItem[];
    x: number;
    y: number;
    visible: boolean;
    onclose: () => void;
  }

  let { items, x, y, visible, onclose }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  let menuSize = $state({ width: 0, height: 0 });
  let viewport = $state({ width: window.innerWidth, height: window.innerHeight });
  let previousFocus: HTMLElement | null = null;
  let search = "";
  let lastSearchAt = 0;

  // Clamp position to viewport
  const clampedX = $derived.by(() => {
    return Math.max(8, Math.min(x, viewport.width - menuSize.width - 8));
  });
  const clampedY = $derived.by(() => {
    return Math.max(8, Math.min(y, viewport.height - menuSize.height - 8));
  });

  // Portal the menu to <body> so `position: fixed` resolves against the viewport.
  // Rendered inline, a transformed/`will-change-transform` ancestor (the generation
  // panels) becomes the containing block, which shifts the menu right of the cursor
  // and lets the panel's `overflow-hidden` clip it (#421 follow-up).
  function portal(node: HTMLElement) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    search = "";
    document.body.appendChild(node);
    const observer = new ResizeObserver(() => {
      menuSize = { width: node.offsetWidth, height: node.offsetHeight };
    });
    observer.observe(node);
    void tick().then(() => {
      if (node.isConnected) (enabledItems()[0] ?? node).focus({ preventScroll: true });
    });
    return {
      destroy() {
        observer.disconnect();
        // Don't steal focus from an action's dialog or an outside click.
        if (document.activeElement === document.body || node.contains(document.activeElement)) {
          if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        }
        node.remove();
      },
    };
  }

  function enabledItems(): HTMLButtonElement[] {
    return Array.from(menuEl?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onclose();
      return;
    }
    if (e.key === "Tab") {
      onclose();
      return;
    }
    const buttons = enabledItems();
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (e.key === "ArrowDown") next = (current + 1) % buttons.length;
    if (e.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = buttons.length - 1;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
      const now = Date.now();
      search = now - lastSearchAt > 500 ? e.key : search + e.key;
      lastSearchAt = now;
      const query = search.toLocaleLowerCase();
      const prefix = [...query].every((letter) => letter === query[0]) ? query[0] : query;
      for (let offset = 1; offset <= buttons.length; offset++) {
        const index = (current + offset) % buttons.length;
        if (buttons[index].textContent?.trim().toLocaleLowerCase().startsWith(prefix)) {
          next = index;
          break;
        }
      }
    }
    if (next !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      buttons[next].focus({ preventScroll: true });
      buttons[next].scrollIntoView({ block: "nearest" });
    }
  }

  function handleScroll(e: Event) {
    if (!menuEl?.contains(e.target as Node)) onclose();
  }

  function handleResize() {
    viewport = { width: window.innerWidth, height: window.innerHeight };
  }

  function handleClickOutside(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onclose();
    }
  }

  $effect(() => {
    if (visible) {
      handleResize();
      document.addEventListener("click", handleClickOutside, true);
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleResize);
      window.addEventListener("blur", onclose);
      return () => {
        document.removeEventListener("click", handleClickOutside, true);
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleResize);
        window.removeEventListener("blur", onclose);
      };
    }
  });
</script>

{#if visible}
  <div
    bind:this={menuEl}
    use:portal
    class="fixed z-[100] min-w-[min(180px,calc(100vw-16px))] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto overscroll-contain bg-ui-surface border border-ui-border rounded-xl shadow-xl py-1 select-none"
    style="left: {clampedX}px; top: {clampedY}px;"
    role="menu"
    aria-label={locale.t("common.context_menu")}
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    {#each items as item}
      {#if item.separator}
        <div class="h-px bg-neutral-700 my-1" role="separator"></div>
      {/if}
      <button
        type="button"
        tabindex="-1"
        disabled={item.disabled}
        class="ui-control w-full px-3 text-left text-sm flex items-center gap-2 transition-colors focus-visible:outline-offset-[-3px] disabled:opacity-40 {item.destructive ? 'text-red-400 hover:bg-red-500/10 focus:bg-red-500/10' : 'text-neutral-200 hover:bg-ui-selected focus:bg-ui-selected'}"
        onclick={() => { item.action(); onclose(); }}
        role="menuitem"
      >
        {#if item.icon}
          <span class="w-4 h-4 flex items-center justify-center shrink-0">
            {@render item.icon()}
          </span>
        {/if}
        {item.label}
      </button>
    {/each}
  </div>
{/if}
