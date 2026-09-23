import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/utils/inpaintResultRegistry.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { InpaintResultRegistry } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('cancellation remains effective during asynchronous result preparation', () => {
  const registry = new InpaintResultRegistry();
  const snapshot = registry.capture(1, 'original-mask');
  registry.register('job', snapshot);
  assert.equal(registry.claim('job', 1), snapshot);
  registry.invalidate(['job']);
  assert.equal(registry.accept(snapshot, 1), false);
});

test('cancel all also invalidates submissions awaiting their server prompt id', () => {
  const registry = new InpaintResultRegistry();
  const snapshot = registry.capture(1, 'mask');
  registry.invalidate();
  registry.register('late-id', snapshot);
  assert.equal(registry.claim('late-id', 1), null);
});

test('older results cannot replace a newer accepted preview', () => {
  const registry = new InpaintResultRegistry();
  const older = registry.capture(1, 'old-mask');
  const newer = registry.capture(1, 'new-mask');
  assert.equal(registry.accept(newer, 1), true);
  assert.equal(registry.accept(older, 1), false);
});

test('source changes and duplicate completion events are rejected', () => {
  const registry = new InpaintResultRegistry();
  const snapshot = registry.capture(1, 'mask-at-submit');
  registry.register('job', snapshot);
  assert.equal(registry.claim('job', 2), null);
  assert.equal(registry.claim('job', 1)?.maskUrl, 'mask-at-submit');
  assert.equal(registry.claim('job', 1), null);
  assert.equal(registry.accept(snapshot, 2), false);
  registry.finish(snapshot);
  assert.equal(registry.accept(snapshot, 1), false);
});

test('successful finalization remains distinguishable from cancellation', () => {
  const registry = new InpaintResultRegistry();
  const snapshot = registry.capture(1, 'mask');
  assert.equal(registry.accept(snapshot, 1), true);
  registry.finish(snapshot);
  assert.equal(snapshot.accepted, true);
  assert.equal(snapshot.valid, false);
});
