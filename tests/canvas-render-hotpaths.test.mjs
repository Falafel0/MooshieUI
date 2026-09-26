// Contract: the two per-frame hot paths in CanvasStage keep their guards.
//
// 1. A hover colour sample costs a composite of every layer, which is why it may
//    only run at a readable rate while the box itself keeps following the pointer.
// 2. Mask content bounds are cached: reading them captures the layer and walks
//    every document pixel, and that used to happen on each pan and zoom frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/lib/components/canvas/CanvasStage.svelte', import.meta.url), 'utf8');

test('the hover colour sample is throttled before it composites the stage', () => {
    const start = src.indexOf('function updateTooltip');
    assert.ok(start > -1, 'updateTooltip must exist');
    const body = src.slice(start, start + 1600);
    const throttle = body.indexOf('TOOLTIP_SAMPLE_INTERVAL_MS');
    const composite = body.indexOf('stage.toCanvas');
    assert.ok(throttle > -1 && composite > -1, 'both the throttle and the composite must be present');
    assert.ok(throttle < composite, 'the throttle must be checked before the composite runs');
    assert.ok(body.indexOf('tooltipPos =') < throttle, 'the box follows the pointer on every frame');
});

test('mask content bounds are cached and the key ignores the viewport', () => {
    const start = src.indexOf('function layerContentBounds');
    assert.ok(start > -1, 'layerContentBounds must exist');
    const body = src.slice(start, src.indexOf('function nodeGeometry', start));
    const cacheHit = body.indexOf('contentBoundsCache?.key === key');
    const pixelRead = body.indexOf('canvas.exportMaskLayer');
    assert.ok(cacheHit > -1 && pixelRead > -1, 'the cache and the pixel read must both be present');
    assert.ok(cacheHit < pixelRead, 'the cache must be consulted before the pixel read');
    assert.ok(body.includes('node.getChildren().map'), 'only the children decide the geometry');
    assert.ok(!body.includes('nodeGeometry(node)'), 'the container itself moves with the viewport and must stay out of the key');
    assert.ok(body.includes('canvas.paintRevision'), 'painted pixels must invalidate the cache');
});
