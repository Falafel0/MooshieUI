<script lang="ts">
  import PromptBlockImport from "./PromptBlockImport.svelte";
  import ExtraPromptBoxItem from "./ExtraPromptBoxItem.svelte";
  import { generation } from "../../stores/generation.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";

  interface Props {
    side: "positive" | "negative";
  }

  let { side }: Props = $props();
  let importing = $state(false);

  let boxes = $derived(
    side === "positive" ? generation.extraPositiveBoxes : generation.extraNegativeBoxes,
  );

  function addBox() {
    if (side === "positive") generation.addPositiveBox();
    else generation.addNegativeBox();
  }
</script>

{#each boxes as box, i (box.id)}
  <ExtraPromptBoxItem
    id={box.id}
    name={box.name}
    content={box.content}
    index={i + 1}
    {side}
  />
{/each}

<div class="mt-2 flex gap-2">
  <button type="button" onclick={addBox} class="ui-control flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-ui-border px-2 text-xs text-neutral-400 whitespace-nowrap overflow-hidden hover:border-ui-accent/50 hover:text-ui-accent">
    <span aria-hidden="true">+</span><span class="truncate">{locale.t("generation.prompts.extra_box_add")}</span>
  </button>
  <button type="button" class="ui-control min-w-0 flex-1 rounded-lg border border-ui-border px-2 text-xs text-neutral-400 whitespace-nowrap overflow-hidden hover:bg-ui-surface" onclick={() => importing = true}>{locale.t('prompt_studio.import_blocks')}</button>
</div>
{#if importing}<PromptBlockImport onClose={() => importing = false} onImport={blocks => { generation.importPromptBoxes(side, blocks); importing = false; }} />{/if}
