import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const load = async (path) => {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
};
const { availableWorkspaces, availableSettingsShortcuts } = await load('../src/lib/utils/workspaces.ts');
const { filterCommands } = await load('../src/lib/utils/commands.ts');

test('navigation surfaces include PromptStudio and honor Model Hub permission and hidden workspaces', () => {
  const restricted = availableWorkspaces({ canUseModelhub: false, canUseVideo: true }).map(({ id }) => id);
  assert(restricted.includes('studio'));
  assert(restricted.includes('characters'));
  assert(!restricted.includes('modelhub'));
  assert(!restricted.includes('video'));
  assert(!restricted.includes('music'));
  assert(availableWorkspaces({ canUseModelhub: true, canUseVideo: false }).some(({ id }) => id === 'modelhub'));
});

test('command search matches localized labels, ignores accents/case, and requires every word', () => {
  const labels = { generate: 'Génération', studio: 'Студия промптов', settings: 'Настройки' };
  const commands = [
    { id: 'generate', labelKey: 'generate', keywords: 'image inpaint', run() {} },
    { id: 'studio', labelKey: 'studio', keywords: 'prompt draft', run() {} },
    { id: 'settings', labelKey: 'settings', keywords: 'preferences', run() {} },
  ];
  const search = (query) => filterCommands(commands, query, (key) => labels[key]).map(({ id }) => id);
  assert.deepEqual(search('GENERATION'), ['generate']);
  assert.deepEqual(search('  студия   DRAFT '), ['studio']);
  assert.deepEqual(search('НАСТРОЙКИ'), ['settings']);
  assert.deepEqual(search('image draft'), []);
  assert.deepEqual(search('   '), ['generate', 'studio', 'settings']);
});

test('project shortcuts are offered only in the desktop mode that supports project commands', () => {
  assert.deepEqual(availableSettingsShortcuts(true).map(({ id }) => id), ['appearance']);
  assert.deepEqual(availableSettingsShortcuts(false).map(({ id }) => id), ['appearance', 'projects']);
});

test('setting search includes the localized context description', () => {
  const labels = { sampler: 'Sampler', context: 'Настройка генерации' };
  const command = { id: 'sampler', labelKey: 'sampler', descriptionKey: 'context', run() {} };
  assert.deepEqual(filterCommands([command], 'настройка sampler', (key) => labels[key]), [command]);
  assert.deepEqual(filterCommands([command], 'галерея', (key) => labels[key]), []);
});
