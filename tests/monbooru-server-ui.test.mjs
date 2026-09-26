import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

const section = () => read('src/lib/components/settings/MonbooruServerSection.svelte');
const api = () => read('src/lib/utils/api.ts');
const rust = () => read('src-tauri/src/commands/monbooru.rs');

test('the monbooru server panel is reachable, and every command it calls exists', () => {
  const page = read('src/lib/components/settings/SettingsPage.svelte');
  assert.match(page, /import MonbooruServerSection from "\.\/MonbooruServerSection\.svelte"/);
  assert.match(page, /<MonbooruServerSection \{config\} onsave=\{\(\) => autoSave\(\)\} \/>/);

  const component = section();
  const commands = [
    ['monbooru_install_status', 'monbooruInstallStatus'],
    ['monbooru_install_start', 'monbooruInstallStart'],
    ['monbooru_server_status', 'monbooruServerStatus'],
    ['monbooru_server_start', 'monbooruServerStart'],
    ['monbooru_server_stop', 'monbooruServerStop'],
  ];
  for (const [command, wrapper] of commands) {
    assert.match(api(), new RegExp(`ipcInvoke\\("${command}`), `${command} is not wrapped in api.ts`);
    assert.match(
      read('src-tauri/src/lib.rs'),
      new RegExp(`commands::monbooru::${command}`),
      `${command} is not registered`,
    );
    assert.equal(component.includes(wrapper), true, `${wrapper} is not used by the panel`);
  }
  // The backend commands are named exactly as the wrappers invoke them.
  for (const [command] of commands) {
    assert.match(rust(), new RegExp(`pub async fn ${command}\\b`), `${command} is not a command`);
  }
});

test('automatic setup behaves like Patchy: asked for, absent, and never over the user URL', () => {
  const component = section();
  assert.match(component, /config\?\.monbooru_auto_install !== false/);
  assert.match(component, /!installed && canInstall && !config\?\.monbooru_base_url/);
  assert.match(component, /await install\(true\)/);
  // Autostart from the panel is for the launch case only; the app does the same
  // at start-up in Rust, so both must agree on the flag.
  assert.match(component, /config\?\.monbooru_auto_start/);
  assert.match(read('src-tauri/src/lib.rs'), /monbooru_auto_start/);
});

