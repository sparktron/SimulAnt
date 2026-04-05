import test from 'node:test';
import assert from 'node:assert/strict';
import { barycentricWeights, clampPointToTriangle, normalizeWeights, weightsToPercent } from '../src/ui/triangleMath.js';

const a = { x: 90, y: 16 };
const b = { x: 16, y: 144 };
const c = { x: 164, y: 144 };

function approx(actual, expected, epsilon = 0.02) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('marker at each corner maps to 100/0/0', () => {
  const wa = normalizeWeights(barycentricWeights(a, a, b, c));
  const wb = normalizeWeights(barycentricWeights(b, a, b, c));
  const wc = normalizeWeights(barycentricWeights(c, a, b, c));

  assert.deepEqual(weightsToPercent(wa), { a: 100, b: 0, c: 0 });
  assert.deepEqual(weightsToPercent(wb), { a: 0, b: 100, c: 0 });
  assert.deepEqual(weightsToPercent(wc), { a: 0, b: 0, c: 100 });
});

test('marker at center maps to ~33/33/33', () => {
  const center = {
    x: (a.x + b.x + c.x) / 3,
    y: (a.y + b.y + c.y) / 3,
  };
  const weights = normalizeWeights(barycentricWeights(center, a, b, c));
  approx(weights.wA, 1 / 3);
  approx(weights.wB, 1 / 3);
  approx(weights.wC, 1 / 3);

  const percent = weightsToPercent(weights);
  assert.equal(percent.a + percent.b + percent.c, 100);
  assert.ok(percent.a >= 33 && percent.a <= 34);
  assert.ok(percent.b >= 33 && percent.b <= 34);
  assert.ok(percent.c >= 33 && percent.c <= 34);
});

test('point outside triangle is clamped inside bounds', () => {
  const outside = { x: 90, y: -40 };
  const clamped = clampPointToTriangle(outside, a, b, c);
  const weights = normalizeWeights(barycentricWeights(clamped, a, b, c));

  assert.ok(weights.wA >= 0 && weights.wB >= 0 && weights.wC >= 0);
  assert.ok(weights.wA <= 1 && weights.wB <= 1 && weights.wC <= 1);
  assert.equal(weightsToPercent(weights).a + weightsToPercent(weights).b + weightsToPercent(weights).c, 100);
});
