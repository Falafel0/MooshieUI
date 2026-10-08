import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/utils/inpaintSettings.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { normalizeInpaintSettings, withMaskProcessingSettings, DEFAULT_INPAINT_SETTINGS } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

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

const documentSettings = { settings: DEFAULT_INPAINT_SETTINGS, width: 1024, height: 768 };

test('processing inheritance preserves independent edit strength, growth, density and display', () => {
  for (const denoise of [0, 0.42, 1, undefined]) {
    const layer = { denoise, maskGrow: 8, densityDenoise: true, coverage: 0.75, opacity: 0.2, tint: 'rose' };
    const own = withMaskProcessingSettings(layer, documentSettings);
    const inherited = withMaskProcessingSettings(own, null);
    for (const result of [own, inherited]) {
      for (const [key, value] of Object.entries(layer)) assert.equal(result[key], value, key);
    }
    assert.equal(inherited.inpaintSettings, undefined);
    assert.equal(inherited.inpaintWidth, undefined);
  }
});

test('selecting the current processing mode cannot reset custom blur or dimensions', () => {
  const own = { inpaintSettings: { ...DEFAULT_INPAINT_SETTINGS, mask_blur: 17 }, inpaintWidth: 640, inpaintHeight: 384, inpaintAspectLocked: false };
  assert.equal(withMaskProcessingSettings(own, documentSettings), own);
  const inherited = { denoise: 0 };
  assert.equal(withMaskProcessingSettings(inherited, null), inherited);
});

test('new processing overrides own a copy of document settings and preserve saved dimensions', () => {
  const layer = { inpaintWidth: 512, inpaintHeight: 256, inpaintAspectLocked: false };
  const own = withMaskProcessingSettings(layer, documentSettings);
  assert.equal(own.inpaintWidth, 512);
  assert.equal(own.inpaintHeight, 256);
  assert.equal(own.inpaintAspectLocked, false);
  own.inpaintSettings.mask_blur = 17;
  assert.equal(documentSettings.settings.mask_blur, 4);
  assert.equal(layer.inpaintSettings, undefined);
});
