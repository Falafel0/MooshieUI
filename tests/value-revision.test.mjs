import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('src/lib/utils/valueRevision.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {createValueRevision}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('unchanged image strings do not invalidate renders; scalar edits and same-length replacements do',()=>{
 const revision=createValueRevision(),source='data:image/png;base64,'+'A'.repeat(8*1024*1024);
 const initial=revision([source,12,24,1024,768]);
 assert.equal(revision([source,12,24,1024,768]),initial);
 assert.equal(revision([source,13,24,1024,768]),initial+1);
 assert.equal(revision([source.slice(0,-1)+'B',13,24,1024,768]),initial+2);
 assert.equal(revision([]),initial+3);assert.equal(revision([]),initial+3);
});
