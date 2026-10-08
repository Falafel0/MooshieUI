import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../src-tauri/resources/patchy/mooshieui-connector.js', import.meta.url), 'utf8');
function run(destination, linked = true, target = '') {
  const writes = [];
  runInNewContext(script, {
    app: { activeDocument: { path: 'C:/Mooshie/patchy_documents/portrait-abc.psd' } },
    patchy: {
      args: target ? { target } : {},
      io: { fileExists: () => linked, writeTextFile: (path, data) => writes.push({path, ...JSON.parse(data)}) },
      ui: { showOptions: () => destination ? {destination} : null },
    },
    console: { log() {} },
  });
  return writes;
}
test('each Patchy connector destination targets the same hand-off, including a PSD save', () => {
  for (const [label, target] of [['Gallery', 'gallery'], ['Canvas base', 'base'], ['Raster layer', 'raster'], ['Inpaint mask', 'mask'], ['Prompt region', 'region']]) {
    assert.deepEqual(run(label), [{path: 'C:/Mooshie/patchy_documents/portrait-abc.mooshie-request.json', version: 2, target, source: 'MooshieUI Connector'}]);
  }
});
test('cancelling sends nothing and an unrelated Patchy document is refused', () => {
  assert.deepEqual(run(null), []);
  assert.throws(() => run('Gallery', false), /no MooshieUI hand-off/);
});

test('the connector is a visible Patchy script and supports unattended target selection', () => {
  assert.match(script, /^\/\/ @name MooshieUI Connector/m);
  assert.match(script, /^\/\/ @description /m);
  assert.match(script, /^\/\/ @cli --script-arg target=raster/m);
  assert.deepEqual(run(null, true, 'mask'), [{
    path: 'C:/Mooshie/patchy_documents/portrait-abc.mooshie-request.json',
    version: 2,
    target: 'mask',
    source: 'MooshieUI Connector',
  }]);
});

const exportScript = readFileSync(new URL('../src-tauri/resources/patchy/mooshieui-export.js', import.meta.url), 'utf8');
test('headless Patchy export reports success only when exportAs succeeds', () => {
  const calls = [], logs = [];
  const context = { app: {activeDocument: {exportAs: path => {calls.push(path); return true;}}}, patchy: {args: {out: '/tmp/result.png'}}, console: {log: message => logs.push(message)} };
  runInNewContext(exportScript, context);
  assert.deepEqual(calls, ['/tmp/result.png']);
  assert.equal(logs.length, 1);
  context.app.activeDocument.exportAs = () => false;
  logs.length = 0;
  assert.throws(() => runInNewContext(exportScript, context), /could not export/);
  assert.equal(logs.length, 0);
});
