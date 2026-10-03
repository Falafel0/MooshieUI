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
const boundaries = {
  '../utils/ipc.js': { userScopedKey: key => key, ipcInvoke: (...args) => booruRequest(...args) },
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
  }, { filename: path });
  return module.exports;
}
const { insertPrompt } = load('src/lib/prompt-studio/insertion.ts');
assert.equal(insertPrompt('old,', '[red|blue]', 'append'), 'old, [red|blue]');
assert.equal(insertPrompt('old', 'new', 'prepend'), 'new, old');
assert.equal(insertPrompt('old', 'new', 'replace'), 'new');
assert.equal(insertPrompt('old', ' ', 'replace'), 'old');
assert.equal(insertPrompt('', '<fromto[0.5]:a || b>', 'append'), '<fromto[0.5]:a || b>');
const { studio } = load('src/lib/prompt-studio/studio.svelte.ts');
const { toSnapshot, fromSnapshot } = load('src/lib/prompt-studio/presets.ts');
studio.load();
studio.clothed = false;
studio.autoTags = false;
studio.choose('shirt', 'Shirt', 'top_type');
studio.toggleModifier('shirt', 'sleeves_rolled_up');
studio.setPart('shirt', 'Color', 'blue');
assert.equal(studio.prompt, 'blue shirt with rolled-up sleeves');
studio.weight('shirt', 1.2);
assert.equal(studio.prompt, '(blue shirt with rolled-up sleeves:1.20)');
studio.setOption('readable', false);
assert.match(studio.prompt, /\(shirt:1.20\)/);
assert.match(studio.prompt, /sleeves_rolled_up/);
studio.setOption('readable', true);
const light = studio.addGroup('Lighting');
studio.updateGroup(light, { content: 'golden hour' });
const style = studio.addGroup('Style');
studio.updateGroup(style, { content: '@[Watercolor]' });
assert.ok(studio.prompt.endsWith('golden hour, @[Watercolor]'));
studio.moveGroup(style, -1);
assert.ok(studio.prompt.endsWith('@[Watercolor], golden hour'));
studio.updateGroup(style, { enabled: false });
assert.ok(!studio.prompt.includes('@[Watercolor]'));
studio.undo();
assert.ok(studio.prompt.includes('@[Watercolor]'));
studio.redo();
assert.ok(!studio.prompt.includes('@[Watercolor]'));
studio.editPrompt('manual base');
assert.equal(studio.prompt, 'manual base, golden hour');
studio.toggleModifier('shirt', 'striped');
assert.equal(studio.basePrompt, 'manual base');
studio.editPrompt(undefined);
assert.match(studio.prompt, /rolled-up sleeves and a striped pattern/);
const snapshot = toSnapshot(studio.state());
const restored = fromSnapshot(JSON.parse(JSON.stringify(snapshot)));
studio.applyState(restored);
assert.equal(studio.groups.length, 2);
assert.equal(studio.groups[0].enabled, false);
assert.match(studio.prompt, /golden hour$/);
studio.removeGroup(light);
assert.ok(!studio.prompt.includes('golden hour'));
studio.undo();
assert.ok(studio.prompt.includes('golden hour'));
const legacy = { ...snapshot }; delete legacy.groups;
assert.equal(fromSnapshot(legacy).groups.length, 0);
const malformed = { ...snapshot, groups: [null, {id:'x',content:'a'}, {id:'x',content:'b'}, {id:1,content:'x'}] };
assert.equal(fromSnapshot(malformed).groups.length, 1);
const { contextualTag } = load('src/lib/prompt-studio/context.ts');
assert.equal(contextualTag({tag:'black_hair',category:'hair_color'}, {mods:['gradient_hair'],secondary:'blue',parts:{}}), 'black hair with a gradient fading to blue');
assert.equal(contextualTag({tag:'braid',category:'hair_style'}, {mods:[],quantity:'twin_braids',parts:{}}), 'twin braids');
assert.equal(contextualTag({tag:'blue',category:'eye_color_wheel'}), 'blue eyes');
const cats = studio.categories;
for (const cat of cats) for (const sub of cat.subs) {
  const names = (sub.variants ?? []).map(v => v.tag);
  assert.equal(new Set(names).size, names.length, `Duplicate variants in ${sub.id}`);
  for (const group of sub.groups ?? []) for (const id of group.variantIds) assert.ok(sub.variants.some(v => v.id === id), `Invalid variant reference: ${id}`);
}
assert.ok(cats.find(c=>c.id==='tops').subs.find(s=>s.id==='top_type').variants.length >= 30);
assert.ok(cats.find(c=>c.id==='hair').subs.find(s=>s.id==='hair_style').variants.length >= 25);
console.log('Prompt Studio regressions passed: insertion, context, groups, undo/redo, persistence, legacy imports, catalog.');

