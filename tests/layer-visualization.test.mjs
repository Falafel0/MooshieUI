import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

function walk(relative) {
  const out = [];
  for (const entry of fs.readdirSync(new URL(relative, root), { withFileTypes: true })) {
    const child = `${relative.replace(/\/$/, '')}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}

// The palette is importable on its own: no runtime imports, so a plain
// transpile is enough to exercise it.
const tintsCode = ts.transpileModule(read('src/lib/utils/layerTints.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const tints = await import('data:text/javascript;base64,' + Buffer.from(tintsCode).toString('base64'));

test('a mask, a region and a raster layer can be told apart at a glance', () => {
  assert.equal(tints.resolveTintKey({ type: 'mask' }), 'rose');
  assert.equal(tints.resolveTintKey({ type: 'region' }), 'violet');
  assert.equal(tints.resolveTintKey({ type: 'raster' }), 'sky');
  const colours = tints.LAYER_TINT_KEYS.map((key) => tints.LAYER_TINTS[key]);
  assert.equal(new Set(colours).size, colours.length, 'two keys must never share one colour');
  for (const colour of colours) {
    assert.match(
      colour,
      /^#[0-9a-f]{6}$/,
      `${colour} must be a literal colour, so the canvas and the interface can both use it`,
    );
  }
});

test('a chosen colour wins, and a stale key falls back instead of vanishing', () => {
  assert.equal(tints.resolveTint({ type: 'mask', tint: 'emerald' }), tints.LAYER_TINTS.emerald);
  assert.equal(tints.resolveTintKey({ type: 'region', tint: 'not-a-colour' }), 'violet');
  assert.equal(tints.resolveTintKey({ type: 'something-new' }), 'slate');
});

test('the layer colours are not duplicated across the components that draw them', () => {
  const duplicated = ['#fb7185', '#a78bfa', '#ff3333'];
  const offenders = [];
  for (const file of walk('src/lib')) {
    if (/locales\/|layerTints\.ts$/.test(file)) continue;
    const text = read(file);
    for (const colour of duplicated) {
      if (text.includes(colour)) offenders.push(`${file}: ${colour}`);
    }
  }
  assert.deepEqual(offenders, [], 'layer colours belong in the one palette, not in each component');
});

test('the type colours in the interface come from the same map', () => {
  const chrome = [
    'src/lib/components/canvas/layers/LayerItem.svelte',
    'src/lib/components/canvas/layers/LayerPanel.svelte',
    'src/lib/components/canvas/layers/LayerProperties.svelte',
    'src/lib/components/canvas/CanvasEditor.svelte',
    'src/lib/components/canvas/CanvasStatusBar.svelte',
  ];
  const stale = [
    'border-violet-500/50',
    'border-rose-500/50',
    'border-sky-500/40',
    'bg-violet-400',
    'bg-rose-400',
    'bg-sky-400',
    'text-violet-300',
    'text-rose-300',
    'text-sky-300',
  ];
  for (const file of chrome) {
    const text = read(file);
    for (const className of stale) {
      assert.equal(text.includes(className), false, `${file} still colours a layer with ${className}`);
    }
    assert.match(text, /resolveTint\(/, `${file} must draw layers in the shared palette colour`);
  }
});

test('the palette is offered as a choice, and the choice is stored on the layer', () => {
  const panel = read('src/lib/components/canvas/layers/LayerProperties.svelte');
  assert.match(panel, /LAYER_TINT_KEYS/);
  assert.match(panel, /canvas\.setLayerTint\(layer\.id/);
  assert.match(panel, /tint_note/);
  const store = read('src/lib/stores/canvas.svelte.ts');
  assert.match(store, /tint\?: string/);
  assert.match(store, /setLayerTint\(id: string, tint: string\)/);
});

test('a colour and an overlay strength are cosmetics: generation never reads them', () => {
  for (const file of [
    'src/lib/utils/regionalInpaintChain.ts',
    'src/lib/utils/inpaintingRegions.ts',
    'src/lib/stores/generation.svelte.ts',
    'src-tauri/src/templates/inpainting.rs',
    'src-tauri/src/templates/txt2img.rs',
  ]) {
    assert.equal(/\btint\b/.test(read(file)), false, `${file} must not read a display colour`);
    assert.equal(
      /maskOverlayOpacity/.test(read(file)),
      false,
      `${file} must not read the display strength`,
    );
  }
});

test('drawing a layer and generating from it read different numbers', () => {
  const stage = read('src/lib/components/canvas/CanvasStage.svelte');
  assert.match(
    stage,
    /const overlayDisplayScale = \(layer: \{ type: string \}\) =>\s*\n\s*layer\.type === "raster" \? 1 : canvas\.maskOverlayOpacity/,
    'only a mask or a region is drawn through the display strength',
  );
  assert.match(
    stage,
    /const displayOpacity = \(layer: \{ type: string; opacity: number \}\) =>\s*\n\s*layer\.opacity \* overlayDisplayScale\(layer\)/,
    'the canvas shows the layer density through that strength',
  );
  assert.match(
    read('src/lib/stores/canvas.svelte.ts'),
    /maskOverlayOpacity = \$state\(0\.45\)/,
    'the display strength is a display default, not a run setting',
  );
  const panel = read('src/lib/components/canvas/layers/LayerPanel.svelte');
  assert.match(panel, /canvas\.maskOverlayOpacity =/, 'the strength is adjustable from the panel');
});

test('changing a colour repaints what is already on the canvas', () => {
  const stage = read('src/lib/components/canvas/CanvasStage.svelte');
  assert.match(stage, /function paintLayerAsset/);
  assert.match(stage, /function repaintOverlayNodes/);
  assert.match(stage, /repaintOverlayNodes\(konvaLayers\.get\(layer\.id\)!, layer\)/);
  assert.match(
    stage,
    /node\.getAttr\(['"]tintKey['"]\) !== resolveTintKey\(layer\)/,
    'a recolour has to happen on the change, not on the next load',
  );
  const paint = stage.slice(
    stage.indexOf('function paintLayerAsset'),
    stage.indexOf('function repaintOverlayNodes'),
  );
  assert.equal(
    /isMaskLayer/.test(paint),
    false,
    'a region asset is drawn in its own tint exactly like a mask',
  );
  assert.match(paint, /layer\.type === ['"]raster['"]/, 'a raster layer is the picture, drawn as itself');
});

test('the density switch is wired from the panel to the sampler flag', () => {
  const panel = read('src/lib/components/canvas/layers/LayerProperties.svelte');
  assert.match(panel, /canvas\.setLayerDensityDenoise\(layer\.id/);
  assert.match(panel, /mask_density_denoise/);
  assert.match(panel, /mask_density_(range|flat)/, 'the panel says what strength will be used');
  const store = read('src/lib/stores/canvas.svelte.ts');
  assert.match(store, /densityDenoise\?: boolean/);
  assert.match(store, /setLayerDensityDenoise\(id: string, enabled: boolean\)/);
  assert.match(
    read('src/lib/utils/regionalInpaintChain.ts'),
    /differential_diffusion: differentialDiffusion \|\| !!region\.densityDenoise/,
  );
});

test('every string the new controls show exists in the base locale', () => {
  const en = read('src/lib/locales/en.ts');
  const keys = [
    'canvas.density',
    'canvas.density_title',
    'canvas.density_hint_mask',
    'canvas.density_hint_region',
    'canvas.tint_label',
    'canvas.tint_swatch',
    'canvas.tint_note',
    'canvas.overlay_strength',
    'canvas.overlay_strength_tip',
    'canvas.mask_density_denoise',
    'canvas.mask_density_on_note',
    'canvas.mask_density_off_note',
    'canvas.mask_density_range',
    'canvas.mask_density_flat',
  ];
  for (const key of keys) {
    assert.match(en, new RegExp(`"${key.replace(/\./g, '\\.')}":`), `${key} is missing`);
  }
});

test('no component keeps its own copy of the pass order', () => {
  const panel = read('src/lib/components/canvas/layers/LayerPanel.svelte');
  assert.match(panel, /editMaskPassOrder\(canvas\.sortedLayers\)/);
  assert.equal(
    /filter\([^)]*type === ['"]mask['"][^)]*\)\.reverse\(\)/.test(panel),
    false,
    'the numbering must ask the chain rule, not repeat it',
  );
});

test('the picture a run starts from is raster layers only', () => {
  const source = read('src/lib/utils/regionalInpaintChain.ts');
  assert.equal(/\btint\b|\bmaskOverlayOpacity\b/.test(source), false);
  const palette = path.posix.normalize('src/lib/utils/layerTints.ts');
  assert.equal(walk('src/lib').includes(palette), true);
});
