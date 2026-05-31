import test from 'node:test';
import assert from 'node:assert/strict';
import { FoodEconomySystem } from '../src/sim/systems/FoodEconomySystem.js';
import { SeededRng } from '../src/sim/rng.js';

// FoodEconomySystem.update only reads world geometry, the pellet list, its rng,
// and spawnFoodCluster — so lightweight fakes fully exercise the respawn logic.
function makeWorld() {
  return { width: 256, height: 256, nestX: 128, nestY: 128 };
}

function makePellets(unclaimed, claimed = 0) {
  const pellets = [];
  for (let i = 0; i < unclaimed; i += 1) pellets.push({ takenByAntId: null });
  for (let i = 0; i < claimed; i += 1) pellets.push({ takenByAntId: `ant-${i}` });
  return pellets;
}

function makeSystem(seed = 'food-econ', bootFoodTotal = 390) {
  const calls = [];
  const sys = new FoodEconomySystem({
    world: makeWorld(),
    colony: {},
    rng: new SeededRng(seed),
    spawnFoodCluster: (x, y, r, count) => calls.push({ x, y, r, count }),
    bootFoodTotal,
  });
  return { sys, calls };
}

// bootFoodTotal 390 → threshold floor(390 * 0.25) = 97, respawn count round(390/2) = 195.

test('does not respawn while available food is at or above the threshold', () => {
  const { sys, calls } = makeSystem();
  sys.update({ foodPellets: makePellets(97) }); // exactly at threshold
  assert.equal(calls.length, 0, 'threshold is inclusive — no spawn at exactly 97');

  sys.update({ foodPellets: makePellets(200) });
  assert.equal(calls.length, 0, 'plenty of food — no spawn');
});

test('respawns one concentrated cluster when available food falls below threshold', () => {
  const { sys, calls } = makeSystem();
  sys.update({ foodPellets: makePellets(50) });

  assert.equal(calls.length, 1, 'exactly one cluster per update tick');
  assert.equal(calls[0].count, 195, 'cluster size is half the boot total');
});

test('claimed pellets do not count toward available food', () => {
  const { sys, calls } = makeSystem();
  // 50 unclaimed + 100 claimed = 150 total, but only 50 are available (< 97).
  sys.update({ foodPellets: makePellets(50, 100) });
  assert.equal(calls.length, 1, 'claimed pellets are excluded, so this is a famine');
});

test('respawn drop lands on the surface band (y <= nestY - 2)', () => {
  const { sys, calls } = makeSystem();
  sys.update({ foodPellets: makePellets(0) });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].y <= 128 - 2, `drop y ${calls[0].y} must be above the horizon`);
});

test('respawn location is deterministic for a fixed seed', () => {
  const a = makeSystem('identical-seed');
  const b = makeSystem('identical-seed');
  a.sys.update({ foodPellets: makePellets(0) });
  b.sys.update({ foodPellets: makePellets(0) });
  assert.deepEqual(a.calls[0], b.calls[0], 'same seed → same drop');

  const c = makeSystem('different-seed');
  c.sys.update({ foodPellets: makePellets(0) });
  assert.notDeepEqual(c.calls[0], a.calls[0], 'different seed → different drop');
});

test('threshold scales with bootFoodTotal', () => {
  const { sys, calls } = makeSystem('scaled', 800); // threshold = 200, count = 400
  sys.update({ foodPellets: makePellets(150) });
  assert.equal(calls.length, 1, '150 < 200 threshold → respawn');
  assert.equal(calls[0].count, 400, 'cluster size tracks the larger boot total');
});
