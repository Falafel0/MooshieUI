import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const dir = new URL('../src/lib/prompt-studio/data/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'));
const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/prompt-studio/collection-tools.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { resolveTemplate, artistPrompt, pairFlag, wardrobeCompatibility } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
test('every supplied file has an audited role and each duplicate points to an earlier copy', () => {
  const coverage = read('coverage.json'); assert.equal(coverage.length, 92);
  for (const row of coverage) { assert.equal(row.included, true); assert.ok(row.role); assert.match(row.sha256, /^[a-f0-9]{64}$/); if (row.duplicateOf) assert.ok(row.duplicateOf < row.copy); }
  const index = read('index.json'); assert.equal(index.distinctContent, new Set(coverage.map(row => row.duplicateOf ?? row.copy)).size);
});
test('collection counts, stable IDs, source memberships and artwork counts remain separate', () => {
  const index = read('index.json'); const names = new Set(); let artistCount = 0;
  for (const collection of index.collections) {
    const rows = collection.files.flatMap(read); assert.equal(rows.length, collection.count);
    if (collection.kind === 'artist') {
      for (const [tag,count,memberships] of rows) { assert.ok(!names.has(tag)); names.add(tag); assert.ok(memberships > 0 && memberships < 2 ** collection.sets.length); assert.ok(count === null || Number.isInteger(count)); assert.ok(!tag.startsWith('@')); artistCount++; }
    } else assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  }
  assert.equal(artistCount, 364080);
});
test('dictionary expansion keeps whitespace semantics, nested choices and escaped name parentheses', () => {
  const dictionaries = read('dictionaries.json');
  assert.equal(resolveTemplate('{@colors_shaded} dress', dictionaries, () => 0).text, 'white dress');
  assert.equal(resolveTemplate('{@colors_shaded} dress', dictionaries, () => .3).text, 'pale pink dress');
  assert.equal(resolveTemplate('{a|{b|c}}', dictionaries, () => .9).text, 'c');
  assert.equal(resolveTemplate(String.raw`\{literal\}, flower \(name\)`, dictionaries).text, String.raw`\{literal\}, flower \(name\)`);
  assert.equal(resolveTemplate('{@unknown}', dictionaries).unresolved, true);
});
test('all bundled templates can be resolved without unknown dictionaries', () => {
  const dictionaries = read('dictionaries.json');
  for (const row of read('templates.json')) assert.equal(resolveTemplate(row.tag, dictionaries, () => .4).unresolved, false, row.tag);
});
test('artist formatting escapes literal syntax and applies prefixes explicitly', () => {
  assert.equal(artistPrompt('artist (series)', false), String.raw`artist \(series\)`);
  assert.equal(artistPrompt('artist (series)', true), String.raw`@artist \(series\)`);
});
test('upper triangular bitmaps are symmetric and do not guess about unknown tags', () => {
  const tags = ['a','b','c','d']; const bits = Buffer.from([0b100101]).toString('base64');
  assert.equal(pairFlag(tags,bits,'a','b'),true); assert.equal(pairFlag(tags,bits,'b','a'),true);
  assert.equal(pairFlag(tags,bits,'a','c'),false); assert.equal(pairFlag(tags,bits,'c','d'),true);
  assert.equal(pairFlag(tags,bits,'a','a'),undefined); assert.equal(pairFlag(tags,bits,'missing','b'),undefined);
});
test('wardrobe advice uses veto, worlds, graph and measured pair scores without mutating selections', () => {
  const relations = {worlds:{tags:['a','b'],world:[0,1],worlds:['formal','beach'],table:[['own','odd'],['odd','own']],axes:{}},graph:{near:[[],[]],odd:[[],[]]},veto:{tags:['a','b'],bits:'AQ==',threshold:0},measure:{tags:['a','b'],bits:'AQ==',pairs:[[1,125],[]],precision:100,seen:0,unseen:-100,threshold:0}};
  const selected = ['b']; assert.deepEqual(wardrobeCompatibility(relations,'a',selected), [{other:'b',level:'conflict',score:1.25,worlds:['formal','beach']}]); assert.deepEqual(selected,['b']);
});
test('negative/context metadata and preview inventory remain out of positive tags', () => {
  const rows = read('characters.json'); const negative = rows.find(row => row.negative.length); assert.ok(negative);
  assert.ok(Array.isArray(negative.context)); assert.equal(typeof negative.tag,'string');
  const previews = read('preview-info.json'); assert.equal(Object.keys(previews.poses).length,1060); assert.ok(previews.open.length > 0);
  for (const collection of read('index.json').collections.filter(item => item.kind !== 'artist')) for (const row of collection.files.flatMap(read)) assert.ok(!/https?:\/\/|data:image/i.test(row.tag));
});
