// The mask target: what a user painted in an external editor has to come back as
// the mask.
//
// The fixtures are recorded from real editor output, not synthesised: the pair
// below is a document that was handed to the editor, saved back after one blob
// was painted, and read unchanged (byte-identical) when it was not saved at all.
// The defect these pin down was measured on that output — reading coverage from
// luminance turned a photograph into a mask of its own brightness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/utils/canvasLayerExport.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const sandbox = {
  exports: {},
  document: { createElement: () => ({ getContext: () => ({ putImageData: () => {} }) }) },
};
vm.runInNewContext(code, sandbox);
const { paintedCoverageToAlpha, opaqueMaskLuminanceToAlpha } = sandbox.exports;

/** Decode a fixture to RGBA the way a canvas would, so the helpers see the same
 * pixels the app hands them. */
function decode(file) {
  const buf = fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url));
  let pos = 8, ihdr = null, idat = Buffer.alloc(0);
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = body;
    if (type === 'IDAT') idat = Buffer.concat([idat, body]);
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4);
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr[9]];
  const raw = zlib.inflateSync(idat);
  const stride = width * bpp;
  const lines = [];
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    if (f === 1) for (let i = bpp; i < stride; i++) line[i] = (line[i] + line[i - bpp]) & 255;
    else if (f === 2) for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 255;
    else if (f === 3) for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255;
    } else if (f === 4) for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
      line[i] = (line[i] + pr) & 255;
    }
    lines.push(line); prev = line;
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * width * 4 + x * 4;
      const s = x * bpp;
      data[o] = lines[y][s];
      data[o + 1] = lines[y][s + 1];
      data[o + 2] = lines[y][s + 2];
      data[o + 3] = bpp === 4 ? lines[y][s + 3] : 255;
    }
  }
  return { width, height, data };
}

const alpha = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

test('one painted blob comes back as the mask, not as the picture brightness', () => {
  const original = decode('patchy-photo-original.png');
  const edited = decode('patchy-photo-painted.png');
  const painted = paintedCoverageToAlpha(original.data, edited.data);
  assert.equal(painted, true, 'a painted document must report a selection');
  assert.equal(alpha(edited, 12, 12), 255, 'inside the painted blob');
  assert.equal(alpha(edited, 2, 24), 0, 'unpainted dark area must stay out');
  assert.equal(alpha(edited, 60, 24), 0, 'unpainted bright area must stay out');
  assert.equal(alpha(edited, 32, 40), 0, 'unpainted mid area must stay out');
});

test('the luminance shortcut would have contaminated that very document', () => {
  const edited = decode('patchy-photo-painted.png');
  assert.equal(opaqueMaskLuminanceToAlpha(edited.data), true);
  assert.notEqual(alpha(edited, 60, 24), 0,
    'bright unpainted pixels would have become mask coverage — this is why coverage is read from the change');
});

test('an unsaved document paints nothing and is reported as such', () => {
  const original = decode('patchy-photo-original.png');
  const alsoOriginal = decode('patchy-photo-original.png');
  assert.equal(paintedCoverageToAlpha(original.data, alsoOriginal.data), false);
  assert.equal(alpha(alsoOriginal, 12, 12), 0);
});

test('a black-on-white mask document still converts by luminance', () => {
  const mask = decode('patchy-mask-black-white.png');
  assert.equal(opaqueMaskLuminanceToAlpha(mask.data), true);
  assert.equal(alpha(mask, 12, 12), 255, 'painted area is covered');
  assert.equal(alpha(mask, 40, 30), 0, 'untouched area is not');
});

test('painted coverage reads as a mask layer, not as a photograph', () => {
  const original = decode('patchy-photo-original.png');
  const edited = decode('patchy-photo-painted.png');
  paintedCoverageToAlpha(original.data, edited.data);
  const o = (12 * edited.width + 12) * 4;
  assert.deepEqual(Array.from(edited.data.slice(o, o + 4)), [255, 255, 255, 255]);
  const p = (40 * edited.width + 40) * 4;
  assert.deepEqual(Array.from(edited.data.slice(p, p + 4)), [0, 0, 0, 0]);
});

test('a resized edit is refused instead of masking the whole canvas', () => {
  const original = decode('patchy-photo-original.png');
  // Same document, handed back one pixel wider: nothing lines up any more.
  assert.equal(
    sandbox.exports.canComparePaintedCoverage(
      { width: original.width, height: original.height },
      { width: original.width, height: original.height },
    ),
    true,
  );
  assert.equal(
    sandbox.exports.canComparePaintedCoverage(
      { width: original.width, height: original.height },
      { width: original.width + 1, height: original.height },
    ),
    false,
  );
  assert.equal(
    sandbox.exports.canComparePaintedCoverage(
      { width: 0, height: original.height },
      { width: 0, height: original.height },
    ),
    false,
    'a document with no size cannot be compared',
  );
});

test('the layer properties read the painted bounds, not the picture bounds', () => {
  const original = decode('patchy-photo-original.png');
  const edited = decode('patchy-photo-painted.png');
  paintedCoverageToAlpha(original.data, edited.data);
  // grayscaleMaskBounds() takes the layer canvas; stand in for it with the
  // pixels the mask layer is built from.
  const layer = {
    width: edited.width,
    height: edited.height,
    getContext: () => ({ getImageData: () => ({ data: edited.data, width: edited.width, height: edited.height }) }),
  };
  const bounds = sandbox.exports.grayscaleMaskBounds(layer);
  // Field by field: the helper runs in a VM context, so its object has a
  // different prototype and would fail a strict deep comparison on that alone.
  assert.deepEqual(
    { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    { x: 8, y: 8, width: 24, height: 16 },
  );
});

test('a soft brush stroke becomes the mask without picking up the picture', () => {
  const original = decode('patchy-photo-original.png');
  const brushed = decode('patchy-photo-brushed.png');
  assert.equal(paintedCoverageToAlpha(original.data, brushed.data), true);

  let covered = 0, minY = brushed.height, maxY = -1;
  for (let y = 0; y < brushed.height; y++) {
    for (let x = 0; x < brushed.width; x++) {
      if (brushed.data[(y * brushed.width + x) * 4 + 3] === 0) continue;
      covered++;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  assert.ok(covered > 400, `a full-width stroke covers the picture (${covered} pixels)`);
  // The fixture is a stroke at y=24 with size 12, so a mask that reached outside
  // that band would be reading the photograph's brightness, not the paint.
  assert.ok(minY >= 14 && maxY <= 34, `coverage stays on the stroke (rows ${minY}..${maxY})`);
});

test('the coverage is exactly the painted rectangle, edge to edge', () => {
  const original = decode('patchy-photo-original.png');
  const edited = decode('patchy-photo-painted.png');
  paintedCoverageToAlpha(original.data, edited.data);
  let count = 0, minX = edited.width, minY = edited.height, maxX = -1, maxY = -1;
  for (let y = 0; y < edited.height; y++) {
    for (let x = 0; x < edited.width; x++) {
      if (edited.data[(y * edited.width + x) * 4 + 3] === 0) continue;
      count++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  assert.equal(count, 24 * 16, 'the painted rectangle and nothing else');
  assert.deepEqual([minX, minY, maxX, maxY], [8, 8, 31, 23], 'at the coordinates the user painted');
});
