import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/utils/layerAlpha.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
} }).outputText;
const {
  restrictGenerationMaskToRasterAlpha,
  applySpatialMaskToRasterAlpha,
} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const rgba = (values, width = values.length / 4, height = 1) => ({
  data: new Uint8ClampedArray(values), width, height,
});

test('generation restriction multiplies fractional coverage without raster RGB leakage', () => {
  const mask = rgba([
    255, 255, 255, 255,
    128, 128, 128, 255,
    64, 64, 64, 255,
    0, 0, 0, 255,
  ]);
  const raster = rgba([
    255, 30, 70, 0,
    0, 240, 45, 128,
    180, 0, 255, 255,
    255, 255, 255, 255,
  ]);
  assert.deepEqual(Array.from(restrictGenerationMaskToRasterAlpha(mask, raster)), [
    0, 0, 0, 255,
    64, 64, 64, 255,
    64, 64, 64, 255,
    0, 0, 0, 255,
  ]);
});

test('generation restriction uses intrinsic alpha independently of raster display settings', () => {
  const mask = rgba([255, 255, 255, 255, 127, 127, 127, 255]);
  const raster = {
    ...rgba([10, 20, 30, 128, 40, 50, 60, 128]),
    opacity: 0,
    visible: false,
    clipToLayerId: 'another-layer',
  };
  assert.deepEqual(Array.from(restrictGenerationMaskToRasterAlpha(mask, raster)), [
    128, 128, 128, 255,
    64, 64, 64, 255,
  ]);
});

test('spatial clipping preserves raster RGB and reads raw mask alpha rather than luminance', () => {
  const raster = rgba([
    10, 20, 30, 255,
    40, 50, 60, 128,
    70, 80, 90, 255,
    100, 110, 120, 0,
  ]);
  const mask = {
    ...rgba([
      0, 0, 0, 255,
      255, 0, 100, 128,
      255, 255, 255, 0,
      255, 255, 255, 255,
    ]),
    visible: false,
    coverage: 0,
    opacity: 0,
  };
  assert.deepEqual(Array.from(applySpatialMaskToRasterAlpha(raster, mask)), [
    10, 20, 30, 255,
    40, 50, 60, 64,
    70, 80, 90, 0,
    100, 110, 120, 0,
  ]);
});

test('alpha multiplication rounds partial coverage rather than truncating it', () => {
  const raster = rgba([10, 20, 30, 1, 40, 50, 60, 254]);
  const mask = rgba([0, 0, 0, 128, 0, 0, 0, 1]);
  assert.deepEqual(Array.from(applySpatialMaskToRasterAlpha(raster, mask)), [
    10, 20, 30, 1,
    40, 50, 60, 1,
  ]);
  assert.deepEqual(Array.from(restrictGenerationMaskToRasterAlpha(
    rgba([1, 1, 1, 255, 254, 254, 254, 255]),
    rgba([0, 0, 0, 128, 0, 0, 0, 1]),
  )), [1, 1, 1, 255, 1, 1, 1, 255]);
});

test('both operations leave inputs unchanged and return independently owned pixel arrays', () => {
  const mask = rgba([128, 128, 128, 255, 0, 0, 0, 0]);
  const raster = rgba([11, 22, 33, 128, 44, 55, 66, 255]);
  const originalMask = Array.from(mask.data);
  const originalRaster = Array.from(raster.data);
  for (const output of [
    restrictGenerationMaskToRasterAlpha(mask, raster),
    applySpatialMaskToRasterAlpha(raster, mask),
  ]) {
    assert.ok(output instanceof Uint8ClampedArray);
    assert.notEqual(output.buffer, mask.data.buffer);
    assert.notEqual(output.buffer, raster.data.buffer);
    output.fill(99);
    assert.deepEqual(Array.from(mask.data), originalMask);
    assert.deepEqual(Array.from(raster.data), originalRaster);
  }
});

test('pixel views with non-zero offsets retain their ordering without resampling', () => {
  const backing = new Uint8ClampedArray([
    200, 200, 200, 200,
    255, 255, 255, 255,
    128, 128, 128, 255,
    0, 0, 0, 255,
    0, 0, 0, 128,
    77, 77, 77, 77,
  ]);
  const before = Array.from(backing);
  const mask = { data: backing.subarray(4, 12), width: 2, height: 1 };
  const raster = { data: backing.subarray(12, 20), width: 2, height: 1 };
  assert.deepEqual(Array.from(restrictGenerationMaskToRasterAlpha(mask, raster)), [
    255, 255, 255, 255,
    64, 64, 64, 255,
  ]);
  assert.deepEqual(Array.from(backing), before);
});

test('equal byte counts with different image shapes are rejected', () => {
  const horizontal = rgba([0, 0, 0, 255, 0, 0, 0, 255], 2, 1);
  const vertical = rgba([0, 0, 0, 255, 0, 0, 0, 255], 1, 2);
  for (const operation of [restrictGenerationMaskToRasterAlpha, applySpatialMaskToRasterAlpha]) {
    assert.throws(() => operation(horizontal, vertical), /same dimensions/);
    assert.throws(() => operation(horizontal, rgba([0, 0, 0, 255])), /same dimensions/);
  }
});

test('malformed RGBA buffers and invalid dimensions fail before either input can be modified', () => {
  const valid = rgba([12, 34, 56, 128]);
  const invalidImages = [
    { data: new Uint8ClampedArray(3), width: 1, height: 1 },
    { data: new Uint8ClampedArray(8), width: 1, height: 1 },
    { data: new Uint8ClampedArray(4), width: 0, height: 1 },
    { data: new Uint8ClampedArray(4), width: -1, height: 1 },
    { data: new Uint8ClampedArray(4), width: 1.5, height: 1 },
    { data: new Uint8ClampedArray(4), width: 1, height: NaN },
    { data: new Uint8ClampedArray(4), width: Number.MAX_SAFE_INTEGER, height: 2 },
  ];
  for (const operation of [restrictGenerationMaskToRasterAlpha, applySpatialMaskToRasterAlpha]) {
    for (const invalid of invalidImages) {
      assert.throws(() => operation(valid, invalid), RangeError);
      assert.throws(() => operation(invalid, valid), RangeError);
    }
    assert.throws(() => operation(valid, { data: [0, 0, 0, 255], width: 1, height: 1 }), TypeError);
  }
  assert.deepEqual(Array.from(valid.data), [12, 34, 56, 128]);
});
