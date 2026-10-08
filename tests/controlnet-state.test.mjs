import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = async path => {
 const {outputText}=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};
const { generationModelContextKey,controlnetPayload,controlnetRequestKey,LatestControlnetRequest,newControlnetLayer,controlnetLayerPayloads }=await compile('src/lib/utils/controlnetState.ts');
const docs=await compile('src/lib/utils/projectDocument.ts');
const state={controlnetEnabled:true,controlnetMode:'custom',controlnetPreset:'depth',controlnetModel:' folder/depth.safetensors ',controlnetPreprocessor:' DepthAnythingV2Preprocessor ',controlnetImage:'raw.png',controlnetStrength:0,controlnetStartPercent:.2,controlnetEndPercent:.8,mode:'txt2img',isNovelAi:false,modelFamily:'sdxl'};
test('custom preprocessors reach every image mode without a preset',()=>{
 for(const mode of ['txt2img','img2img','inpainting','image_edit']) {
  const payload=controlnetPayload({...state,mode});assert.equal(payload.preprocessor,'DepthAnythingV2Preprocessor');assert.equal(payload.preset,null);assert.equal(payload.strength,0);assert.equal(payload.controlnet_model,'folder/depth.safetensors');
 }
 assert.equal(controlnetPayload({...state,controlnetPreprocessor:'  '}).preprocessor,null);
 assert.equal(controlnetPayload({...state,controlnetMode:'preset'}).preset,'depth');
});
test('disabled controls and unsupported engines do not submit a control',()=>{
 for(const change of [{controlnetEnabled:false},{isNovelAi:true},{mode:'video'}]) assert.equal(controlnetPayload({...state,...change}),null);
});
test('latest request rejects superseded uploads, mode changes, source changes and disposal',()=>{
 const requests=new LatestControlnetRequest(),key=controlnetRequestKey(state),old=requests.begin(key),latest=requests.begin(key);
 assert.equal(requests.current(old,key),false);assert.equal(requests.current(latest,key),true);
 for(const change of [{mode:'inpainting'},{modelFamily:'anima'},{controlnetImage:'new.png'},{controlnetPreprocessor:null},{controlnetEnabled:false}]) assert.equal(requests.current(latest,controlnetRequestKey({...state,...change})),false);
 requests.invalidate();assert.equal(requests.current(latest,key),false);
});
test('map inspection survives disabling a modifier but invalidates a changed source or pipeline',()=>{
 const requests=new LatestControlnetRequest(),key=controlnetRequestKey(state,true),request=requests.begin(key);
 assert.equal(requests.current(request,controlnetRequestKey({...state,controlnetEnabled:false},true)),true);
 for(const change of [{controlnetImage:'replacement.png'},{controlnetPreprocessor:null},{modelFamily:'anima'},{mode:'inpainting'}]) {
  assert.equal(requests.current(request,controlnetRequestKey({...state,...change},true)),false);
 }
});
const layer=(order,overrides={})=>({id:`control-${order}`,name:`Control ${order}`,type:'controlnet',visible:true,opacity:1,locked:false,order,controlnet:{...newControlnetLayer(),model:'depth.safetensors',image:`hint-${order}.png`,sourceData:'data:image/png;base64,AAAA'},...overrides});
test('document controls preserve stack order and exclude hidden, disabled and non-control layers',()=>{
 const layers=[layer(2),layer(0),layer(1,{visible:false}),layer(3,{controlnet:{...newControlnetLayer(),enabled:false}}),{type:'mask',visible:true,order:4}];
 assert.deepEqual(controlnetLayerPayloads(layers).map(c=>c.image),['hint-0.png','hint-2.png']);assert.deepEqual(layers.map(l=>l.order),[2,0,1,3,4]);
});
test('control layers validate, survive document serialization and detect meaningful changes',()=>{
 const doc=docs.emptyDocument(1024,768);doc.layers=[layer(0)];assert.equal(docs.isProjectDocument(JSON.parse(JSON.stringify(doc))),true);
 const signature=docs.documentSignature(doc);
 doc.layers[0].controlnet.image='different-server-session.png';assert.equal(docs.documentSignature(doc),signature,'server upload names are transient when pixels travel with the document');
 doc.layers[0].controlnet.strength=.8;assert.notEqual(docs.documentSignature(doc),signature);
 for(const patch of [{startPercent:.9,endPercent:.2},{strength:NaN},{sourceData:'blob:expired'}]) assert.equal(docs.isProjectDocument({...doc,layers:[layer(0,{controlnet:{...newControlnetLayer(),...patch}})]}),false);
});

test('input preparation distinguishes mode, checkpoint and model family while ignoring editable display state', () => {
  const state={mode:'inpainting',checkpoint:'portrait.safetensors',modelFamily:'sdxl'};
  const initial=generationModelContextKey(state);
  for(const change of [{mode:'img2img'},{checkpoint:'other.safetensors'},{modelFamily:'anima'}]) assert.notEqual(generationModelContextKey({...state,...change}),initial);
  assert.equal(generationModelContextKey({...state,opacity:.2}),initial);
});
