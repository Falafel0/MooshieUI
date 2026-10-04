import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/prompt-studio/weight-converter.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { convertWeights, formatWeightedTag } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('explicit weighted phrases round-trip with internal commas, newlines and precision', () => {
  const input = '  1girl, ( red hair,\nblue eyes :1.234567890123456), (artist:foo:0.8000)\n';
  const nai = convertWeights(input, 'sd', 'nai');
  assert.equal(nai.output, '  1girl, 1.234567890123456:: red hair,\nblue eyes ::, 0.8000::artist:foo::\n');
  assert.equal(nai.converted, 2);
  assert.deepEqual(nai.warnings, []);
  assert.deepEqual(convertWeights(nai.output, 'nai', 'sd'), { output: input, converted: 2, warnings: [] });
});

test('same-format conversion is an exact passthrough even for malformed syntax', () => {
  for (const format of ['sd', 'nai']) {
    const input = '  (broken], NaN::x, <from:0.5>(tag:2)\n';
    assert.deepEqual(convertWeights(input, format, format), { output: input, converted: 0, warnings: [] });
  }
});

test('escaped syntax remains literal, including escaped closers and double colons', () => {
  const input = String.raw`\(plain:2\), (artist_\(series\), \[name\], a\:\:b:1.25)`;
  const nai = convertWeights(input, 'sd', 'nai');
  assert.equal(nai.output, String.raw`\(plain:2\), 1.25::artist_\(series\), \[name\], a\:\:b::`);
  assert.deepEqual(nai.warnings, []);
  assert.equal(convertWeights(nai.output, 'nai', 'sd').output, input);
  assert.equal(convertWeights(String.raw`\1.2::literal\:\:`, 'nai', 'sd').converted, 0);
});

test('NovelAI numeric body parentheses are escaped as literals for SD', () => {
  const result = convertWeights('1.25::artist_(series), literal (text)::', 'nai', 'sd');
  assert.equal(result.output, String.raw`(artist_\(series\), literal \(text\):1.25)`);
  assert.equal(result.converted, 1);
  assert.deepEqual(result.warnings, []);
  assert.equal(convertWeights('1.2::red hair::', 'nai', 'sd').output, '(red hair:1.2)');
  assert.equal(convertWeights('1.2::year 2026::', 'nai', 'sd').output, '(year 2026:1.2)');
  assert.equal(convertWeights('1.2::year 2026::, 1.3::next phrase::', 'nai', 'sd').output, '(year 2026:1.2), (next phrase:1.3)');
});

test('plain numbers and identifiers do not become weights', () => {
  const input = '2026, 8k, 1girl, model_v2.5, foo1.25, 0.8, 99';
  for (const from of ['sd', 'nai']) {
    const result = convertWeights(input, from, from === 'sd' ? 'nai' : 'sd');
    assert.deepEqual(result, { output: input, converted: 0, warnings: [] });
  }
  assert.equal(convertWeights('model_v1.2::name::', 'nai', 'sd').converted, 0);
});

test('signed, zero and decimal weights retain their original number tokens', () => {
  for (const number of ['0', '-1.25', '+1.25', '.625', '1.', '1.0000000000000000001']) {
    const input = `(tag:${number})`;
    const nai = convertWeights(input, 'sd', 'nai');
    assert.equal(nai.output, `${number}::tag::`);
    assert.equal(convertWeights(nai.output, 'nai', 'sd').output, input);
  }
});

test('unbalanced and invalid weights remain unchanged and identify original spans', () => {
  const input = '(valid:1.2), (bad:NaN), (broken]';
  const result = convertWeights(input, 'sd', 'nai');
  assert.equal(result.output, '1.2::valid::, (bad:NaN), (broken]');
  assert.equal(result.converted, 1);
  assert.deepEqual(result.warnings, [
    { code: 'invalid_weight', start: input.indexOf('(bad'), end: input.indexOf('(bad') + '(bad:NaN)'.length },
    { code: 'unbalanced', start: input.indexOf('(broken'), end: input.length },
  ]);
  for (const malformed of ['NaN::tag::', 'Infinity::tag::', '1.2.3::tag::', '1e999::tag::']) {
    const converted = convertWeights(malformed, 'nai', 'sd');
    assert.equal(converted.output, malformed);
    assert.equal(converted.warnings[0].code, 'invalid_weight');
  }
  for (const malformed of ['1.2::missing close', '1.2::outer 1.1::inner::', '(missing close', '<lora:missing']) {
    const converted = convertWeights(malformed, malformed.startsWith('1') ? 'nai' : 'sd', malformed.startsWith('1') ? 'sd' : 'nai');
    assert.equal(converted.output, malformed);
    assert.equal(converted.warnings[0].code, 'unbalanced');
  }
});

