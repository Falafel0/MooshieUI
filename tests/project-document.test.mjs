import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

// The document rules are pure: a plain transpile is enough to exercise them.
const code = ts.transpileModule(read('src/lib/utils/projectDocument.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const docs = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

/** A mask layer, so every case starts from the same honest shape. */
function maskLayer(overrides = {}) {
  return {
    name: 'Mask 1',
    type: 'mask',
    visible: true,
    opacity: 1,
    coverage: 1,
    locked: false,
    order: 0,
    spatialPng: 'data:image/png;base64,AAAA',
    ...overrides,
  };
}

function document_(overrides = {}) {
  const doc = docs.emptyDocument(1024, 768, '#101010');
  doc.layers = [maskLayer()];
  return { ...doc, ...overrides };
}

test('an empty document is a document, and the limits hold', () => {
  const doc = docs.emptyDocument(1024, 768, '#101010');
  assert.equal(docs.isProjectDocument(doc), true);
  assert.equal(doc.version, docs.PROJECT_DOCUMENT_VERSION);
  assert.deepEqual([doc.canvasWidth, doc.canvasHeight], [1024, 768]);
  assert.deepEqual(doc.layers, []);
  assert.equal(doc.backgroundColor, '#101010');
});

test('a document a run cannot open is rejected instead of half-loading', () => {
  assert.equal(docs.isProjectDocument(null), false);
  assert.equal(docs.isProjectDocument('not a document'), false);
  // A newer file than this build understands.
  assert.equal(docs.isProjectDocument(document_({ version: docs.PROJECT_DOCUMENT_VERSION + 1 })), false);
  // Sizes outside what the canvas can hold.
  assert.equal(docs.isProjectDocument(document_({ canvasWidth: 8 })), false);
  assert.equal(docs.isProjectDocument(document_({ canvasHeight: 40000 })), false);
  // Colours that are not colours.
  assert.equal(docs.isProjectDocument(document_({ backgroundColor: 'black' })), false);
  // Layers that are not a list, or not layers.
  assert.equal(docs.isProjectDocument(document_({ layers: 'none' })), false);
  assert.equal(docs.isProjectDocument(document_({ layers: [{ name: 'x', order: 0, type: 'layer' }] })), false);
});

test('a raster may not point at pixels that die with the session', () => {
  const raster = (src) =>
    document_({
      layers: [
        {
          name: 'Base',
          type: 'raster',
          visible: true,
          opacity: 1,
          locked: false,
          order: 0,
          image: { src, x: 0, y: 0, width: 1024, height: 768, rotation: 0, flipX: false, flipY: false },
        },
      ],
    });
  assert.equal(docs.isProjectDocument(raster('data:image/png;base64,AAAA')), true);
  assert.equal(docs.isProjectDocument(raster('https://example.test/a.png')), true);
  assert.equal(docs.isProjectDocument(raster('/tmp/a.png')), true);
  assert.equal(docs.isProjectDocument(raster('blob:http://localhost/deadbeef')), false);
  assert.equal(docs.isProjectDocument(raster('thumbnail://a.png')), false);
  assert.equal(docs.isProjectDocument(raster('file:///C:/a.png')), false);
});

test('canvas sides are clamped, not trusted', () => {
  assert.equal(docs.clampDocumentSize(1024), 1024);
  assert.equal(docs.clampDocumentSize(1024.4), 1024);
  assert.equal(docs.clampDocumentSize(1024.6), 1025);
  assert.equal(docs.clampDocumentSize(1), docs.DOCUMENT_MIN_SIZE);
  assert.equal(docs.clampDocumentSize(999999), docs.DOCUMENT_MAX_SIZE);
  assert.equal(docs.clampDocumentSize('nonsense'), docs.DOCUMENT_MIN_SIZE);
});

test('what a run reads changes the signature', () => {
  const base = docs.documentSignature(document_());
  const changed = [
    { coverage: 0.5 },
    { denoise: 0.55 },
    { densityDenoise: true },
    { maskGrow: 4 },
    { inpaintWidth: 1536 },
    { inpaintHeight: 1536 },
    { visible: false },
    { locked: true },
    { order: 3 },
    { name: 'Mask renamed' },
    { spatialPng: 'data:image/png;base64,AAAAAAAA' },
    { inpaintSettings: { mask_blur: 4 } },
  ];
  for (const override of changed) {
    const doc = document_({ layers: [maskLayer(override)] });
    assert.notEqual(
      docs.documentSignature(doc),
      base,
      `${JSON.stringify(override)} must count as a change to the document`,
    );
  }
  assert.notEqual(docs.documentSignature(document_(), 1), base, 'painted pixels must count');
  assert.notEqual(docs.documentSignature(document_({ canvasWidth: 2048 })), base);
});

test('what only changes how a layer looks is not a change to the document', () => {
  const base = docs.documentSignature(document_());
  // A mask's opacity is how it is drawn; its tint and the view are display too.
  for (const override of [{ opacity: 0.2 }, { tint: 'emerald' }, { showContext: false }]) {
    assert.equal(
      docs.documentSignature(document_({ layers: [maskLayer(override)] })),
      base,
      `${JSON.stringify(override)} is display only and must not mark the document dirty`,
    );
  }
  const moved = document_();
  moved.viewport = { zoom: 3, panX: 120, panY: -40 };
  assert.equal(docs.documentSignature(moved), base, 'moving the view is not an edit');
  // A raster's opacity is real: it is part of the picture.
  const rasterOf = (opacity) =>
    document_({
      layers: [
        {
          name: 'Base',
          type: 'raster',
          visible: true,
          opacity,
          locked: false,
          order: 0,
          image: { src: 'data:image/png;base64,AAAA', x: 0, y: 0, width: 1024, height: 768, rotation: 0, flipX: false, flipY: false },
        },
      ],
    });
  assert.notEqual(docs.documentSignature(rasterOf(0.5)), docs.documentSignature(rasterOf(1)));
});

test('settings travel with a document and compare by value', () => {
  assert.equal(docs.settingsSignature({ prompt: 'cat' }), docs.settingsSignature({ prompt: 'cat' }));
  assert.notEqual(docs.settingsSignature({ prompt: 'cat' }), docs.settingsSignature({ prompt: 'dog' }));
  assert.equal(docs.settingsSignature(null), 'none');
  const circular = {};
  circular.self = circular;
  assert.equal(docs.settingsSignature(circular), 'unreadable', 'a broken snapshot must not throw');
});
