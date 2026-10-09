import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/utils/visibleResourceQueue.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {createVisibleResourceQueue}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(concurrency=3){
 const requests=[],loaded=[],failed=[],pending=new Map();
 const queue=createVisibleResourceQueue({concurrency,load:key=>{requests.push(key);return new Promise((resolve,reject)=>pending.set(key,{resolve,reject}));},loaded:(...args)=>loaded.push(args),failed:(...args)=>failed.push(args)});
 return {queue,requests,loaded,failed,pending};
}
test('only visible resources load with bounded concurrency and duplicate keys share a request',async()=>{
 const f=fixture();f.queue.setVisible(['a','b','a','c','d']);await flush();assert.deepEqual(f.requests,['a','b','c']);
 f.queue.setVisible(['a','b','c','d']);f.pending.get('a').resolve('pixels');await flush();assert.deepEqual(f.requests,['a','b','c','d']);assert.deepEqual(f.loaded,[['a','pixels']]);
 f.pending.get('b').resolve('b');f.pending.get('c').resolve('c');f.pending.get('d').resolve('d');await flush();assert.equal(f.requests.length,4);
});
test('scrolling or filtering drops queued invisible previews before they start',async()=>{
 const f=fixture(1);f.queue.setVisible(['visible','below-fold']);await flush();f.queue.setVisible(['search-match']);f.pending.get('visible').resolve('old');await flush();assert.deepEqual(f.requests,['visible','search-match']);f.pending.get('search-match').resolve('new');await flush();
});
test('failed previews do not retry on every reactive update and explicit retry works',async()=>{
 const f=fixture();f.queue.setVisible(['bad']);await flush();f.pending.get('bad').reject(new Error('offline'));await flush();
 for(let i=0;i<5;i++)f.queue.setVisible(['bad']);await flush();assert.deepEqual(f.requests,['bad']);assert.equal(f.failed.length,1);
 f.queue.retry('bad');await flush();assert.deepEqual(f.requests,['bad','bad']);f.pending.get('bad').resolve('restored');await flush();assert.deepEqual(f.loaded,[['bad','restored']]);
});
test('switching panels prevents queued work and late results from touching the destroyed panel',async()=>{
 const f=fixture(2);f.queue.setVisible(['a','b','c']);await flush();f.queue.dispose();f.pending.get('a').resolve('pixels');f.pending.get('b').reject(new Error('late'));await flush();
 f.queue.setVisible(['d']);f.queue.retry('a');await flush();assert.deepEqual(f.requests,['a','b']);assert.deepEqual(f.loaded,[]);assert.deepEqual(f.failed,[]);
});
test('a panel hidden in the same turn starts no request, and a newly visible card can still load',async()=>{
 const f=fixture(1);f.queue.setVisible(['old']);f.queue.setVisible(['new']);await flush();assert.deepEqual(f.requests,['new']);
 f.pending.get('new').resolve('new');await flush();f.queue.setVisible(['old']);await flush();assert.deepEqual(f.requests,['new','old']);f.pending.get('old').resolve('old');await flush();
 const closed=fixture();closed.queue.setVisible(['closed']);closed.queue.dispose();await flush();assert.deepEqual(closed.requests,[]);
});
