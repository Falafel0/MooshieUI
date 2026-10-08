import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const transpile = async path => ts.transpileModule(await readFile(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const source = await transpile('src/lib/utils/prepareControlnetLayers.ts');
const documentReferenceSource = await transpile('src/lib/utils/documentControlnetReference.ts');
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
  const calls = { fetched: [], rendered: [], encoded: [], uploaded: [], placed: [] };
  const canvas = {
    layers, groups: [], inpaintSourceVersion: 1, paintRevision: 0, canvasWidth: 1024, canvasHeight: 768,
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
      await hooks.upload?.(canvas, name);
      return { name: hooks.filename?.(name) ?? 'current-session.png' };
    } },
    './canvasLayerExport.js': { matteControlnetReference: pixels => pixels, canvasPngBytes: async pixels => {
      calls.encoded.push(pixels);
      await hooks.encode?.(canvas);
      return [8, 9];
    } },
    './layerRelations.js': relations,
    './canvasResize.js': { placedControlnetReference: (image, placement, width, height) => {
      calls.placed.push({ image, placement, width, height });
      return { placement, width, height };
    } },
  };
  const context = {
    exports: {}, Uint8Array, JSON, Error,
    Image: class { set src(source) { this.source = source; queueMicrotask(() => this.onload()); } },
    require: path => { assert(path in modules, `Unexpected dependency ${path}`); return modules[path]; },
    fetch: async url => {
      calls.fetched.push(url);
      await hooks.fetch?.(canvas);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    },
  };
  const referenceContext = { ...context, exports: {} };
  vm.runInNewContext(documentReferenceSource, referenceContext);
  modules['./documentControlnetReference.js'] = referenceContext.exports;
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
    canvas => { canvas.layers.find(layer => layer.id === 'image-a').image.flipX = true; },
    canvas => { canvas.layers.find(layer => layer.id === 'image-a').image.flipY = true; },
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

test('two controls linked to the same raster share export, encoding and upload', async () => {
  const { canvas, calls, run } = fixture([mask(), raster(), control({ referenceRasterId: 'image-a' }), control({ id: 'control-b', referenceRasterId: 'image-a' })]);
  await run();
  assert.deepEqual(calls.rendered, ['image-a']);
  assert.equal(calls.encoded.length, 1); assert.equal(calls.uploaded.length, 1);
  assert.deepEqual(canvas.layers.filter(layer => layer.type === 'controlnet').map(layer => layer.controlnet.image), ['current-session.png', 'current-session.png']);
});

test('identical durable sources share a fresh upload on each generation run', async () => {
  const { calls, run } = fixture([mask(), control(), control({ id: 'control-b' })]);
  await run(); assert.equal(calls.fetched.length, 1); assert.equal(calls.uploaded.length, 1);
  await run(); assert.equal(calls.fetched.length, 2); assert.equal(calls.uploaded.length, 2);
});

test('independent sources upload concurrently with at most two in flight', async () => {
  const controls = ['a', 'b', 'c', 'd'].map(id => control({ id: `control-${id}`, controlnet: { enabled: true, sourceData: `data:${id}`, image: 'old-session.png' } }));
  let active = 0, maximum = 0;
  const pending = [], waiters = [];
  const { calls, run } = fixture([mask(), ...controls], { upload: () => new Promise(resolve => {
    active++; maximum = Math.max(maximum, active);
    pending.push(() => { active--; resolve(); });
    waiters.splice(0).forEach(resolve => resolve());
  }) });
  const started = run();
  async function waitForUploads(count) { while (calls.uploaded.length < count) await new Promise(resolve => waiters.push(resolve)); }
  await waitForUploads(2); assert.equal(active, 2);
  pending.shift()(); await waitForUploads(3); assert.equal(active, 2);
  pending.shift()(); await waitForUploads(4); assert.equal(active, 2);
  pending.splice(0).forEach(release => release()); await started;
  assert.equal(maximum, 2); assert.equal(calls.uploaded.length, 4);
});

test('a failed or changed source never partially commits uploaded filenames', async () => {
  for (const failure of ['throw', 'change']) {
    const { canvas, run } = fixture([mask(), control(), control({ id: 'control-b', controlnet: { enabled: true, image: 'old-session.png', sourceData: 'data:other' } })], {
      upload: (state, name) => {
        if (name !== 'control-control-b.png') return;
        if (failure === 'throw') throw new Error('upload failed');
        state.canvasWidth++;
      },
    });
    await assert.rejects(run(), failure === 'throw' ? /upload failed/ : /reference_changed/);
    assert(canvas.layers.filter(layer => layer.type === 'controlnet').every(layer => layer.controlnet.image === 'old-session.png'));
  }
});

test('a resized own reference is rendered into full document pixels while linked rasters ignore placement', async () => {
  const placement = { x: 128, y: 96, width: 512, height: 384 };
  const own = fixture([mask(), control({ controlnet: { enabled: true, sourceData: 'data:own', sourcePlacement: placement } })]);
  await own.run();
  assert.equal(own.calls.placed.length, 1);
  assert.deepEqual({ ...own.calls.placed[0].placement }, placement);
  assert.equal(own.calls.placed[0].width, 1024); assert.equal(own.calls.placed[0].height, 768);
  assert.equal(own.calls.fetched.length, 0);
  const linked = fixture([mask(), raster(), control({ referenceRasterId: 'image-a', controlnet: { enabled: true, sourceData: 'data:own', sourcePlacement: placement } })]);
  await linked.run(); assert.equal(linked.calls.placed.length, 0); assert.deepEqual(linked.calls.rendered, ['image-a']);
});

test('shared image pixels with different placements require separate uploads', async () => {
  const { calls, run } = fixture([mask(), ...[0, 32].map((x, i) => control({ id: `control-${i}`, controlnet: { enabled: true, sourceData: 'data:shared', sourcePlacement: { x, y: 0, width: 512, height: 512 } } }))]);
  await run(); assert.equal(calls.placed.length, 2); assert.equal(calls.uploaded.length, 2);
});
