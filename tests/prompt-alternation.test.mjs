import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText,
).toString('base64');
const escapeUrl = moduleUrl(fs.readFileSync(
  new URL('../src/lib/utils/promptSyntaxEscape.ts', import.meta.url), 'utf8',
));
const source = fs.readFileSync(
  new URL('../src/lib/utils/promptAlternation.ts', import.meta.url), 'utf8',
).replace('"./promptSyntaxEscape.js"', JSON.stringify(escapeUrl));
const { ALTERNATION_SAMPLERS, parsePromptAlternations, resolvePromptAlternation } =
  await import(moduleUrl(source));

test('scheduled artist alternation preserves weights and selects successive branches', () => {
  const raw = '<fromto[0.875]:[(@mik uneki:1.35)|(@artist:1.25)]||(painting:2.0)>';
  assert.equal(parsePromptAlternations(raw).length, 1);
  assert.equal(resolvePromptAlternation(raw, 0),
    '<fromto[0.875]:(@mik uneki:1.35)||(painting:2.0)>');
  assert.equal(resolvePromptAlternation(raw, 1),
    '<fromto[0.875]:(@artist:1.25)||(painting:2.0)>');
  assert.equal(resolvePromptAlternation(raw, 2), resolvePromptAlternation(raw, 0));
});

test('frontend, workflow validation and runtime agree on supported samplers', () => {
  const rust = fs.readFileSync(new URL(
    '../src-tauri/src/templates/prompt_alternation.rs', import.meta.url), 'utf8');
  const python = fs.readFileSync(new URL(
    '../src-tauri/src/comfyui/mooshie_nodes.py', import.meta.url), 'utf8');
  const rustSamplers = [...rust.match(/SUPPORTED_SAMPLERS[^=]*= &\[([\s\S]*?)\];/)[1]
    .matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const pythonSamplers = [...python.match(/_ALTERNATION_SAMPLER_FUNCTIONS = \{([\s\S]*?)\n\}/)[1]
    .matchAll(/"sample_([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...ALTERNATION_SAMPLERS].sort(), rustSamplers.sort());
  assert.deepEqual([...ALTERNATION_SAMPLERS].sort(), pythonSamplers.sort());
  for (const name of [
    'res_multistep', 'res_multistep_cfg_pp', 'res_multistep_ancestral',
    'res_multistep_ancestral_cfg_pp', 'euler_cfg_pp',
    'euler_ancestral_cfg_pp', 'dpmpp_2m_cfg_pp',
  ]) {
    assert.ok(ALTERNATION_SAMPLERS.has(name), name);
  }
  for (const name of ['heun', 'dpmpp_2s_ancestral_cfg_pp', 'dpm_adaptive']) {
    assert.ok(!ALTERNATION_SAMPLERS.has(name), name);
  }
});
