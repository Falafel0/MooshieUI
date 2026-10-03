<script lang="ts">
  import { BOORU_SOURCES, type BooruSource } from "../../utils/booru.js";
  import PromptStudioSavedSources from './PromptStudioSavedSources.svelte';
  import { savedSources } from '../../prompt-studio/saved-sources.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  import PromptStudioLive from './PromptStudioLive.svelte';
  import PromptStudioSources from './PromptStudioSources.svelte';
  import PromptStudioCatalog from './PromptStudioCatalog.svelte';
  import ReferenceBrowser from '../generation/ReferenceBrowser.svelte';
  let { onUseGeneration }: { onUseGeneration?: () => void } = $props();
  let source = $state('live');
  let booru = $state<BooruSource>('danbooru');
  let visitedBooru = $state<BooruSource[]>(['danbooru']);
  function openBooru(next: BooruSource) { booru = next; if (!visitedBooru.includes(next)) visitedBooru = [...visitedBooru, next]; }
  let visited = $state(['live']);
  $effect(() => { savedSources.load(); });
  function open(next: string) { source = next; if (!visited.includes(next)) visited = [...visited, next]; }
</script>
<div class="flex h-full min-h-0 min-w-0 flex-col gap-3">
  <header>
    <h3 class="text-base font-semibold">{locale.t('prompt_studio.browser')}</h3>
    <p class="mt-1 text-xs leading-relaxed text-neutral-400">{locale.t('prompt_studio.browser_hint')}</p>
  </header>
  <nav class="flex flex-wrap gap-2" aria-label={locale.t('prompt_studio.sources')}>
    {#each ['live', 'recipes', 'references', 'local', 'saved'] as id}
      <button type="button" aria-pressed={source === id} class="touch-target rounded-lg px-3 py-2 text-xs {source === id ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-900'}" onclick={() => open(id)}>{locale.t(id === 'references' ? 'anima_studio.tab.sources' : `prompt_studio.browser_${id}`)}</button>
    {/each}
  </nav>
  {#if savedSources.storageError}<p role="alert" class="text-xs text-amber-300">{locale.t("prompt_studio.storage_error")}</p>{/if}
  <div class="min-h-0 flex-1">
    {#each visited as id (id)}
      <div hidden={source !== id} class="h-full {id === 'live' ? 'flex min-h-0 flex-col' : 'overflow-y-auto overscroll-contain pr-1'}">
        {#if id === 'live'}
          <nav aria-label={locale.t('settings.sections.booru')} class="mb-3 flex shrink-0 flex-wrap gap-2">
            {#each BOORU_SOURCES as provider (provider.id)}
              <button type="button" aria-pressed={booru === provider.id} class="touch-target rounded border px-3 py-2 text-xs {booru === provider.id ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-neutral-700 text-neutral-400'}" onclick={() => openBooru(provider.id)}>{provider.label}</button>
            {/each}
          </nav>
          {#each visitedBooru as provider (provider)}
            <div hidden={booru !== provider} class="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"><PromptStudioLive initialSource={provider} fixedSource /></div>
          {/each}
        {:else if id === 'references'}<ReferenceBrowser {onUseGeneration} />
        {:else if id === 'recipes'}<PromptStudioSources />
        {:else if id === 'saved'}<PromptStudioSavedSources />
        {:else}<PromptStudioCatalog />{/if}
      </div>
    {/each}
  </div>
</div>
