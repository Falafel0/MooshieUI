import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const fixture = globalThis.__workspaceChainTest = {};
const source = fs.readFileSync(new URL('../src/lib/utils/regionalInpaintChain.ts', import.meta.url), 'utf8');
let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (_, names) => `const {${names}} = globalThis.__workspaceChainTest;`);
code = 'const setTimeout = (fn) => { fn(); };\n' + code;
Object.assign(fixture, {
  generation: {}, progress: { clearPromptOutput() {} }, canvas: {}, locale: { t: (key) => key },
  buildRegionalContextPrompt: (text) => text, mergeRegionalPromptText: (base, local) => [base,local].filter(Boolean).join(', '),
  uploadImageBytes: (...args) => fixture.uploadImpl(...args), renderRegionMaskPngBytes: async () => [1], maskToGrayscale: (pixels) => pixels, canvasPngBytes: (...args) => fixture.encodeImpl(...args),
  regionStrengthToDenoise: (s) => .38 + s*.27, regionalChainStepSeed: (s,i) => String(BigInt(s)+BigInt(i)+1n),
  tempOutputToUploadBytes: async () => [2], waitForPromptCompletion: async () => {}, waitForPromptOutput: async (id) => id+'.png',
});
const relationCode = ts.transpileModule(fs.readFileSync(new URL('../src/lib/utils/layerRelations.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const relationFunctions = await import('data:text/javascript;base64,' + Buffer.from(relationCode).toString('base64'));
Object.assign(fixture, relationFunctions);
const defaultsCode = ts.transpileModule(fs.readFileSync(new URL('../src/lib/utils/inpaintSettings.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
Object.assign(fixture, await import('data:text/javascript;base64,' + Buffer.from(defaultsCode).toString('base64')));
fixture.captureInpaintLayerSnapshot = () => JSON.parse(JSON.stringify({layers:fixture.canvas.layers, groups:fixture.canvas.groups ?? []}));
fixture.assertInpaintLayerRelations = snapshot => assert.deepEqual(relationFunctions.validateLayerRelations(snapshot.layers, snapshot.groups), []);
const { runRegionalInpaintChain } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
function setup(mode='inpainting') {
  Object.assign(fixture.generation, { mode, isAnima:false, supportsRegionalConditioning:mode==='inpainting', differentialDiffusion:false, loras:[], toParams: (options={}) => ({mode,input_image:'source.png',positive_prompt:'shared',negative_prompt:'global bad',seed:'123',width:64,height:64,facefix_enabled:true,detail_segments:[{text:'detail'}],inpaint_settings:{mask_blur:4},positive_regions:options.regionalSelectionsOverride??[]}) });
  fixture.canvas.layers=[{id:'a',name:'A',type:'mask',visible:true},{id:'b',name:'B',type:'mask',visible:true},{id:'prompt-region',name:'Region',type:'region',visible:true}];
  fixture.encodeImpl=async pixels=>pixels;
  fixture.canvas.exportMaskLayer=(id)=>[id==='a'?10:20];
  fixture.uploadImpl=async(_,name)=>({name});
  const calls=[];
  const callbacks={conditioningRegions:[{id:'prompt-region',shape:'lasso',text:'red hair',strength:1,x:0,y:0,width:1,height:1,mask_image:'region.png'}],submit:async(params,ctx)=>{calls.push({params,ctx});return {promptId:'p'+calls.length,seed:'123'};}};
  const regions=['a','b'].map(id=>({id,maskLayerId:mode==='inpainting'?id:undefined,text:id,strength:1,shape:'box',x:0,y:0,width:1,height:1}));
  return {calls,callbacks,regions};
}
test('inpainting starts with uploaded base, preserves order, and saves only final output',async()=>{
  const {calls,callbacks,regions}=setup();regions[1].inpaintSettings={mask_blur:12};regions[1].maskGrow=18;
  await runRegionalInpaintChain(regions,callbacks);
  assert.equal(calls.length,2);assert.equal(calls[0].params.input_image,'source.png');
  assert.match(calls[1].params.input_image,/regional_chain_input_1_/);
  assert.equal(calls[0].params.positive_prompt,'shared');assert.equal(calls[1].params.positive_prompt,'shared');
  assert.equal(calls[0].params.positive_regions[0].mask_image,'region.png');assert.equal(calls[1].params.positive_regions[0].text,'red hair');
  assert.equal(calls[0].ctx.index,0);assert.equal(calls[1].ctx.total,2);
  assert.equal(calls[0].params.facefix_enabled,false);assert.deepEqual(calls[0].params.detail_segments,[]);
  assert.equal(calls[1].params.facefix_enabled,true);assert.equal(calls[1].params.inpaint_settings.mask_blur,12);assert.equal(calls[1].params.grow_mask_by,18);
  assert.equal(calls[0].ctx.isFinalOutput,false);assert.equal(calls[1].ctx.isFinalOutput,true);
});
test('txt2img retains its base pass',async()=>{const {calls,callbacks,regions}=setup('txt2img');await runRegionalInpaintChain(regions,callbacks);assert.equal(calls.length,3);assert.equal(calls[0].ctx.phase,'base');assert.equal(calls[1].ctx.index,1);});
test('ordinary masks may omit local prompts',async()=>{const {calls,callbacks,regions}=setup();regions[0].text='';await runRegionalInpaintChain(regions,callbacks);assert.equal(calls.length,2);});
test('ordinary empty masks are skipped and keep layer denoise',async()=>{const {calls,callbacks,regions}=setup();fixture.canvas.exportMaskLayer=id=>id==='a'?null:[1];regions[1].denoise=.42;await runRegionalInpaintChain(regions,callbacks);assert.equal(calls.length,1);assert.equal(calls[0].params.denoise,.42);});

test('a mask whose density sets the denoise asks for a per-pixel denoise',async()=>{
  const {calls,callbacks,regions}=setup();
  const plain=await (async()=>{await runRegionalInpaintChain(regions,callbacks);return calls.map(c=>c.params.differential_diffusion);})();
  assert.deepEqual(plain,[false,false],'a plain mask keeps one uniform denoise');
  calls.length=0;
  regions[1].densityDenoise=true;regions[1].denoise=.42;
  await runRegionalInpaintChain(regions,callbacks);
  assert.deepEqual(calls.map(c=>c.params.differential_diffusion),[false,true],'only the density mask scales by its own pixels');
  assert.equal(calls[1].params.denoise,.42,'the density mask keeps its own denoise as the ceiling');
});

test('an Anima run keeps the per-pixel denoise every pass already had',async()=>{
  const {calls,callbacks,regions}=setup();
  fixture.generation.isAnima=true;
  await runRegionalInpaintChain(regions,callbacks);
  assert.deepEqual(calls.map(c=>c.params.differential_diffusion),[true,true]);
});
test('mask passes keep global negative prompt because local negative is spatial conditioning',async()=>{const {calls,callbacks,regions}=setup();regions[0].negativePrompt='blurry';await runRegionalInpaintChain(regions,callbacks);assert.equal(calls[0].params.negative_prompt,'global bad');assert.equal(calls[1].params.negative_prompt,'global bad');});
test('Anima inpaint regions use sequential local prompts instead of unsupported conditioning',async()=>{const {calls,callbacks,regions}=setup();fixture.generation.isAnima=true;fixture.generation.supportsRegionalConditioning=false;regions[0].text='red hair';regions[0].negativePrompt='blue hair';await runRegionalInpaintChain(regions,callbacks);assert.match(calls[0].params.positive_prompt,/red hair/);assert.match(calls[0].params.negative_prompt,/blue hair/);assert.deepEqual(calls[0].params.positive_regions,[]);});
test('each mask keeps its own sampling resolution while the document size stays fixed',async()=>{const {calls,callbacks,regions}=setup();regions[0].inpaintWidth=768;regions[0].inpaintHeight=512;regions[1].inpaintWidth=1024;regions[1].inpaintHeight=1024;await runRegionalInpaintChain(regions,callbacks);assert.deepEqual(calls.map(({params})=>[params.width,params.height,params.inpaint_target_width,params.inpaint_target_height]),[[64,64,768,512],[64,64,1024,1024]]);});
test('cancelled chain submits nothing',async()=>{const {calls,callbacks,regions}=setup();await assert.rejects(runRegionalInpaintChain(regions,{...callbacks,shouldCancel:()=>true}),/cancelled/);assert.equal(calls.length,0);});

test('upscale runs only once, after the final region',async()=>{
  const {calls,callbacks,regions}=setup('txt2img');
  const original=fixture.generation.toParams;
  fixture.generation.toParams=()=>({...original(),upscale_enabled:true});
  await runRegionalInpaintChain(regions,callbacks);
  assert.deepEqual(calls.map(c=>c.params.upscale_enabled),[false,false,true]);
});

test('later layer settings are frozen before the first submission',async()=>{
  const {calls,callbacks,regions}=setup();
  regions[1].inpaintSettings={mask_blur:7};
  regions[1].inpaintWidth=1280;regions[1].inpaintHeight=768;
  const submit=callbacks.submit;
  callbacks.submit=async(...args)=>{regions[1].inpaintSettings.mask_blur=31;regions[1].inpaintWidth=256;return submit(...args);};
  await runRegionalInpaintChain(regions,callbacks);
  assert.equal(calls[1].params.inpaint_settings.mask_blur,7);
  assert.equal(calls[1].params.inpaint_target_width,1280);
  assert.equal(calls[1].params.inpaint_target_height,768);
});

test('ControlNet layers and prompt regions modify every mask pass without adding generation steps', async () => {
  const {calls, callbacks, regions} = setup();
  const controls = [{layer_id:'control-depth',enabled:true, image:'depth.png', controlnet_model:'depth.safetensors', strength:.7}, {layer_id:'control-pose',enabled:true, image:'pose.png', controlnet_model:'pose.safetensors', strength:.5}];
  fixture.canvas.layers.push(...controls.map(control => ({ id:control.layer_id, type:'controlnet', visible:true, controlnet:{enabled:true} })));
  const original = fixture.generation.toParams;
  fixture.generation.toParams = options => ({...original(options), controlnet:null, controlnet_layers:controls});
  await runRegionalInpaintChain(regions, callbacks);
  assert.equal(calls.length, 2, 'only the two edit masks create generation steps');
  for (const {params} of calls) {
    assert.deepEqual(params.controlnet_layers, controls, 'both controls condition each mask pass');
    assert.equal(params.positive_regions.length, 1, 'the prompt region conditions each mask pass');
    assert.equal(params.positive_regions[0].mask_image, 'region.png');
  }
});


test('explicit and group-scoped modifiers condition only their edit masks, without adding passes', async () => {
  const { calls, callbacks, regions } = setup();
  fixture.canvas.groups = [{id:'portrait',name:'Portrait',visible:true},{id:'background',name:'Background',visible:true}];
  fixture.canvas.layers.find(layer=>layer.id==='a').groupId='portrait';
  fixture.canvas.layers.find(layer=>layer.id==='b').groupId='background';
  fixture.canvas.layers.find(layer=>layer.id==='prompt-region').groupId='portrait';
  fixture.canvas.layers.push({id:'pose',type:'controlnet',visible:true,controlnet:{enabled:true},modifierScope:{mode:'masks',maskIds:['b']}},
    {id:'off',type:'controlnet',visible:true,controlnet:{enabled:true},modifierScope:{mode:'masks',maskIds:[]}});
  const original=fixture.generation.toParams;
  fixture.generation.toParams=options=>({...original(options),controlnet_layers:[{layer_id:'pose',image:'pose.png'},{layer_id:'off',image:'unused.png'}]});
  await runRegionalInpaintChain(regions,callbacks);
  assert.equal(calls.length,2);
  assert.equal(calls[0].params.positive_regions.length,1);
  assert.equal(calls[1].params.positive_regions.length,0);
  assert.deepEqual(calls.map(call=>call.params.controlnet_layers.map(control=>control.layer_id)),[[],['pose']]);
  fixture.canvas.groups=[];
});

test('modifier targeting is frozen before PNG encoding and remains stable across submissions', async () => {
  const { calls, callbacks, regions } = setup();
  const control={id:'pose',type:'controlnet',visible:true,controlnet:{enabled:true},modifierScope:{mode:'masks',maskIds:['b']}};
  fixture.canvas.layers.push(control);
  const original=fixture.generation.toParams;
  fixture.generation.toParams=options=>({...original(options),controlnet_layers:[{layer_id:'pose',image:'pose.png',strength:.5}]});
  const encode=fixture.encodeImpl;
  fixture.encodeImpl=async pixels=>{control.modifierScope.maskIds=['a'];control.visible=false;return pixels;};
  try { await runRegionalInpaintChain(regions,callbacks); } finally { fixture.encodeImpl=encode; }
  assert.deepEqual(calls.map(call=>call.params.controlnet_layers.map(control=>control.layer_id)),[[],['pose']]);
});

test('linked raster alpha is uploaded as a separate strict processing limit, not a generation pass', async () => {
  const { calls, callbacks, regions } = setup();
  fixture.canvas.layers.push({id:'raster',type:'raster',visible:true});
  fixture.canvas.layers.find(layer=>layer.id==='a').targetRasterId='raster';
  fixture.canvas.exportRasterLayer=(_id, options)=>{assert.equal(options.raw,true); return [127];};
  const uploads=[]; fixture.uploadImpl=async(bytes,name)=>{uploads.push({bytes,name});return {name};};
  await runRegionalInpaintChain(regions,callbacks);
  assert.equal(calls.length,2);
  assert.match(calls[0].params.inpaint_settings.area_limit_image,/inpaint_area_limit_0_/);
  assert.equal(calls[1].params.inpaint_settings.area_limit_image,undefined);
  assert.deepEqual(uploads.find(upload=>upload.name.startsWith('inpaint_area_limit')).bytes,[127]);
});
