// Exercise the real Writing component's request lifecycle without a DOM framework.
// Run: node scripts/test-prompt-studio-writing.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const component = new URL('../src/lib/components/prompt-studio/PromptStudioWriting.svelte', import.meta.url);
const source = fs.readFileSync(component, 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const effects = [];
const destroys = [];
const groups = [];
let userScope = ':alice';
let resolveRequest;
let rejectRequest;
const assistant = {
  isGenerating: false,
  isAvailable: true,
  async compose() {
    this.isGenerating = true;
    try { return await new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; }); }
    finally { this.isGenerating = false; }
  },
};
const boundaries = {
  '../../prompt-studio/tool-state.js': { restoreTool: (_name, defaults) => defaults, saveTool() {} },
  svelte: { onDestroy: callback => destroys.push(callback), untrack: callback => callback() },
  '../../prompt-studio/studio.svelte.js': { studio: { selected: [], groups: [], rawPrompt: undefined, addGroup: (name, content) => groups.push({ name, content }) } },
  '../../stores/promptAssistant.svelte.js': { promptAssistant: assistant },
  '../../stores/generation.svelte.js': { generation: { modelFamily: 'anima' } },
  '../../stores/locale.svelte.js': { locale: { t: key => key } },
  '../../utils/ipc.js': { userScopedKey: key => key + userScope },
};
const harness = `
module.exports = {
  compose, selectView, toggleAssistant, addResult, checkScope,
  setActive(value) { active = value; },
  setOpen(value) { assistantOpen = value; },
  describe(value, name = 'AI block') { description = value; groupName = name; },
  snapshot() { return { description, groupName, result, resultScope, error, composing, assistantOpen, scope, added, view }; },
};`;
const { outputText } = ts.transpileModule(source + harness, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const module = { exports: {} };
vm.runInNewContext(outputText, {
  module, exports: module.exports,
  require: name => { assert.ok(boundaries[name], `Unexpected component dependency: ${name}`); return boundaries[name]; },
  $state: value => value,
  $props: () => ({ active: true }),
  $effect: callback => effects.push(callback),
  console,
}, { filename: component.pathname });
const writing = module.exports;
const flushEffects = () => effects.forEach(callback => callback());
const reopen = () => {
  writing.setActive(true); flushEffects(); writing.setOpen(true);
  writing.toggleAssistant({ currentTarget: { open: true } });
};
flushEffects(); reopen(); writing.describe('A moonlit library', 'Moonlight');
const complete = writing.compose();
assert.equal(writing.snapshot().composing, true);
resolveRequest('  moonlit library, silver light  ');
await complete;
assert.equal(writing.snapshot().result, 'moonlit library, silver light');
writing.setActive(false); flushEffects();
assert.equal(writing.snapshot().result, 'moonlit library, silver light', 'Root navigation preserves completed AI output');
assert.equal(writing.snapshot().description, 'A moonlit library');
assert.equal(writing.snapshot().resultScope, 'mooshie.prompt-studio.writing:alice');
reopen();
writing.selectView('weights');
assert.equal(writing.snapshot().result, 'moonlit library, silver light', 'Switching to the converter preserves completed output');
writing.selectView('text'); reopen();
writing.setOpen(false); writing.toggleAssistant({ currentTarget: { open: false } });
assert.equal(writing.snapshot().result, 'moonlit library, silver light', 'Closing the assistant preserves completed output');
reopen(); writing.addResult();
assert.deepEqual(groups, [{ name: 'Moonlight', content: 'moonlit library, silver light' }]);
assert.equal(writing.snapshot().result, '');
assert.equal(writing.snapshot().added, true);

// Hidden in-flight requests are invalidated; late replies cannot create draft work.
const late = writing.compose();
writing.setActive(false); flushEffects();
assert.equal(writing.snapshot().composing, false);
resolveRequest('discard this hidden request'); await late;
assert.equal(writing.snapshot().result, '');
assert.equal(groups.length, 1);

// Closing details also invalidates delivery while retaining the typed description.
reopen(); const closed = writing.compose();
writing.setOpen(false); writing.toggleAssistant({ currentTarget: { open: false } });
resolveRequest('discard this closed request'); await closed;
assert.equal(writing.snapshot().result, '');
assert.equal(writing.snapshot().description, 'A moonlit library');

// Completed errors survive navigation so their explanation remains reviewable.
reopen(); const failed = writing.compose(); rejectRequest(new Error('Provider temporarily unavailable')); await failed;
const error = writing.snapshot().error;
assert.ok(error.includes('Provider temporarily unavailable'));
writing.selectView('weights'); assert.equal(writing.snapshot().error, error);
writing.selectView('text'); reopen();

// Account boundaries clear private local drafts and invalidate outstanding delivery.
const crossAccount = writing.compose();
userScope = ':bob'; flushEffects();
assert.equal(writing.snapshot().description, '');
assert.equal(writing.snapshot().groupName, '');
assert.equal(writing.snapshot().result, '');
assert.equal(writing.snapshot().error, '');
assert.equal(writing.snapshot().composing, false);
resolveRequest('Alice result must not appear for Bob'); await crossAccount;
assert.equal(writing.snapshot().result, ''); writing.addResult(); assert.equal(groups.length, 1);

reopen(); writing.describe('A new account draft'); const destroyed = writing.compose();
destroys.forEach(callback => callback()); resolveRequest('discard destroyed delivery'); await destroyed;
assert.equal(writing.snapshot().result, '');
console.log('Writing preserves completed drafts across navigation and rejects hidden, closed, cross-account and destroyed request delivery.');
