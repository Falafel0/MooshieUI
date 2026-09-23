import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/utils/maskProcessing.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { processMaskCoverage } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('growth uses square max coverage and does not accumulate opacity', () => {
  const values = new Float32Array(25); values[12] = .5;
  const actual = processMaskCoverage(values, 5, 5, 1, 0, false);
  for (let y=0;y<5;y++) for(let x=0;x<5;x++) assert.equal(actual[y*5+x], x>=1&&x<=3&&y>=1&&y<=3 ? .5 : 0);
});
test('blur preserves fully masked borders', () => {
  const actual = processMaskCoverage(new Float32Array(25).fill(1), 5, 5, 0, 4, false);
  assert.ok(actual.every(value => Math.abs(value-1)<1e-6));
});
test('inversion happens before growth', () => {
  const values = new Float32Array(25).fill(1); values[12] = 0;
  const actual = processMaskCoverage(values, 5, 5, 1, 0, true);
  assert.equal(actual[6],1); assert.equal(actual[0],0);
});
test('sliding maximum matches a direct reference for non-square images', () => {
  const w=17,h=9;
  const values=Float32Array.from({length:w*h},(_,i)=>(i*13%37)/37);
  const actual=processMaskCoverage(values,w,h,3,0,false);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    let expected=0;
    for(let yy=Math.max(0,y-3);yy<=Math.min(h-1,y+3);yy++) for(let xx=Math.max(0,x-3);xx<=Math.min(w-1,x+3);xx++) expected=Math.max(expected,values[yy*w+xx]);
    assert.equal(actual[y*w+x],expected);
  }
});
