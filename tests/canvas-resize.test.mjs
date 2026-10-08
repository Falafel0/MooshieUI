import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('src/lib/utils/canvasResize.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {documentResizeTransform,resizedPlacement,fittedImagePlacement}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('bounds changes translate pixels without stretching, including anchored crops',()=>{
  const rect={x:16,y:24,width:80,height:40,rotation:30,flipX:true};
  const center=documentResizeTransform(256,192,512,384,{mode:'bounds'});
  assert.deepEqual(resizedPlacement(rect,center),{...rect,x:144,y:120});
  assert.deepEqual(documentResizeTransform(256,192,128,96,{mode:'bounds',anchor:{x:1,y:1}}),{scaleX:1,scaleY:1,offsetX:-128,offsetY:-96});
  assert.deepEqual(documentResizeTransform(255,191,256,192,{mode:'bounds'}),{scaleX:1,scaleY:1,offsetX:1,offsetY:1});
});
test('scale changes every document coordinate together and has no bounds offset',()=>{
  const transform=documentResizeTransform(256,192,512,288,{mode:'scale'});
  assert.deepEqual(resizedPlacement({x:20,y:32,width:80,height:40},transform),{x:40,y:48,width:160,height:60});
});
test('an imported base fits once while later bounds operations preserve its extent',()=>{
  const fit=fittedImagePlacement(640,480,1024,1024);
  assert.deepEqual(fit,{x:0,y:128,width:1024,height:768});
  assert.deepEqual(resizedPlacement(fit,documentResizeTransform(1024,1024,1536,1024,{mode:'bounds'})),{x:256,y:128,width:1024,height:768});
});
