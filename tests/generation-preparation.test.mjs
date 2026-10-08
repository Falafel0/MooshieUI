import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/utils/generationPreparation.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { createGenerationPreparation, GenerationPreparationCancelled, onceWithinGenerationRun } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('multiple detectors share one Python verification only within their generation run', async () => {
  let calls = 0;
  const gate = deferred();
  const task = async () => { calls++; await gate.promise; return true; };
  const verify = onceWithinGenerationRun(task);
  const first = verify(), second = verify();
  assert.equal(first, second);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  await verify();
  assert.equal(calls, 1);
  await onceWithinGenerationRun(task)();
  assert.equal(calls, 2, 'A new generation verifies the current Python environment again');
});

test('failed verification is shared in its run but cannot poison a retry in another run', async () => {
  let calls = 0;
  const task = async () => { if (++calls === 1) throw new Error('Python unavailable'); return true; };
  const verify = onceWithinGenerationRun(task);
  await assert.rejects(verify(), /Python unavailable/);
  await assert.rejects(verify(), /Python unavailable/);
  assert.equal(calls, 1);
  assert.equal(await onceWithinGenerationRun(task)(), true);
});

test('cancel while dependencies wait prevents a later generation submission', async () => {
  let cancelled = false, submissions = 0;
  const gate = deferred();
  const phases = [];
  const preparation = createGenerationPreparation(() => cancelled, phase => phases.push(phase), { log() {} });
  const pending = (async () => {
    await preparation.wait('dependencies', () => gate.promise);
    await preparation.wait('submitting', async () => { submissions++; });
  })();
  cancelled = true;
  gate.resolve();
  await assert.rejects(pending, GenerationPreparationCancelled);
  assert.equal(submissions, 0);
  assert.deepEqual(phases, ['dependencies']);
});

test('a cancelled run never starts another awaited operation', async () => {
  let calls = 0;
  const preparation = createGenerationPreparation(() => true, () => {}, { log() {} });
  await assert.rejects(preparation.wait('submitting', async () => { calls++; }), GenerationPreparationCancelled);
  assert.equal(calls, 0);
});

test('phase timings report preparation and acceptance waits without prompt content', async () => {
  let clock = 100;
  const phases = [], logs = [];
  const preparation = createGenerationPreparation(() => false, phase => phases.push(phase), { now: () => clock, log: line => logs.push(line) });
  preparation.phase('inputs');
  clock = 140;
  await preparation.wait('submitting', async () => { clock = 225; return 'prompt-id'; });
  preparation.phase(null);
  clock = 250;
  preparation.finish();
  assert.deepEqual(phases, ['inputs', 'submitting', null]);
  assert.deepEqual(logs, ['[generate:prepare] inputs: 40 ms', '[generate:prepare] submitting: 85 ms', '[generate:prepare] finished: 125 ms preparation, 150 ms elapsed']);
});
