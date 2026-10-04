<script lang="ts">
  import { studio } from '../../prompt-studio/studio.svelte.js';
  import { library } from '../../prompt-studio/library.svelte.js';
  import { customCatalog } from '../../prompt-studio/custom-catalog.svelte.js';
  import { workspace, type StudioView } from '../../prompt-studio/workspace.svelte.js';
  import { locale } from '../../stores/locale.svelte.js';
  let { management = false, activeOnly = false }: { management?: boolean; activeOnly?: boolean } = $props();
  function fromDraft() {
    const selectedTags = new Set(studio.selected.map(row => row.tag));
    const source = new Map(Object.values(library.databases).flatMap(rows => rows.filter(row => selectedTags.has(row.tag))).map(row => [row.tag, row]));
    const entries = studio.selected.map(choice => {
      const authored = customCatalog.entries.find(row => row.tag === choice.tag && row.subId === choice.category);
      const supplied = source.get(choice.tag);
      return { ...authored, id: crypto.randomUUID(), name: choice.name, tag: choice.tag, subId: '', contextualTags: [...new Set([...(authored?.contextualTags ?? supplied?.context ?? []), ...studio.detail(choice.tag).mods])], collectionData: authored?.collectionData ?? supplied };
    });
    library.newSetDraft = { name: studio.name || locale.t('prompt_studio.library.from_draft'), entries };
    library.editingSet = '';
  }
  function use(id: string, view: StudioView) {
    const mode = library.activateSet(id);
    if (!mode) return;
    workspace.setGuidedMode(mode);
    if (view === 'mix') library.mixerSet = id;
    workspace.setView(view);
  }
</script>
<section class="space-y-3 rounded-xl border border-neutral-800 p-4">
  <header class="flex flex-wrap items-center gap-2"><h3 class="min-w-0 flex-1 text-sm font-semibold">{locale.t('prompt_studio.library.global_sets')}</h3>{#if management}<button type="button" disabled={!customCatalog.ready} class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-amber-300 disabled:opacity-30" onclick={() => { library.newSetDraft = undefined; library.editingSet = ''; }}>{locale.t('prompt_studio.library.new_set')}</button>{/if}</header>
  {#if management}<button type="button" disabled={!studio.selected.length} class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300 disabled:opacity-30" onclick={fromDraft}>{locale.t('prompt_studio.library.from_draft')}</button>{/if}
  {#each customCatalog.categories.filter(row => !activeOnly || row.id === studio.activeCategoryId) as category (category.id)}
    <article class="rounded-lg border border-neutral-800 p-3"><h4 class="text-xs text-neutral-200">{category.name}</h4><div class="mt-2 flex flex-wrap gap-2">{#if management}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300" onclick={() => library.editingSet = category.id}>{locale.t('prompt_studio.library.edit_global')}</button>{:else}{#each ['build', 'mix', 'editor'] as destination}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300" onclick={() => use(category.id, destination as StudioView)}>{locale.t('prompt_studio.library.use_in', { mode: locale.t(`prompt_studio.v2.view_${destination}`) })}</button>{/each}{/if}<button type="button" class="touch-target rounded-lg border border-neutral-700 px-3 text-xs text-neutral-400" onclick={() => customCatalog.export(category.id)}>{locale.t('prompt_studio.v2.export_set')}</button></div></article>
  {/each}
</section>
