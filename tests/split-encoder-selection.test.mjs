import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const encoderModule = compile(fs.readFileSync(new URL('../src/lib/utils/krea2Encoder.ts', import.meta.url), 'utf8'));
const { pickKrea2Encoder } = await import('data:text/javascript;base64,' + Buffer.from(encoderModule).toString('base64'));
const source = fs.readFileSync(new URL('../src/lib/stores/generation.svelte.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('generation.ts', source, ts.ScriptTarget.Latest, true);
const store = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GenerationStore');
const method = store.members.find(node => node.name?.getText(ast) === 'ensureRecommendedSplitClip');
const Selection = new Function('pickKrea2Encoder', compile(`class Selection { ${method.getText(ast)} }`) + '; return Selection;')(pickKrea2Encoder);
function fixture(values = {}) {
  return Object.assign(new Selection(), { useSplitModel: true, modelFamily: 'anima', clipModel: 'custom-anima.safetensors', clipType: null, saves: 0, saveSettings() { this.saves++; } }, values);
}
test('family-only encoder detection sets loader type while retaining an installed custom encoder', () => {
  const state = fixture(); state.ensureRecommendedSplitClip(['custom-anima.safetensors'], true);
  assert.equal(state.clipType, 'wan'); assert.equal(state.clipModel, 'custom-anima.safetensors'); assert.equal(state.saves, 1);
});
test('an unloaded inventory retains the current encoder; a loaded inventory removes a stale file', () => {
  const state = fixture(); state.ensureRecommendedSplitClip([], true);
  assert.equal(state.clipModel, 'custom-anima.safetensors');
  state.ensureRecommendedSplitClip(['other.safetensors'], true); assert.equal(state.clipModel, null);
});
test('generic recommendations do not select a file missing from the inventory', () => {
  const state = fixture({ modelRecommendedClipModel: 'missing.safetensors', modelRecommendedClipType: 'wan' });
  state.ensureRecommendedSplitClip(['custom-anima.safetensors'], true);
  assert.equal(state.clipType, 'wan'); assert.equal(state.clipModel, 'custom-anima.safetensors');
});
test('Krea 2 respects the preferred installed encoder over the backend recommendation', () => {
  const stock = 'qwen3-vl-4b_fp8.safetensors', heretic = 'qwen3-vl-4b-heretic_fp8.safetensors';
  const state = fixture({ modelFamily: 'krea2', clipModel: stock, clipType: 'krea2', modelRecommendedClipModel: stock, krea2UncensoredEncoder: true });
  state.ensureRecommendedSplitClip([stock, heretic], true); assert.equal(state.clipModel, heretic);
  state.krea2UncensoredEncoder = false; state.ensureRecommendedSplitClip([stock, heretic], true); assert.equal(state.clipModel, stock);
});
test('checkpoint models and unchanged split selections do not write settings', () => {
  const state = fixture({ useSplitModel: false }); state.ensureRecommendedSplitClip([], true); assert.equal(state.saves, 0);
  state.useSplitModel = true; state.clipType = 'wan'; state.ensureRecommendedSplitClip(['custom-anima.safetensors'], true); assert.equal(state.saves, 0);
});
