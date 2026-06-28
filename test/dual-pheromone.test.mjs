import test from 'node:test';
import assert from 'node:assert/strict';
import { World, TERRAIN } from '../src/sim/world.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

// Two-pheromone recruitment (config.dualPheromone, docs/pheromone-strategy.md
// future-direction #3): a SECOND short-lived, high-diffusion food-scent field
// (`world.recruit`) separate from the long-lived toFood "route" channel. These
// tests cover the field plumbing — deposit, evaporation, diffusion, clear — and
// the config defaults. The deposit/read wiring (decisions.js / steering.js) is
// gated by config.dualPheromone and exercised by the foraging A/B harnesses.

function groundWorld(w = 32, h = 32) {
  const world = new World(w, h);
  world.terrain.fill(TERRAIN.GROUND);
  world.markTerrainDirty();
  return world;
}

// Minimal field-update config: evaporation only (no diffusion) unless overridden.
const BASE = {
  tickSeconds: 1 / 30,
  evapFood: 0.25, evapHome: 0, evapDanger: 0, evapRecruit: 0.6,
  diffFood: 0, diffHome: 0, diffDanger: 0, diffRecruit: 0,
  diffIntervalTicks: 1, pheromoneMaxClamp: 150,
};

test('depositRecruit populates the recruit field and registers it as active', () => {
  const world = groundWorld();
  const idx = world.index(16, 16);
  assert.equal(world.recruit[idx], 0);
  assert.equal(world._activeRecruit.length, 0);

  world.depositRecruit(idx, 2.0, 150);
  assert.equal(world.recruit[idx], 2.0);
  assert.ok(world._activeRecruit.includes(idx), 'deposited cell is in the active list');
});

test('the recruit channel evaporates faster than toFood at default rates', () => {
  const world = groundWorld();
  const idx = world.index(16, 16);
  world.depositToFood(idx, 10);
  world.depositRecruit(idx, 10, 150);

  for (let t = 1; t <= 10; t += 1) world.updatePheromones(BASE, t);

  assert.ok(world.recruit[idx] > 0, 'recruit still positive');
  assert.ok(
    world.recruit[idx] < world.toFood[idx] - 1e-6,
    `recruit (${world.recruit[idx].toFixed(3)}) should decay below toFood `
      + `(${world.toFood[idx].toFixed(3)}) — evapRecruit 0.6 > evapFood 0.25`,
  );
});

test('the recruit channel diffuses (spreads to neighbors) when diffRecruit > 0', () => {
  const world = groundWorld();
  const center = world.index(16, 16);
  const neighbor = world.index(17, 16);
  world.depositRecruit(center, 10, 150);

  world.updatePheromones({ ...BASE, diffRecruit: 0.1 }, 1);

  assert.ok(world.recruit[neighbor] > 0, 'recruitment spread to an adjacent tile');
});

test('disabling pheromones clears the recruit field and its active list', () => {
  const world = groundWorld();
  world.depositRecruit(world.index(16, 16), 5, 150);
  world.updatePheromones({ ...BASE, diffRecruit: 0.1 }, 1);
  assert.ok(world._activeRecruit.length > 0);

  world.updatePheromones({ ...BASE, enablePheromones: false }, 2);
  assert.equal(world._activeRecruit.length, 0, 'active list cleared');
  let nonZero = 0;
  for (let i = 0; i < world.recruit.length; i += 1) if (world.recruit[i] !== 0) nonZero += 1;
  assert.equal(nonZero, 0, 'recruit field zeroed');
});

test('dualPheromone defaults off and the recruit params survive sanitize unchanged', () => {
  const defaults = getDefaultConfig();
  assert.equal(defaults.dualPheromone, false, 'single mode is the default');

  const safe = sanitizeTickConfig(defaults);
  assert.equal(safe.dualPheromone, false);
  assert.equal(safe.evapRecruit, defaults.evapRecruit);
  assert.equal(safe.diffRecruit, defaults.diffRecruit);
  assert.equal(safe.depositRecruit, defaults.depositRecruit);
  assert.equal(safe.recruitFollowWeight, defaults.recruitFollowWeight);
});
