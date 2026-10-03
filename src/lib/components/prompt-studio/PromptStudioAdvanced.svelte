<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";
  import AnimaSources from "../generation/AnimaSources.svelte";

</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-3">
  <div class="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-400">
    <p class="font-mono text-[11px] tracking-[0.16em] text-indigo-400 uppercase">anima_tools</p>
    <p class="mt-2">{locale.t("prompt_studio.advanced_desc")}</p>
    <p class="mt-1 text-neutral-500">{locale.t("prompt_studio.advanced_desc")}</p>
  </div>
  <div class="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
    <AnimaSources />
  </div>

</div>
