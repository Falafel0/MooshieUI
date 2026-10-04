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
const { fromSnapshot } = load('src/lib/prompt-studio/presets.ts');
assert.equal(fromSnapshot({ prefix: { injected: true }, suffix: 42 }), null, 'Malformed prefix/suffix cannot turn arbitrary JSON into a set');
assert.equal(fromSnapshot({ groups: [{ id: 'block', name: 'Scene', content: 'forest' }] }).groups[0].content, 'forest', 'Group-only sets remain portable');
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
studio.updateCatalogChoice('my_tag',{tag:'wrong_owner',name:'Wrong owner',subId:'elsewhere'},'elsewhere');
assert.equal(studio.selected[0].tag,'my_tag','Editing the same tag in another bucket must not change this selection');
studio.choose('second_tag','Second tag',sub);
studio.updateCatalogChoice('my_tag',{tag:'renamed_tag',name:'Renamed tag',subId:sub},sub);
assert.equal(studio.selected[0].tag,'renamed_tag','Renaming a selected card preserves prompt order');
assert.equal(studio.detail('renamed_tag').mods[0],'my_context');
studio.updateCatalogChoice('renamed_tag',{tag:'my_tag',name:'My tag',subId:sub},sub);
studio.remove('second_tag');
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
// Editing a known row must not overwrite another row with the same target tag.
const safeCategory = customCatalog.addCategory('Preserve authored entries');
const safeSub = customCatalog.addSub(safeCategory, 'Preserve subcategory');
const alphaPreview = 'data:image/webp;base64,YWxwaGE=';
const betaPreview = 'data:image/png;base64,YmV0YQ==';
assert.equal(customCatalog.add({tag:'alpha',name:'Alpha',subId:safeSub,preview:alphaPreview,description:'Alpha description',aliases:['Alpha alias'],contextualTags:['alpha_modifier']}),true);
assert.equal(customCatalog.add({tag:'beta',name:'Beta',subId:safeSub,preview:betaPreview,description:'Beta description',aliases:['Beta alias'],contextualTags:['beta_modifier']}),true);
const alphaEntry = customCatalog.entries.find(row => row.tag === 'alpha' && row.subId === safeSub);
const beforeEditConflict = JSON.stringify({categories:customCatalog.categories,entries:customCatalog.entries});
const beforeStudioConflict = JSON.stringify(studio.state());
await new Promise(resolve => setImmediate(resolve));
const storedBeforeEditConflict = storage.get('mooshie.studio.custom-catalog.v1');
assert.equal(customCatalog.add({...alphaEntry,tag:' beta ',name:'Overwrite attempt'}),false,'Renaming onto an existing tag must be rejected');
assert.equal(JSON.stringify({categories:customCatalog.categories,entries:customCatalog.entries}),beforeEditConflict,'A rejected edit preserves both rows, IDs and authored metadata');
assert.equal(JSON.stringify(studio.state()),beforeStudioConflict,'A rejected edit preserves selected tags and details');
await new Promise(resolve => setImmediate(resolve));
assert.equal(storage.get('mooshie.studio.custom-catalog.v1'),storedBeforeEditConflict,'A rejected edit must not persist a changed catalog');
assert.equal(customCatalog.entries.find(row => row.tag === 'beta' && row.subId === safeSub).preview,betaPreview);

