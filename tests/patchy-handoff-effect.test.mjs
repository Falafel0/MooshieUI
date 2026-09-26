// The hand-off dialog's $effect is the difference between "Patchy saved my edit"
// and "the dialog quietly threw it away".
//
// Svelte 5 tracks every $state an effect reads — including reads that happen
// inside the functions the effect calls. prepare() and resetState() touch
// importInfo, importPreviewUrl and the rest of the panel, so an effect that
// calls them bare re-runs as soon as a read-back result lands: the document is
// re-exported, the state is reset, and the result the user just asked for is
// gone. Observed live: the hand-off document was rewritten every few seconds on
// its own, the import card dropped back to "Pending" right after a successful
// read, and the panel showed a fresh document next to a stale result.
//
// These checks keep the effect dependent on the dialog and the image only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SOURCE = new URL('../src/lib/components/PatchyHandoff.svelte', import.meta.url);

/** The body of the $effect that starts the hand-off, brace-matched. */
function prepareEffectBody(text) {
  const start = text.indexOf('$effect(() => {');
  assert.notEqual(start, -1, 'PatchyHandoff.svelte no longer has a $effect');
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('unclosed $effect in PatchyHandoff.svelte');
}

/** Drop every untrack(...) span: what is left is the part the effect tracks. */
function trackedPart(body) {
  let text = body;
  for (let index = text.indexOf('untrack('); index !== -1; index = text.indexOf('untrack(')) {
    let depth = 0;
    let end = -1;
    for (let i = text.indexOf('(', index); i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    assert.notEqual(end, -1, 'unclosed untrack( in the hand-off effect');
    text = text.slice(0, index) + text.slice(end + 1);
  }
  return text;
}

test('the hand-off effect starts the hand-off untracked', () => {
  const body = prepareEffectBody(fs.readFileSync(SOURCE, 'utf8'));
  assert.match(body, /prepare\(\)/, 'the effect must still start the hand-off');
  assert.match(body, /untrack\(/, 'prepare() runs untracked, or a read-back re-exports the document');
});

test('only the dialog and the image are tracked by the hand-off effect', () => {
  const body = prepareEffectBody(fs.readFileSync(SOURCE, 'utf8'));
  const tracked = trackedPart(body);
  assert.doesNotMatch(
    tracked,
    /prepare\s*\(/,
    'a tracked prepare() call makes the panel depend on the state prepare() writes',
  );
  assert.doesNotMatch(
    tracked,
    /resetState\s*\(/,
    'a tracked resetState() call makes the panel depend on the state it resets',
  );
  assert.match(tracked, /\bopen\b/, 'the effect re-runs when the dialog opens');
  assert.match(tracked, /\bimage\b/, 'the effect re-runs when a different image is handed off');
});

function namedFunctionBody(text, name) {
  const start = text.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `PatchyHandoff.svelte no longer has ${name}()`);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error(`unclosed ${name}()`);
}

test('opening the hand-off never launches Patchy without an explicit click', () => {
  const text = fs.readFileSync(SOURCE, 'utf8');
  assert.doesNotMatch(
    namedFunctionBody(text, 'prepare'),
    /\blaunch\s*\(/,
    'prepare() must prepare the document without unexpectedly opening Patchy',
  );
  assert.doesNotMatch(
    namedFunctionBody(text, 'installAndPrepare'),
    /\blaunch\s*\(/,
    'installing Patchy must not auto-open it; the Launch button is explicit',
  );
  assert.match(text, /onclick=\{launch\}/, 'keep Patchy launch behind its explicit button');
});
