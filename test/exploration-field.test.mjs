import test from 'node:test';
import assert from 'node:assert/strict';
import { World, TERRAIN } from '../src/sim/world.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

// Exploration / dispersion field (config.explorationField, docs/exploration-field-design.md):
// a REPULSIVE field (world.explored) marking ground searchers recently swept and
// clusters that recently depleted. Increment 2 is the field PLUMBING only — deposit,
// slow evaporation, no diffusion, clear. Deposit/read wiring (decisions.js /
// steering.js, gated by config.explorationField) lands in increment 3.

function groundWorld(w = 32, h = 32) {
  const world = new World(w, h);
  world.terrain.fill(TERRAIN.GROUND);
  world.markTerrainDirty();
  return world;
}

const BASE = {
  tickSeconds: 1 / 30,
  evapFood: 0.25, evapHome: 0, evapDanger: 0, evapRecruit: 0.6, evapExplored: 0.1,
  diffFood: 0, diffHome: 0, diffDanger: 0, diffRecruit: 0, diffExplored: 0,
  diffIntervalTicks: 1, pheromoneMaxClamp: 150,
};

test('depositExplored populates the explored field and registers it as active', () => {
  const world = groundWorld();
  const idx = world.index(16, 16);
  assert.equal(world.explored[idx], 0);
  assert.equal(world._activeExplored.length, 0);

  world.depositExplored(idx, 3.0, 150);
  assert.equal(world.explored[idx], 3.0);
  assert.ok(world._activeExplored.includes(idx), 'deposited cell is in the active list');
});

test('the explored channel evaporates SLOWLY — longer-lived than toFood', () => {
  const world = groundWorld();
  const idx = world.index(16, 16);
  world.depositToFood(idx, 10);
  world.depositExplored(idx, 10, 150);

  for (let t = 1; t <= 20; t += 1) world.updatePheromones(BASE, t);

  assert.ok(world.explored[idx] > 0, 'explored still positive');
  assert.ok(
    world.explored[idx] > world.toFood[idx] + 1e-6,
    `explored (${world.explored[idx].toFixed(3)}) should outlast toFood `
      + `(${world.toFood[idx].toFixed(3)}) — evapExplored 0.1 < evapFood 0.25`,
  );
});

test('the explored field does NOT diffuse at the default diffExplored 0', () => {
  const world = groundWorld();
  const center = world.index(16, 16);
  const neighbor = world.index(17, 16);
  world.depositExplored(center, 10, 150);

  world.updatePheromones(BASE, 1); // diffExplored 0

  assert.equal(world.explored[neighbor], 0, 'no spread to neighbors (positional marker)');
  assert.ok(world.explored[center] > 0, 'center still marked');
});

test('explored DOES diffuse when diffExplored > 0 (wiring check)', () => {
  const world = groundWorld();
  const center = world.index(16, 16);
  const neighbor = world.index(17, 16);
  world.depositExplored(center, 10, 150);

  world.updatePheromones({ ...BASE, diffExplored: 0.1 }, 1);

  assert.ok(world.explored[neighbor] > 0, 'spread to an adjacent tile when diffusion on');
});

test('disabling pheromones clears the explored field and its active list', () => {
  const world = groundWorld();
  world.depositExplored(world.index(16, 16), 5, 150);
  world.updatePheromones(BASE, 1);
  assert.ok(world._activeExplored.length > 0);

  world.updatePheromones({ ...BASE, enablePheromones: false }, 2);
  assert.equal(world._activeExplored.length, 0, 'active list cleared');
  let nonZero = 0;
  for (let i = 0; i < world.explored.length; i += 1) if (world.explored[i] !== 0) nonZero += 1;
  assert.equal(nonZero, 0, 'explored field zeroed');
});

test('explored field params default sensibly and survive sanitize unchanged', () => {
  const defaults = getDefaultConfig();
  assert.equal(defaults.evapExplored, 0.1);
  assert.equal(defaults.diffExplored, 0.0);
  assert.equal(defaults.explorationField, false, 'single mode is the default');
  assert.equal(defaults.exploreAvoidWeight, 1.0);
  assert.equal(defaults.depositExplored, 0.5);
  assert.equal(defaults.depletedRepulseDeposit, 2.0);
  assert.equal(defaults.depletedRepulseRadius, 6);
  assert.equal(defaults.depletedRepulseThreshold, 2);

  const safe = sanitizeTickConfig(defaults);
  for (const k of ['evapExplored', 'diffExplored', 'explorationField', 'exploreAvoidWeight',
    'depositExplored', 'depletedRepulseDeposit', 'depletedRepulseRadius', 'depletedRepulseThreshold']) {
    assert.equal(safe[k], defaults[k], `${k} survives sanitize unchanged`);
  }
});
