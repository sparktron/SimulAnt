import test from 'node:test';
import assert from 'node:assert/strict';
import { World, TERRAIN } from '../src/sim/world.js';

// Depletion-reactive decay (docs/pheromone-strategy.md future-direction #2):
// food trails get EXTRA evaporation wherever the harvest field is absent, so a
// corridor to an exhausted source collapses fast while a live (still-harvested)
// source's corridor stays protected. Opt-in via config.depletionReactive.

function groundWorld(w = 32, h = 32) {
  const world = new World(w, h);
  world.terrain.fill(TERRAIN.GROUND);
  world.markTerrainDirty();
  return world;
}

const BASE = {
  tickSeconds: 1 / 30, evapFood: 0.25, evapHome: 0, evapDanger: 0,
  diffFood: 0, diffHome: 0, diffDanger: 0, diffIntervalTicks: 1, pheromoneMaxClamp: 150,
};
const DEPLETION = {
  ...BASE,
  depletionReactive: true, harvestRadius: 6, harvestDeposit: 1.0, harvestMaxClamp: 2.0,
  evapHarvest: 0.5, harvestProtectRef: 0.5, depletionDecayBoost: 1.0,
};

test('an unprotected trail decays faster under depletion-reactive decay than baseline', () => {
  const idx = (w) => w.index(16, 16);
  const baseline = groundWorld();
  const depleted = groundWorld();
  baseline.depositToFood(idx(baseline), 10);
  depleted.depositToFood(idx(depleted), 10);

  for (let t = 1; t <= 15; t += 1) {
    baseline.updatePheromones(BASE, t);
    depleted.updatePheromones(DEPLETION, t); // no harvest painted -> extra decay
  }
  assert.ok(
    depleted.toFood[idx(depleted)] < baseline.toFood[idx(baseline)] - 1e-6,
    `unprotected trail should decay faster (baseline ${baseline.toFood[idx(baseline)].toFixed(3)}, `
      + `depleted ${depleted.toFood[idx(depleted)].toFixed(3)})`,
  );
});

test('a continuously-harvested trail is protected and tracks the baseline', () => {
  const idx = (w) => w.index(16, 16);
  const baseline = groundWorld();
  const protectedWorld = groundWorld();
  baseline.depositToFood(idx(baseline), 10);
  protectedWorld.depositToFood(idx(protectedWorld), 10);

  for (let t = 1; t <= 15; t += 1) {
    protectedWorld.paintHarvest(16, 16, 6, 1.0, 2.0); // ongoing pickups keep the zone live
    baseline.updatePheromones(BASE, t);
    protectedWorld.updatePheromones(DEPLETION, t);
  }
  // Protection saturates (harvest >= protectRef), so extra decay is ~0 and the
  // protected trail stays within a hair of the unmodified baseline.
  const b = baseline.toFood[idx(baseline)];
  const p = protectedWorld.toFood[idx(protectedWorld)];
  assert.ok(Math.abs(p - b) < 1e-3, `protected trail should track baseline (baseline ${b.toFixed(4)}, protected ${p.toFixed(4)})`);
});

test('harvest is painted as a disk, decays over time, and clears from the active list', () => {
  const world = groundWorld();
  world.paintHarvest(16, 16, 6, 1.0, 2.0);

  // Disk: center plus a ring of neighbors registered as active, dup-free.
  assert.ok(world.harvest[world.index(16, 16)] > 0, 'center painted');
  assert.ok(world.harvest[world.index(19, 16)] > 0, 'a cell ~3 tiles out is painted (radius 6)');
  assert.equal(world.harvest[world.index(25, 16)], 0, 'a cell well outside the radius is untouched');
  assert.equal(new Set(world._activeHarvest).size, world._activeHarvest.length, 'active list is dup-free');
  const painted = world._activeHarvest.length;

  const before = world.harvest[world.index(16, 16)];
  for (let t = 1; t <= 100; t += 1) world.updatePheromones(DEPLETION, t);
  assert.ok(world.harvest[world.index(16, 16)] < before * 0.5, 'harvest decays without re-painting');
  assert.equal(world._activeHarvest.length, painted, 'still active at 100 ticks (half-life ~42 ticks)');

  // Run long enough that the (uniform) disk crosses the 1e-4 threshold and the
  // active list is fully reclaimed.
  for (let t = 101; t <= 800; t += 1) world.updatePheromones(DEPLETION, t);
  assert.equal(world.harvest[world.index(16, 16)], 0, 'harvest fully decays without re-painting');
  assert.equal(world._activeHarvest.length, 0, 'active list is reclaimed once cells fall below threshold');
});

test('disabling pheromones clears the harvest field and its active list', () => {
  const world = groundWorld();
  world.paintHarvest(16, 16, 6, 1.0, 2.0);
  world.updatePheromones({ ...DEPLETION, enablePheromones: false }, 1);
  assert.equal(world._activeHarvest.length, 0);
  assert.equal(world.harvest[world.index(16, 16)], 0);
});
