import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

test('a document is saved as a document, and a save that would lose pixels is refused', () => {
  const store = read('src/lib/stores/projects.svelte.ts');
  assert.match(store, /await canvas\.captureDocument\(\)/);
  assert.match(store, /if \(!isProjectDocument\(document_\)\)/);
  assert.match(store, /projects\.capture_failed/);
  assert.match(
    store,
    /data: \{ document: document_, generation: prefsSync\.collectAll\(\) \}/,
    'a project carries the canvas and the settings that belong to it',
  );
});

test('opening a document replaces the workspace and clears the old session', () => {
  const canvas = read('src/lib/stores/canvas.svelte.ts');
  assert.match(canvas, /loadDocument\(doc: ProjectDocument\)/);
  for (const call of [
    'clearInpaintSession',
    'dismissInpaintResult',
    'clearStaging',
    'clearMask',
    'canvasHistory.clear',
  ]) {
    assert.match(canvas, new RegExp(call.replace('.', '\\.')), `loadDocument must ${call}`);
  }
  assert.match(
    canvas,
    /generation\.width = doc\.canvasWidth/,
    'the editor keeps the canvas at the generation size, so a document has to carry its size into both',
  );
  assert.match(canvas, /pendingSpatialLayerRestore = spatial/, 'mask and region pixels are re-hydrated');
  assert.match(canvas, /genLayerId\(\)/, 'ids are handed out fresh so they cannot collide with this session');
});

test('nothing throws a document away without asking about unsaved changes', () => {
  const store = read('src/lib/stores/projects.svelte.ts');
  assert.match(store, /requestGuarded\(action: \(\) => void \| Promise<unknown>\)/);
  assert.match(store, /if \(!this\.dirty\) \{\s*\n\s*void action\(\);/);
  const bar = read('src/lib/components/canvas/ProjectBar.svelte');
  for (const call of [
    'projects.requestGuarded(async () => {',
    'projects.requestGuarded(() => projects.open(id))',
    'projects.requestGuarded(() => projects.close())',
  ]) {
    assert.equal(bar.includes(call), true, `the bar must guard: ${call}`);
  }
  const section = read('src/lib/components/settings/ProjectsSection.svelte');
  assert.match(section, /projects\.requestGuarded/, 'the manager opens through the same guard');
});

test('dirty is decided by comparing signatures, not by a flag a caller sets', () => {
  const store = read('src/lib/stores/projects.svelte.ts');
  assert.match(store, /documentSignature\(canvas\.documentShape\(\), canvas\.paintRevision\)/);
  assert.match(store, /settingsSignature\(prefsSync\.collectAll\(\)\)/);
  assert.match(store, /this\.savedDocument = documentSignature/);
  assert.match(store, /this\.dirty = false/);
  // Painted pixels move the revision; a structural digest alone cannot see them.
  const stage = read('src/lib/components/canvas/CanvasStage.svelte');
  assert.match(
    stage,
    /if \(shouldAutoCommitMask\) \{[\s\S]{0,200}canvas\.bumpPaintRevision\(\);[\s\S]{0,80}autoCommitMaskIfNeeded\(\)/,
    'a finished stroke must move the picture revision',
  );
  const canvas = read('src/lib/stores/canvas.svelte.ts');
  assert.match(canvas, /bumpPaintRevision\(\) \{/, 'the store owns the counter');
});

test('the project bar is mounted, and Ctrl+S belongs to the document — except in a text field', () => {
  const editor = read('src/lib/components/canvas/CanvasEditor.svelte');
  assert.match(editor, /<ProjectBar \/>/);
  const bar = read('src/lib/components/canvas/ProjectBar.svelte');
  assert.match(bar, /isTypingTarget\(event\.target\)/);
  assert.match(bar, /projects\.watch\(\)/);
  assert.match(bar, /projects\.unwatch\(\)/);
  assert.match(bar, /projects\.saveAs\(name\)/, 'Save as goes through the store');
});

test('the strings the project surfaces show exist in the base locale', () => {
  const en = read('src/lib/locales/en.ts');
  for (const key of [
    'projects.untitled',
    'projects.menu_tip',
    'projects.new',
    'projects.new_background',
    'projects.save_short',
    'projects.save_as',
    'projects.close',
    'projects.dirty',
    'projects.saved_state',
    'projects.saving',
    'projects.guard_title',
    'projects.guard_note',
    'projects.guard_save',
    'projects.guard_discard',
    'projects.guard_cancel',
    'projects.capture_failed',
    'projects.invalid_document',
    'projects.legacy_project',
    'projects.rename',
    'projects.manager_note',
  ]) {
    assert.match(en, new RegExp(`"${key.replace(/\./g, '\\.')}":`), `${key} is missing`);
  }
});
