import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('src/lib/utils/promptOverlayViewport.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {visiblePromptSegmentRange}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const runs=(length)=>Array.from({length},(_,index)=>({start:index*10,end:index*10+9,clickable:true,kind:'tag',top:index*20,bottom:index*20+20}));
const edge=(run,side)=>side==='start'?run.top:run.bottom;
test('only visible lines are measured, including viewport edges',()=>{
  assert.deepEqual(visiblePromptSegmentRange(runs(10000),2000,2080,edge),{start:99,end:105});
});
test('a weighted group wrapping from above the viewport remains clickable',()=>{
  const items=[{top:0,bottom:20},{top:20,bottom:400},{top:400,bottom:420}];
  assert.deepEqual(visiblePromptSegmentRange(items,200,260,edge),{start:1,end:2});
});
test('empty and beyond-document viewports produce no phantom segments',()=>{
  assert.deepEqual(visiblePromptSegmentRange([],0,100,edge),{start:0,end:0});
  assert.deepEqual(visiblePromptSegmentRange(runs(10),1000,1100,edge),{start:10,end:10});
});
test('lookup cost depends on visible area, not the number of offscreen tags',()=>{
  let reads=0;
  const result=visiblePromptSegmentRange(runs(100000),1000000,1000200,(...args)=>{reads++;return edge(...args);});
  assert.equal(result.end-result.start,12);assert(reads<40,`${reads} geometry reads`);
});
