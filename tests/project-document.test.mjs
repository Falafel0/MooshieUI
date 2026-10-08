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
    id: 'mask-1',
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
          id: 'base',
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
          id: 'base',
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

test('v2 persists ids and groups while v1 documents without either remain readable', () => {
  const legacy = document_({ version: 1 });
  delete legacy.groups;
  delete legacy.layers[0].id;
  assert.equal(docs.isProjectDocument(legacy), true);
  const current = document_();
  assert.equal(current.version, 2);
  assert.deepEqual(current.groups, []);
  assert.equal(docs.isProjectDocument(current), true);
  assert.equal(docs.isProjectDocument({ ...current, groups: undefined }), false);
  assert.equal(docs.isProjectDocument({ ...current, layers: [{ ...current.layers[0], id: undefined }] }), false);
  assert.equal(docs.isProjectDocument({ ...current, layers: [current.layers[0], { ...current.layers[0] }] }), false);
  for (const groups of [
    [{ id: 'g', name: 'Group', visible: true }, { id: 'g', name: 'Duplicate', visible: true }],
    [{ id: 'g', name: 'Group', visible: 'yes' }],
    [{ id: '', name: 'Group', visible: true }],
    [{ id: 'g', name: 'Group', visible: true, collapsed: 'yes' }],
  ]) assert.equal(docs.isProjectDocument({ ...current, groups }), false);
  for (const version of [0, -1, 1.5, NaN]) assert.equal(docs.isProjectDocument({ ...current, version }), false);
});

test('serialized relations retain missing explicit references and empty scope without broadening', () => {
  const doc = document_({ groups: [{ id: 'face', name: 'Face', visible: true, collapsed: true }] });
  doc.layers = [
    maskLayer({ groupId: 'face', targetRasterId: 'missing-raster' }),
    { ...maskLayer(), id: 'pixels', type: 'raster', spatialPng: undefined, clippingMaskId: 'missing-mask', clippingEnabled: false },
    { ...maskLayer(), id: 'prompt', type: 'region', modifierScope: { mode: 'masks', maskIds: [] }, targetRasterId: 'missing-raster' },
  ];
  const stored = JSON.parse(JSON.stringify(doc));
  assert.equal(docs.isProjectDocument(stored), true, 'missing targets are repairable intent, not corrupt metadata');
  assert.equal(stored.layers[0].targetRasterId, 'missing-raster');
  assert.equal(stored.layers[1].clippingMaskId, 'missing-mask');
  assert.equal(stored.layers[1].clippingEnabled, false);
  assert.deepEqual(stored.layers[2].modifierScope.maskIds, []);
  assert.equal(stored.groups[0].collapsed, true);
  assert.equal(docs.isProjectDocument(document_({ layers: [maskLayer({ groupId: 'missing-group' })] })), true);
});

test('invalid relation roles and shapes are rejected before load', () => {
  for (const patch of [
    { referenceRasterId: 'pixels' },
    { clippingMaskId: 'another-mask' },
    { clippingEnabled: true },
    { targetRasterId: 12 },
    { groupId: '' },
    { modifierScope: { mode: 'document' } },
  ]) assert.equal(docs.isProjectDocument(document_({ layers: [maskLayer(patch)] })), false, JSON.stringify(patch));
  for (const modifierScope of [{ mode: 'bad' }, { mode: 'masks', maskIds: 'mask-1' }, { mode: 'masks', maskIds: [null] }]) {
    assert.equal(docs.isProjectDocument(document_({ layers: [maskLayer({ type: 'region', modifierScope })] })), false);
  }
});

test('groups and functional bindings change the signature, collapsed UI state does not', () => {
  const doc = document_({ groups: [{ id: 'face', name: 'Face', visible: true, collapsed: false }] });
  const baseline = docs.documentSignature(doc);
  const clone = () => JSON.parse(JSON.stringify(doc));
  const collapsed = clone();
  collapsed.groups[0].collapsed = true;
  assert.equal(docs.documentSignature(collapsed), baseline);
  for (const patch of [{ groupId: 'face' }, { targetRasterId: 'raster' }, { clippingMaskId: 'other-mask' }, { clippingEnabled: false }, { referenceRasterId: 'raster' }, { modifierScope: { mode: 'masks', maskIds: [] } }]) {
    const changed = clone();
    Object.assign(changed.layers[0], patch);
    assert.notEqual(docs.documentSignature(changed), baseline, JSON.stringify(patch));
  }
  for (const patch of [{ name: 'Face edited' }, { visible: false }, { id: 'face-new' }]) {
    const changed = clone();
    Object.assign(changed.groups[0], patch);
    assert.notEqual(docs.documentSignature(changed), baseline);
  }
});

