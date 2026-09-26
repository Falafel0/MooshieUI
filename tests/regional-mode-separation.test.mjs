import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// The two mechanisms a run can have are separate, and each mode decides only for
// itself:
//   - a prompt region is an area of influence (conditioning),
//   - a mask layer in the inpaint workspace is an edit (one pass per mask).
// The canvas already promises this to the user ("Prompt regions ... never enter
// the inpaint chain", "does not ... add a generation pass"), so these tests hold
// the code to the interface's own words.

const strategy = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(
        fs.readFileSync(new URL('../src/lib/utils/regionalStrategy.ts', import.meta.url), 'utf8'),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
      ).outputText,
    ).toString('base64')
);

const FAMILIES = {
  anima: { isAnima: true, isSdxlLike: false, isNovelAi: false },
  sdxl: { isAnima: false, isSdxlLike: true, isNovelAi: false },
  other: { isAnima: false, isSdxlLike: false, isNovelAi: false },
  novelai: { isAnima: false, isSdxlLike: false, isNovelAi: true },
};

// What each mode must do. A mode never borrows another mode's answer.
const CONDITIONING = {
  txt2img: { anima: true, sdxl: true, other: false, novelai: false },
  img2img: { anima: false, sdxl: false, other: false, novelai: false },
  inpainting: { anima: true, sdxl: true, other: false, novelai: false },
  video: { anima: false, sdxl: false, other: false, novelai: false },
};

// Sequential edit passes belong to the inpaint workspace, and only to it.
const SEQUENTIAL_MASKS = {
  txt2img: { anima: false, sdxl: false, other: false, novelai: false },
  img2img: { anima: false, sdxl: false, other: false, novelai: false },
  inpainting: { anima: true, sdxl: true, other: true, novelai: false },
  video: { anima: false, sdxl: false, other: false, novelai: false },
};

test('every mode decides region conditioning for itself', () => {
  for (const [mode, perFamily] of Object.entries(CONDITIONING)) {
    for (const [family, facts] of Object.entries(FAMILIES)) {
      assert.equal(
        strategy.supportsRegionalConditioning({ mode, ...facts }),
        perFamily[family],
        `conditioning in ${mode} for ${family}`,
      );
    }
  }
});

test('sequential edit passes belong to the inpaint workspace alone', () => {
  for (const [mode, perFamily] of Object.entries(SEQUENTIAL_MASKS)) {
    for (const [family, facts] of Object.entries(FAMILIES)) {
      assert.equal(
        strategy.supportsSequentialEditMasks({ mode, ...facts }),
        perFamily[family],
        `sequential masks in ${mode} for ${family}`,
      );
    }
  }
});

test('the two mechanisms are independent of each other', () => {
  // A run takes sequential passes on its own terms: an unsupported family still
  // inpaints mask by mask, without region conditioning.
  assert.equal(strategy.supportsSequentialEditMasks({ mode: 'inpainting', ...FAMILIES.other }), true);
  assert.equal(strategy.supportsRegionalConditioning({ mode: 'inpainting', ...FAMILIES.other }), false);
  // And conditioning in a mode never turns regions into passes.
  assert.equal(strategy.supportsRegionalConditioning({ mode: 'inpainting', ...FAMILIES.anima }), true);
  assert.equal(strategy.supportsSequentialEditMasks({ mode: 'txt2img', ...FAMILIES.anima }), false);
});

// ---------------------------------------------------------------------------
// What the region helpers hand to the generate button.
// ---------------------------------------------------------------------------

const fixture = (globalThis.__regionalSeparationTest = {
  canvas: {
    isCanvasMode: true,
    layers: [],
    sortedLayers: [],
    exportMaskLayer: () => [1, 2, 3],
  },
  generation: { mode: 'inpainting', isAnima: true, denoise: 0.6, regionalPrompts: [], supportsRegionalConditioning: true },
  locale: { t: (key) => key },
  canvasPngBytes: async () => new Uint8Array([1, 2, 3]),
  uploadImageBytes: async (_bytes, name) => ({ name }),
});

