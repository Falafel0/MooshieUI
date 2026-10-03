// Focused behavior regressions; no frontend test framework required.
// Run: node scripts/test-prompt-studio-workspace.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
const root = new URL('../', import.meta.url);
const cache = new Map();
const storage = new Map();
let booruRequest = async () => [];
let userScope = '';
let exportedBlob;
let download;
const runtime = { Blob, URL: { createObjectURL: blob => { exportedBlob = blob; return 'blob:test'; }, revokeObjectURL() {} }, document: { createElement: () => (download = { click() {} }) } };
const boundaries = {
  '../utils/ipc.js': { userScopedKey: key => key + userScope, ipcInvoke: (...args) => booruRequest(...args) },
  '../utils/syncTrigger.js': { triggerSync: () => {} },
  '../stores/locale.svelte.js': { locale: { t: key => key } },
};
boundaries['./ipc.js'] = boundaries['../utils/ipc.js'];
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = fs.readFileSync(new URL(path, root), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} };
  cache.set(path, module.exports);
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require(name) {
      if (boundaries[name]) return boundaries[name];
      const resolved = new URL(name.replace(/\.js$/, '.ts'), new URL(path, root));
      return load(resolved.pathname.slice(root.pathname.length));
    },
    console, $state: value => value, crypto: { randomUUID },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    ...runtime,
  }, { filename: path });
  return module.exports;
}
const { insertPrompt } = load('src/lib/prompt-studio/insertion.ts');
assert.equal(insertPrompt('old,', '[red|blue]', 'append'), 'old, [red|blue]');
const { customCatalog } = load('src/lib/prompt-studio/custom-catalog.svelte.ts');
const { studio } = load('src/lib/prompt-studio/studio.svelte.ts');
await customCatalog.load(); studio.load();
assert.equal(studio.categories.length, 0, 'A fresh catalog must be empty');
const category = customCatalog.addCategory('My category');
const sub = customCatalog.addSub(category, 'My subcategory');
studio.selectCategory(category); studio.selectSub(sub);
const preview = 'data:image/webp;base64,YQ==';
customCatalog.add({tag:'my_tag',name:'My tag',subId:sub,preview,description:'Description',aliases:['Alias'],contextualTags:['my_context']});
customCatalog.add({tag:'my_tag',name:'Renamed tag',subId:sub});
assert.equal(customCatalog.entries.length, 1);
assert.equal(customCatalog.entries[0].preview, preview);
assert.equal(customCatalog.entries[0].contextualTags[0], 'my_context');
studio.choose('my_tag','My tag',sub); studio.toggleModifier('my_tag','my_context');
assert.equal(studio.prompt,'my tag, my context');
assert.ok(!studio.prompt.includes('clothed'));
customCatalog.export(category);
assert.equal(download.download, 'prompt-studio-tag-pack.json');
const pack = JSON.parse(await exportedBlob.text());
assert.equal(pack.categories.length, 1);
assert.equal(pack.entries[0].preview, preview);
assert.deepEqual(pack.entries[0].contextualTags, ['my_context']);
assert.equal(customCatalog.import(pack),true);
assert.equal(customCatalog.entries.length,1,'Reimporting a pack is idempotent');
assert.equal(customCatalog.entries[0].preview,preview);
assert.equal(customCatalog.entries[0].aliases[0],'Alias');
// Older packs omit metadata; importing them must not erase authored contexts/previews.
assert.equal(customCatalog.import({kind:'mooshie-custom-catalog',version:1,entries:[{id:'old',tag:'my_tag',subId:sub}]}),true);
assert.equal(customCatalog.entries[0].description,'Description');
assert.equal(customCatalog.entries[0].aliases[0],'Alias');
assert.equal(customCatalog.entries[0].contextualTags[0],'my_context');
// Whitespace IDs normalize together, and conflicting category/sub IDs remap consistently.
const padded = {kind:'mooshie-tag-pack',version:1,categories:[{id:' padded ',name:'Padded',subs:[{id:' nested ',name:'Nested'}]}],entries:[{id:'pad',tag:'pad_tag',subId:' nested '}]};
assert.equal(customCatalog.import(padded),true);
assert.equal(customCatalog.entries.find(row=>row.tag==='pad_tag').subId,'nested');
const collision = {kind:'mooshie-tag-pack',version:1,categories:[{id:sub,name:'Collision',subs:[{id:category,name:'Collision sub'}]}],entries:[{id:customCatalog.entries[0].id,tag:'collision_tag',subId:category}]};
assert.equal(customCatalog.import(collision),true);
const beforeRepeat = JSON.stringify({categories:customCatalog.categories,entries:customCatalog.entries});
assert.equal(customCatalog.import(collision),true);
assert.equal(JSON.stringify({categories:customCatalog.categories,entries:customCatalog.entries}),beforeRepeat);
assert.equal(new Set(customCatalog.entries.map(row=>row.id)).size,customCatalog.entries.length);
const invalid = {...padded,categories:[...padded.categories,{id:'padded',name:'Duplicate ID',subs:[]}]};
assert.equal(customCatalog.import(invalid),false);
assert.equal(JSON.stringify({categories:customCatalog.categories,entries:customCatalog.entries}),beforeRepeat,'Invalid packs must not partly mutate the catalog');
customCatalog.removeSub(sub);
assert.equal(customCatalog.entries[0].subId,category,'Deleting a subcategory keeps its entries');
const group = studio.addGroup('My block'); studio.updateGroup(group,{content:'manual prose'});
assert.ok(studio.prompt.endsWith('manual prose')); studio.undo();
assert.ok(!studio.prompt.includes('manual prose')); studio.redo();
assert.ok(studio.prompt.endsWith('manual prose'));
assert.equal(customCatalog.import({kind:'mooshie-tag-pack',version:99,categories:[],entries:[]}),false);
assert.equal(customCatalog.import({kind:'mooshie-custom-catalog',version:1,entries:[{id:'legacy',tag:'saved_tag',subId:'old_bucket',preview}]}),true);
assert.ok(customCatalog.categories.some(row=>row.id==='old_bucket'));
assert.match(fs.readFileSync(new URL('src/lib/stores/generation.svelte.ts', root), 'utf8'), /anima_tools: null/, 'Retired Anima controls cannot inject hidden saved groups');
console.log('Local catalog, user contexts, portable packs, legacy import and prompt history cases passed.');

