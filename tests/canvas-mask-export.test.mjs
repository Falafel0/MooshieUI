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

test('opaque external-editor masks use brightness as coverage, while transparent masks retain alpha', () => {
  const opaque = new Uint8ClampedArray([0,0,0,255, 128,128,128,255, 255,255,255,255]);
  assert.equal(sandbox.exports.opaqueMaskLuminanceToAlpha(opaque), true);
  assert.deepEqual([opaque[3], opaque[7], opaque[11]], [0,128,255]);
  const transparent = new Uint8ClampedArray([0,0,0,0, 255,255,255,128]);
  assert.equal(sandbox.exports.opaqueMaskLuminanceToAlpha(transparent), false);
  assert.deepEqual([transparent[3], transparent[7]], [0,128]);
});

test('grayscale mask bounds follow the non-zero mask region', () => {
  const width = 6, height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, value] of [[2, 1, 64], [4, 1, 255], [3, 3, 128]]) {
    const offset = (y * width + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  const mask = { width, height, getContext: () => ({ getImageData: () => ({ data }) }) };
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.exports.grayscaleMaskBounds(mask))),
    { x: 2, y: 1, width: 3, height: 3 },
  );
});
