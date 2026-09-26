import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../src-tauri/resources/patchy/mooshieui-return.js', import.meta.url), 'utf8');
function run(destination, linked = true) {
  const writes = [];
  runInNewContext(script, {
    app: { activeDocument: { path: 'C:/Mooshie/patchy_documents/portrait-abc.psd' } },
    patchy: {
      io: { fileExists: () => linked, writeTextFile: (path, data) => writes.push({path, ...JSON.parse(data)}) },
      ui: { showOptions: () => destination ? {destination} : null },
    },
    console: { log() {} },
  });
  return writes;
}
test('each Patchy return destination targets the same hand-off, including a PSD save', () => {
  for (const [label, target] of [['Gallery', 'gallery'], ['Canvas base', 'base'], ['Raster layer', 'raster'], ['Inpaint mask', 'mask'], ['Prompt region', 'region']]) {
    assert.deepEqual(run(label), [{path: 'C:/Mooshie/patchy_documents/portrait-abc.mooshie-request.json', target}]);
  }
});
test('cancelling sends nothing and an unrelated Patchy document is refused', () => {
  assert.deepEqual(run(null), []);
  assert.throws(() => run('Gallery', false), /no MooshieUI hand-off/);
});