// Drive real store reads and writes through deferred IndexedDB boundary calls.
const reads = [];
const writes = [];
const db = {
  close() {},
  transaction(_store, mode) {
    const tx = {
      objectStore() {
        return {
          get(key) { const request = {}; reads.push({key, request}); return request; },
          put(rows, key) { writes.push({rows, key}); queueMicrotask(() => tx.oncomplete()); },
        };
      },
    };
    return tx;
  },
};
runtime.indexedDB = {open() { const request = {result: db}; queueMicrotask(() => request.onsuccess()); return request; }};
cache.delete('src/lib/prompt-studio/custom-catalog.svelte.ts');
const isolatedCatalog = load('src/lib/prompt-studio/custom-catalog.svelte.ts').customCatalog;
const flush = () => new Promise(resolve => setImmediate(resolve));
const readResult = (read, rows) => {read.request.result = rows; read.request.onsuccess();};
userScope = ':alice';
const aliceLoad = isolatedCatalog.load();
assert.equal(isolatedCatalog.ready, false);
isolatedCatalog.add({tag:'premature',subId:'top_type',name:'Premature'});
assert.equal(isolatedCatalog.import({kind:'mooshie-custom-catalog',version:1,entries:[]}), false);
assert.equal(isolatedCatalog.entries.length, 0);
await flush();
userScope = ':bob';
const bobLoad = isolatedCatalog.load();
await flush();
readResult(reads[1], [{id:'bob',tag:'bob_shirt',subId:'top_type',preview}]);
await bobLoad;
readResult(reads[0], [{id:'alice',tag:'alice_shirt',subId:'top_type'}]);
await aliceLoad;
assert.equal(isolatedCatalog.entries[0].tag, 'bob_shirt');
assert.equal(isolatedCatalog.ready, true);
isolatedCatalog.add({tag:'bob_coat',subId:'top_type',name:'Coat'});
userScope = ':carol';
isolatedCatalog.remove('bob');
assert.equal(isolatedCatalog.entries.length, 2, 'Different account cannot mutate the old account catalog');
const carolLoad = isolatedCatalog.load();
await flush();
assert.equal(writes[0].key.endsWith(':bob'), true);
assert.equal(writes[0].rows.entries.length, 2);
assert.equal(isolatedCatalog.entries.length, 0, 'Account switch clears previous previews immediately');
readResult(reads[2], [
  {id:'duplicate',tag:'coat',subId:'top_type',preview},
  {id:'duplicate',tag:'dress',subId:'dress_type'},
  {id:'other',tag:'coat',subId:'top_type',name:'Updated coat'},
]);
await carolLoad;
assert.equal(isolatedCatalog.entries.length, 2);
assert.equal(new Set(isolatedCatalog.entries.map(row => row.id)).size, 2);
assert.equal(isolatedCatalog.entries.find(row => row.tag === 'coat').preview, preview);
userScope = ':dave';
const failedLoad = isolatedCatalog.load();
await flush();
reads[3].request.error = new Error('Storage temporarily unavailable');
reads[3].request.onerror();
await failedLoad;
assert.equal(isolatedCatalog.ready, false);
assert.equal(isolatedCatalog.storageError, true);
const retryLoad = isolatedCatalog.load();
await flush();
readResult(reads[4], []);
await retryLoad;
assert.equal(isolatedCatalog.ready, true);
assert.equal(isolatedCatalog.storageError, false);
userScope = '';
console.log('IndexedDB account switches reject stale reads, scope queued writes, repair duplicates and allow retry.');
