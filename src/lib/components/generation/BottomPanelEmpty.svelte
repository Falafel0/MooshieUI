<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";
  import BottomPanelIcon from "./BottomPanelIcon.svelte";
  let { icon, messageKey, params, onreset }: { icon: string; messageKey: string; params?: Record<string, string>; onreset?: () => void } = $props();
</script>

<div class="flex min-h-24 flex-1 flex-col items-center justify-center gap-3 px-6 py-5 text-center">
  <span class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-ui-border/60 bg-ui-surface text-neutral-400"><BottomPanelIcon name={icon} class="size-5" /></span>
  <p class="max-w-sm text-sm leading-relaxed text-neutral-400">{locale.t(messageKey, params)}</p>
  {#if onreset}
    <button type="button" onclick={(event) => { onreset?.(); event.currentTarget.closest('[role="tabpanel"]')?.querySelector<HTMLInputElement>('input[type="text"]')?.focus(); }} class="ui-control rounded-lg border border-ui-border px-3 text-xs text-neutral-200 hover:border-ui-accent/50 hover:bg-ui-selected">{locale.t("common.reset")}</button>
  {/if}
</div>
