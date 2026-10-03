<script lang="ts">
  import { locale } from '../../stores/locale.svelte.js';
  import AnimaPromptStudio from '../generation/AnimaPromptStudio.svelte';
  let opened = $state<'groups' | 'composer' | 'mixer' | null>(null);
</script>
<div class="mx-auto flex max-w-4xl flex-col gap-4">
  <h3 class="text-base font-semibold">{locale.t('prompt_studio.advanced')}</h3>
  <p class="text-sm leading-relaxed text-neutral-400">{locale.t('prompt_studio.anima_scope')}</p>
  <div class="grid gap-3 sm:grid-cols-3">
    {#each ['groups', 'composer', 'mixer'] as id}
      <button type="button" class="touch-target flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-left hover:border-indigo-500" onclick={() => opened = id as 'groups' | 'composer' | 'mixer'}>
        <span class="text-sm text-neutral-200">{locale.t(`anima_studio.tab.${id}`)}</span>
        <span class="text-xs leading-relaxed text-neutral-400">{locale.t(`prompt_studio.anima_${id}_hint`)}</span>
      </button>
    {/each}
  </div>
</div>
{#if opened}<AnimaPromptStudio initialTab={opened} onClose={() => opened = null} />{/if}
