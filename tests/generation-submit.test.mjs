import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const fixture = globalThis.__submissionTest = {};
const source = fs.readFileSync(new URL('../src/lib/utils/generationSubmit.ts', import.meta.url), 'utf8');
let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (_, names) => `const {${names}} = globalThis.__submissionTest;`);
let cancelled = false;
const calls = [];
Object.assign(fixture, {
  generate: async () => { cancelled = true; return { prompt_id: 'late', seed: '42' }; },
  novelaiGenerate: async () => ({ prompt_id: 'novel', seed: '7' }),
  isNovelAiModel: model => model === 'novel',
  interruptGeneration: async id => { calls.push(['cancel', id]); },
  progress: { enqueue: id => calls.push(['track', id]), updateQueuePosition() {} },
});
const { submitGeneration } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
test('late submission after cancellation is interrupted without creating a ghost queue entry', async () => {
  calls.length = 0; cancelled = false;
  await assert.rejects(submitGeneration({checkpoint:'local'}, {isCancelled:()=>cancelled}), /cancelled/);
  assert.deepEqual(calls, [['cancel','late']]);
});
test('snapshot registration precedes queue tracking', async () => {
  calls.length = 0;
  const params={checkpoint:'novel'};
  assert.equal(await submitGeneration(params,{beforeTrack:id=>calls.push(['snapshot',id])}),'novel');
  assert.deepEqual(calls,[['snapshot','novel'],['track','novel']]);
  assert.equal(params.seed,'7');
});
