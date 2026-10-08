import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/utils/inpaintLayerSnapshot.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { copyInpaintLayerSnapshot, sameInpaintPreparationSnapshot } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
function document() {
  const layers = [{id:'raster',type:'raster',visible:true,image:{src:'data:image/png;base64,AAAA',x:0,y:0,width:1024,height:768},rasterPaint:[{points:[0,0,10,20]}]}, {id:'mask',type:'mask',visible:true,inpaintSettings:{mask_blur:4},modifierScope:{mode:'masks',maskIds:['mask']}}, {id:'control',type:'controlnet',controlnet:{enabled:true,image:'upload.png',sourceData:'data:image/png;base64,BBBB'}}];
  const groups = [{id:'group',visible:true,collapsed:false}];
  return { layers, groups };
}
test('submission metadata is independent of later nested mutations', () => {
  const {layers,groups} = document(); const snapshot=copyInpaintLayerSnapshot(layers,groups);
  layers[0].image.x=100; layers[0].rasterPaint[0].points[0]=20; layers[1].modifierScope.maskIds.push('other'); layers[1].inpaintSettings.mask_blur=8; groups[0].visible=false;
  assert.equal(snapshot.layers[0].image.x,0); assert.deepEqual(snapshot.layers[0].rasterPaint[0].points,[0,0,10,20]); assert.deepEqual(snapshot.layers[1].modifierScope.maskIds,['mask']); assert.equal(snapshot.layers[1].inpaintSettings.mask_blur,4); assert.equal(snapshot.groups[0].visible,true);
});
test('rune-like proxies and image payloads are copied without invoking JSON serialization', () => {
  const {layers,groups}=document(); Object.defineProperty(layers[0],'toJSON',{value(){throw new Error('image serialization is forbidden');}});
  layers[0].image.src='data:image/png;base64,'+'A'.repeat(8*1024*1024);
  const proxied=layers.map(layer=>new Proxy(layer,{})); const snapshot=copyInpaintLayerSnapshot(proxied,groups);
  assert.equal(snapshot.layers[0].image.src,layers[0].image.src); assert.equal(sameInpaintPreparationSnapshot(snapshot,proxied,groups),true);
});
test('only presentation and uploaded filenames may change during preparation', () => {
  const {layers,groups}=document(); const snapshot=copyInpaintLayerSnapshot(layers,groups);
  layers[2].controlnet.image='new-session-upload.png'; layers[2].controlnetPreviewUrl='blob:preview'; groups[0].collapsed=true;
  assert.equal(sameInpaintPreparationSnapshot(snapshot,layers,groups),true);
  for (const mutate of [s => s.layers[0].image.src='replacement',s => s.layers[0].image.x=1,s => s.layers[1].inpaintSettings.mask_blur=5,s => s.layers[2].controlnet.sourceData='replacement',s => s.groups[0].visible=false]) {
    const state=document(),before=copyInpaintLayerSnapshot(state.layers,state.groups);
    mutate(state); assert.equal(sameInpaintPreparationSnapshot(before,state.layers,state.groups),false);
  }
});
test('layer order, group visibility and modifier targets remain significant', () => {
  for (const mutate of [s=>s.layers.reverse(),s=>s.groups[0].visible=false,s=>s.layers[1].modifierScope.maskIds.push('other'),s=>s.layers[2].controlnet.enabled=false]) {
    const state=document(),snapshot=copyInpaintLayerSnapshot(state.layers,state.groups); mutate(state); assert.equal(sameInpaintPreparationSnapshot(snapshot,state.layers,state.groups),false);
  }
});
