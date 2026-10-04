import { hasTemplateVariables } from './collection-tools.js';
import { library } from './library.svelte.js';
import { studio } from './studio.svelte.js';
import { locale } from '../stores/locale.svelte.js';
import { userScopedKey } from '../utils/ipc.js';
import { WORKFLOW_CATALOG, randomizeWorkflow, resetWorkflow } from './workflow-catalog.js';
import type { StudioKind } from './presets.js';

const key = () => userScopedKey('mooshie.prompt-studio.workflow.v1');
const groupIds = new Set(WORKFLOW_CATALOG.map(group => group.id));

class Workflow {
  locked = $state<string[]>([]);
  storageError = $state(false);
  detailCount = $state(8);
  private loadedKey = '';

  load() {
    library.load();
    const scope = key();
    if (scope === this.loadedKey) return;
    this.loadedKey = scope;
    this.locked = []; this.detailCount = 8;
    this.storageError = false;
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(scope) ?? '{}');
      if (raw && typeof raw === 'object' && 'detailCount' in raw && [4, 8, 12, 20].includes(Number(raw.detailCount))) this.detailCount = Number(raw.detailCount);
      const locks = raw && typeof raw === 'object' && 'locked' in raw ? raw.locked : [];
      // Imported bucket IDs are arbitrary strings and may load asynchronously.
      if (Array.isArray(locks)) this.locked = [...new Set(locks.filter((id): id is string => typeof id === 'string' && !!id.trim()))];
    } catch (error) {
      this.storageError = true;
      console.warn('Prompt Studio workflow load:', error);
    }
  }
  private save() {
    if (this.loadedKey !== key()) return;
    try {
      localStorage.setItem(this.loadedKey, JSON.stringify({ version: 1, locked: this.locked, detailCount: this.detailCount }));
      this.storageError = false;
    } catch (error) {
      this.storageError = true;
      console.warn('Prompt Studio workflow save:', error);
    }
  }
  setDetailCount(count: number) { this.load(); if (![4, 8, 12, 20].includes(count)) return; this.detailCount = count; this.save(); }
  toggleLock(id: string) {
    this.load();
    if (!id || !(groupIds.has(id) || ['character', 'wardrobe', 'scene'].some(mode => library.groups(mode as StudioKind).some(group => group.id === id)))) return;
    this.locked = this.locked.includes(id) ? this.locked.filter(value => value !== id) : [...this.locked, id];
    this.save();
  }
  choose(mode: StudioKind, id: string, tag: string) {
    this.load(); studio.load();
    const group = library.groups(mode).find(group => group.id === id);
    const option = group?.options.find(option => option.tag === tag);
    if (!group || !option) return;
    if (hasTemplateVariables(tag)) { void library.previewRecipe(option.name || locale.t(option.labelKey), tag); return; }
    // An existing catalog or imported selection belongs to its original source.
    if (studio.selected.some(choice => choice.tag === tag && choice.category !== id)) return;
    const chosen = studio.selected.some(choice => choice.category === id && choice.tag === tag);
    const entries = studio.selected.filter(choice => choice.category === id && (group.multi || chosen) && choice.tag !== tag);
    if (!chosen) entries.push({ tag, name: option.name || locale.t(option.labelKey), category: id, weight: 1 });
    studio.replaceChoices(entries, [id]);
  }
  clearGroup(mode: StudioKind, id: string) {
    this.load(); studio.load();
    if (library.groups(mode).some(group => group.id === id)) studio.replaceChoices([], [id]);
  }
  randomize(mode: StudioKind, id?: string) {
    this.load(); studio.load();
    const groups = library.groups(mode).filter(group => !id || group.id === id);
    const { categories, entries } = randomizeWorkflow(studio.selected, groups, { locked: this.locked, pinned: studio.pinned, banned: studio.banned, freshLimit: !id && library.sources[mode] !== 'starter' ? this.detailCount : undefined });
    if (entries.some(entry => hasTemplateVariables(entry.tag))) { void library.previewRecipe(locale.t('prompt_studio.library.recipe_review'), entries.map(entry => entry.tag).join(', ')); return; }
    studio.replaceChoices(entries.map(entry => {
      const option = groups.find(group => group.id === entry.category)?.options.find(option => option.tag === entry.tag);
      // Preserve the authored name and weight of pinned selections.
      return studio.pinned.includes(entry.tag) || !option ? entry : { ...entry, name: option.name || locale.t(option.labelKey) };
    }), categories);
  }
  reset(mode: StudioKind) {
    this.load(); studio.load();
    const { categories, entries } = resetWorkflow(studio.selected, library.groups(mode), { locked: this.locked, pinned: studio.pinned });
    studio.replaceChoices(entries, categories);
  }
}
export const workflow = new Workflow();
