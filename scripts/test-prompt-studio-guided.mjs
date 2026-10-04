// Recipe behavior regressions without adding a frontend test framework.
// Run: node scripts/test-prompt-studio-guided.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
const storage = new Map();
const cache = new Map();
let userScope = '';
const fixtures = JSON.parse(fs.readFileSync(new URL('src/lib/prompt-studio/data/characters.json', root), 'utf8'));
const boundaries = {
  './collections.js': { collectionGroupKey: group => `prompt_studio.library.group.${group}`, collectionIndex: { collections: [{ id: 'characters', label: 'Characters' }] }, loadCollection: async id => id === 'characters' ? fixtures : [] },
  '../utils/ipc.js': { userScopedKey: key => `${key}${userScope}` },
  '../stores/locale.svelte.js': { locale: { t: key => key } },
};
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
    console, $state: Object.assign(value => value, { raw: value => value }), crypto: { randomUUID },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  }, { filename: path });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const choice = (tag, category, weight = 1) => ({ tag, category, name: tag, weight });
const group = (id, tags, extra = {}) => ({ id, mode: 'character', labelKey: id, options: tags.map(tag => ({ tag, labelKey: tag })), ...extra });
const { WORKFLOW_CATALOG, WORKFLOW_LOCALES, workflowGroups, randomizeWorkflow, resetWorkflow } = load('src/lib/prompt-studio/workflow-catalog.ts');
for (const mode of ['character', 'wardrobe', 'scene']) {
  assert.equal(workflowGroups(mode).length, 8);
  for (const row of workflowGroups(mode)) {
    assert.ok(row.id.startsWith(`recipe:${mode}:`));
    assert.ok(row.options.length >= 6 && row.options.length <= 12);
    for (const key of [row.labelKey, ...row.options.map(option => option.labelKey)]) {
      assert.equal(typeof WORKFLOW_LOCALES.en[key], 'string');
      assert.equal(typeof WORKFLOW_LOCALES.ru[key], 'string');
    }
  }
}
assert.equal(new Set(WORKFLOW_CATALOG.map(row => row.id)).size, 24);

const selected = [choice('locked_tag', 'locked'), choice('pinned_banned', 'pinned', 1.7), choice('shared', 'library'), choice('old', 'active')];
const groups = [group('locked', ['replacement']), group('pinned', ['pinned_banned', 'replacement']), group('active', ['banned', 'shared', 'allowed'])];
const shuffled = randomizeWorkflow(selected, groups, { locked: ['locked'], pinned: ['pinned_banned'], banned: ['pinned_banned', 'banned'], random: () => 0.99 });
assert.deepEqual(plain(shuffled.categories), ['pinned', 'active']);
assert.deepEqual(plain(shuffled.entries), [choice('pinned_banned', 'pinned', 1.7), choice('allowed', 'active')]);
const empty = randomizeWorkflow([choice('old', 'empty')], [group('empty', [])], { locked: [], pinned: [], banned: [], random: () => 0 });
assert.deepEqual(plain(empty), { categories: ['empty'], entries: [] });
const banned = randomizeWorkflow([], [group('active', ['one', 'two'])], { locked: [], pinned: [], banned: ['one', 'two'], random: () => 0 });
assert.equal(banned.entries.length, 0);
const optional = randomizeWorkflow([], [group('optional', ['one'], { optional: true })], { locked: [], pinned: [], banned: [], random: () => 0 });
assert.equal(optional.entries.length, 0);
const multiple = randomizeWorkflow([], [group('multi', ['one', 'two', 'three'], { multi: true })], { locked: [], pinned: [], banned: ['one'], random: () => 1 });
assert.deepEqual(plain(multiple.entries.map(row => row.tag)), ['three', 'two']);
const reset = resetWorkflow(selected, groups, { locked: ['locked'], pinned: ['pinned_banned'] });
assert.deepEqual(plain(reset), { categories: ['pinned', 'active'], entries: [choice('pinned_banned', 'pinned', 1.7)] });