test('control blocks protect their contents while surrounding weights still convert', () => {
  const blocks = [
    '<lora:model:0.8>',
    '<from:0.5>(inside:1.2)</from>',
    '<range:0.2:0.8>(inside, commas:1.1)</range>',
    '<region:0,0,1,1>(inside:1.5)</region>',
    '<segment:face,0.5,0.1>(inside:2)</segment>',
    '<fromto[0.5]:(before:1.2), (after:0.8)>',
    '<custom>(inside:2)</custom>',
  ];
  for (const block of blocks) {
    const result = convertWeights(`${block}, (outside:1.4)`, 'sd', 'nai');
    assert.equal(result.output, `${block}, 1.4::outside::`);
    assert.equal(result.converted, 1);
    assert.deepEqual(result.warnings, [{ code: 'unsupported', start: 0, end: block.length }]);
  }
  const trailing = '<segment:face>(inside:2), (still inside:1.2)';
  assert.equal(convertWeights(trailing, 'sd', 'nai').output, trailing);
  const nested = '(before <lora:model:1>, after:1.2)';
  assert.equal(convertWeights(nested, 'sd', 'nai').output, nested);
});

test('schedules, alternation and implicit SD attention stay intact with warnings', () => {
  for (const input of ['[a:b:.5]', '[a:.5]', '[a|b]', '(implicit)', '[implicit]', '{a|b}']) {
    const result = convertWeights(input, 'sd', 'nai');
    assert.equal(result.output, input);
    assert.equal(result.converted, 0);
    assert.ok(result.warnings.length > 0);
  }
  for (const input of ['[a:b:.5]', '[a:.5]', '[a|b]', '{a|b}', '{{a|b}}', '[[a:b:.5]]']) {
    const result = convertWeights(input, 'nai', 'sd');
    assert.equal(result.output, input);
    assert.equal(result.warnings[0].code, 'unsupported');
  }
});

test('simple legacy NAI wrappers use exact Mooshie multipliers without comma splitting', () => {
  const result = convertWeights('{{tag}}, [other], [[third]], {red hair, blue eyes}', 'nai', 'sd');
  assert.equal(result.output, '(tag:1.1025), (other:0.95), (third:0.9025), (red hair, blue eyes:1.05)');
  assert.equal(result.converted, 4);
  assert.deepEqual(result.warnings, []);
  const tenLayers = '{'.repeat(10) + 'tag' + '}'.repeat(10);
  assert.equal(convertWeights(tenLayers, 'nai', 'sd').output, '(tag:1.62889462677744140625)');
});

test('ambiguous nested and mixed weighted constructs are preserved as a whole', () => {
  const cases = [
    ['sd', '((inner:1.1):1.2)'],
    ['sd', '(outer (inner:1.1):1.2)'],
    ['sd', '(1.2::inner:::1.1)'],
    ['nai', '1.2::outer 1.1::inner::::'],
    ['nai', '1.2::1.1::inner::::'],
    ['nai', '1.2::outer (1.1::inner::) tail::'],
    ['nai', '{outer {inner}}'],
    ['nai', '{{a}{b}}'],
    ['nai', '[{inner}]'],
  ];
  for (const [from, input] of cases) {
    const result = convertWeights(input, from, from === 'sd' ? 'nai' : 'sd');
    assert.equal(result.output, input, input);
    assert.equal(result.converted, 0);
    assert.equal(result.warnings[0].code, 'ambiguous', input);
  }
});

test('adjacent numeric spans convert independently and empty spans do not', () => {
  assert.equal(convertWeights('1.2::a::0.8::b::', 'nai', 'sd').output, '(a:1.2)(b:0.8)');
  const empty = convertWeights('1.2::::', 'nai', 'sd');
  assert.equal(empty.output, '1.2::::');
  assert.equal(empty.warnings[0].code, 'ambiguous');
});

test('mixer formatting escapes literal delimiters and preserves finite number precision', () => {
  assert.equal(formatWeightedTag('artist_(series) [literal]', 1.25, 'sd'), String.raw`(artist_\(series\) \[literal\]:1.25)`);
  assert.equal(formatWeightedTag(String.raw`artist_\(series\)`, 1, 'sd'), String.raw`artist_\(series\)`);
  assert.equal(formatWeightedTag('{artist} [series] a::b', 0.875, 'nai'), String.raw`0.875::\{artist\} \[series\] a\:\:b::`);
  assert.equal(formatWeightedTag('tag', 1.23456789, 'sd'), '(tag:1.23456789)');
  assert.equal(formatWeightedTag('tag', 1e-7, 'nai'), '0.0000001::tag::');
  assert.equal(formatWeightedTag('tag', 1e21, 'sd'), '(tag:1000000000000000000000)');
  assert.equal(formatWeightedTag('(literal)', Infinity, 'sd'), String.raw`\(literal\)`);
});

test('large and deeply nested inputs are handled without recursion', () => {
  const input = '(tag:1.2), '.repeat(5000) + '('.repeat(2000) + 'broken';
  const result = convertWeights(input, 'sd', 'nai');
  assert.equal(result.converted, 5000);
  assert.equal(result.warnings.at(-1).code, 'unbalanced');
  assert.ok(result.output.endsWith('('.repeat(2000) + 'broken'));
});
