import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/utils/denoising.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { normalizeDenoise, effectiveGenerationDenoise } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('denoise imports preserve zero and fractions, clamp out-of-range values, and ignore non-finite values', () => {
  assert.deepEqual([0, 0.42, 1, -0.1, 1.2].map(value => normalizeDenoise(value)), [0, 0.42, 1, 0, 1]);
  for (const value of [NaN, Infinity, -Infinity, null, undefined, '0.42']) {
    assert.equal(normalizeDenoise(value, 0.31), 0.31);
  }
});

test('generation metadata reports the denoise actually used by each mode', () => {
  assert.equal(effectiveGenerationDenoise('img2img', 0.42), 0.42);
  assert.equal(effectiveGenerationDenoise('inpainting', 0), 0);
  assert.equal(effectiveGenerationDenoise('txt2img', 0.42), 1);
  assert.equal(effectiveGenerationDenoise('image_edit', 0.42), 1);
});
