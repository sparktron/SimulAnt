import test from 'node:test';
import assert from 'node:assert/strict';
import { FoodEconomySystem } from '../src/sim/systems/FoodEconomySystem.js';
import { SeededRng } from '../src/sim/rng.js';

// FoodEconomySystem (v0.50.0 dual-trigger strategy): a respawn fires when EITHER
// free (unclaimed) surface pellets fall below minSurfacePellets OR the larder
// (foodStored) falls below max(foodMinReserve, ants*foodReservePerAnt), dropping one
// small cluster (bootFoodTotal/4) 60–100 tiles from the nest. A foodRespawnCooldownTicks
// rate-limit (skipped when no `tick` is supplied) bounds the supply. It reads world
// geometry, the colony's ant count + foodStored, its rng, and spawnFoodCluster —
// lightweight fakes fully exercise the logic.
//
// HISTORY: v0.43.3 was surface-count-ONLY, which let distant uncollected pellets keep
// the surface count high and silence respawn while the colony starved (the RCA cause
// #2). v0.50.0 revives the reserve params (foodReservePerAnt / foodMinReserve /
// foodRespawnCooldownTicks) as the hunger trigger + rate limit. See
// docs/starvation-collapse-rca-2026-06-02.md.
function makeWorld() {
  return { width: 256, height: 256, nestX: 128, nestY: 128 };
}

function makeSystem(opts = {}) {
  const calls = [];
  const colony = {
    ants: new Array(opts.ants ?? 100).fill({}),
    // High by default so surface-trigger tests isolate the surface gate; hunger
    // tests pass a low foodStored explicitly.
    foodStored: opts.foodStored ?? 1_000_000,
  };
  const sys = new FoodEconomySystem({
    world: makeWorld(),
    colony,
    rng: new SeededRng(opts.seed ?? 'food-econ'),
    spawnFoodCluster: (x, y, r, count) => calls.push({ x, y, r, count }),
    bootFoodTotal: opts.bootFoodTotal ?? 390,
    minSurfacePellets: opts.minSurfacePellets ?? 200,
    foodReservePerAnt: opts.foodReservePerAnt ?? 12,
    foodMinReserve: opts.foodMinReserve ?? 150,
    foodRespawnCooldownTicks: opts.foodRespawnCooldownTicks ?? 60,
    foodDropDistanceMin: opts.foodDropDistanceMin ?? 60,
    foodDropDistanceRange: opts.foodDropDistanceRange ?? 40,
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

// --- v0.50.0 hunger trigger (RCA cause #2 fix) ------------------------------

test('HUNGER trigger fires even when the surface is full (the RCA bug fix)', () => {
  // 500 free pellets sit uncollected (e.g. unreachable) — the old surface-only
  // gate would stay silent. With a starved larder the colony is HUNGRY → drop.
  const { sys, calls } = makeSystem({
    ants: 100, foodStored: 0, minSurfacePellets: 200,
  });
  sys.update({ foodPellets: pellets(500) });
  assert.equal(calls.length, 1, 'hungry larder fires the net despite a full surface');
});

test('a well-stocked larder AND full surface → no drop', () => {
  const { sys, calls } = makeSystem({
    ants: 100, foodStored: 1_000_000, minSurfacePellets: 200,
  });
  sys.update({ foodPellets: pellets(500) });
  assert.equal(calls.length, 0, 'neither trigger crosses → silent');
});

test('hunger floor is population-scaled: max(minReserve, ants*perAnt)', () => {
  // 100 ants * 12 = 1200 floor (above the 150 minReserve).
  const hungry = makeSystem({ ants: 100, foodStored: 1199, foodReservePerAnt: 12, foodMinReserve: 150 });
  hungry.sys.update({ foodPellets: pellets(500) });
  assert.equal(hungry.calls.length, 1, 'foodStored 1199 < 1200 floor → hungry');

  const fed = makeSystem({ ants: 100, foodStored: 1200, foodReservePerAnt: 12, foodMinReserve: 150 });
  fed.sys.update({ foodPellets: pellets(500) });
  assert.equal(fed.calls.length, 0, 'foodStored 1200 >= floor → not hungry (inclusive)');

  // Tiny colony: the minReserve floor dominates the per-ant term.
  const tiny = makeSystem({ ants: 1, foodStored: 149, foodReservePerAnt: 12, foodMinReserve: 150 });
  tiny.sys.update({ foodPellets: pellets(500) });
  assert.equal(tiny.calls.length, 1, '1 ant: floor is max(150, 12)=150; 149 < 150 → hungry');
});

test('cooldown rate-limits drops when a real tick is supplied', () => {
  const { sys, calls } = makeSystem({ ants: 100, foodStored: 0, foodRespawnCooldownTicks: 60 });
  sys.update({ foodPellets: pellets(0), tick: 1000 });
  assert.equal(calls.length, 1, 'first drop fires');
  sys.update({ foodPellets: pellets(0), tick: 1030 }); // 30 < 60 cooldown
  assert.equal(calls.length, 1, 'within cooldown → suppressed (prevents hunger flooding)');
  sys.update({ foodPellets: pellets(0), tick: 1060 }); // 60 >= 60 cooldown
  assert.equal(calls.length, 2, 'cooldown elapsed → drops again');
});

test('cooldown is skipped when no tick is supplied (tick-less callers/tests)', () => {
  const { sys, calls } = makeSystem({ ants: 100, foodStored: 0 });
  sys.update({ foodPellets: pellets(0) });
  sys.update({ foodPellets: pellets(0) });
  assert.equal(calls.length, 2, 'no tick → not throttled');
});

test('drop distance band is configurable (the E4 logistics lever)', () => {
  // Pull drops close to the nest: 20–30 tiles.
  const close = makeSystem({ foodDropDistanceMin: 20, foodDropDistanceRange: 10 });
  close.sys.update({ foodPellets: pellets(0) });
  const dc = Math.hypot(close.calls[0].x - 128, close.calls[0].y - 128);
  assert.ok(dc >= 18 && dc <= 32, `close band → ~20–30 tiles, got ${dc.toFixed(1)}`);

  // Per-tick config overrides the constructor band.
  const far = makeSystem({ foodDropDistanceMin: 20, foodDropDistanceRange: 10 });
  far.sys.update({ foodPellets: pellets(0), config: { foodDropDistanceMin: 100, foodDropDistanceRange: 20 } });
  const df = Math.hypot(far.calls[0].x - 128, far.calls[0].y - 128);
  assert.ok(df >= 95, `config far band → >=100 tiles, got ${df.toFixed(1)}`);
});

test('config overrides the hunger params per tick', () => {
  // Constructor floor 0 (never hungry); config lifts perAnt so the colony is hungry.
  const { sys, calls } = makeSystem({ ants: 100, foodStored: 500, foodReservePerAnt: 0, foodMinReserve: 0 });
  sys.update({ foodPellets: pellets(500) });
  assert.equal(calls.length, 0, 'ctor floor 0 → not hungry, surface full → silent');
  sys.update({ foodPellets: pellets(500), config: { foodReservePerAnt: 12, foodMinReserve: 150 } });
  assert.equal(calls.length, 1, 'config floor 1200 > 500 → hungry → drop');
});
