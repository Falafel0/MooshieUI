import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const { outputText } = ts.transpileModule(await readFile('src/lib/utils/layerRelations.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const relations = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const { isModifier, effectiveVisibility, layerRelationTarget, hasUsableLayerBindings,
  modifierAppliesToMask, validateLayerRelations, buildLayerRelationPlan, remapLayerRelations } = relations;
const layer = (id, type, patch = {}) => ({ id, type, visible: true, ...patch });
const groups = [{ id: 'face', name: 'Face', visible: true }, { id: 'body', name: 'Body', visible: true }];
const masks = [layer('face-edit', 'mask', { groupId: 'face' }), layer('body-edit', 'mask', { groupId: 'body' }), layer('loose-edit', 'mask')];

test('regions and ControlNets modify mask passes; rasters and masks are not modifiers', () => {
  assert.equal(isModifier(layer('p', 'region')), true);
  assert.equal(isModifier(layer('c', 'controlnet')), true);
  assert.equal(isModifier(layer('r', 'raster')), false);
  assert.equal(isModifier(masks[0]), false);
  for (const type of ['region', 'controlnet']) {
    const modifier = layer('modifier', type);
    const plan = buildLayerRelationPlan([...masks, modifier], groups);
    assert.deepEqual(plan.modifiers[0].targetMaskIds, masks.map(mask => mask.id));
    assert.equal(plan.edges.filter(edge => edge.kind === 'modifier-target').length, 3);
    assert.equal(modifierAppliesToMask(modifier, modifier.id, [...masks, modifier], groups), false);
  }
});

test('automatic scope follows membership while explicit document scope overrides it', () => {
  const modifier = layer('pose', 'controlnet', { groupId: 'face' });
  const all = [...masks, modifier];
  assert.equal(modifierAppliesToMask(modifier, 'face-edit', all, groups), true);
  assert.equal(modifierAppliesToMask(modifier, 'body-edit', all, groups), false);
  assert.equal(modifierAppliesToMask(modifier, 'loose-edit', all, groups), false);
  assert.equal(modifierAppliesToMask({ ...modifier, modifierScope: { mode: 'document' } }, 'body-edit', all, groups), true);
  assert.equal(modifierAppliesToMask({ ...modifier, groupId: null }, 'body-edit', all, groups), true);
});

test('an explicit whitelist never expands when empty, missing, wrong-role or partly deleted', () => {
  const region = layer('clothes', 'region', { modifierScope: { mode: 'masks', maskIds: ['body-edit', 'gone', 'pixels', 'body-edit'] } });
  const all = [...masks, layer('pixels', 'raster'), region];
  assert.equal(modifierAppliesToMask(region, 'body-edit', all, groups), true);
  assert.equal(modifierAppliesToMask(region, 'face-edit', all, groups), false);
  assert.equal(modifierAppliesToMask(region, 'pixels', all, groups), false);
  for (const maskIds of [[], undefined, ['gone'], ['pixels']]) {
    assert.equal(modifierAppliesToMask({ ...region, modifierScope: { mode: 'masks', maskIds } }, 'body-edit', all, groups), false);
  }
  const plan = buildLayerRelationPlan(all, groups);
  assert.deepEqual(plan.modifiers[0].targetMaskIds, ['body-edit']);
  assert.deepEqual(plan.modifiers[0].unresolvedMaskIds, ['gone', 'pixels']);
  assert.deepEqual(plan.issues.map(issue => issue.code), ['missing_target', 'invalid_target_role']);
  assert.equal(buildLayerRelationPlan(all.filter(item => item.id !== 'body-edit'), groups).modifiers[0].targetMaskIds.length, 0);
});

test('hidden groups and disabled modifiers preserve scope and fail closed for missing groups', () => {
  const modifier = layer('pose', 'controlnet', { groupId: 'face', controlnet: { enabled: true }, modifierScope: { mode: 'document' } });
  const all = [...masks, modifier];
  const hidden = groups.map(group => ({ ...group, visible: group.id !== 'face' }));
  assert.equal(effectiveVisibility(masks[0], hidden), false);
  assert.equal(modifierAppliesToMask(modifier, 'body-edit', all, hidden), false);
  assert.equal(modifierAppliesToMask({ ...modifier, controlnet: { enabled: false } }, 'face-edit', all, groups), false);
  assert.equal(modifierAppliesToMask({ ...modifier, visible: false }, 'face-edit', all, groups), false);
  assert.equal(modifierAppliesToMask({ ...modifier, groupId: 'missing' }, 'body-edit', all, groups), false);
  assert.equal(modifier.modifierScope.mode, 'document');
  assert.equal(effectiveVisibility(masks[1], hidden), true);
  const plan = buildLayerRelationPlan(all, hidden);
  assert.deepEqual(plan.modifiers[0].boundMaskIds, masks.map(mask => mask.id));
  assert.deepEqual(plan.modifiers[0].targetMaskIds, []);
  assert.equal(plan.edges.filter(edge => edge.kind === 'modifier-target').every(edge => !edge.active), true, 'disabled links stay visible without applying');
});

test('typed alpha/reference bindings allow a mask-raster pair without computed-alpha recursion', () => {
  const pixels = layer('pixels', 'raster', { clippingMaskId: 'cutout', clippingEnabled: true });
  const cutout = layer('cutout', 'mask', { targetRasterId: 'pixels', visible: false, coverage: 0 });
  const region = layer('prompt', 'region', { targetRasterId: 'pixels' });
  const control = layer('pose', 'controlnet', { referenceRasterId: 'pixels' });
  const all = [pixels, cutout, region, control];
  assert.deepEqual(validateLayerRelations(all), []);
  assert.equal(layerRelationTarget(pixels, 'clippingMaskId', all), cutout, 'raster clipping consumes painted alpha even when the mask is not an edit pass');
  assert.equal(layerRelationTarget(cutout, 'targetRasterId', all), pixels);
  assert.equal(layerRelationTarget(control, 'referenceRasterId', all), pixels);
  assert.equal(hasUsableLayerBindings(pixels, all), true);
  assert.equal(buildLayerRelationPlan(all).edges.find(edge => edge.kind === 'raster-clipping').active, true);
});

test('wrong roles and deleted active sources never silently substitute an unbound document', () => {
  const raster = layer('pixels', 'raster');
  const mask = layer('edit', 'mask', { targetRasterId: 'missing-raster' });
  const control = layer('pose', 'controlnet', { referenceRasterId: 'edit' });
  const wrongRole = layer('prompt', 'region', { clippingMaskId: 'edit' });
  const all = [raster, mask, control, wrongRole];
  assert.equal(hasUsableLayerBindings(mask, all), false);
  assert.equal(hasUsableLayerBindings(control, all), false);
  assert.equal(hasUsableLayerBindings(wrongRole, all), false);
  assert.equal(modifierAppliesToMask(layer('valid', 'region'), 'edit', all), false);
  assert.deepEqual(validateLayerRelations(all).map(issue => issue.code), ['missing_target', 'invalid_target_role', 'invalid_role']);
  assert.equal(hasUsableLayerBindings({ ...raster, clippingMaskId: 'missing', clippingEnabled: true }, all), false);
  assert.equal(hasUsableLayerBindings({ ...raster, clippingMaskId: 'missing', clippingEnabled: false }, all), true, 'explicitly disabling clipping is allowed and preserves the binding for repair');
});

test('duplicate ids and malformed scopes do not resolve ambiguously', () => {
  const duplicate = [masks[0], { ...masks[0] }, layer('pose', 'controlnet', { modifierScope: { mode: 'masks', maskIds: ['face-edit'] } })];
  assert.equal(modifierAppliesToMask(duplicate[2], 'face-edit', duplicate, groups), false);
  assert.ok(validateLayerRelations(duplicate, groups).some(issue => issue.code === 'duplicate_layer_id'));
  assert.equal(effectiveVisibility(masks[0], [...groups, groups[0]]), false);
  assert.ok(validateLayerRelations(masks, [...groups, groups[0]]).some(issue => issue.code === 'duplicate_group_id'));
  for (const modifierScope of [{ mode: 'typo' }, { mode: 'masks', maskIds: 'face-edit' }, { mode: 'masks', maskIds: [null] }]) {
    const bad = layer('bad', 'region', { modifierScope });
    assert.equal(modifierAppliesToMask(bad, 'face-edit', [...masks, bad], groups), false);
    assert.equal(validateLayerRelations([bad])[0].code, 'invalid_scope');
  }
  assert.equal(validateLayerRelations([layer('pixels', 'raster', { modifierScope: { mode: 'document' } })])[0].code, 'invalid_scope');
  assert.equal(validateLayerRelations([layer('prompt', 'region', { clippingEnabled: true })])[0].code, 'invalid_role');
});

test('two-pass id remapping rebases every relationship without mutating snapshots or widening broken scopes', () => {
  const mapping = new Map([['raster', 'raster-new'], ['mask', 'mask-new'], ['control', 'control-new']]);
  const groupMapping = new Map([['group', 'group-new']]);
  const original = layer('control', 'controlnet', { groupId: 'group', referenceRasterId: 'raster', modifierScope: { mode: 'masks', maskIds: ['mask', 'missing'] } });
  const mapped = remapLayerRelations(original, mapping, groupMapping);
  assert.equal(mapped.id, 'control-new');
  assert.equal(mapped.groupId, 'group-new');
  assert.equal(mapped.referenceRasterId, 'raster-new');
  assert.deepEqual(mapped.modifierScope.maskIds, ['mask-new', 'missing']);
  assert.deepEqual(original.modifierScope.maskIds, ['mask', 'missing']);
  assert.notEqual(mapped.modifierScope, original.modifierScope);
  assert.equal(remapLayerRelations(layer('raster', 'raster', { clippingMaskId: 'mask', clippingEnabled: false }), mapping).clippingMaskId, 'mask-new');
  assert.equal(remapLayerRelations(layer('mask', 'mask', { targetRasterId: 'raster' }), mapping).targetRasterId, 'raster-new');
  assert.deepEqual(remapLayerRelations(layer('control', 'controlnet', { modifierScope: { mode: 'masks', maskIds: [] } }), mapping).modifierScope.maskIds, []);
});
