import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// The id generator runs in the browser; the rules it has to satisfy are enforced
// by `projects::is_safe_project_id` in src-tauri/src/projects.rs, because the id
// becomes a bare filename stem there. This test holds the two in step: the
// mirror below is deliberately written from the Rust source, not from the
// generator, so a generator bug cannot define its own passing test.
function backendAcceptsId(id) {
  if (!id || id.length > 128 || id === '.' || id === '..') return false;
  if (id.startsWith('.') || id.endsWith('.') || id.endsWith(' ')) return false;
  return ![...id].some(
    (character) =>
      character.codePointAt(0) < 0x20 || '/\\:*?"<>|'.includes(character),
  );
}

const idSource = fs.readFileSync(
  new URL('../src/lib/utils/projectId.ts', import.meta.url),
  'utf8',
);
const idModule = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(idSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText,
  ).toString('base64')}`
);
const { projectIdFromName, projectSlug, MAX_PROJECT_ID_LENGTH } = idModule;

test('every name a user can type produces an id the backend accepts', () => {
  const names = [
    'Character studies',
    '  padded  ',
    'Дом',
    '日本語のプロジェクト',
    'a/b\\c:d*e?f"g<h>i|j',
    '../../etc/passwd',
    '.hidden',
    'trailing.',
    'trailing ',
    '...',
    'x'.repeat(400),
    'ß ü ö',
    'emoji 🎨 project',
    '-dashes-',
    '---',
  ];
  for (const name of names) {
    const id = projectIdFromName(name);
    assert.ok(
      backendAcceptsId(id),
      `id ${JSON.stringify(id)} from name ${JSON.stringify(name)} must pass the backend's check`,
    );
    assert.ok(
      id.length <= MAX_PROJECT_ID_LENGTH,
      `id ${JSON.stringify(id)} must stay inside the backend's length limit`,
    );
  }
});

test('a name maps to a stable slug, and saves stay unique', () => {
  assert.equal(
    projectSlug('Character studies'),
    projectSlug('character   STUDIES'),
    'the slug must not depend on case or run-length of separators',
  );
  // The suffix is what keeps two projects saved under one name apart.
  assert.notEqual(
    projectIdFromName('Study', 'aaaaaaaa'),
    projectIdFromName('Study', 'bbbbbbbb'),
  );
  assert.equal(
    projectIdFromName('Study', 'aaaaaaaa'),
    projectIdFromName('Study', 'aaaaaaaa'),
    'the same name and suffix must give the same id, so a re-save updates one project',
  );
  assert.match(projectIdFromName('Study'), /^study-[0-9a-f]{8}$/);
});

test('names that leave no ASCII behind still get a usable id', () => {
  // Cyrillic and CJK strip to nothing; an empty id would be rejected by the
  // backend and would also collide with every other such name.
  for (const name of ['Дом', '日本語', '🎨🎨']) {
    assert.equal(projectSlug(name), 'project', `slug for ${name}`);
    assert.match(projectIdFromName(name), /^project-[0-9a-f]{8}$/);
  }
});

// ---------------------------------------------------------------------------
// The section's copy. A key that is missing from a locale renders as the key
// itself, and one left in English reads as a bug to a translated UI, so both
// are caught here rather than by eye.
// ---------------------------------------------------------------------------

const component = fs.readFileSync(
  new URL('../src/lib/components/settings/ProjectsSection.svelte', import.meta.url),
  'utf8',
);
const settingsPage = fs.readFileSync(
  new URL('../src/lib/components/settings/SettingsPage.svelte', import.meta.url),
  'utf8',
);

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'zh', 'zh-tw'];

function localeEntries(name) {
  const text = fs.readFileSync(new URL(`../src/lib/locales/${name}.ts`, import.meta.url), 'utf8');
  const entries = new Map();
  for (const line of text.split('\n')) {
    const match = /^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/.exec(line);
    if (match) entries.set(match[1], match[2]);
  }
  return entries;
}

test('every string the section shows exists in all 12 locales', () => {
  const used = [...component.matchAll(/locale\.t\(\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(used.length >= 12, `expected the section to show its own copy, found ${used.length} keys`);

  for (const locale of LOCALES) {
    const entries = localeEntries(locale);
    for (const key of used) {
      assert.ok(entries.has(key), `${locale}.ts is missing ${key}`);
      assert.ok(entries.get(key).trim().length > 0, `${locale}.ts has an empty ${key}`);
    }
  }
});

test('the section is translated, not left in English', () => {
  const english = localeEntries('en');
  // Take the strings from the component itself. A hand-counted threshold drifts
  // (it already did once) and a key nobody asks for proves nothing.
  const asked = [...component.matchAll(/locale\.t\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const needed = [...new Set(asked.filter((key) => key.startsWith('projects.')))].sort();
  assert.ok(needed.length >= 10, `the section must ask for its own strings, found ${needed.length}`);
  const missing = needed.filter((key) => !english.has(key));
  assert.deepEqual(missing, [], `en.ts is missing: ${missing.join(', ')}`);
  const projectKeys = [...english.keys()].filter((key) => key.startsWith('projects.'));
  for (const locale of LOCALES) {
    if (locale === 'en') continue;
    const entries = localeEntries(locale);
    // Without this the comparison below passes vacuously — no projects.* keys
    // at all means nothing to compare, which is the failure it must catch.
    assert.deepEqual(
      [...entries.keys()].filter((key) => key.startsWith('projects.')).sort(),
      [...projectKeys].sort(),
      `${locale}.ts does not carry the same projects.* keys as en.ts`,
    );
    const identical = projectKeys.filter((key) => entries.get(key) === english.get(key));
    assert.deepEqual(
      identical,
      [],
      `${locale}.ts still shows the English text for: ${identical.join(', ')}`,
    );
  }
});

test('the projects category is reachable from the settings list', () => {
  assert.match(
    settingsPage,
    /key: "projects",\s*labelKey: "settings\.sections\.projects"/,
    'the category must be listed, or the section has no way in',
  );
  assert.match(
    settingsPage,
    /case "projects":/,
    'the category needs an explicit visibility rule rather than the default',
  );
  assert.match(
    settingsPage,
    /activeCategory === "projects"[\s\S]{0,120}<ProjectsSection/,
    'the section must be mounted under its own category',
  );
});

test('every control in the section carries an accessible name', () => {
  const buttons = component.match(/<button[\s\S]*?<\/button>/g) ?? [];
  assert.ok(buttons.length >= 3, `expected save, load and delete buttons, found ${buttons.length}`);
  for (const button of buttons) {
    const hasText = /locale\.t\(/.test(button);
    const hasLabel = /aria-label=/.test(button);
    assert.ok(hasText || hasLabel, `a button has no name:\n${button}`);
  }

  // The text field is named by a real label, not only by its placeholder.
  const labelFor = /<label[^>]*for="([^"]+)"/.exec(component);
  assert.ok(labelFor, 'the project name field needs a label pointing at it');
  assert.match(component, new RegExp(`id="${labelFor[1]}"`), 'the label must target the field that exists');
});
