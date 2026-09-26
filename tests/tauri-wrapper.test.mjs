// `npm run tauri build` is the documented way to produce a local binary, and it
// was broken: the override that keeps a keyless build from failing was passed as
// inline JSON through a shell, the shell stripped the quotes out of it, and cargo
// rejected the leftovers ("unexpected argument '{bundle:…}'"). These checks pin
// the shape of the arguments instead of trusting a build to notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareLocalConfig } from '../scripts/tauri-wrapper.mjs';

function keylessEnv() {
  const env = { ...process.env };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  return env;
}

test('a keyless local build gets a config file, not inline JSON', () => {
  const { args, cleanup } = prepareLocalConfig({ argv: ['build'], env: keylessEnv() });
  const file = args[2]?.replace(/"/g, '');
  try {
    assert.equal(args[0], 'build', 'the subcommand survives');
    assert.equal(args[1], '--config', 'the override is passed as a tauri flag');
    assert.ok(!String(args[2]).includes('{'), 'the override must not travel as inline JSON');
    assert.ok(fs.existsSync(file), `config file missing: ${file}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
      bundle: { createUpdaterArtifacts: false },
    });
  } finally {
    cleanup();
  }
  assert.ok(!fs.existsSync(file), 'the temp config is cleaned up after the build');
});

test('a signed build and other subcommands are left alone', () => {
  const signed = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: 'not-a-real-key' };
  assert.deepEqual(prepareLocalConfig({ argv: ['build'], env: signed }).args, ['build']);
  assert.deepEqual(prepareLocalConfig({ argv: ['dev'], env: keylessEnv() }).args, ['dev']);
  assert.deepEqual(
    prepareLocalConfig({ argv: ['build', '--bundles', 'nsis'], env: keylessEnv() }).args.slice(0, 3),
    ['build', '--bundles', 'nsis'],
    'caller flags come first, the override is appended',
  );
});
