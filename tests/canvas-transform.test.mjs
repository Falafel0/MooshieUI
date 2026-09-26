import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

// The transform geometry is pure arithmetic with no runtime imports, so a plain
// transpile is enough to exercise it.
const code = ts.transpileModule(read('src/lib/utils/canvasTransform.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const geometry = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const { identityBox, projectNode, rotatedBounds, unionBounds, clampToDocument, isTransformable } = geometry;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

test('a box that only moves moves its shapes by the same amount', () => {
  const reference = identityBox(100, 100, 200, 150);
  const box = { ...reference, x: 140, y: 70 };
  const moved = projectNode({ x: 120, y: 130, rotation: 0, scaleX: 1, scaleY: 1 }, box, reference);
  assert.equal(moved.x, 160);
  assert.equal(moved.y, 100);
  assert.equal(moved.scaleX, 1);
  assert.equal(moved.scaleY, 1);
});

test('scaling the box scales every shape about the box origin, stroke included', () => {
  const reference = identityBox(50, 60, 100, 100);
  const box = { ...reference, width: 200, height: 300, scaleX: 2, scaleY: 3 };
  const scaled = projectNode({ x: 70, y: 80, rotation: 0, scaleX: 1, scaleY: 1, strokeWidth: 12 }, box, reference);
  // (70,80) sits 20 right and 20 down of the origin, so 2x and 3x land it at
  // 50+40 and 60+60.
  assert.equal(scaled.x, 90);
  assert.equal(scaled.y, 120);
  assert.equal(scaled.scaleX, 2);
  assert.equal(scaled.scaleY, 3);
  // A stroke keeps its weight relative to the shape: (2+3)/2.
  assert.equal(scaled.strokeWidth, 30);
});

test('turning the box turns the shapes with it, about the same origin', () => {
  const reference = identityBox(0, 0, 100, 100);
  const box = { ...reference, rotation: 90 };
  const turned = projectNode({ x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, box, reference);
  close(turned.x, 0, 'a shape 10 to the right of the origin ends up directly below it');
  close(turned.y, 10, 'a shape 10 to the right of the origin ends up directly below it');
  assert.equal(turned.rotation, 90);
});

test('scale and rotation together compose in that order', () => {
  const reference = identityBox(0, 0, 100, 100);
  const box = { ...reference, rotation: 90, scaleX: 2, scaleY: 2 };
  const projected = projectNode({ x: 10, y: 5, rotation: 0, scaleX: 1, scaleY: 1 }, box, reference);
  // 2x first: (20, 10). Then a quarter turn: (-10, 20).
  close(projected.x, -10, 'x after scale-then-turn');
  close(projected.y, 20, 'y after scale-then-turn');
});

test('a shape that is already turned keeps its own rotation and adds the box turn', () => {
  const reference = identityBox(0, 0, 10, 10);
  const box = { ...reference, rotation: 45 };
  const projected = projectNode({ x: 0, y: 0, rotation: 10, scaleX: 1, scaleY: 1 }, box, reference);
  assert.equal(projected.rotation, 55);
});

test('the box of a turned rectangle is the rectangle it occupies', () => {
  const turned = rotatedBounds(0, 0, 10, 20, 90);
  close(turned.width, 20, 'a quarter-turned 10x20 rectangle is 20 wide');
  close(turned.height, 10, 'and 10 tall');
  close(turned.x, -5, 'and stays centred on where it was');
  close(turned.y, 5, 'and stays centred on where it was');
});

test('covering box of a set of shapes, and nothing when there are none', () => {
  assert.equal(unionBounds([]), null);
  const union = unionBounds([identityBox(10, 10, 10, 10), identityBox(50, 40, 20, 20)]);
  assert.deepEqual({ x: union.x, y: union.y, width: union.width, height: union.height }, { x: 10, y: 10, width: 60, height: 50 });
});

test('a box is kept inside the document and an empty one is not transformable', () => {
  const clamped = clampToDocument(identityBox(-20, -5, 100, 100), 500, 500);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0);
  assert.equal(clamped.width, 80);
  assert.equal(clamped.height, 95);
  const barely = clampToDocument(identityBox(499, 499, 100, 100), 500, 500);
  assert.equal(isTransformable(barely), false, 'a box clamped to a sliver must not offer handles');
  assert.equal(isTransformable(identityBox(10, 10, 40, 40)), true);
});
