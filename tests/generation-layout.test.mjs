import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/utils/generationLayout.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { GENERATION_SECTIONS, normalizeGenerationSections } = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
test('the default workspace places sources and intent before composition', () => {
  const visible = mode => GENERATION_SECTIONS.filter(id => !['imageInputs', 'imageEdit'].includes(id) || (id === 'imageInputs' ? mode === 'img2img' : mode === 'image_edit'));
  assert.deepEqual(visible('txt2img').slice(0,2), ['prompts','dimensions']);
  assert.deepEqual(visible('img2img').slice(0,3), ['imageInputs','prompts','dimensions']);
  assert.deepEqual(visible('image_edit').slice(0,3), ['imageEdit','prompts','dimensions']);
});
test('legacy untouched default order migrates to the semantic workspace order', () => {
  const old = ['dimensions','prompts','imageInputs','imageEdit',...GENERATION_SECTIONS.slice(4)];
  assert.deepEqual(normalizeGenerationSections(old, true), GENERATION_SECTIONS);
  assert.deepEqual(normalizeGenerationSections(old), old);
});
test('explicit custom order survives migration and legacy modelSampler expands in place', () => {
  const order = normalizeGenerationSections(['sampler','dimensions','model','prompts']);
  assert.deepEqual(order.slice(0,4), ['sampler','dimensions','model','prompts']);
  assert.deepEqual(normalizeGenerationSections(['modelSampler','prompts']).slice(0,3), ['model','sampler','prompts']);
});
test('corrupt orders discard duplicates and unsupported entries, then recover every section', () => {
  for (const order of [null, {}, ['prompts','prompts',null,42,'removed']]) {
    const normalized = normalizeGenerationSections(order);
    assert.equal(normalized.length, GENERATION_SECTIONS.length);
    assert.equal(new Set(normalized).size, GENERATION_SECTIONS.length);
    assert(normalized.every(id => GENERATION_SECTIONS.includes(id)));
  }
});