test('an install reports progress on the channel the backend emits', () => {
  const component = section();
  assert.match(component, /ipcListen\("monbooru:install_progress"/);
  assert.match(rust(), /emit\("monbooru:install_progress"/);
  // Percentages are clamped, so a server reporting more than the total cannot
  // paint a bar past its own end.
  assert.match(component, /Math\.min\(\s*100,\s*Math\.round/);
});

test('a server this app started becomes the address the app talks to', () => {
  // Starting a server is only half the job: without the address, the monbooru
  // tab stays "not connected" while a server answers on the loopback.
  const rust = read('src-tauri/src/commands/monbooru.rs');
  const start = rust.slice(rust.indexOf('pub(crate) async fn start_managed_server'));
  const body = start.slice(0, start.indexOf('pub async fn monbooru_server_stop'));
  assert.match(body, /config\.monbooru_base_url\.trim\(\)\.is_empty\(\)/);
  assert.match(body, /config\.monbooru_base_url = crate::monbooru_server::local_url\(\)/);
  assert.match(body, /crate::config::save_config\(&snapshot\)/);

  // And the panel shows the field what the backend just wrote.
  const component = section();
  assert.match(component, /if \(config && !config\.monbooru_base_url && server\.url\)/);
  assert.match(component, /config\.monbooru_base_url = server\.url/);
});

test('the server MooshieUI did not start is never stopped', () => {
  const lib = read('src-tauri/src/lib.rs');
  assert.match(lib, /config\.monbooru_keep_alive/);
  assert.match(
    read('src-tauri/src/monbooru_server.rs'),
    /pub fn stop\(/,
    'stopping goes through the recorded identity, not a process name',
  );
  const component = section();
  assert.match(component, /disabled=\{busy \|\| server\?\.running !== true\}/, 'Stop needs our own process');
});

test('the settings the panel writes are the settings the backend reads', () => {
  const types = read('src/lib/types/index.ts');
  const rust_config = read('src-tauri/src/config.rs');
  for (const field of ['monbooru_auto_install', 'monbooru_auto_start', 'monbooru_keep_alive', 'monbooru_flavor']) {
    assert.match(types, new RegExp(`\\b${field}\\?:`), `${field} is missing from the frontend config`);
    assert.match(rust_config, new RegExp(`pub ${field}:`), `${field} is missing from AppConfig`);
  }
  assert.match(rust_config, /monbooru_auto_install: true/, 'the Patchy-matching default is on');
  assert.match(rust_config, /monbooru_flavor: "lite"/);
});

test('the field names the frontend reads are the field names the backend serializes', () => {
  // The struct is renamed to camelCase in Rust, so the interface has to speak
  // camelCase too — reading a snake_case name silently yields undefined, and
  // `canInstall ?? false` then renders "not supported on this platform" on a
  // platform that is supported.
  const rust = read('src-tauri/src/commands/monbooru.rs');
  // The serde attribute sits on the line above the struct, so the slice starts
  // before the declaration.
  const struct = rust.slice(rust.indexOf('pub struct MonbooruInstallStatus') - 160);
  assert.match(struct.slice(0, 240), /rename_all = "camelCase"/);
  assert.match(struct.slice(0, 1000), /pub can_install: bool/);

  const wrapper = read('src/lib/utils/api.ts').slice(
    read('src/lib/utils/api.ts').indexOf('export interface MonbooruInstallStatus'),
  );
  const declared = wrapper.slice(0, wrapper.indexOf('}'));
  for (const field of ['installed', 'version', 'executable', 'canInstall', 'flavor']) {
    assert.equal(declared.includes(`${field}:`), true, `${field} is missing from the wrapper`);
  }
  assert.equal(declared.includes('can_install:'), false, 'snake_case would never arrive');

  // The Patchy read-back is not renamed, so its wrapper is snake_case on
  // purpose. Pinning it here is what keeps the two from drifting apart.
  assert.match(read('src-tauri/src/commands/patchy.rs'), /pub layered_source: Option<String>/);
  assert.match(read('src/lib/utils/api.ts'), /layered_source: string \| null;/);
});

test('every locale carries the monbooru server strings', () => {
  const keys = [
    'monbooru.server.title',
    'monbooru.server.hint',
    'monbooru.server.state.installed',
    'monbooru.server.state.missing',
    'monbooru.server.state.unsupported',
    'monbooru.server.install',
    'monbooru.server.installing',
    'monbooru.server.downloading',
    'monbooru.server.install_done',
    'monbooru.server.install_failed',
    'monbooru.server.action_failed',
    'monbooru.server.running',
    'monbooru.server.stopped',
    'monbooru.server.start',
    'monbooru.server.stop',
    'monbooru.server.managed_note',
    'monbooru.server.auto_install',
    'monbooru.server.auto_install_desc',
    'monbooru.server.auto_start',
    'monbooru.server.auto_start_desc',
    'monbooru.server.keep_alive',
    'monbooru.server.flavor',
  ];
  for (const language of ['en', 'ru', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'zh', 'zh-tw']) {
    const locale = read(`src/lib/locales/${language}.ts`);
    for (const key of keys) {
      const occurrences = locale.split(`"${key}":`).length - 1;
      assert.equal(occurrences, 1, `${language} has ${occurrences} of ${key}`);
    }
  }
  // The placeholders the panel fills are the ones the strings declare.
  const en = read('src/lib/locales/en.ts');
  assert.match(en, /"monbooru\.server\.state\.installed": "[^"]*\{version\}/);
  assert.match(en, /"monbooru\.server\.running": "[^"]*\{pid\}/);
  assert.match(en, /"monbooru\.server\.install_failed": "[^"]*\{error\}/);
});
