import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/utils/bottomPanel.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { availableBottomTabs, bottomPanelContext, bottomTabLabelKey, isBottomTab, validatedCardSize, DEFAULT_SHELF_PINS, visibleShelfTabs, validatedShelfPins, shelfGroup, shelfSelectionKey } = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));

test('bottom tools honor image, NovelAI and video capabilities', () => {
  assert.deepEqual(availableBottomTabs('video', true), ['references', 'prompts', 'images', 'jobs', 'notes', 'timeline']);
  const nai = availableBottomTabs('novelai', false);
  for (const hidden of ['loras', 'compare', 'schedule', 'timeline', 'checkpoints']) assert(!nai.includes(hidden));
  for (const supported of ['artists', 'styles', 'style_creator', 'images', 'prompts', 'notes']) assert(nai.includes(supported));
  assert(availableBottomTabs('image', true).includes('checkpoints'));
  assert(!availableBottomTabs('image', false).includes('checkpoints'));
});

test('video wins over a stale NovelAI flag and output labels follow the context', () => {
  assert.equal(bottomPanelContext(true, true), 'video');
  assert.equal(bottomPanelContext(false, true), 'novelai');
  assert.equal(bottomPanelContext(false, false), 'image');
  assert.equal(bottomTabLabelKey('images', 'video'), 'bottom_panel.tab.videos');
  assert.equal(bottomTabLabelKey('images', 'image'), 'bottom_panel.variants');
});

test('persisted tab names reject unexpected types and stale values', () => {
  for (const value of [null, undefined, {}, 0, 'removed-tab', '__proto__']) assert.equal(isBottomTab(value), false);
  for (const value of ['loras', 'timeline', 'notes', 'style_creator']) assert.equal(isBottomTab(value), true);
});

test('card geometry rejects corrupt persistence and clamps finite sizes', () => {
  for (const value of [null, {}, '120', NaN, Infinity, -Infinity]) assert.equal(validatedCardSize(value, 72, 48, 160), 72);
  assert.equal(validatedCardSize(-100, 72, 48, 160), 48);
  assert.equal(validatedCardSize(10000, 72, 48, 160), 160);
  assert.equal(validatedCardSize(100.7, 72, 48, 160), 101);
});


test('shelf defaults are task groups with optional model and artist browsers', () => {
  const tabs = visibleShelfTabs(availableBottomTabs('image', true), DEFAULT_SHELF_PINS);
  assert.deepEqual(tabs, ['loras', 'references', 'prompts', 'styles', 'images', 'compare', 'jobs', 'notes']);
  assert.deepEqual(tabs.map(shelfGroup), ['resources', 'resources', 'resources', 'resources', 'results', 'results', 'workflow', 'workflow']);
  assert(!tabs.includes('checkpoints'));
  assert(!tabs.includes('artists'));
  assert(!tabs.includes('style_creator'));
});

test('pin validation rejects corrupt data, deduplicates and preserves user order', () => {
  assert.deepEqual(validatedShelfPins(['styles', {}, 'removed', 'references', 'styles', 'notes']), ['styles', 'references', 'notes']);
  for (const value of [null, {}, 'loras', [], ['removed']]) assert.deepEqual(validatedShelfPins(value), DEFAULT_SHELF_PINS);
  const pins = ['notes', 'styles', 'loras', 'images', 'references', 'jobs'];
  const copy = [...pins];
  assert.deepEqual(visibleShelfTabs(availableBottomTabs('image', true), pins), ['styles', 'loras', 'references', 'images', 'notes', 'jobs']);
  assert.deepEqual(pins, copy, 'deriving navigation must not mutate persisted order');
});

test('a directly opened unpinned tool stays accessible without permanent pinning', () => {
  const available = availableBottomTabs('image', true);
  assert(visibleShelfTabs(available, DEFAULT_SHELF_PINS, 'checkpoints').includes('checkpoints'));
  assert(!visibleShelfTabs(available, DEFAULT_SHELF_PINS, 'styles').includes('checkpoints'));
  assert(!visibleShelfTabs(availableBottomTabs('novelai', true), DEFAULT_SHELF_PINS, 'checkpoints').includes('checkpoints'));
  assert.deepEqual(visibleShelfTabs(availableBottomTabs('video', false), ['loras']), ['notes']);
});

test('all four image workflows share order while remembering different active tools', () => {
  const modes = ['txt2img', 'img2img', 'inpainting', 'image_edit'];
  assert.equal(new Set(modes.map(mode => shelfSelectionKey('image', mode))).size, 4);
  assert.notEqual(shelfSelectionKey('image', 'txt2img'), shelfSelectionKey('novelai', 'txt2img'));
  const pins = ['styles', 'references', 'loras', 'images', 'notes'];
  for (const mode of modes) {
    assert.deepEqual(visibleShelfTabs(availableBottomTabs(bottomPanelContext(false, false), true), pins), ['styles', 'references', 'loras', 'images', 'notes'], mode);
  }
});
