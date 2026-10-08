import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(await readFile('src/lib/utils/comfyReadyWait.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function scenario(action,fail=false) {
 const handlers=new Map(); let removed=0;
 const context={exports:{},setTimeout,clearTimeout,require:()=>({ipcListen:async(name,handler)=>{if(fail && name.endsWith('error')) throw new Error('subscription failed'); handlers.set(name,handler); return ()=>{removed++;handlers.delete(name);};}})};
 vm.runInNewContext(source,context);
 const wait=await context.exports.createComfyReadyWait(20);
 await action(wait,handlers);
 assert.equal(handlers.size,0); assert.equal(removed,fail?1:2);
}
await scenario(async(w,h)=>{h.get('comfyui:server_ready')({});await w.promise;});
await scenario(async(w,h)=>{h.get('comfyui:server_error')({payload:{error:'startup failed'}});await assert.rejects(w.promise,/startup failed/);});
await scenario(async(w)=>{await assert.rejects(w.promise,/timed out/);});
await scenario(async(w)=>{w.cancel();await w.promise;});
await scenario(async(w)=>{await assert.rejects(w.promise,/subscription failed/);},true);
console.log('ComfyUI ready, error, timeout, cancellation and subscription cleanup passed');
