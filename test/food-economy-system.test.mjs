import test from 'node:test';
import assert from 'node:assert/strict';
import { FoodEconomySystem } from '../src/sim/systems/FoodEconomySystem.js';
import { SeededRng } from '../src/sim/rng.js';

// FoodEconomySystem (v0.43.3 surface-count-gated strategy): a respawn fires when
// the number of FREE (unclaimed) surface pellets falls below minSurfacePellets,
// dropping one small cluster (bootFoodTotal/4) 60–100 tiles from the nest so ants
// must forage for it. It reads world geometry, the colony's ant count, its rng,
// and spawnFoodCluster — lightweight fakes fully exercise the logic.
//
// NOTE: this replaced the old v0.36.0 demand-tracking "reserve floor" model
// (reservePerAnt / minReserve / dropCooldownTicks / foodStored). Those params are
// orphaned — the constructor no longer reads them. See docs and config-integrity.
function makeWorld() {
  return { width: 256, height: 256, nestX: 128, nestY: 128 };
}

function makeSystem(opts = {}) {
  const calls = [];
  const colony = {
    ants: new Array(opts.ants ?? 100).fill({}),
  };
  const sys = new FoodEconomySystem({
    world: makeWorld(),
    colony,
    rng: new SeededRng(opts.seed ?? 'food-econ'),
    spawnFoodCluster: (x, y, r, count) => calls.push({ x, y, r, count }),
    bootFoodTotal: opts.bootFoodTotal ?? 390,
    minSurfacePellets: opts.minSurfacePellets ?? 200,
  });
  return { sys, calls, colony };
}

// Build N free pellets (+ optionally some already-claimed ones the floor ignores).
function pellets(free, taken = 0) {
  const out = [];
  for (let i = 0; i < free; i += 1) out.push({ takenByAntId: null });
  for (let i = 0; i < taken; i += 1) out.push({ takenByAntId: `ant-${i}` });
  return out;
}

test('does not respawn while free surface pellets are at or above the floor', () => {
  // Exactly at the floor is inclusive (>= threshold short-circuits).
  const atFloor = makeSystem({ minSurfacePellets: 200 });
  atFloor.sys.update({ foodPellets: pellets(200) });
  assert.equal(atFloor.calls.length, 0, 'floor is inclusive — no drop at exactly the floor');

  const plenty = makeSystem({ minSurfacePellets: 200 });
  plenty.sys.update({ foodPellets: pellets(500) });
  assert.equal(plenty.calls.length, 0, 'plenty of free pellets — no drop');
});

test('respawns one concentrated cluster when free pellets fall below the floor', () => {
  const { sys, calls } = makeSystem({ minSurfacePellets: 200 });
  sys.update({ foodPellets: pellets(50) }); // 50 < 200
  assert.equal(calls.length, 1, 'exactly one cluster when below the surface floor');
  assert.equal(calls[0].count, 98, 'cluster size is a quarter of the boot total (390/4)');
});

test('only FREE pellets count toward the floor — claimed pellets do not', () => {
  // 50 free + 300 claimed: total 350 but only 50 are available → still a famine.
  const { sys, calls } = makeSystem({ minSurfacePellets: 200 });
  sys.update({ foodPellets: pellets(50, 300) });
  assert.equal(calls.length, 1, 'claimed pellets are spoken for and do not satisfy the floor');
});

test('the surface floor is configurable, and per-tick config overrides the default', () => {
  // Constructor floor.
  const ctor = makeSystem({ minSurfacePellets: 80 });
  ctor.sys.update({ foodPellets: pellets(100) });
  assert.equal(ctor.calls.length, 0, '100 free >= constructor floor 80 → no drop');

  // config.minSurfacePellets wins over the constructor value.
  const overridden = makeSystem({ minSurfacePellets: 80 });
  overridden.sys.update({ foodPellets: pellets(100), config: { minSurfacePellets: 200 } });
  assert.equal(overridden.calls.length, 1, 'config floor 200 > 100 free → drop');
});

test('no respawn when the colony is extinct', () => {
  const { sys, calls } = makeSystem({ ants: 0 });
  sys.update({ foodPellets: pellets(0) });
  assert.equal(calls.length, 0, 'no ants → nothing to feed, even with zero pellets');
});

test('an empty / missing foodPellets list reads as a famine and drops', () => {
  const { sys, calls } = makeSystem({ minSurfacePellets: 200 });
  sys.update({}); // foodPellets defaults to [] → 0 free < floor
  assert.equal(calls.length, 1, 'no surface pellets at all is the strongest famine signal');
});

test('respawn drop lands on the surface band, well away from the nest', () => {
  const { sys, calls } = makeSystem({ minSurfacePellets: 200 });
  sys.update({ foodPellets: pellets(0) });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].y <= 128 - 2, `drop y ${calls[0].y} must be above the horizon`);
  const d = Math.hypot(calls[0].x - 128, calls[0].y - 128);
  // Strategy drops 60–100 tiles out so ants must forage; allow rounding/clamp slack.
  assert.ok(d >= 55 && d <= 105, `drop should be 60–100 tiles from nest, got ${d.toFixed(1)}`);
  assert.equal(calls[0].r, 8, 'fixed cluster radius');
});

test('respawn location is deterministic for a fixed seed', () => {
  const a = makeSystem({ seed: 'identical' });
  const b = makeSystem({ seed: 'identical' });
  a.sys.update({ foodPellets: pellets(0) });
  b.sys.update({ foodPellets: pellets(0) });
  assert.deepEqual(a.calls[0], b.calls[0], 'same seed → same drop');

  const c = makeSystem({ seed: 'different' });
  c.sys.update({ foodPellets: pellets(0) });
  assert.notDeepEqual(c.calls[0], a.calls[0], 'different seed → different drop');
});

test('cluster size tracks bootFoodTotal (a quarter of it)', () => {
  const { sys, calls } = makeSystem({ bootFoodTotal: 800, minSurfacePellets: 200 });
  sys.update({ foodPellets: pellets(0) });
  assert.equal(calls[0].count, 200, 'cluster size is a quarter of the boot total (800/4)');
});
