import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const transpile = async path => ts.transpileModule(await readFile(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const source = await transpile('src/lib/utils/prepareControlnetLayers.ts');
const relationsSource = await transpile('src/lib/utils/layerRelations.ts');
const relationsContext = { exports: {} };
vm.runInNewContext(relationsSource, relationsContext);
const relations = relationsContext.exports;
const mask = (id = 'mask-a', overrides = {}) => ({ id, type: 'mask', visible: true, coverage: 1, ...overrides });
const control = (overrides = {}) => ({
  id: 'control-a', type: 'controlnet', visible: true,
  controlnet: { enabled: true, image: 'old-session.png', sourceData: 'data:image/png;base64,AQID' },
  ...overrides,
});
const raster = (overrides = {}) => ({ id: 'image-a', type: 'raster', visible: true, opacity: .75, image: { src: 'pixels.png', x: 5, y: 6 }, ...overrides });

function fixture(layers, hooks = {}) {
  const calls = { fetched: [], rendered: [], encoded: [], uploaded: [] };
  const canvas = {
    layers, groups: [], inpaintSourceVersion: 1, paintRevision: 0,
    exportRasterLayer: id => {
      calls.rendered.push(id);
      return hooks.render ? hooks.render(id, canvas) : { id, pixels: [8, 9] };
    },
  };
  const modules = {
    '../stores/canvas.svelte.js': { canvas },
    '../stores/locale.svelte.js': { locale: { t: key => key } },
    './api.js': { uploadImageBytes: async (bytes, name) => {
      calls.uploaded.push({ bytes, name });
      await hooks.upload?.(canvas);
      return { name: 'current-session.png' };
    } },
    './canvasLayerExport.js': { matteControlnetReference: pixels => pixels, canvasPngBytes: async pixels => {
      calls.encoded.push(pixels);
      await hooks.encode?.(canvas);
      return [8, 9];
    } },
    './layerRelations.js': relations,
  };
  const context = {
    exports: {}, Uint8Array, JSON, Error,
    require: path => { assert(path in modules, `Unexpected dependency ${path}`); return modules[path]; },
    fetch: async url => {
      calls.fetched.push(url);
      await hooks.fetch?.(canvas);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    },
  };
  vm.runInNewContext(source, context);
  return { canvas, calls, run: context.exports.prepareControlnetLayers };
}

test('durable uploaded references restore session filenames without editing source pixels', async () => {
  const original = control();
  const { canvas, calls, run } = fixture([mask(), original]);
  await run();
  assert.equal(calls.fetched[0], original.controlnet.sourceData);
  assert.deepEqual(Array.from(calls.uploaded[0].bytes), [1, 2, 3]);
  assert.equal(canvas.layers[1].controlnet.image, 'current-session.png');
  assert.equal(canvas.layers[1].controlnet.sourceData, original.controlnet.sourceData);
  assert.equal(original.controlnet.image, 'old-session.png');
});

test('a linked raster uses its rendered pixels rather than the unused uploaded reference', async () => {
  const linked = control({ referenceRasterId: 'image-a' });
  const { canvas, calls, run } = fixture([mask(), raster(), linked]);
  await run();
  assert.deepEqual(calls.rendered, ['image-a']);
  assert.equal(calls.fetched.length, 0);
  assert.deepEqual(Array.from(calls.uploaded[0].bytes), [8, 9]);
  assert.equal(canvas.layers[2].controlnet.image, 'current-session.png');
  assert.equal(canvas.layers[2].referenceRasterId, 'image-a');
});

test('disabled groups, zero targets and out-of-group automatic scopes do not upload unused controls', async () => {
  for (const change of [
    { visible: false },
    { controlnet: { enabled: false, sourceData: 'data:image/png;base64,AQID' } },
    { groupId: 'missing-group' },
    { groupId: 'portrait' },
    { modifierScope: { mode: 'masks', maskIds: [] } },
    { modifierScope: { mode: 'masks', maskIds: ['missing-mask'] } },
  ]) {
    const { canvas, calls, run } = fixture([mask(), control(change)]);
    canvas.groups = [{ id: 'portrait', name: 'Portrait', visible: true }];
    await run();
    assert.equal(calls.uploaded.length, 0, JSON.stringify(change));
  }
  const hidden = fixture([mask('mask-a', { groupId: 'portrait' }), control({ groupId: 'portrait' })]);
  hidden.canvas.groups = [{ id: 'portrait', name: 'Portrait', visible: false }];
  await hidden.run();
  assert.equal(hidden.calls.uploaded.length, 0);
  const zeroCoverage = fixture([mask('mask-a', { coverage: 0 }), control()]);
  await zeroCoverage.run();
  assert.equal(zeroCoverage.calls.uploaded.length, 0);
});

test('automatic grouped and explicit document scopes prepare applicable references', async () => {
  const grouped = fixture([mask('mask-a', { groupId: 'portrait' }), control({ groupId: 'portrait' })]);
  grouped.canvas.groups = [{ id: 'portrait', name: 'Portrait', visible: true }];
  await grouped.run();
  assert.equal(grouped.calls.uploaded.length, 1);
  const document = fixture([mask(), control({ groupId: 'portrait', modifierScope: { mode: 'document' } })]);
  document.canvas.groups = [{ id: 'portrait', name: 'Portrait', visible: true }];
  await document.run();
  assert.equal(document.calls.uploaded.length, 1);
});

test('missing or wrong-role linked references fail instead of using the uploaded fallback', async () => {
  for (const layers of [[mask(), control({ referenceRasterId: 'missing' })], [mask(), control({ referenceRasterId: 'mask-a' })]]) {
    const { calls, run } = fixture(layers);
    await assert.rejects(run(), /canvas.missing_connection/);
    assert.equal(calls.fetched.length, 0);
    assert.equal(calls.uploaded.length, 0);
  }
  const renderFailed = fixture([mask(), raster(), control({ referenceRasterId: 'image-a' })], { render: () => null });
  await assert.rejects(renderFailed.run(), /canvas.missing_connection/);
  assert.equal(renderFailed.calls.fetched.length, 0);
});

test('changes while encoding linked pixels cancel before upload', async () => {
  for (const edit of [
    canvas => { canvas.inpaintSourceVersion++; },
    canvas => { canvas.paintRevision++; },
    canvas => { canvas.layers = canvas.layers.filter(layer => layer.id !== 'image-a'); },
    canvas => { canvas.layers = canvas.layers.map(layer => layer.id === 'image-a' ? { ...layer, image: { ...layer.image, x: 20 } } : layer); },
    canvas => { canvas.layers = canvas.layers.map(layer => layer.id === 'control-a' ? { ...layer, modifierScope: { mode: 'masks', maskIds: [] } } : layer); },
  ]) {
    const { canvas, calls, run } = fixture([mask(), raster(), control({ referenceRasterId: 'image-a' })], { encode: edit });
    await assert.rejects(run(), /generation.controlnet.reference_changed/);
    assert.equal(calls.uploaded.length, 0);
    assert.equal(canvas.layers.find(layer => layer.type === 'controlnet').controlnet.image, 'old-session.png');
  }
});

test('changes while uploading preserve the previous server filename', async () => {
  for (const edit of [
    canvas => { canvas.layers = canvas.layers.map(layer => layer.id === 'control-a' ? { ...layer, controlnet: { ...layer.controlnet, sourceData: 'data:image/png;base64,BAUG' } } : layer); },
    canvas => { canvas.groups = [{ id: 'portrait', name: 'Portrait', visible: false }]; },
    canvas => { canvas.layers = canvas.layers.map(layer => layer.id === 'image-a' ? { ...layer, clippingMaskId: 'mask-a', clippingEnabled: true } : layer); },
  ]) {
    const linked = control({ referenceRasterId: 'image-a' });
    const { canvas, run } = fixture([mask(), raster(), linked], { upload: edit });
    await assert.rejects(run(), /generation.controlnet.reference_changed/);
    assert.equal(canvas.layers.find(layer => layer.type === 'controlnet').controlnet.image, 'old-session.png');
  }
});
