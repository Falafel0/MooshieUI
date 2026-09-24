import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/utils/canvasLayerExport.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const sandbox = {
  exports: {},
  document: { createElement: () => {
    const output = { pixels: null };
    output.getContext = () => ({ putImageData: (pixels) => { output.pixels = pixels; } });
    return output;
  } },
};
vm.runInNewContext(code, sandbox);

test('mask export preserves soft coverage independently of tint', () => {
  const source = {
    width: 4, height: 1,
    getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([
      255, 0, 0, 0, 0, 255, 0, 64, 0, 0, 255, 128, 123, 45, 67, 255,
    ]) }) }),
  };
  const output = sandbox.exports.maskToGrayscale(source);
  assert.deepEqual(Array.from(output.pixels.data), [
    0, 0, 0, 255, 64, 64, 64, 255, 128, 128, 128, 255, 255, 255, 255, 255,
  ]);
});

test('blank mask does not produce a generation mask', () => {
  const source = { width: 1, height: 1, getContext: () => ({
    getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 0]) }),
  }) };
  assert.equal(sandbox.exports.maskToGrayscale(source), null);
});
