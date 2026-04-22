import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { isInNestSpatial } from '../src/sim/behavior/NestState.js';

test('isInNestSpatial follows below-surface spatial boundary', () => {
  const world = new World(32, 32);
  assert.equal(isInNestSpatial(world, world.nestX, world.nestY), false);
  assert.equal(isInNestSpatial(world, world.nestX, world.nestY + 1), true);
});

test('isInNestSpatial safely rejects invalid inputs', () => {
  const world = new World(32, 32);
  assert.equal(isInNestSpatial(null, 1, 1), false);
  assert.equal(isInNestSpatial(world, Number.NaN, 1), false);
  assert.equal(isInNestSpatial(world, 1, Number.NaN), false);
});
