import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/stores/generation.svelte.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('generation.ts', source, ts.ScriptTarget.Latest, true);
const store = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'GenerationStore');
const names = new Set(['checkComponentKinds', 'cachedModelKind', 'componentInspectionScope', 'wrongKindMessage']);
const members = store.members.filter(n => names.has(n.name?.getText(ast)) || /^(componentKind|componentInspection|checkedComponent|mainModelWrongKind)/.test(n.name?.getText(ast) ?? ''));
const compiled = ts.transpileModule(`class Selection { ${members.map(n => n.getText(ast)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(inspect = async () => 'text_encoder') {
  const models = { remote: false, cacheScope: 'local', inventoryRevision: 0 };
  const Selection = new Function('models', 'detectModelKind', 'locale', '$state', `${compiled}; return Selection;`)(models, inspect, { t: (key, { file }) => `${key}:${file}` }, v => v);
  const state = Object.assign(new Selection(), { vae: 'bad.safetensors', clipModel: null, useSplitModel: false, vaeWrongKind: null, clipWrongKind: null, currentModelMetadataKey: () => 'checkpoints::model.safetensors' });
  return { models, state };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('a warning never follows the previously inspected file into a new selection', async () => {
  const { state } = fixture(); await state.checkComponentKinds();
  assert.match(state.wrongKindMessage('vae'), /bad.safetensors/);
  state.vae = 'good.safetensors';
  assert.equal(state.wrongKindMessage('vae'), null);
});
test('an unused split encoder cannot block a checkpoint', async () => {
  const { state } = fixture(async () => 'vae');
  state.vae = null; state.useSplitModel = true; state.clipModel = 'bad.safetensors';
  await state.checkComponentKinds(); assert.ok(state.wrongKindMessage('clip'));
  state.useSplitModel = false; assert.equal(state.wrongKindMessage('clip'), null);
});
test('remote selections never inspect local files with coinciding names', async () => {
  let calls = 0; const { state, models } = fixture(async () => { calls++; return 'text_encoder'; });
  models.remote = true; await state.checkComponentKinds();
  assert.equal(calls, 0); assert.equal(state.wrongKindMessage('vae'), null);
});
test('refreshing inventory invalidates cached kinds and current warnings', async () => {
  let kind = 'text_encoder'; const { state, models } = fixture(async () => kind);
  await state.checkComponentKinds(); assert.ok(state.wrongKindMessage('vae'));
  models.inventoryRevision++; kind = 'vae';
  assert.equal(state.wrongKindMessage('vae'), null);
  await state.checkComponentKinds(); assert.equal(state.vaeWrongKind, null);
});
test('a transient inspection failure is retried rather than cached forever', async () => {
  let calls = 0; const { state } = fixture(async () => { if (++calls === 1) throw new Error('offline'); return 'text_encoder'; });
  await state.checkComponentKinds(); await state.checkComponentKinds();
  assert.equal(calls, 2); assert.ok(state.wrongKindMessage('vae'));
});
test('a late reply from another model location is ignored even for the same filename', async () => {
  const pending = deferred(); const { state, models } = fixture(() => pending.promise);
  const checking = state.checkComponentKinds(); models.cacheScope = 'another-install';
  pending.resolve('text_encoder'); await checking; assert.equal(state.vaeWrongKind, null);
});
test('overlapping inspections share the same backend read', async () => {
  const pending = deferred(); let calls = 0;
  const { state } = fixture(() => { calls++; return pending.promise; });
  const a = state.checkComponentKinds(), b = state.checkComponentKinds();
  pending.resolve('vae'); await Promise.all([a, b]); assert.equal(calls, 1);
});
test('a main-model warning belongs to its inspected installation', () => {
  const { state, models } = fixture();
  state.checkpoint = 'model.safetensors'; state.mainModelWrongKind = 'vae';
  state.mainModelWrongKindKey = state.currentModelMetadataKey(); state.mainModelWrongKindScope = models.cacheScope;
  assert.ok(state.wrongKindMessage('model'));
  models.cacheScope = 'another-install'; assert.equal(state.wrongKindMessage('model'), null);
});
