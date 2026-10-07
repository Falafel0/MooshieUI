import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/utils/bottomPanel.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { availableBottomTabs, bottomPanelContext, bottomTabLabelKey, isBottomTab, validatedCardSize } = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));

test('bottom tools honor image, NovelAI and video capabilities', () => {
  assert.deepEqual(availableBottomTabs('video', true), ['images', 'prompts', 'timeline', 'notes']);
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
  assert.equal(bottomTabLabelKey('images', 'image'), 'bottom_panel.tab.images');
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
