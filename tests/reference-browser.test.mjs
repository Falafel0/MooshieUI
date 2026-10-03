import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/components/generation/ReferenceBrowser.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const code = ts.transpileModule(source + '\nmodule.exports = { importImage };', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness(overrides = {}) {
  const events = [];
  let destroy;
  const bitmap = { width: 32, height: 24, close: () => events.push('close') };
  const generation = {
    saveSettings: () => events.push('save'),
    setModeInput: (...args) => events.push(['input', ...args]),
    setMode: mode => events.push(['mode', mode]),
  };
  const canvas = { addRasterImage: async (...args) => { events.push(['raster', ...args]); return 'layer'; }, ...overrides.canvas };
  const api = {
    loadAnimaSourceImage: async () => [1],
    uploadImageBytes: async () => ({name:'image.png'}),
    ...overrides.api,
  };
  const modules = {
    '../../stores/locale.svelte.js': { locale:{t:key=>key} },
    '../../stores/generation.svelte.js': {generation},
    '../../stores/canvas.svelte.js': {canvas},
    '../../stores/autocomplete.svelte.js': {autocomplete:{tags:[]}},
    '../../utils/api.js': api,
    '../../utils/animaIntegration.js': {},
    svelte: {onDestroy: callback => {destroy = callback;}},
  };
  const module = {exports:{}};
  vm.runInNewContext(code, {
    module, exports: module.exports, require: name => { assert.ok(modules[name], name); return modules[name]; },
    $state:value=>value, $derived:value=>value, $props:()=>({onUseGeneration:()=>events.push('handoff')}),
    Blob, Uint8Array,
    createImageBitmap: overrides.decode ?? (async () => bitmap),
    document: {createElement:() => ({getContext:()=>({drawImage:()=>events.push('draw')}),toDataURL:()=>'data:image/png;base64,AQ=='})},
    fetch: async () => ({arrayBuffer:async()=>new Uint8Array([2]).buffer}),
  });
  return {importImage:module.exports.importImage, destroy:()=>destroy(), events, bitmap};
}
const entry = {id:'1', name:'Reference', image:'https://example.test/reference.png'};
const flush = () => new Promise(resolve => setImmediate(resolve));

test('reference decoding after close releases the bitmap without importing', async () => {
  const decoded = deferred();
  const h = harness({decode:()=>decoded.promise});
  const importTask = h.importImage(entry, true);
  await flush(); h.destroy(); decoded.resolve(h.bitmap);
  await importTask;
  assert.deepEqual(h.events, ['close']);
});

test('reference raster import checks that the request is current at layer insertion', async () => {
  const ready = deferred();
  const h = harness({canvas:{addRasterImage:async (_src, _name, type, current) => {
    assert.equal(type, 'raster');
    await ready.promise;
    assert.equal(current(), false);
    return '';
  }}});
  const importTask = h.importImage(entry, true);
  await flush(); h.destroy(); ready.resolve();
  await importTask;
  assert.deepEqual(h.events, ['draw', 'close']);
});

test('closing during upload leaves generation input unchanged', async () => {
  const upload = deferred();
  const h = harness({api:{uploadImageBytes:()=>upload.promise}});
  const importTask = h.importImage(entry, false);
  await flush(); h.destroy(); upload.resolve({name:'late.png'});
  await importTask;
  assert.deepEqual(h.events, ['draw', 'close']);
});

test('a current reference upload selects img2img and persists the handoff', async () => {
  const h = harness();
  await h.importImage(entry, false);
  assert.equal(h.events[2][0], 'input');
  assert.equal(h.events[2][1], 'img2img');
  assert.equal(h.events[2][2].input, 'image.png');
  assert.equal(h.events[2][2].aspect.w, 32);
  assert.deepEqual(h.events.slice(3), [['mode','img2img'], 'save', 'handoff']);
});