test('raster paint preserves primitives, eraser ordering and transforms without baking generated clipping', () => {
  const node = (type, attrs, name = '') => ({ getClassName: () => type, getAttrs: () => attrs, hasName: value => value === name });
  const points = [2, 4, 10, 20];
  const raw = [
    node('Image', { image: {} }, 'raster-asset'),
    node('Line', { points, stroke: '#fff', strokeWidth: 12, lineCap: 'round', opacity: .7, globalCompositeOperation: 'source-over', listening: false }),
    node('Rect', { x: 4, y: 8, width: 12, height: 20, fill: '#e0c', scaleX: 2, scaleY: .5 }),
    node('Ellipse', { x: 8, y: 12, radiusX: 4, radiusY: 2, rotation: 15, fill: '#fff' }),
    node('Line', { points: [8, 8, 14, 20], stroke: '#000', strokeWidth: 5, globalCompositeOperation: 'destination-out' }),
    node('Image', { image: {} }, 'raster-clip-mask'),
  ];
  const paint = docs.captureRasterPaint(raw);
  assert.deepEqual(paint.map(command => command.type), ['Line', 'Rect', 'Ellipse', 'Line']);
  assert.equal(paint.at(-1).attrs.globalCompositeOperation, 'destination-out');
  assert.equal(paint[1].attrs.scaleX, 2);
  assert.equal(paint[0].attrs.listening, undefined);
  points[0] = 100;
  assert.equal(paint[0].attrs.points[0], 2, 'capture is a snapshot, not a live pointer to the stroke');
  const restored = docs.decodeRasterPaint(JSON.parse(JSON.stringify(paint)));
  assert.deepEqual(restored, paint);
  restored[0].attrs.points[0] = 200;
  assert.equal(paint[0].attrs.points[0], 2);
  const document = document_({ layers: [{ ...maskLayer(), type: 'raster', rasterPaint: paint }] });
  assert.equal(docs.isProjectDocument(document), true, 'a pure painted raster does not need an asset image');
  assert.equal(docs.isProjectDocument(document_({ layers: [maskLayer({ rasterPaint: paint })] })), false);
  const baseline = docs.documentSignature(document);
  document.layers[0].rasterPaint[0].attrs.stroke = '#abc';
  assert.notEqual(docs.documentSignature(document), baseline);
});

test('unsupported nodes or malformed paint cannot be quietly omitted from a saved raster', () => {
  const unknownImage = { getClassName: () => 'Image', getAttrs: () => ({ image: {} }), hasName: () => false };
  assert.throws(() => docs.captureRasterPaint([unknownImage]), /Cannot save raster paint node: Image/);
  for (const paint of [
    [{ type: 'Path', attrs: {} }],
    [{ type: 'Line', attrs: {} }],
    [{ type: 'Line', attrs: { points: [1, 2, 3] } }],
    [{ type: 'Line', attrs: { points: [1, NaN] } }],
    [{ type: 'Rect', attrs: { width: -1 } }],
    [{ type: 'Rect', attrs: { x: Infinity } }],
    [{ type: 'Ellipse', attrs: { opacity: 2 } }],
    [{ type: 'Rect', attrs: { globalCompositeOperation: 'made-up' } }],
    [{ type: 'Rect', attrs: { customFunction: 'unsupported' } }],
  ]) {
    assert.equal(docs.isRasterPaint(paint), false, JSON.stringify(paint));
    assert.equal(docs.decodeRasterPaint(paint), null);
  }
});

test('change snapshots detect nested edits without serializing embedded pixels', () => {
  const doc=document_(); doc.layers.push({ ...maskLayer({id:'control',type:'controlnet'}),controlnet:{enabled:true,model:'depth',image:'old.png',sourceData:'data:image/png;base64,'+'A'.repeat(8*1024*1024),sourcePlacement:{x:0,y:0,width:1024,height:768}} });
  Object.defineProperty(doc.layers[1].controlnet,'toJSON',{value(){throw new Error('pixel serialization is forbidden');}});
  const saved=docs.documentChangeSnapshot(doc,1);
  assert(docs.sameChangeSnapshot(saved,docs.documentChangeSnapshot(doc,1)));
  doc.layers[1].controlnet.image='new-session.png';doc.groups[0] = {id:'group',name:'Group',visible:true,collapsed:false};
  // Organization changes matter; session upload names alone do not.
  assert(!docs.sameChangeSnapshot(saved,docs.documentChangeSnapshot(doc,1)));
  doc.groups=[];
  assert(docs.sameChangeSnapshot(saved,docs.documentChangeSnapshot(doc,1)));
  doc.layers[1].controlnet.sourcePlacement.x=12;
  assert(!docs.sameChangeSnapshot(saved,docs.documentChangeSnapshot(doc,1)));
});

test('settings snapshots retain nested values and detect equal-length image replacements', () => {
  const settings={prompt:'forest',styles:[{thumbnail:'data:AAAA',artists:[{weight:.8}]}]};
  const before=docs.settingsChangeSnapshot(settings);
  settings.styles[0].artists[0].weight=.9;
  assert(!docs.sameChangeSnapshot(before,settings));settings.styles[0].artists[0].weight=.8;
  assert(docs.sameChangeSnapshot(before,settings));settings.styles[0].thumbnail='data:BBBB';
  assert(!docs.sameChangeSnapshot(before,settings));
});

test('resized document base and ControlNet placement must be durable and finite', () => {
  const base={src:'data:image/png;base64,AAAA',x:-32,y:48,width:1024,height:768,rotation:0,flipX:false,flipY:false};
  assert(docs.isProjectDocument(document_({baseImage:base})));
  for(const patch of [{src:'blob:expired'},{width:0},{height:Infinity},{x:NaN}])assert(!docs.isProjectDocument(document_({baseImage:{...base,...patch}})));
});