const { parsePromptBlocks } = load('src/lib/utils/promptBlocks.ts');
assert.equal(parsePromptBlocks('1girl, solo\n\n[red|blue], <fromto[0.5]:a || b>').length, 2);
assert.equal(parsePromptBlocks('# Character\n1girl, solo\nlong hair\n\n# Lighting\ngolden hour')[0].content, '1girl, solo\nlong hair');
assert.equal(parsePromptBlocks('a\r\nb', 'lines').length, 2);
assert.equal(parsePromptBlocks('a, b, c').length, 1);
const { promptPresets } = load('src/lib/stores/promptPresets.svelte.ts');
const sky = promptPresets.create('Небо', 'blue sky');
const hair = promptPresets.create('Волосы', 'black hair');
assert.equal(promptPresets.resolveInline('@[Небо], @[Волосы]'), 'blue sky, black hair');
assert.ok(promptPresets.inlinePresetIds('@[Волосы]').has(hair.id));
const { resolveAnimaPromptGroups, defaultAnimaTools } = load('src/lib/utils/animaIntegration.ts');
const tools = { ...defaultAnimaTools(), character_tags: '@[Волосы]', background_tags: '@[Небо]' };
const resolved = resolveAnimaPromptGroups(tools, text => promptPresets.resolveInline(text));
assert.equal(resolved.character_tags, 'black hair');
assert.equal(resolved.background_tags, 'blue sky');
assert.equal(tools.character_tags, '@[Волосы]');
const { savedSources } = load('src/lib/prompt-studio/saved-sources.svelte.ts');
savedSources.load(); savedSources.add([{ id:'blue_eyes', name:'Blue eyes', source:'danbooru', tags:['blue_eyes'] }]);
savedSources.add([{ id:'blue_eyes', name:'Blue eyes', source:'danbooru', tags:['blue_eyes'] }]);
assert.equal(savedSources.entries.length, 1);
savedSources.add([{ id:'blue_eyes', name:'Blue eyes', source:'gelbooru', tags:['blue_eyes'] }]);
assert.equal(savedSources.entries.length, 2);
assert.equal(savedSources.import({ kind:'mooshie-studio-sources',version:1,entries:[{id:'group',source:'danbooru:group',tags:['shirt','skirt']}] }),true);
assert.ok(savedSources.has('group','danbooru:group'));
const { customCatalog } = load('src/lib/prompt-studio/custom-catalog.svelte.ts');
await customCatalog.load();
customCatalog.add({ tag:'custom_shirt',name:'Custom shirt',subId:'top_type',preview:'data:image/webp;base64,YQ==' });
assert.ok(studio.categories.find(cat=>cat.id==='tops').subs.find(sub=>sub.id==='top_type').variants.some(v=>v.tag==='custom_shirt'));
customCatalog.add({ tag:'custom_shirt',name:'Renamed shirt',subId:'top_type' });
assert.equal(customCatalog.entries.length, 1);
assert.equal(customCatalog.entries[0].preview, 'data:image/webp;base64,YQ==', 'Renaming keeps the chosen preview');
const preview = 'data:image/webp;base64,YQ==';
customCatalog.import({kind:'mooshie-custom-catalog',version:1,entries:[{id:'custom',tag:'my_dress',name:'My dress',subId:'dress_type',preview}]});
assert.equal(customCatalog.entries.find(entry=>entry.tag==='my_dress').preview,preview);
console.log('Block import, named macros, Anima macro resolution, saved sources and custom catalog regressions passed.');

const shirtSub = studio.categories.find(cat => cat.id === 'tops').subs.find(sub => sub.id === 'top_type');
const originalShirt = shirtSub.variants.find(variant => variant.tag === 'shirt');
customCatalog.add({ tag: 'shirt', name: 'My shirt', subId: 'top_type', preview });
const updatedSub = studio.categories.find(cat => cat.id === 'tops').subs.find(sub => sub.id === 'top_type');
const updatedShirt = updatedSub.variants.find(variant => variant.tag === 'shirt');
assert.equal(updatedShirt.id, originalShirt.id);
assert.deepEqual(updatedShirt.modifiers, originalShirt.modifiers);
assert.deepEqual(updatedShirt.parts, originalShirt.parts);
for (const group of updatedSub.groups ?? []) for (const id of group.variantIds) assert.ok(updatedSub.variants.some(variant => variant.id === id));
const importedId = customCatalog.entries[0].id;
assert.equal(customCatalog.import({kind:'mooshie-custom-catalog',version:1,entries:[{id: importedId, tag:'second_shirt',subId:'top_type'}]}), true);
assert.equal(new Set(customCatalog.entries.map(entry => entry.id)).size, customCatalog.entries.length);
const originalId = customCatalog.entries.find(entry => entry.tag === 'shirt').id;
customCatalog.import({kind:'mooshie-custom-catalog',version:1,entries:[{id:'foreign',tag:'shirt',name:'Imported shirt',subId:'top_type'}]});
assert.equal(customCatalog.entries.find(entry => entry.tag === 'shirt').id, originalId);
assert.equal(customCatalog.entries.find(entry => entry.tag === 'shirt').preview, preview);
customCatalog.add({ id: originalId, tag:'shirt',name:'Imported shirt',subId:'top_type',preview:undefined });
assert.equal(customCatalog.entries.find(entry => entry.tag === 'shirt').preview, undefined);
// Reload a fresh store from the fallback persistence path after pending writes.
await new Promise(resolve => setImmediate(resolve));
cache.delete('src/lib/prompt-studio/custom-catalog.svelte.ts');
const reloadedCatalog = load('src/lib/prompt-studio/custom-catalog.svelte.ts').customCatalog;
await reloadedCatalog.load();
assert.equal(reloadedCatalog.entries.find(entry => entry.tag === 'my_dress').preview, preview);
assert.equal(reloadedCatalog.entries.length, customCatalog.entries.length);
console.log('Chosen previews survive updates, import and reload; imports keep unique IDs and built-in details remain intact.');

