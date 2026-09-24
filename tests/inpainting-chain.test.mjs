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
  uploadImageBytes: async (_, name) => ({ name }), renderRegionMaskPngBytes: async () => [1], canvasPngBytes: async (pixels) => pixels,
  regionStrengthToDenoise: (s) => .38 + s*.27, regionalChainStepSeed: (s,i) => String(BigInt(s)+BigInt(i)+1n),
  tempOutputToUploadBytes: async () => [2], waitForPromptCompletion: async () => {}, waitForPromptOutput: async (id) => id+'.png',
});
const { runRegionalInpaintChain } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
function setup(mode='inpainting') {
  Object.assign(fixture.generation, { mode, isAnima:false, supportsRegionalConditioning:mode==='inpainting', differentialDiffusion:false, loras:[], toParams: (options={}) => ({mode,input_image:'source.png',positive_prompt:'shared',negative_prompt:'global bad',seed:'123',width:64,height:64,facefix_enabled:true,detail_segments:[{text:'detail'}],inpaint_settings:{mask_blur:4},positive_regions:options.regionalSelectionsOverride??[]}) });
  fixture.canvas.layers=[{id:'a',name:'A',type:'mask'},{id:'b',name:'B',type:'mask'}];
  fixture.canvas.exportMaskLayer=(id)=>[id==='a'?10:20];
  fixture.uploadImageBytes=async(_,name)=>({name});
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
