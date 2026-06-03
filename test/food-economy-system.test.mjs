import test from 'node:test';
import assert from 'node:assert/strict';
import { FoodEconomySystem } from '../src/sim/systems/FoodEconomySystem.js';
import { SeededRng } from '../src/sim/rng.js';

// FoodEconomySystem.update reads world geometry, the colony's stored food and
// ant count, its rng, and spawnFoodCluster — lightweight fakes fully exercise
// the demand-tracking respawn logic (v0.36.0).
function makeWorld() {
  return { width: 256, height: 256, nestX: 128, nestY: 128 };
}

function makeSystem(opts = {}) {
  const calls = [];
  const colony = {
    foodStored: opts.foodStored ?? 0,
    ants: new Array(opts.ants ?? 100).fill({}),
  };
  const sys = new FoodEconomySystem({
    world: makeWorld(),
    colony,
    rng: new SeededRng(opts.seed ?? 'food-econ'),
    spawnFoodCluster: (x, y, r, count) => calls.push({ x, y, r, count }),
    bootFoodTotal: opts.bootFoodTotal ?? 390,
    reservePerAnt: opts.reservePerAnt ?? 12,
    minReserve: opts.minReserve ?? 300,
    dropCooldownTicks: opts.dropCooldownTicks ?? 180,
  });
  return { sys, calls, colony };
}

test('does not respawn while stored food is at or above the reserve floor', () => {
  // 100 ants × 12 = 1200 reserve floor.
  const { sys, calls } = makeSystem({ ants: 100, foodStored: 1200 });
  sys.update({ tick: 0 });
  assert.equal(calls.length, 0, 'floor is inclusive — no drop at exactly the floor');

  const big = makeSystem({ ants: 100, foodStored: 5000 });
  big.sys.update({ tick: 0 });
  assert.equal(big.calls.length, 0, 'plenty of stored food — no drop');
});

test('respawns one concentrated cluster when stored food falls below the floor', () => {
  const { sys, calls } = makeSystem({ ants: 100, foodStored: 500 }); // 500 < 1200
  sys.update({ tick: 0 });
  assert.equal(calls.length, 1, 'exactly one cluster when below the reserve floor');
  assert.equal(calls[0].count, 195, 'cluster size is half the boot total');
});

test('reserve floor scales with population (supply tracks demand)', () => {
  // 300 ants × 12 = 3600 floor; 2000 stored is a famine for this colony size.
  const big = makeSystem({ ants: 300, foodStored: 2000 });
  big.sys.update({ tick: 0 });
  assert.equal(big.calls.length, 1, 'large colony: 2000 stored is below its scaled floor → drop');

  // Same stored food, small colony: 50 × 12 = 600 floor; 2000 is plenty.
  const small = makeSystem({ ants: 50, foodStored: 2000 });
  small.sys.update({ tick: 0 });
  assert.equal(small.calls.length, 0, 'small colony: 2000 stored is above its floor → no drop');
});

test('minReserve floor protects a tiny colony', () => {
  // 5 ants × 12 = 60, but minReserve 300 wins.
  const { sys, calls } = makeSystem({ ants: 5, foodStored: 100, minReserve: 300 });
  sys.update({ tick: 0 });
  assert.equal(calls.length, 1, '100 < minReserve 300 → drop even for a tiny colony');
});

test('no respawn when the colony is extinct', () => {
  const { sys, calls } = makeSystem({ ants: 0, foodStored: 0 });
  sys.update({ tick: 0 });
  assert.equal(calls.length, 0, 'no ants → nothing to feed');
});

test('cooldown bounds the supply rate', () => {
  const { sys, calls } = makeSystem({ ants: 100, foodStored: 0, dropCooldownTicks: 180 });
  sys.update({ tick: 0 });
  assert.equal(calls.length, 1, 'first famine tick drops');
  sys.update({ tick: 100 });
  assert.equal(calls.length, 1, 'still within cooldown — no second drop');
  sys.update({ tick: 180 });
  assert.equal(calls.length, 2, 'cooldown elapsed — drops again');
});

test('respawn drop lands on the surface band, close to the nest', () => {
  const { sys, calls } = makeSystem({ ants: 100, foodStored: 0 });
  sys.update({ tick: 0 });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].y <= 128 - 2, `drop y ${calls[0].y} must be above the horizon`);
  const d = Math.hypot(calls[0].x - 128, calls[0].y - 128);
  assert.ok(d <= 31, `drop should be reachable (≤~30 tiles from nest), got ${d.toFixed(1)}`);
});

test('respawn location is deterministic for a fixed seed', () => {
  const a = makeSystem({ seed: 'identical', ants: 100, foodStored: 0 });
  const b = makeSystem({ seed: 'identical', ants: 100, foodStored: 0 });
  a.sys.update({ tick: 0 });
  b.sys.update({ tick: 0 });
  assert.deepEqual(a.calls[0], b.calls[0], 'same seed → same drop');

  const c = makeSystem({ seed: 'different', ants: 100, foodStored: 0 });
  c.sys.update({ tick: 0 });
  assert.notDeepEqual(c.calls[0], a.calls[0], 'different seed → different drop');
});

test('cluster size tracks bootFoodTotal', () => {
  const { sys, calls } = makeSystem({ ants: 100, foodStored: 0, bootFoodTotal: 800 });
  sys.update({ tick: 0 });
  assert.equal(calls[0].count, 400, 'cluster size is half the boot total');
});