const secondId = customCatalog.entries.find(entry => entry.tag === 'second_shirt').id;
customCatalog.add({id:secondId,tag:'custom_shirt',name:'Merged shirt',subId:'top_type',preview});
assert.equal(customCatalog.entries.filter(entry => entry.tag === 'custom_shirt').length,1);
assert.equal(customCatalog.entries.find(entry => entry.tag === 'custom_shirt').id,secondId);

const { withContextOptions } = load('src/lib/prompt-studio/catalog-expansion.ts');
const liveGarment = withContextOptions({ id:'live', name:'New coat', tag:'unknown_coat' }, 'top_type');
assert.ok(liveGarment.modifiers.some(mod => mod.tag === 'striped'));
assert.ok(liveGarment.parts.some(part => part.name === 'Color'));
assert.equal(new Set(withContextOptions(liveGarment, 'top_type').parts.map(part => part.name)).size, liveGarment.parts.length);
assert.ok(studio.categories.find(cat => cat.id === 'tops').subs.find(sub => sub.id === 'top_type').variants.find(variant => variant.tag === 'custom_shirt').parts.some(part => part.name === 'Material'));
assert.equal(contextualTag({tag:'braid',category:'hair_style'}, {mods:[],quantity:'twin_braids',parts:{Color:'blue'}}), 'blue twin braids');
assert.equal(contextualTag({tag:'black_hair',category:'hair_color'}, {mods:['colored_tips'],secondary:'blue',parts:{}}), 'black hair with blue tips');
assert.equal(contextualTag({tag:'coat',category:'top_type'}, {mods:[],parts:{'Additional details':'@preset:night_sky, <lora:coat_style:1>, floral_print'}}), 'coat with @preset:night_sky, <lora:coat_style:1>, floral print');
const { inlineChunkToken } = load('src/lib/utils/promptChunkTokens.ts');
const token = inlineChunkToken(hair.name, hair.id);
promptPresets.update(hair.id, {name:'Переименованный макрос'});
assert.equal(promptPresets.resolveInline(token), 'black hair');
assert.ok(promptPresets.inlinePresetIds(token).has(hair.id));
assert.ok(promptPresets.slugs.has(hair.id));
const { insertPromptBlocks } = load('src/lib/utils/promptBlocks.ts');
const existingBlocks = [{name:'Old',content:'old'}];
const newBlocks = [{name:'New',content:'[red|blue], @[Небо]'}];
assert.equal(insertPromptBlocks(existingBlocks,newBlocks,'append')[1].content,newBlocks[0].content);
assert.equal(insertPromptBlocks(existingBlocks,newBlocks,'prepend')[0].name,'New');
assert.equal(insertPromptBlocks(existingBlocks,newBlocks,'replace').length,1);
assert.equal(insertPromptBlocks(existingBlocks,[{name:'Empty',content:' '}],'replace')[0].name,'Old');
console.log('Live/custom context, syntax preservation, stable macro references and block insertion modes passed.');

const { BooruSearchPager } = load('src/lib/utils/booru.ts');
const pager = new BooruSearchPager();
let pendingResponse;
booruRequest = () => new Promise(resolve => { pendingResponse = resolve; });
pager.reset('danbooru','old',2);
const stalePage = pager.loadNext();
assert.equal(await pager.loadNext(),null);
pager.reset('danbooru','new',2);
pendingResponse([{name:'old_tag',category:0,post_count:1}]);
assert.equal(await stalePage,null);
const requestedPages = [];
booruRequest = async (_, args) => {
  requestedPages.push(args.page);
  return [{name:'new_tag',category:0,post_count:10},{name:'second_tag',category:0,post_count:9}];
};
assert.equal((await pager.loadNext()).hasMore,true);
assert.equal((await pager.loadNext()).tags.length,0);
assert.equal(pager.hasMore,false);
assert.deepEqual(requestedPages,[1,2]);
pager.reset('danbooru','retry',2);
booruRequest = async () => {throw new Error('source unavailable');};
await assert.rejects(pager.loadNext(),/source unavailable/);
booruRequest = async (_,args) => {assert.equal(args.page,1);return [{name:'retried',category:0,post_count:1}];};
assert.equal((await pager.loadNext()).tags[0].name,'retried');
console.log('Booru pagination rejects stale pages, stops on repeated pages and retries without skipping results.');