const { studio } = load('src/lib/prompt-studio/studio.svelte.ts');
const { customCatalog } = load('src/lib/prompt-studio/custom-catalog.svelte.ts');
const { workflow } = load('src/lib/prompt-studio/workflow.svelte.ts');
const { library } = load('src/lib/prompt-studio/library.svelte.ts');
library.load(); for (const mode of ['character', 'wardrobe', 'scene']) library.select(mode, 'starter');
await customCatalog.load(); studio.load(); workflow.load();
assert.equal(customCatalog.categories.length, 0, 'Starter recipes never populate authored catalogs');
studio.selected = [choice('before', 'library'), choice('keep', 'target'), choice('remove', 'target'), choice('after', 'other')];
studio.details = { keep: { mods: ['retained'], parts: {} }, before: { mods: ['untouched'], parts: {} } };
studio.pinned = ['keep']; studio.banned = ['excluded']; studio.rawPrompt = '[literal|syntax], <chunk:a>';
studio.replaceChoices([choice('keep', 'target'), choice('new', 'target'), choice('new', 'target'), choice('after', 'target'), choice('wrong', 'ignored')], ['target']);
assert.deepEqual(plain(studio.selected.map(row => row.tag)), ['before', 'keep', 'new', 'after']);
assert.deepEqual(plain(studio.details.keep.mods), ['retained']);
assert.deepEqual(plain(studio.details.before.mods), ['untouched']);
assert.equal(studio.rawPrompt, '[literal|syntax], <chunk:a>');
assert.deepEqual(plain(studio.pinned), ['keep']); assert.deepEqual(plain(studio.banned), ['excluded']);
assert.equal(studio.history.length, 1, 'A bulk replacement is one undo step');
studio.replaceChoices([choice('keep', 'target'), choice('new', 'target')], ['target']);
assert.equal(studio.history.length, 1, 'No-op replacements create no undo entry');
studio.undo();
assert.deepEqual(plain(studio.selected.map(row => row.tag)), ['before', 'keep', 'remove', 'after']);
studio.redo();
assert.deepEqual(plain(studio.selected.map(row => row.tag)), ['before', 'keep', 'new', 'after']);

const subject = workflowGroups('character')[0];
const features = workflowGroups('character').find(row => row.multi);
workflow.choose('character', subject.id, subject.options[0].tag);
workflow.choose('character', subject.id, subject.options[1].tag);
assert.equal(studio.selected.filter(row => row.category === subject.id).length, 1);
assert.ok(studio.selected.some(row => row.tag === subject.options[1].tag));
workflow.choose('character', features.id, features.options[0].tag);
workflow.choose('character', features.id, features.options[1].tag);
assert.equal(studio.selected.filter(row => row.category === features.id).length, 2);
workflow.choose('character', features.id, features.options[0].tag);
assert.equal(studio.selected.filter(row => row.category === features.id).length, 1);
workflow.toggleLock(subject.id);
const lockedSubject = studio.selected.find(row => row.category === subject.id).tag;
const pinnedFeature = studio.selected.find(row => row.category === features.id).tag;
studio.pin(pinnedFeature);
workflow.randomize('character');
assert.equal(studio.selected.find(row => row.category === subject.id).tag, lockedSubject);
assert.ok(studio.selected.some(row => row.tag === pinnedFeature));
assert.ok(studio.selected.some(row => row.tag === 'before' && row.category === 'library'));
assert.equal(studio.rawPrompt, '[literal|syntax], <chunk:a>');
workflow.reset('character');
assert.deepEqual(plain(studio.selected.filter(row => row.category.startsWith('recipe:character:')).map(row => row.tag)), [lockedSubject, pinnedFeature]);
const historyBeforeGroup = studio.history.length;
const blockId = studio.addGroup('Tool output', '[one|two], (preserved:1.2)');
assert.equal(studio.groups.find(row => row.id === blockId).content, '[one|two], (preserved:1.2)');
assert.equal(studio.history.length, historyBeforeGroup + 1, 'Named content insertion is one undo step');
studio.undo();
assert.ok(!studio.groups.some(row => row.id === blockId));
studio.redo();
assert.equal(studio.groups.find(row => row.id === blockId).content, '[one|two], (preserved:1.2)');

// Existing tags from custom catalogs are selected globally, with their ownership
// and an unrelated current recipe choice intact when a Guided chip is clicked.
const eyeGroup = workflowGroups('character').find(row => row.id.endsWith(':eyes'));
const importedEye = choice('blue_eyes', 'user-catalog', 1.4);
studio.selected = [...studio.selected, importedEye, choice('green_eyes', eyeGroup.id)];
studio.details = { ...studio.details, blue_eyes: { mods: ['authored-context'], parts: {} } };
studio.save();
const beforeDuplicateClick = JSON.stringify(studio.selected);
const beforeDuplicateHistory = studio.history.length;
workflow.choose('character', eyeGroup.id, 'blue_eyes');
assert.equal(JSON.stringify(studio.selected), beforeDuplicateClick, 'A globally selected catalog tag does not replace a recipe choice');
assert.equal(studio.history.length, beforeDuplicateHistory, 'Clicking a shared-source tag is a no-op');
assert.equal(studio.selected.find(row => row.tag === 'blue_eyes').category, 'user-catalog');
assert.deepEqual(plain(studio.details.blue_eyes.mods), ['authored-context']);
workflow.clearGroup('character', eyeGroup.id);
assert.ok(studio.selected.some(row => row.tag === 'blue_eyes' && row.category === 'user-catalog'));
assert.ok(!studio.selected.some(row => row.category === eyeGroup.id), 'None only clears this recipe group');

