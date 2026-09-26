import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// The pair resolver lives next to the canvas store, so swap that import for a
// mutable stub before transpiling: this exercises the exact gate logic without
// pulling Konva or a DOM into plain node. One stub object is shared and edited
// per test; the resolver reads its fields through the captured reference.
const source = fs.readFileSync(new URL('../src/lib/utils/inpaintComparePair.ts', import.meta.url), 'utf8');
const stubbed = source.replace(
  /import \{ canvas \} from "\.\.\/stores\/canvas\.svelte\.js";/,
  'const canvas = globalThis.__canvasStub;',
);
assert.ok(!stubbed.includes('stores/canvas.svelte.js'), 'store import must be stubbed');
const code = ts.transpileModule(stubbed, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;

globalThis.__canvasStub = {
  pendingResultPreviewUrl: null,
  pendingResultSourceKey: null,
  preparedInpaintPreviewUrl: null,
  referenceImageUrl: null,
  completed: {},
  getCompletedInpaintResult(key) {
    return key in this.completed ? this.completed[key] : null;
  },
};
const { getInpaintComparePair } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

function reset() {
  const c = globalThis.__canvasStub;
  c.pendingResultPreviewUrl = null;
  c.pendingResultSourceKey = null;
  c.preparedInpaintPreviewUrl = null;
  c.referenceImageUrl = null;
  c.completed = {};
}

test('fresh result against its session original forms a pair', () => {
  reset();
  const c = globalThis.__canvasStub;
  c.pendingResultPreviewUrl = 'blob:result';
  c.pendingResultSourceKey = 'p1:out_0.png';
  c.referenceImageUrl = 'blob:original';
  c.completed = { 'p1:out_0.png': { maskUrl: 'data:mask', rasterLayerIds: [] } };
  assert.deepEqual(getInpaintComparePair(), {
    originalUrl: 'blob:original',
    resultUrl: 'blob:result',
  });
});

test('a prepared base override is the original when one exists', () => {
  reset();
  const c = globalThis.__canvasStub;
  c.pendingResultPreviewUrl = 'blob:result';
  c.pendingResultSourceKey = 'p2:out_0.png';
  c.preparedInpaintPreviewUrl = 'blob:prepared';
  c.referenceImageUrl = 'blob:session-original';
  c.completed = { 'p2:out_0.png': { maskUrl: null, rasterLayerIds: [] } };
  assert.equal(getInpaintComparePair()?.originalUrl, 'blob:prepared');
});

test('no base means no genuine original: blank-document inpaint stays hidden', () => {
  reset();
  const c = globalThis.__canvasStub;
  c.pendingResultPreviewUrl = 'blob:result';
  c.pendingResultSourceKey = 'p3:out_0.png';
  c.completed = { 'p3:out_0.png': { maskUrl: 'data:mask', rasterLayerIds: [] } };
  assert.equal(getInpaintComparePair(), null);
});

test('a result without a registered source run is never compared', () => {
  reset();
  const c = globalThis.__canvasStub;
  c.pendingResultPreviewUrl = 'blob:result';
  c.pendingResultSourceKey = null;
  c.referenceImageUrl = 'blob:original';
  assert.equal(getInpaintComparePair(), null);

  // Registered key set but the registry has no record for it: still no pair.
  c.pendingResultSourceKey = 'p4:out_0.png';
  assert.equal(getInpaintComparePair(), null);
});

test('dismissing the result removes the pair', () => {
  reset();
  const c = globalThis.__canvasStub;
  c.pendingResultPreviewUrl = 'blob:result';
  c.pendingResultSourceKey = 'p5:out_0.png';
  c.referenceImageUrl = 'blob:original';
  c.completed = { 'p5:out_0.png': { maskUrl: null, rasterLayerIds: [] } };
  assert.ok(getInpaintComparePair());
  c.pendingResultPreviewUrl = null;
  c.pendingResultSourceKey = null;
  assert.equal(getInpaintComparePair(), null);
});
