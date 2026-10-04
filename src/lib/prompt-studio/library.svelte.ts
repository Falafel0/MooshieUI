import type { CustomCatalogEntry } from './catalog-model.js';
import { customCatalog } from './custom-catalog.svelte.js';
import { locale } from '../stores/locale.svelte.js';
import { loadCollection, loadCollectionAsset, collectionGroupKey, type CollectionEntry } from './collections.js';
import { workflowGroups, type WorkflowGroup } from './workflow-catalog.js';
import { artistPrompt, resolveTemplate, type Dictionaries } from './collection-tools.js';
import type { StudioKind } from './presets.js';
import { userScopedKey } from '../utils/ipc.js';

export const domainCollection = { character: 'characters', wardrobe: 'wardrobe', scene: 'composition' } as const;
const key = () => userScopedKey('mooshie.prompt-studio.library.v1');
export type InspectedTag = { tag: string; name: string; group: string; description?: string; aliases?: string[]; context?: string[]; preview?: string; mode?: StudioKind; groupId?: string; source?: string };

/** One source selection and one cached database for every working view. */
class StudioLibrary {
  sources = $state<Record<StudioKind, string>>({ character: 'database', wardrobe: 'database', scene: 'database' });
  databases = $state.raw<Record<string, CollectionEntry[]>>({});
  pending = $state<string[]>([]);
  failed = $state<string[]>([]);
  editingSet = $state<string | undefined>();
  mixerSet = $state('');
  newSetDraft = $state.raw<{ name: string; entries: CustomCatalogEntry[] } | undefined>();
  recipePreview = $state<{ name: string; text: string; scope: string } | undefined>();
  recipeLoading = $state(false);
  inspectedTag = $state<InspectedTag>();
  private recipeRevision = 0;
  private owner = '';
  private requests = new Map<string, Promise<void>>();
  load() {
    const owner = key();
    if (owner === this.owner) return;
    this.owner = owner; this.editingSet = undefined; this.mixerSet = ''; this.newSetDraft = undefined; this.inspectedTag = undefined; this.clearRecipe();
    this.sources = { character: 'database', wardrobe: 'database', scene: 'database' };
    try {
      const raw = JSON.parse(localStorage.getItem(owner) ?? '{}');
      for (const mode of ['character', 'wardrobe', 'scene'] as const) if (typeof raw[mode] === 'string') this.sources = { ...this.sources, [mode]: raw[mode] };
    } catch (error) { console.warn('Prompt Studio library settings:', error); }
  }
  select(mode: StudioKind, source: string) {
    this.load(); this.sources = { ...this.sources, [mode]: source };
    try { localStorage.setItem(this.owner, JSON.stringify(this.sources)); }
    catch (error) { console.warn('Prompt Studio library settings:', error); }
    if (source === 'database') void this.fetch(domainCollection[mode]);
  }
  async fetch(id: string): Promise<void> {
    if (this.databases[id]) return;
    if (this.requests.has(id)) return this.requests.get(id);
    this.pending = [...this.pending, id]; this.failed = this.failed.filter(row => row !== id);
    const request = loadCollection(id).then(rows => { this.databases = { ...this.databases, [id]: rows }; })
      .catch(error => { this.failed = [...this.failed, id]; console.warn('Prompt Studio database:', error); })
      .finally(() => { this.pending = this.pending.filter(row => row !== id); this.requests.delete(id); });
    this.requests.set(id, request); return request;
  }
  clearRecipe() { this.recipeRevision++; this.recipePreview = undefined; this.recipeLoading = false; }
  async previewRecipe(name: string, text: string) {
    this.load(); this.clearRecipe();
    const revision = this.recipeRevision, scope = customCatalog.scope;
    this.recipeLoading = true;
    try {
      const dictionaries = await loadCollectionAsset<Dictionaries>('dictionaries.json');
      if (revision !== this.recipeRevision || scope !== customCatalog.scope) return;
      this.recipePreview = { name, text: resolveTemplate(text, dictionaries).text, scope };
    } catch (error) { console.warn('Prompt Studio recipe preview:', error); }
    finally { if (revision === this.recipeRevision) this.recipeLoading = false; }
  }
  activateSet(id: string): StudioKind | undefined {
    const category = customCatalog.categories.find(row => row.id === id);
    if (!category || !customCatalog.current) return;
    const modes = category.domains?.length ? category.domains : ['character', 'wardrobe', 'scene'] as StudioKind[];
    for (const mode of modes) this.select(mode, id);
    return modes[0];
  }
  sets(mode: StudioKind) { return customCatalog.current ? customCatalog.categories.filter(row => !row.domains?.length || row.domains.includes(mode)) : []; }
  groups(mode: StudioKind): WorkflowGroup[] {
    const source = this.sources[mode];
    if (source === 'starter') return workflowGroups(mode);
    if (source === 'database') {
      const collection = domainCollection[mode];
      const buckets = new Map<string, CollectionEntry[]>();
      for (const row of this.databases[collection] ?? []) { const bucket = buckets.get(row.group); if (bucket) bucket.push(row); else buckets.set(row.group, [row]); }
      return [...buckets].map(([id, rows]) => ({ id: `collection:${collection}:${id}`, labelKey: `prompt_studio.library.group.${id}`, mode, optional: true, multi: !['subject', 'body_type', 'breasts', 'skin', 'hair_len', 'hair_color', 'eye_color', 'style', 'shirt', 'dress', 'skirt', 'pants', 'outerwear', 'boots', 'shoes', 'hats', 'shot', 'angle', 'daytime', 'perspective'].includes(id), options: rows.map(row => ({ tag: row.tag, name: row.name, labelKey: '' })) }));
    }
    const category = this.sets(mode).find(row => row.id === source);
    if (!category) return [];
    return [category, ...category.subs].map(bucket => ({ id: bucket.id, name: bucket.name, labelKey: '', mode, optional: true, multi: true, options: customCatalog.entries.filter(row => row.subId === bucket.id).map(row => ({ tag: row.tag, name: row.name, labelKey: '' })) }));
  }
  async copyCollection(id: string): Promise<string | undefined> {
    const owner = customCatalog.scope;
    await customCatalog.load(); await this.fetch(id);
    if (owner !== customCatalog.scope || !customCatalog.ready || !this.databases[id]) return;
    const rows = this.databases[id];
    const categoryId = crypto.randomUUID();
    const groups = [...new Set(rows.map(row => row.group))];
    const ids = new Map(groups.map(group => [group, crypto.randomUUID()]));
    const domain = (Object.keys(domainCollection) as StudioKind[]).find(mode => domainCollection[mode] === id);
    const imported = customCatalog.import({ kind: 'mooshie-tag-pack', version: 1,
      categories: [{ id: categoryId, name: locale.t(`prompt_studio.collections.${id}`), icon: 'library', domains: domain ? [domain] : [], subs: groups.map(group => ({ id: ids.get(group), name: locale.t(collectionGroupKey(group)) })) }],
      entries: rows.map(row => ({ id: crypto.randomUUID(), subId: ids.get(row.group), tag: id === 'artists' ? artistPrompt(row.tag, false) : row.tag, name: row.name, description: row.description, contextualTags: row.context, collectionData: row })),
    });
    if (!imported) return;
    this.editingSet = categoryId;
    return categoryId;
  }
}
export const library = new StudioLibrary();
