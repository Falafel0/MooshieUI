import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('../src/lib/utils/yieldToUi.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(){
 let next=0;const frames=new Map(),timers=new Map();const sandbox={exports:{},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(code,sandbox);return{frames,timers,yieldToUi:sandbox.exports.yieldToUi};
}
test('preparation yields past the frame callback and clears the background fallback',async()=>{
 const f=fixture();let resumed=false;const pending=f.yieldToUi().then(()=>resumed=true);await Promise.resolve();assert.equal(resumed,false);
 const [frame,fn]=[...f.frames][0];f.frames.delete(frame);fn();await Promise.resolve();assert.equal(resumed,false,'work must not run inside the pre-paint animation callback');
 const afterFrame=[...f.timers.values()].find(t=>t.delay===0);afterFrame.fn();await pending;assert.equal(resumed,true);assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);
});
test('suspended background frames cannot block submission indefinitely',async()=>{
 const f=fixture();const pending=f.yieldToUi();assert.equal(f.frames.size,1);const fallback=[...f.timers.values()][0];assert.equal(fallback.delay,100);fallback.fn();await pending;assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
