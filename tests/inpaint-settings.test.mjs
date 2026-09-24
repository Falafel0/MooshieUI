import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/utils/inpaintSettings.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { normalizeInpaintSettings } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('old one-axis padding is restored into the new context controls', () => {
  const settings = normalizeInpaintSettings({ padding: 48 });
  assert.equal(settings.context_padding_x, 48);
  assert.equal(settings.context_padding_y, 48);
  assert.equal(settings.preserve_context_aspect, true);
});

test('saved context controls are clamped and preserved independently', () => {
  const settings = normalizeInpaintSettings({
    context_padding_x: 12,
    context_padding_y: 88,
    context_shape: 'square',
    context_min_size: 768,
    preserve_context_aspect: false,
  });
  assert.deepEqual(
    [settings.context_padding_x, settings.context_padding_y, settings.context_shape, settings.context_min_size, settings.preserve_context_aspect],
    [12, 88, 'square', 768, false],
  );
});