const regionsSource = fs.readFileSync(new URL('../src/lib/utils/inpaintingRegions.ts', import.meta.url), 'utf8');
let regionsCode = ts.transpileModule(regionsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
regionsCode = regionsCode.replace(
  /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g,
  (_, names) => `const {${names}} = globalThis.__regionalSeparationTest;`,
);
const regions = await import('data:text/javascript;base64,' + Buffer.from(regionsCode).toString('base64'));

function maskLayer(id, extra = {}) {
  return { id, type: 'mask', visible: true, opacity: 1, ...extra };
}
function regionLayer(id, extra = {}) {
  return { id, type: 'region', visible: true, opacity: 1, regionalPrompt: 'red hair', ...extra };
}
function rasterLayer(id, extra = {}) {
  return { id, type: 'raster', visible: true, opacity: 1, ...extra };
}

const layerPanel = fs.readFileSync(
  new URL('../src/lib/components/canvas/layers/LayerPanel.svelte', import.meta.url),
  'utf8',
);
const canvasStage = fs.readFileSync(
  new URL('../src/lib/components/canvas/CanvasStage.svelte', import.meta.url),
  'utf8',
);

test('a raster layer is the picture, never a pass and never conditioning', async () => {
  fixture.generation.mode = 'inpainting';
  const raster = rasterLayer('raster-1', {
    positivePrompt: 'a raster prompt that must be ignored',
    denoise: 0.1,
    maskGrow: 9,
  });
  const bottom = maskLayer('mask-1');
  const top = maskLayer('mask-2');
  fixture.canvas.layers = [raster, bottom, top];
  fixture.canvas.sortedLayers = [raster, top, bottom];
  assert.deepEqual(
    regions.getRegionalChainRegions().map((pass) => pass.maskLayerId),
    ['mask-1', 'mask-2'],
    'only masks become passes',
  );
  const region = regionLayer('region-1');
  fixture.canvas.layers = [raster, region];
  fixture.canvas.sortedLayers = [raster, region];
  const conditioning = await regions.prepareConditioningRegions();
  assert.deepEqual(
    conditioning.map((entry) => entry.id),
    ['region-1'],
    'only regions condition the prompt',
  );
});

test('the panel numbers its passes with the same rule the chain runs them', () => {
  fixture.canvas.layers = [];
  fixture.canvas.sortedLayers = [];
  assert.deepEqual(
    regions
      .editMaskPassOrder([
        rasterLayer('raster-1'),
        maskLayer('top'),
        maskLayer('bottom', { visible: false }),
        maskLayer('middle'),
      ])
      .map((layer) => layer.id),
    ['middle', 'top'],
    'visible masks only, painted bottom to top',
  );
  assert.match(
    layerPanel,
    /processingOrder = \$derived\(editMaskPassOrder\(canvas\.sortedLayers\)\)/,
    'the #n badge must come from the shared order, or it can lie about which mask runs first',
  );
  assert.equal(
    /type === ['"]mask['"][^\n]*reverse\(\)/.test(layerPanel),
    false,
    'the panel must not keep its own copy of the order rule',
  );
});

test('a raster layer can never be exported as an edit mask', () => {
  const store = fs.readFileSync(new URL('../src/lib/stores/canvas.svelte.ts', import.meta.url), 'utf8');
  assert.match(
    store,
    /exportMaskLayer\(id: string\)[^]*?isMaskLayer\(layer\)/,
    'exportMaskLayer must refuse anything that is not a mask layer',
  );
  assert.match(
    store,
    /this\.layers\.filter\(\(layer\) => layer\.type === "mask"\)/,
    'the submitted mask must be built from mask layers only',
  );
});

test('the picture being edited is built from raster layers only', () => {
  const filters = [...canvasStage.matchAll(/\.filter\(\(l(?:ayer)?\) =>[^\n]*['"]raster['"][^\n]*\)/g)].map(
    (match) => match[0],
  );
  assert.ok(filters.length >= 1, 'the canvas must derive its picture from raster layers somewhere');
  for (const filter of filters) {
    assert.equal(
      /['"]mask['"]|['"]region['"]/.test(filter),
      false,
      `the base picture must not pull in masks or regions: ${filter}`,
    );
  }
});

test('text-to-image regions are never handed to the inpaint chain', () => {
  fixture.generation.mode = 'txt2img';
  fixture.generation.regionalPrompts = [{ id: 'gui-1', text: 'red hair', x: 0, y: 0, width: 0.5, height: 0.5 }];
  fixture.canvas.layers = [];
  fixture.canvas.sortedLayers = [];
  assert.deepEqual(
    regions.getRegionalChainRegions(),
    [],
    'a txt2img region is conditioning; it must not be readable as a chain region',
  );
});

test('in the inpaint workspace only mask layers are passes', () => {
  fixture.generation.mode = 'inpainting';
  fixture.generation.isAnima = true;
  const region = regionLayer('region-1');
  const mask = maskLayer('mask-1');
  fixture.canvas.layers = [region, mask];
  fixture.canvas.sortedLayers = [region, mask];
  // One plain mask is the ordinary inpaint mask, not a chain.
  assert.deepEqual(regions.getRegionalChainRegions(), []);

  // Two masks are two passes, in visual stack order (topmost last).
  const second = maskLayer('mask-2');
  fixture.canvas.layers = [region, mask, second];
  fixture.canvas.sortedLayers = [region, mask, second];
  const chain = regions.getRegionalChainRegions();
  assert.deepEqual(
    chain.map((r) => r.maskLayerId),
    ['mask-2', 'mask-1'],
    'passes run bottom to top',
  );
  assert.equal(
    chain.some((r) => r.maskLayerId === 'region-1'),
    false,
    'a prompt region must never be a pass of its own',
  );

  // A lone mask that drives its own denoise is a pass in its own right, because
  // its density has to reach the sampler as a per-pixel strength.
  const density = maskLayer('mask-3');
  density.densityDenoise = true;
  fixture.canvas.layers = [region, density];
  fixture.canvas.sortedLayers = [region, density];
  assert.deepEqual(
    regions.getRegionalChainRegions().map((r) => r.maskLayerId),
    ['mask-3'],
    'a mask whose density sets the denoise runs its own pass',
  );
  assert.equal(
    regions.getRegionalChainRegions()[0].densityDenoise,
    true,
    'and the flag travels with the pass',
  );
});

test('a painted region conditions text-to-image as well as an inpaint pass', async () => {
  const region = regionLayer('region-1', { regionalPrompt: 'red hair', regionalNegativePrompt: 'blue hair', regionalStrength: 0.8 });
  fixture.canvas.layers = [region];
  fixture.canvas.sortedLayers = [region];

  fixture.generation.mode = 'txt2img';
  fixture.generation.supportsRegionalConditioning = true;
  const txt2img = await regions.prepareConditioningRegions();
  assert.deepEqual(
    txt2img.map((entry) => entry.id),
    ['region-1'],
    'a region painted on the canvas is influence in text-to-image too',
  );
  assert.match(String(txt2img[0].mask_image), /^conditioning_mask_0_/, 'its own pixels travel as the region mask');
  assert.equal(txt2img[0].text, 'red hair');
  assert.equal(txt2img[0].negativeText, 'blue hair');
  assert.equal(txt2img[0].strength, 0.8);

  // img2img takes no regions at all, whatever the family.
  fixture.generation.mode = 'img2img';
  fixture.generation.supportsRegionalConditioning = false;
  assert.deepEqual(await regions.prepareConditioningRegions(), []);

  // An unsupported family drops them in every mode.
  fixture.generation.mode = 'inpainting';
  assert.deepEqual(await regions.prepareConditioningRegions(), []);

  // And a painted region without text says so, rather than being ignored.
  fixture.generation.mode = 'txt2img';
  fixture.generation.supportsRegionalConditioning = true;
  fixture.canvas.layers = [regionLayer('region-2', { regionalPrompt: '' })];
  fixture.canvas.sortedLayers = [regionLayer('region-2', { regionalPrompt: '' })];
  await assert.rejects(regions.prepareConditioningRegions(), /region_prompt_required/);
});

test('a painted region cannot stand in for an inpaint mask', () => {
  const source = fs.readFileSync(new URL('../src/lib/utils/inpaintingRegions.ts', import.meta.url), 'utf8');
  assert.equal(
    /hasSequentialInpaintRegionMask/.test(source),
    false,
    'a region is conditioning only: it does not permit pixel edits, so nothing may treat it as an edit mask',
  );
});

test('several masks run one pass each, bottom to top', () => {
  fixture.generation.mode = 'inpainting';
  // sortedLayers arrives top-first, the way the layer panel lists them; the
  // passes have to run the other way round so an upper mask paints over a
  // lower one, exactly as the panel hint promises.
  const layers = [maskLayer('top'), maskLayer('middle'), maskLayer('bottom')];
  fixture.canvas.layers = layers;
  fixture.canvas.sortedLayers = layers;
  const chain = regions.getRegionalChainRegions();
  assert.deepEqual(
    chain.map((pass) => pass.maskLayerId),
    ['bottom', 'middle', 'top'],
    'one pass per mask, painted bottom to top',
  );
});

test('a mask pass runs the global prompt, not a prompt of its own', () => {
  fixture.generation.mode = 'inpainting';
  const first = maskLayer('mask-1', { positivePrompt: 'red hair', negativePrompt: 'blue hair', denoise: 0.4 });
  const second = maskLayer('mask-2');
  fixture.canvas.layers = [first, second];
  fixture.canvas.sortedLayers = [first, second];
  const chain = regions.getRegionalChainRegions();
  assert.equal(chain.length, 2);
  for (const pass of chain) {
    assert.equal(pass.text, '', 'a mask must not carry a positive prompt of its own');
    assert.equal(pass.negativePrompt, '', 'a mask must not carry a negative prompt of its own');
  }
  const own = chain.find((pass) => pass.maskLayerId === 'mask-1');
  const inherited = chain.find((pass) => pass.maskLayerId === 'mask-2');
  assert.equal(own.denoise, 0.4, 'the mask still owns the denoise');
  assert.equal(inherited.denoise, 0.6, 'a mask without its own denoise follows the document');
});

test('only regions condition the prompt, and a mask cannot smuggle one in', async () => {
  fixture.generation.mode = 'inpainting';
  const region = regionLayer('region-1');
  const mask = maskLayer('mask-1', {
    positivePrompt: 'a mask prompt that must be ignored',
    negativePrompt: 'and this one too',
  });
  fixture.canvas.layers = [region, mask];
  fixture.canvas.sortedLayers = [region, mask];
  const conditioning = await regions.prepareConditioningRegions();
  assert.deepEqual(
    conditioning.map((entry) => entry.id),
    ['region-1'],
    'mask text is not a region prompt and must not reach the conditioning',
  );
  assert.equal(conditioning[0].text, 'red hair');
});

// ---------------------------------------------------------------------------
// The generate button and the region modal must follow one rule, not their own.
// ---------------------------------------------------------------------------

const generateButton = fs.readFileSync(
  new URL('../src/lib/components/generation/GenerateButton.svelte', import.meta.url),
  'utf8',
);

test('the generate button asks one question about the chain', () => {
  assert.match(
    generateButton,
    /generation\.supportsSequentialEditMasks/,
    'the chain decision must come from the shared rule',
  );
  assert.equal(
    /mode === "inpainting" && !generation\.isNovelAi && getRegionalChainRegions\(\)\.length > 0/.test(generateButton),
    false,
    'the mode must not carry its own copy of the rule: that is how a mode ends up deciding for the others',
  );
  assert.equal(
    /getValidRegionalSelectionsForInpaint/.test(generateButton),
    false,
    'txt2img regions must not be reachable from the chain path',
  );
});

test('the region modal no longer offers a strategy that cannot be reached', () => {
  const modal = fs.readFileSync(
    new URL('../src/lib/components/generation/RegionalPromptModal.svelte', import.meta.url),
    'utf8',
  );
  assert.equal(
    /canChooseRegionalStrategy/.test(modal),
    false,
    'the toggle was unreachable for every model family; the rule is derived per mode now',
  );
  assert.equal(
    /regionalPromptStrategy/.test(modal),
    false,
    'a persisted strategy would let one mode change how another behaves',
  );
});
