import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const script = fs.readFileSync(new URL('../src/lib/components/generation/ModelSelector.svelte', import.meta.url), 'utf8').split('</script>')[0].replace(/^<script[^>]*>/, '');
const ast = ts.createSourceFile('selector.ts', script, ts.ScriptTarget.Latest, true);
const method = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ensureRequiredSplitEncoder');
const compiled = ts.transpileModule(method.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(download = async () => {}) {
  const generation = { useSplitModel: true, modelFamily: 'krea2', diffusionModel: 'original.safetensors', vae: null, clipModel: null, clipType: null, saves: 0, currentModelMetadataKey() { return this.diffusionModel; }, saveSettings() { this.saves++; } };
  const models = { loading: false, remote: false, cacheScope: 'local', serverModels: { diffusion_models: [generation.diffusionModel] }, textEncoders: [], vaes: [], async refresh() { return true; } };
  const req = { label: 'Krea 2', clipType: 'krea2', isEncoder: name => name === 'required-encoder.safetensors', isVae: name => name === 'required-vae.safetensors', encoderFile: { filename: 'required-encoder.safetensors', url: 'https://example/encoder', category: 'text_encoders' }, vaeFile: { filename: 'required-vae.safetensors', url: 'https://example/vae', category: 'vae' } };
  const deps = { generation, models, REQUIRED_SPLIT_ENCODERS: {}, pickKrea2Encoder: () => null, locale: { t: key => key }, downloadModel: download, cacheHashAfterDownload: async () => {}, console: { error() {} }, setTimeout: () => 0 };
  const code = `let requiredEncoderEnsureRunning=false, modelSelectorDestroyed=false, downloading=null, downloadError=''; const requiredEncoderFailed=new Set();let dlEntries={},dlOrder=[];${compiled};return { ensureRequiredSplitEncoder, dispose(){modelSelectorDestroyed=true}, error(){return downloadError} };`;
  return { generation, models, req, ...new Function(...Object.keys(deps), code)(...Object.values(deps)) };
}
test('automatic component setup cannot overwrite a newly selected model', async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  const installing = f.ensureRequiredSplitEncoder(f.req);
  f.generation.modelFamily = 'anima'; f.generation.diffusionModel = 'new.safetensors';
  f.generation.clipModel = 'new-encoder.safetensors'; f.generation.vae = 'new-vae.safetensors';
  pending.resolve(); await installing;
  assert.equal(f.generation.clipModel, 'new-encoder.safetensors'); assert.equal(f.generation.vae, 'new-vae.safetensors');
});
test('a destroyed model panel cannot apply a late downloaded selection', async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  const installing = f.ensureRequiredSplitEncoder(f.req); f.dispose(); pending.resolve(); await installing;
  assert.equal(f.generation.clipModel, null); assert.equal(f.generation.vae, null);
});
test('automatic setup waits for pending transfers after another transfer fails', async () => {
  const pending = deferred(); let settled = false;
  const f = fixture((url, category) => category === 'vae' ? Promise.reject(new Error('failed transfer')) : pending.promise);
  const installing = f.ensureRequiredSplitEncoder(f.req).then(() => { settled = true; });
  await new Promise(r => setImmediate(r)); const prematurelySettled = settled;
  pending.resolve(); await installing;
  assert.equal(prematurelySettled, false); assert.match(f.error(), /failed transfer/);
});
