import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/utils/canvasViewport.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { fittedCanvasViewport, viewportMatchesCanvasFit } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

test('fit centres a document with ten percent breathing room', () => {
  assert.deepEqual(fittedCanvasViewport(1000, 800, 1000, 500), {
    zoom: 0.9,
    panX: 50,
    panY: 175,
  });
});

test('a fitted viewport remains recognisable across reactive updates', () => {
  const fitted = fittedCanvasViewport(600, 500, 512, 512);
  assert.equal(viewportMatchesCanvasFit(fitted, 600, 500, 512, 512), true);
  assert.equal(viewportMatchesCanvasFit({ ...fitted, zoom: fitted.zoom * 1.2 }, 600, 500, 512, 512), false);
  assert.equal(viewportMatchesCanvasFit({ ...fitted, panX: fitted.panX + 12 }, 600, 500, 512, 512), false);
});

test('re-fitting a replacement base uses its new geometry', () => {
  const oldViewport = fittedCanvasViewport(600, 500, 512, 512);
  assert.equal(viewportMatchesCanvasFit(oldViewport, 600, 500, 512, 512), true);
  assert.deepEqual(fittedCanvasViewport(600, 500, 1200, 800), {
    zoom: 0.45,
    panX: 30,
    panY: 70,
  });
});
