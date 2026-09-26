// The user-facing side of the Patchy hand-off.
//
// Correct bytes are not enough: the panel has to explain itself in the user's
// language. These checks fail when copy a user should see is missing from the UI,
// missing from a locale, or left in English where it is supposed to be translated
// — the three ways this panel can silently stop being understandable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'zh-tw', 'zh'];

function readLocale(name) {
  const text = fs.readFileSync(new URL(`../src/lib/locales/${name}.ts`, import.meta.url), 'utf8');
  const entries = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/.exec(line);
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

/** Every file that can put text in front of the user. */
function uiSources(dir = new URL('../src/', import.meta.url), found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) uiSources(child, found);
    else if (/\.(svelte|ts)$/.test(entry.name)) found.push(child);
  }
  return found;
}

const sources = uiSources().map((url) => ({ path: fileURLToPath(url), text: fs.readFileSync(url, 'utf8') }));
const locales = Object.fromEntries(LOCALES.map((name) => [name, readLocale(name)]));

// Keys this hand-off puts in front of the user, and whether the text is meant to
// differ per language. The two direction labels are product names and an arrow,
// so they read the same everywhere by design.
const COPY = [
  ['patchy.export_direction', false],
  ['patchy.import_direction', false],
  ['patchy.transfer_target', true],
  ['patchy.transfer_pending', true],
  ['patchy.transfer_failed', true],
  ['patchy.result_ready', true],
  ['patchy.refresh_result', true],
  ['patchy.size_changed_warning', true],
  ['patchy.mask_paint_hint', true],
  ['patchy.mask_nothing_painted', true],
  ['patchy.mask_size_mismatch', true],
  ['canvas.compare_with_original', true],
  ['canvas.compare_original_hint', true],
];

test('every message this panel shows is actually rendered somewhere', () => {
  for (const [key] of COPY) {
    const shown = sources.some((source) => source.text.includes(`"${key}"`));
    assert.ok(shown, `${key} exists in the locales but nothing shows it to the user`);
  }
});

test('every message is present in all 12 locales', () => {
  for (const name of LOCALES) {
    for (const [key] of COPY) {
      assert.equal(typeof locales[name][key], 'string', `${name}.ts is missing ${key}`);
    }
  }
});

test('the messages a user reads are translated, not left in English', () => {
  for (const name of LOCALES) {
    if (name === 'en') continue;
    for (const [key, translated] of COPY) {
      if (!translated) continue;
      assert.notEqual(
        locales[name][key],
        locales.en[key],
        `${name}.ts still shows the English text for ${key}`,
      );
    }
  }
});

test('the mask guidance tells the user what to do, and the refusals say why', () => {
  // The hint is only useful if it names the action, and each refusal is only
  // useful if it is distinguishable from the other one.
  assert.match(locales.en['patchy.mask_paint_hint'], /paint/i);
  assert.match(locales.en['patchy.mask_nothing_painted'], /differ|changed/i);
  assert.match(locales.en['patchy.mask_size_mismatch'], /resiz/i);
  assert.notEqual(
    locales.en['patchy.mask_nothing_painted'],
    locales.en['patchy.mask_size_mismatch'],
    'the two refusals describe different situations',
  );
});

test('the panel does not ship English sentences typed into the markup', () => {
  // A literal sentence in the markup would never reach the locale files. Keys and
  // product names are fine; a run of four or more words is not.
  const panel = fs.readFileSync(new URL('../src/lib/components/PatchyHandoff.svelte', import.meta.url), 'utf8');
  const body = panel.split('</script>')[1] ?? '';
  const literals = [...body.matchAll(/>([^<>{}]{12,})</g)]
    .map((match) => match[1].trim())
    .filter((text) => text.split(/\s+/).length >= 4 && /[a-z]/.test(text));
  assert.deepEqual(literals, [], `untranslated text in the markup: ${literals.join(' | ')}`);
});

test('every control in the hand-off and compare surfaces has a name', () => {
  // An icon-only button with no aria-label is invisible to a screen reader, and
  // svelte-check does not flag it. A user who cannot see the icon would be left
  // with an unnamed control in the middle of the round trip.
  const surfaces = [
    ['../src/lib/components/PatchyHandoff.svelte', 10],
    ['../src/lib/components/canvas/InpaintCompareDialog.svelte', 3],
  ];
  for (const [file, expected] of surfaces) {
    const body = fs.readFileSync(new URL(file, import.meta.url), 'utf8').split('</script>')[1] ?? '';
    const controls = [...body.matchAll(/<(button|select|input|textarea)\b[\s\S]*?<\/\1>/g)].map((m) => m[0]);
    const opened = [...body.matchAll(/<(input)\b[^>]*\/?>/g)].map((m) => m[0]);
    // A surface that suddenly exposes no controls would pass this check without
    // ever looking at one.
    assert.ok(
      controls.length + opened.length >= expected,
      `${file}: expected at least ${expected} controls, found ${controls.length + opened.length}`,
    );
    for (const control of [...controls, ...opened]) {
      const opening = control.slice(0, control.indexOf('>') + 1);
      if (/aria-label\s*=/.test(opening)) continue;
      const inner = control.slice(control.indexOf('>') + 1);
      const labelled =
        inner.includes('locale.t(') ||
        /(^|>)[^<>{}]*[A-Za-z]{2,}/.test(inner) ||
        /title\s*=/.test(opening);
      assert.ok(labelled, `${file}: unnamed control ${opening.slice(0, 140)}`);
    }
  }
});
