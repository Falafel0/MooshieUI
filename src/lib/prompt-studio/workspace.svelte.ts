import { userScopedKey } from '../utils/ipc.js';

export type StudioView = 'build' | 'mix' | 'editor' | 'library';
export type GuidedMode = 'character' | 'wardrobe' | 'scene';
export type LibrarySection = 'collections' | 'catalog' | 'sets' | 'sources';
const storageKey = () => userScopedKey('mooshie.prompt-studio.workspace.v2');

class StudioWorkspace {
  view = $state<StudioView>('build');
  guidedMode = $state<GuidedMode>('character');
  mobileDraft = $state(false);
  librarySection = $state<LibrarySection>('collections');
  libraryManagement = $state(false);
  draftPart = $state('base');
  storageError = $state(false);
  private loadedKey = '';
  load() {
    const key = storageKey();
    if (this.loadedKey === key) return;
    this.loadedKey = key;
    this.view = 'build'; this.guidedMode = 'character'; this.mobileDraft = false;
    this.librarySection = 'collections'; this.libraryManagement = false;
    this.draftPart = 'base';
    this.storageError = false;
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}');
      if (['build', 'mix', 'editor', 'library'].includes(raw.view)) this.view = raw.view;
      if (['character', 'wardrobe', 'scene'].includes(raw.guidedMode)) this.guidedMode = raw.guidedMode;
      let legacy: { tab?: string; management?: boolean } = {};
      try { legacy = JSON.parse(localStorage.getItem(userScopedKey('mooshie.prompt-studio.tool.library.v1')) || '{}'); } catch { /* Corrupt retired preferences do not hide current state. */ }
      const section = raw.librarySection ?? legacy?.tab;
      if (['collections', 'catalog', 'sets', 'sources'].includes(section)) this.librarySection = section;
      this.libraryManagement = typeof raw.libraryManagement === 'boolean' ? raw.libraryManagement : legacy?.management === true;
      let promptPanel: { active?: string } = {};
      try { promptPanel = JSON.parse(localStorage.getItem(userScopedKey('mooshie.prompt-studio.tool.prompt-panel.v1')) || '{}'); } catch { /* Keep the current draft selection. */ }
      if (typeof raw.draftPart === 'string') this.draftPart = raw.draftPart;
      else if (typeof promptPanel?.active === 'string' && promptPanel.active) this.draftPart = `chunk:${promptPanel.active}`;
    } catch { this.storageError = true; }
  }
  setView(view: StudioView) { this.load(); this.view = view; this.mobileDraft = false; this.save(); }
  setGuidedMode(mode: GuidedMode) { this.load(); this.guidedMode = mode; this.save(); }
  setLibrarySection(section: LibrarySection) { this.load(); this.librarySection = section; this.save(); }
  setLibraryManagement(value: boolean) { this.load(); this.libraryManagement = value; this.save(); }
  setDraftPart(part: string) { this.load(); this.draftPart = part; this.save(); }
  private save() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ view: this.view, guidedMode: this.guidedMode, librarySection: this.librarySection, libraryManagement: this.libraryManagement, draftPart: this.draftPart }));
      this.storageError = false;
    } catch { this.storageError = true; }
  }
}

export const workspace = new StudioWorkspace();
