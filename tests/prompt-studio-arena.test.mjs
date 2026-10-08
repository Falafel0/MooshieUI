import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/prompt-studio/weight-converter.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { promptTokenRanges, parsePromptAtom, replacePromptToken } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const texts = prompt => promptTokenRanges(prompt).map(token => token.text);

test('pills keep weighted groups, nested attention and alternation intact', () => {
  assert.deepEqual(texts('girl, (blue hair, long hair:1.25), ((smile:0.8):1.1), [cat|dog], garden'), ['girl', '(blue hair, long hair:1.25)', '((smile:0.8):1.1)', '[cat|dog]', 'garden']);
});
test('scheduled and regional blocks remain complete editable atoms', () => {
  for (const block of ['<from:0.5>red, blue</from>', '<fromto[0.875]:[(artist:1.35)|(other:1.25)]||painting>', '<region:0,0,1,1>red, blue</region>', '<segment:face,0.5,0.1>red, blue</segment>', '<lora:my model:0.8>']) {
    assert.deepEqual(texts(`start, ${block}, end`), ['start', block, 'end']);
  }
});
test('NAI weights containing commas are one pill and retain exact offsets', () => {
  const prompt = '  one, 1.25::red, blue::, three  ';
  const tokens = promptTokenRanges(prompt);
  assert.deepEqual(tokens.map(token => token.text), ['one', '1.25::red, blue::', 'three']);
  for (const token of tokens) assert.equal(prompt.slice(token.start, token.end), token.text);
});
test('escaped punctuation, literal braces and malformed tails are not silently rewritten', () => {
  assert.deepEqual(texts(String.raw`foo\,bar, artist\(name\), {{chunk}}, (unfinished, comma`), [String.raw`foo\,bar`, String.raw`artist\(name\)`, '{{chunk}}', '(unfinished, comma']);
});
test('representable weights parse without stripping unsupported or extreme syntax', () => {
  assert.deepEqual(parsePromptAtom('(red, blue:0.65)'), { tag: 'red, blue', weight: .65 });
  assert.deepEqual(parsePromptAtom('1.25::red, blue::'), { tag: 'red, blue', weight: 1.25 });
  for (const prompt of ['{red}', '[red|blue]', '(red:0)', '(red:-1)', '(red:4)', '(red:NaN)', '((red:1.2):1.1)']) assert.deepEqual(parsePromptAtom(prompt), { tag: prompt, weight: 1 });
});
test('removing first, middle, last and only pills leaves adjacent prompt syntax intact', () => {
  const prompt = 'first, (middle, details:0.8), last';
  const tokens = promptTokenRanges(prompt);
  assert.equal(replacePromptToken(prompt, tokens[0].start, tokens[0].end, ''), '(middle, details:0.8), last');
  assert.equal(replacePromptToken(prompt, tokens[1].start, tokens[1].end, ''), 'first, last');
  assert.equal(replacePromptToken(prompt, tokens[2].start, tokens[2].end, ''), 'first, (middle, details:0.8)');
  assert.equal(replacePromptToken('(one:1.2)', 0, 9, ''), '');
});
test('a pill edit preserves all unrelated bytes and rejects invalid positions', () => {
  const prompt = 'first,\n  (middle:0.8),  <from:0.5>red, blue</from>';
  const token = promptTokenRanges(prompt)[1];
  assert.equal(replacePromptToken(prompt, token.start, token.end, '(new:0.65)'), 'first,\n  (new:0.65),  <from:0.5>red, blue</from>');
  assert.equal(replacePromptToken(prompt, -1, 3, 'new'), prompt);
  assert.equal(replacePromptToken(prompt, 3, 1, 'new'), prompt);
});
