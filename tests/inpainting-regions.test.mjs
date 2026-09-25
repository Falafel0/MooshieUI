import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const fixture = globalThis.__inpaintingRegionsTest = {
  canvas: { isCanvasMode: true, layers: [], sortedLayers: [] },
  generation: { mode: 'inpainting', isAnima: true },
  locale: { t: (key) => key },
};
const source = fs.readFileSync(new URL('../src/lib/utils/inpaintingRegions.ts', import.meta.url), 'utf8');
let code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} }).outputText;
code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g,
  (_, names) => `const {${names}} = globalThis.__inpaintingRegionsTest;`);
const { hasSequentialInpaintRegionMask } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('Anima accepts a painted prompt region as the only sequential inpaint mask', () => {
  fixture.canvas.layers = [{ id: 'region-1', type: 'region', visible: true, opacity: 1, regionalPrompt: 'red hair' }];
  fixture.canvas.sortedLayers = fixture.canvas.layers;
  assert.equal(hasSequentialInpaintRegionMask(), true);
  fixture.generation.isAnima = false;
  assert.equal(hasSequentialInpaintRegionMask(), false);
  fixture.generation.isAnima = true;
  fixture.canvas.layers = [{ ...fixture.canvas.layers[0], visible: false }];
  fixture.canvas.sortedLayers = fixture.canvas.layers;
  assert.equal(hasSequentialInpaintRegionMask(), false);
});