// Deleting a subcategory moves its rows; reject a move that would merge two tags.
assert.equal(customCatalog.add({tag:'shared_tag',name:'Parent tag',subId:safeCategory,preview:alphaPreview,description:'Parent description',aliases:['Parent alias'],contextualTags:['parent_modifier']}),true);
assert.equal(customCatalog.add({tag:'shared_tag',name:'Child tag',subId:safeSub,preview:betaPreview,description:'Child description',aliases:['Child alias'],contextualTags:['child_modifier']}),true);
const childEntry = customCatalog.entries.find(row => row.tag === 'shared_tag' && row.subId === safeSub);
const beforeMoveConflict = JSON.stringify({categories:customCatalog.categories,entries:customCatalog.entries});
await new Promise(resolve => setImmediate(resolve));
const storedBeforeMoveConflict = storage.get('mooshie.studio.custom-catalog.v1');
assert.equal(customCatalog.removeSub(safeSub),false,'A subcategory move must reject colliding tags in its parent');
assert.equal(JSON.stringify({categories:customCatalog.categories,entries:customCatalog.entries}),beforeMoveConflict,'A rejected move preserves category structure and every field of both rows');
assert.equal(JSON.stringify(studio.state()),beforeStudioConflict,'A rejected move preserves the current draft');
await new Promise(resolve => setImmediate(resolve));
assert.equal(storage.get('mooshie.studio.custom-catalog.v1'),storedBeforeMoveConflict,'A rejected move must not persist a changed catalog');
assert.equal(customCatalog.add({...alphaEntry,tag:'shared_tag',subId:safeCategory}),false,'Moving a known tag onto a parent tag must also reject the edit');
assert.equal(JSON.stringify({categories:customCatalog.categories,entries:customCatalog.entries}),beforeMoveConflict);
assert.equal(customCatalog.add({...childEntry,tag:'child_unique_tag'}),true,'Resolve a collision by renaming the child tag');
assert.equal(customCatalog.removeSub(safeSub),true,'The subcategory can be removed once its tags are unique');
const movedChild = customCatalog.entries.find(row => row.id === childEntry.id);
assert.equal(movedChild.subId,safeCategory);
assert.equal(movedChild.preview,betaPreview);
assert.equal(movedChild.description,'Child description');
assert.deepEqual(Array.from(movedChild.aliases),['Child alias']);
assert.deepEqual(Array.from(movedChild.contextualTags),['child_modifier']);
assert.equal(customCatalog.entries.find(row => row.tag === 'shared_tag' && row.subId === safeCategory).description,'Parent description');
customCatalog.removeCategory(safeCategory);
assert.equal(customCatalog.removeSub(sub),true);
assert.equal(customCatalog.entries[0].subId,category,'Deleting a subcategory keeps its entries');
const group = studio.addGroup('My block'); studio.updateGroup(group,{content:'manual prose'});
assert.ok(studio.prompt.endsWith('manual prose')); studio.undo();
assert.ok(!studio.prompt.includes('manual prose')); studio.redo();
assert.ok(studio.prompt.endsWith('manual prose'));
assert.equal(customCatalog.import({kind:'mooshie-tag-pack',version:99,categories:[],entries:[]}),false);
assert.equal(customCatalog.import({kind:'mooshie-custom-catalog',version:1,entries:[{id:'legacy',tag:'saved_tag',subId:'old_bucket',preview}]}),true);
assert.ok(customCatalog.categories.some(row=>row.id==='old_bucket'));
const { generationAnimaTools, defaultAnimaTools } = load('src/lib/utils/animaIntegration.ts');
const retired = {...defaultAnimaTools(),enabled:true,composer_enabled:true,quality_prompt:'hidden quality',character_tags:'hidden character'};
assert.equal(generationAnimaTools(retired),null,'Retired controls cannot inject hidden saved groups');
const multiLora = generationAnimaTools({...retired,multi_lora_enabled:true});
assert.equal(multiLora.enabled,true);
assert.equal(multiLora.multi_lora_enabled,true);
assert.equal(multiLora.composer_enabled,false);
assert.equal(multiLora.quality_prompt,'');
assert.equal(multiLora.character_tags,'');
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

// Workspace navigation and draft part preferences migrate without changing content.
const { workspace } = load('src/lib/prompt-studio/workspace.svelte.ts');
userScope = ':preferences';
storage.set('mooshie.prompt-studio.tool.library.v1' + userScope, JSON.stringify({ tab: 'sets', management: true }));
storage.set('mooshie.prompt-studio.tool.prompt-panel.v1' + userScope, JSON.stringify({ active: 'output' }));
workspace.load();
assert.equal(workspace.librarySection, 'sets');
assert.equal(workspace.libraryManagement, true);
assert.equal(workspace.draftPart, 'chunk:output', 'Old chunk IDs never collide with the output selector');
workspace.setDraftPart('output'); workspace.setLibrarySection('sources'); workspace.setLibraryManagement(false);
const preferences = JSON.parse(storage.get('mooshie.prompt-studio.workspace.v2' + userScope));
assert.equal(preferences.draftPart, 'output'); assert.equal(preferences.librarySection, 'sources');
userScope = ':other-preferences'; workspace.load();
assert.equal(workspace.draftPart, 'base'); assert.equal(workspace.librarySection, 'collections');
userScope = ':preferences';
storage.set('mooshie.prompt-studio.tool.library.v1' + userScope, '{broken');
storage.set('mooshie.prompt-studio.tool.prompt-panel.v1' + userScope, 'null');
workspace.load();
assert.equal(workspace.librarySection, 'sources'); assert.equal(workspace.draftPart, 'output');
assert.equal(workspace.storageError, false, 'Corrupt retired preferences cannot prevent current preferences loading');
userScope = '';
console.log('Workspace section, management and draft-part preferences persist, migrate and remain isolated by account.');
