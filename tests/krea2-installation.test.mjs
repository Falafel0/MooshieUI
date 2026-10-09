import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const encoderSource = compile(fs.readFileSync(new URL('../src/lib/utils/krea2Encoder.ts', import.meta.url), 'utf8'));
const encoders = await import('data:text/javascript;base64,' + Buffer.from(encoderSource).toString('base64'));
const source = fs.readFileSync(new URL('../src/lib/utils/krea2UncensoredSetup.ts', import.meta.url), 'utf8').replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const compiled = compile(source);
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(download = async () => {}, options = {}) {
  const stock = 'qwen3-vl-4b_fp8.safetensors';
  const models = { remote: false, cacheScope: 'local', textEncoders: [stock, encoders.KREA2_UNCENSORED_ENCODER.filename], loras: [], async refresh() { return true; }, ...options };
  const generation = { modelFamily: 'krea2', useSplitModel: true, diffusionModel: 'krea2.safetensors', clipModel: stock, clipType: 'krea2', krea2UncensoredEncoder: false, saves: 0, saveSettings() { this.saves++; }, currentModelMetadataKey() { return this.diffusionModel; } };
  const deps = { generation, models, locale: { t: key => key }, notifications: { notifications: [], addLocalNotification() {} }, downloadModel: async (...args) => {
    await download(...args);
    if (args[1] === 'loras') models.loras = [...models.loras, args[2]];
    else models.textEncoders = [...models.textEncoders, args[2]];
  }, userScopedKey: key => key, ...encoders };
  const setup = new Function(...Object.keys(deps), `${compiled}; return { installKrea2Uncensored, setKrea2Uncensored };`)(...Object.values(deps));
  return { models, generation, ...setup };
}
test('model panel and notification share one installation', async () => {
  const pending = deferred(); let calls = 0;
  const f = fixture(async () => { calls++; await pending.promise; });
  const a = f.installKrea2Uncensored(), b = f.installKrea2Uncensored();
  pending.resolve(); await Promise.all([a,b]); assert.equal(calls, 1);
});
test('completion cannot replace an encoder after switching to another model', async () => {
  const pending = deferred(); const f = fixture(() => pending.promise);
  const installing = f.installKrea2Uncensored();
  f.generation.modelFamily = 'anima'; f.generation.diffusionModel = 'anima.safetensors'; f.generation.clipModel = 'anima-encoder.safetensors';
  pending.resolve(); await installing;
  assert.equal(f.generation.clipModel, 'anima-encoder.safetensors'); assert.equal(f.generation.krea2UncensoredEncoder, false);
});
test('failure waits for other transfers before unlocking retry', async () => {
  const pending = deferred(); let settled = false;
  const f = fixture((url, category) => category === 'loras' ? Promise.reject(new Error('download failed')) : pending.promise, { textEncoders: [] });
  const installing = f.installKrea2Uncensored().then(() => { settled = true; }, error => { settled = true; return error; });
  await new Promise(r => setImmediate(r)); const prematurelySettled = settled;
  pending.resolve(); const error = await installing;
  assert.equal(prematurelySettled, false); assert.match(String(error), /download failed/);
});
test('failed inventory refresh cannot report a completed activation', async () => {
  const f = fixture(undefined, { async refresh() { return false; } });
  await assert.rejects(f.installKrea2Uncensored()); assert.equal(f.generation.krea2UncensoredEncoder, false);
});
test('an empty picker filled by inventory refresh can activate the downloaded mode', async () => {
  const f = fixture(); f.generation.clipModel = null;
  f.models.refresh = async () => { f.generation.clipModel = encoders.KREA2_UNCENSORED_ENCODER.filename; return true; };
  await f.installKrea2Uncensored(); assert.equal(f.generation.krea2UncensoredEncoder, true);
});
test('turning off without a stock encoder preserves the active mode and selection', () => {
  const f = fixture(undefined, { textEncoders: [encoders.KREA2_UNCENSORED_ENCODER.filename] });
  f.generation.krea2UncensoredEncoder = true; f.generation.clipModel = encoders.KREA2_UNCENSORED_ENCODER.filename;
  f.setKrea2Uncensored(false); assert.equal(f.generation.clipModel, encoders.KREA2_UNCENSORED_ENCODER.filename); assert.equal(f.generation.krea2UncensoredEncoder, true); assert.equal(f.generation.saves, 0);
});
test('turning off with a stock encoder selects it and saves the disabled mode', () => {
  const f = fixture(); const stock = f.generation.clipModel;
  f.generation.krea2UncensoredEncoder = true; f.generation.clipModel = encoders.KREA2_UNCENSORED_ENCODER.filename;
  f.setKrea2Uncensored(false); assert.equal(f.generation.clipModel, stock); assert.equal(f.generation.krea2UncensoredEncoder, false); assert.equal(f.generation.saves, 1);
});
test('an incomplete install cannot enable the mode', () => {
  const f = fixture(); f.setKrea2Uncensored(true);
  assert.equal(f.generation.krea2UncensoredEncoder, false);
});
