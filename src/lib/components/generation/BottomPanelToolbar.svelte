<script lang="ts">
  import type { Snippet } from "svelte";
  let { children }: { children: Snippet } = $props();
</script>

<div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-ui-border/60 bg-ui-surface/40 px-3 py-2">{@render children()}</div>
