import test from 'node:test';
import assert from 'node:assert/strict';
import { barycentricWeights, clampPointToTriangle, normalizedWeightsForPoint } from '../src/ui/TriangleControl.js';

const TRIANGLE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 5, y: 10 },
];

function almostEqual(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) <= epsilon;
}

test('marker at each corner maps to 100/0/0 barycentric weights', () => {
  const wa = barycentricWeights(TRIANGLE[0], TRIANGLE);
  assert.ok(almostEqual(wa.a, 1));
  assert.ok(almostEqual(wa.b, 0));
  assert.ok(almostEqual(wa.c, 0));

  const wb = barycentricWeights(TRIANGLE[1], TRIANGLE);
  assert.ok(almostEqual(wb.a, 0));
  assert.ok(almostEqual(wb.b, 1));
  assert.ok(almostEqual(wb.c, 0));

  const wc = barycentricWeights(TRIANGLE[2], TRIANGLE);
  assert.ok(almostEqual(wc.a, 0));
  assert.ok(almostEqual(wc.b, 0));
  assert.ok(almostEqual(wc.c, 1));
});

test('marker at triangle centroid is ~33/33/33', () => {
  const centroid = { x: (TRIANGLE[0].x + TRIANGLE[1].x + TRIANGLE[2].x) / 3, y: (TRIANGLE[0].y + TRIANGLE[1].y + TRIANGLE[2].y) / 3 };
  const w = barycentricWeights(centroid, TRIANGLE);

  assert.ok(Math.abs(w.a - 1 / 3) < 1e-6);
  assert.ok(Math.abs(w.b - 1 / 3) < 1e-6);
  assert.ok(Math.abs(w.c - 1 / 3) < 1e-6);
});

test('point outside triangle clamps to nearest edge and normalized weights sum to 1', () => {
  const outside = { x: 12, y: 9 };
  const clamped = clampPointToTriangle(outside, TRIANGLE);
  const w = normalizedWeightsForPoint(outside, TRIANGLE);

  assert.ok(clamped.x <= 10 && clamped.x >= 0);
  assert.ok(clamped.y <= 10 && clamped.y >= 0);

  const sum = w.a + w.b + w.c;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(w.a >= 0 && w.b >= 0 && w.c >= 0);
});
