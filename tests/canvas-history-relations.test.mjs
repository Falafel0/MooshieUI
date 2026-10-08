import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

class MockNode {
  constructor(value, name = '') { this.value = value; this.nodeName = name; this.parent = null; }
  clone() { return new MockNode(this.value, this.nodeName); }
  hasName(name) { return this.nodeName === name; }
  destroy() { if (this.parent) this.parent.nodes = this.parent.nodes.filter(node => node !== this); }
}
class MockLayer {
  constructor({ id, nodes = [] }) { this.layerId = id; this.nodes = nodes; this.destroyed = false; for (const node of nodes) node.parent = this; }
  id(value) { if (value !== undefined) this.layerId = value; return this.layerId; }
  getChildren() { return this.nodes; }
  getStage() { return null; }
  clone({ id = this.layerId } = {}) { return new MockLayer({ id, nodes: this.nodes.map(node => node.clone()) }); }
  destroy() { this.destroyed = true; }
  destroyChildren() { this.nodes = []; }
  add(node) { node.parent = this; this.nodes.push(node); }
  batchDraw() {}
}
globalThis.__historyKonva = { Layer: MockLayer };
const snapshotCode = ts.transpileModule(await readFile('src/lib/utils/inpaintLayerSnapshot.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
globalThis.__historySnapshot = await import('data:text/javascript;base64,' + Buffer.from(snapshotCode).toString('base64'));
globalThis.$state = { raw: value => value };
const source = (await readFile('src/lib/stores/canvasHistory.svelte.ts', 'utf8'))
  .replace('import Konva from "konva";', 'const Konva = globalThis.__historyKonva;')
  .replace("import { copyInpaintLayerSnapshot } from '../utils/inpaintLayerSnapshot.js';", 'const { copyInpaintLayerSnapshot } = globalThis.__historySnapshot;');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { canvasHistory: history } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const baseMask = () => ({ id: 'mask', type: 'mask', name: 'Edit', visible: true, opacity: 1, locked: false, order: 0,
  groupId: 'face', targetRasterId: 'pixels' });
const baseControl = () => ({ id: 'control', type: 'controlnet', name: 'Pose', visible: true, opacity: 1, locked: false, order: 1,
  groupId: 'face', referenceRasterId: 'pixels', modifierScope: { mode: 'masks', maskIds: ['mask'] },
  controlnet: { enabled: true, sourceData: 'data:image/png;base64,AAAA' }, controlnetPreviewUrl: 'blob:session-only' });

function connect(state, pixelLayers = new Map()) {
  history.clear();
  history.setRefs(pixelLayers, 1024, 768);
  history.setDocumentStateProvider(() => state);
  history.setOnDocumentRestored((layers, activeLayerId, groups, activeGroupId, geometry) => {
    Object.assign(state, { layers, activeLayerId, groups, activeGroupId, geometry });
  });
  history.setOnRestored(null);
}

test('one legacy-signature snapshot restores group membership, scope, selections and removed pixels together', () => {
  const state = { layers: [baseMask(), baseControl()], activeLayerId: 'mask',
    groups: [{ id: 'face', name: 'Face', visible: true, collapsed: false }], activeGroupId: 'face' };
  const pixels = new Map([['mask', new MockLayer({ id: 'mask', nodes: [new MockNode('painted alpha')] })]]);
  connect(state, pixels);
  history.snapshotDocument(state.layers, state.activeLayerId, ['mask']);
  state.groups[0].name = 'Changed after snapshot';
  state.layers = [{ ...baseControl(), groupId: null, modifierScope: { mode: 'masks', maskIds: [] } }];
  state.groups = [];
  state.activeGroupId = null;
  state.activeLayerId = 'control';
  pixels.get('mask').destroy();
  pixels.delete('mask');
  history.undo();
  assert.equal(state.groups[0].name, 'Face', 'metadata is copied before mutation');
  assert.equal(state.activeGroupId, 'face');
  assert.equal(state.activeLayerId, 'mask');
  assert.equal(state.layers[0].targetRasterId, 'pixels');
  assert.equal(state.layers[1].referenceRasterId, 'pixels');
  assert.deepEqual(state.layers[1].modifierScope.maskIds, ['mask']);
  assert.equal(state.layers[1].controlnetPreviewUrl, undefined, 'history does not retain session-owned URLs');
  assert.equal(state.layers[1].controlnet.sourceData, 'data:image/png;base64,AAAA');
  assert.equal(pixels.get('mask').getChildren()[0].value, 'painted alpha');
  history.redo();
  assert.deepEqual(state.groups, []);
  assert.equal(state.activeGroupId, null);
  assert.equal(state.activeLayerId, 'control');
  assert.deepEqual(state.layers[0].modifierScope.maskIds, []);
  assert.equal(pixels.has('mask'), false);
});

test('undo and redo preserve missing explicit bindings, disabled clipping and empty scope', () => {
  const raster = { id: 'pixels', type: 'raster', name: 'Pixels', visible: true, opacity: 1, locked: false, order: 0,
    clippingMaskId: 'deleted-mask', clippingEnabled: false };
  const region = { ...baseMask(), id: 'region', type: 'region', targetRasterId: 'deleted-raster', modifierScope: { mode: 'masks', maskIds: [] } };
  const state = { layers: [raster, region], activeLayerId: 'region', groups: [], activeGroupId: null };
  connect(state);
  history.snapshotDocument(state.layers, state.activeLayerId);
  state.layers = state.layers.map(layer => ({ ...layer, name: 'Changed' }));
  history.undo();
  assert.equal(state.layers[0].clippingMaskId, 'deleted-mask');
  assert.equal(state.layers[0].clippingEnabled, false);
  assert.equal(state.layers[1].targetRasterId, 'deleted-raster');
  assert.deepEqual(state.layers[1].modifierScope.maskIds, []);
  history.redo();
  assert.equal(state.layers[1].name, 'Changed');
  assert.deepEqual(state.layers[1].modifierScope.maskIds, []);
});

test('existing layer-only providers and two-argument restore callbacks stay compatible', () => {
  history.clear();
  history.setRefs(new Map(), 1024, 768);
  const state = { layers: [baseMask()], activeLayerId: 'mask' };
  history.setDocumentStateProvider(() => state);
  history.setOnDocumentRestored((layers, activeLayerId) => Object.assign(state, { layers, activeLayerId }));
  history.snapshotDocument(state.layers, state.activeLayerId);
  state.layers = [{ ...baseMask(), name: 'Changed' }];
  history.undo();
  assert.equal(state.layers[0].name, 'Edit');
  history.redo();
  assert.equal(state.layers[0].name, 'Changed');
});

test('ephemeral raster clipping nodes are excluded from pixel and removed-layer history', () => {
  const raster = { ...baseMask(), id: 'pixels', type: 'raster', clippingMaskId: 'mask', clippingEnabled: true };
  const state = { layers: [raster, baseMask()], activeLayerId: 'pixels', groups: [], activeGroupId: null };
  const makePixels = () => new MockLayer({ id: 'pixels', nodes: [new MockNode('original raster'), new MockNode('computed alpha', 'raster-clip-mask')] });
  const pixels = new Map([['pixels', makePixels()]]);
  connect(state, pixels);
  history.snapshot('pixels');
  pixels.get('pixels').nodes[0].value = 'painted change';
  history.undo();
  assert.deepEqual(pixels.get('pixels').getChildren().map(node => node.value), ['original raster']);
  history.redo();
  assert.deepEqual(pixels.get('pixels').getChildren().map(node => node.value), ['painted change']);

  pixels.set('pixels', makePixels());
  history.snapshotDocument(state.layers, state.activeLayerId, ['pixels']);
  state.layers = [baseMask()];
  pixels.delete('pixels');
  history.undo();
  assert.deepEqual(pixels.get('pixels').getChildren().map(node => node.value), ['original raster']);
  assert.equal(state.layers[0].clippingMaskId, 'mask', 'clipping remains metadata for renderer rebuild');
  assert.equal(state.layers[0].clippingEnabled, true);
});

test('document resize undo and redo restore geometry and surviving pixel layers together', () => {
  const geometry={width:256,height:192,boundingBox:{x:0,y:0,width:256,height:192,locked:false},baseImagePlacement:{source:'data:image/png;base64,AAAA',rect:{x:0,y:0,width:256,height:192}}};
  const state={layers:[{id:'pixels',type:'raster',image:{src:'data:AAAA',x:8,y:12,width:64,height:64}},baseControl()],activeLayerId:'pixels',groups:[],activeGroupId:null,geometry};
  const pixels=new Map([['pixels',new MockLayer({id:'pixels',nodes:[new MockNode('original pixels')]})]]);
  connect(state,pixels);history.snapshotDocument(state.layers,state.activeLayerId,['pixels']);
  state.geometry={...geometry,width:512,height:384,baseImagePlacement:{...geometry.baseImagePlacement,rect:{x:128,y:96,width:256,height:192}}};
  state.layers=state.layers.map(layer=>layer.image?{...layer,image:{...layer.image,x:136,y:108}}:layer);
  pixels.get('pixels').getChildren()[0].value='resized pixels';
  history.undo();assert.equal(state.geometry.width,256);assert.equal(state.layers[0].image.x,8);assert.equal(pixels.get('pixels').getChildren()[0].value,'original pixels');
  history.redo();assert.equal(state.geometry.width,512);assert.equal(state.geometry.baseImagePlacement.rect.x,128);assert.equal(state.layers[0].image.x,136);assert.equal(pixels.get('pixels').getChildren()[0].value,'resized pixels');
});

test('a failed resize rolls back its surviving pixels without creating a partial redo',()=>{
  const state={layers:[{id:'pixels',type:'raster',name:'Original'}],activeLayerId:'pixels',groups:[],activeGroupId:null};
  const pixels=new Map([['pixels',new MockLayer({id:'pixels',nodes:[new MockNode('original')]})]]);connect(state,pixels);
  const entry=history.snapshotDocument(state.layers,state.activeLayerId,['pixels']);
  state.layers[0].name='Partial';pixels.get('pixels').getChildren()[0].value='partial';
  history.rollbackDocumentSnapshot(entry);
  assert.equal(state.layers[0].name,'Original');assert.equal(pixels.get('pixels').getChildren()[0].value,'original');assert.equal(history.canRedo,false);assert.equal(history.canUndo,false);
});