userScope = ':alice'; workflow.load(); studio.load();
assert.equal(workflow.locked.length, 0); assert.equal(studio.selected.length, 0);
workflow.toggleLock(subject.id);
assert.deepEqual(JSON.parse(storage.get('mooshie.prompt-studio.workflow.v1:alice')).locked, [subject.id]);
userScope = ':bob'; library.select('character', 'starter');
// Mutations at a new account boundary must load its preferences before writing.
workflow.toggleLock(features.id);
assert.deepEqual(plain(workflow.locked), [features.id]);
assert.deepEqual(JSON.parse(storage.get('mooshie.prompt-studio.workflow.v1:alice')).locked, [subject.id]);
assert.deepEqual(JSON.parse(storage.get('mooshie.prompt-studio.workflow.v1:bob')).locked, [features.id]);
workflow.choose('character', subject.id, subject.options[0].tag);
assert.equal(studio.selected.length, 1);
userScope = ':alice'; workflow.load(); studio.load();
assert.deepEqual(plain(workflow.locked), [subject.id]); assert.equal(studio.selected.length, 0);
storage.set('mooshie.prompt-studio.workflow.v1:carol', JSON.stringify({ locked: [subject.id, subject.id, 'unknown', 4] }));
userScope = ':carol'; workflow.load();
assert.deepEqual(plain(workflow.locked), [subject.id, 'unknown'], 'Unavailable global set IDs remain locked until their datasets load');
console.log('Guided recipes, atomic draft changes, pinned/banned/locked randomization, resets and account boundaries passed.');

// Shared databases and editable global sets must change options in every mode,
// while the prompt remains a snapshot until an explicit composing action.
await library.fetch('characters');
library.select('character', 'database');
assert.equal(library.groups('character').flatMap(group => group.options).length, fixtures.length);
const copied = await library.copyCollection('characters');
assert.ok(copied);
assert.equal(customCatalog.entries.filter(row => customCatalog.categories.find(category => category.id === copied).subs.some(sub => sub.id === row.subId)).length, fixtures.length);
const global = customCatalog.addCategory('Shared edits');
const beforeEdit = studio.prompt;
const metadata = { id: 'row', tag: 'source_tag', name: 'Named source', subId: global, contextualTags: ['optional_detail'], aliases: ['alias'], description: 'kept', collectionData: { id: 'original', tag: 'source_tag', name: 'Source', group: 'body', negative: ['negative_tag'], meta: { zone: 'body' } } };
assert.ok(customCatalog.replaceSet(global, 'Shared edits', [], [metadata]));
assert.equal(studio.prompt, beforeEdit, 'Global data editing must not change the working prompt');
for (const mode of ['character', 'wardrobe', 'scene']) {
 library.select(mode, global);
 assert.equal(library.groups(mode)[0].options[0].tag, 'source_tag');
}
assert.ok(customCatalog.replaceSet(global, 'Shared edits', [], [{ ...metadata, tag: 'updated_tag' }]));
for (const mode of ['character', 'wardrobe', 'scene']) assert.equal(library.groups(mode)[0].options[0].tag, 'updated_tag');
assert.equal(customCatalog.entries.find(row => row.tag === 'updated_tag').collectionData.negative[0], 'negative_tag');
assert.equal(studio.prompt, beforeEdit);
workflow.choose('character', global, 'updated_tag');
assert.ok(studio.selected.some(row => row.tag === 'updated_tag'));
assert.equal(customCatalog.replaceSet(global, 'No duplicates', [], [metadata, metadata]), false);
const { parseGlobalSet } = load('src/lib/prompt-studio/catalog-model.ts');
assert.equal(parseGlobalSet('source_tag\nnew_tag\nsource_tag', 'txt', global, [metadata])[0].description, 'kept');
const large = JSON.stringify([{ ...metadata, description: 'x'.repeat(33 * 1024 * 1024) }]);
assert.equal(parseGlobalSet(large, 'json', global)[0].description.length, 33 * 1024 * 1024, 'Global set parsing has no 32 MiB cap');
assert.ok(customCatalog.replaceSet(global, 'Character only', ['character'], [metadata]));
assert.equal(library.groups('scene').length, 0);
const { restoreTool, saveTool } = load('src/lib/prompt-studio/tool-state.ts');
saveTool('test', { weights: [1.2, .8], query: 'kept', page: 7 });
assert.deepEqual(plain(restoreTool('test', { weights: [], query: '', page: 0 })), { weights: [1.2, .8], query: 'kept', page: 7 });
userScope = ':isolated';
assert.equal(restoreTool('test', { query: '' }).query, '');
console.log('Shared database coverage, global edits across modes, metadata, uncapped files and persistent scoped working state passed.');

const limited = randomizeWorkflow([choice('pinned', 'g0', 1.6)], Array.from({ length: 20 }, (_, i) => group(`g${i}`, [`new${i}`])), { locked: [], pinned: ['pinned'], banned: [], freshLimit: 4, random: () => .75 });
assert.equal(limited.categories.length, 20);
assert.equal(limited.entries.filter(row => row.tag.startsWith('new')).length, 4);
assert.equal(limited.entries.find(row => row.tag === 'pinned').weight, 1.6);
console.log('Full database randomization respects the requested detail budget and preserves pinned weights.');
