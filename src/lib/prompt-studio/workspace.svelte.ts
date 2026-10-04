import { userScopedKey } from '../utils/ipc.js';

export type StudioView = 'build' | 'mix' | 'editor' | 'library';
export type GuidedMode = 'character' | 'wardrobe' | 'scene';
const storageKey = () => userScopedKey('mooshie.prompt-studio.workspace.v2');

class StudioWorkspace {
  view = $state<StudioView>('build');
  guidedMode = $state<GuidedMode>('character');
  mobileDraft = $state(false);
  storageError = $state(false);
  private loadedKey = '';
  load() {
    const key = storageKey();
    if (this.loadedKey === key) return;
    this.loadedKey = key;
    this.view = 'build'; this.guidedMode = 'character'; this.mobileDraft = false;
    this.storageError = false;
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}');
      if (['build', 'mix', 'editor', 'library'].includes(raw.view)) this.view = raw.view;
      if (['character', 'wardrobe', 'scene'].includes(raw.guidedMode)) this.guidedMode = raw.guidedMode;
    } catch { this.storageError = true; }
  }
  setView(view: StudioView) { this.load(); this.view = view; this.mobileDraft = false; this.save(); }
  setGuidedMode(mode: GuidedMode) { this.load(); this.guidedMode = mode; this.save(); }
  private save() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ view: this.view, guidedMode: this.guidedMode }));
      this.storageError = false;
    } catch { this.storageError = true; }
  }
}

export const workspace = new StudioWorkspace();
