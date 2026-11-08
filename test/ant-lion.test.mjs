import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { TERRAIN } from '../src/sim/world.js';

test('ant lions spawn deterministically on clear surface ground, with a hard cap of four', () => {
  const a = new SimulationCore('ant-lions');
  const b = new SimulationCore('ant-lions');
  assert.equal(a.world.antLions.length, 4);
  assert.deepEqual(a.antLionSystem.serialize(), b.antLionSystem.serialize());
  for (const lion of a.world.antLions) {
    assert.equal(a.world.terrain[a.world.index(lion.x, lion.y)], TERRAIN.GROUND);
    assert.ok(lion.y < a.world.nestY - 5);
  }
  for (let i = 0; i < 100; i += 1) a.antLionSystem.spawn();
  assert.equal(a.world.antLions.length, 4);
  assert.notDeepEqual(a.world.antLions, new SimulationCore('different').world.antLions);
});

test('unfed ant lions lose health after the grace period, die, and refill gradually', () => {
  const sim = new SimulationCore('starvation');
  const system = sim.antLionSystem;
  const config = { antLionStarvationTicks: 2, antLionStarvationDamage: 50, antLionSpawnInterval: 10 };
  system.update([], config);
  system.update([], config);
  assert.equal(system.lions[0].health, 100);
  system.update([], config);
  assert.equal(system.lions[0].health, 50);
  system.update([], config);
  assert.equal(system.lions.length, 0);
  for (let i = 0; i < 6; i += 1) system.update([], config);
  assert.equal(system.lions.length, 1);
});

test('ant lions eat either colony, recover health, respect cooldown, and maintain occupancy', () => {
  const sim = new SimulationCore('feeding');
  const system = sim.antLionSystem;
  const lion = system.lions[0];
  lion.health = 20;
  lion.hungryTicks = 1000;
  const black = sim.colony.ants.find((ant) => ant.role !== 'queen');
  const red = sim.rivalColony.ants.find((ant) => ant.role !== 'queen');
  for (const ant of [black, red]) { ant.x = lion.x; ant.y = lion.y; }
  sim.colony.rebuildAntGridFromAnts();
  sim.rivalColony.rebuildAntGridFromAnts();
  system.update([sim.colony, sim.rivalColony]);
  assert.equal(black.alive, false);
  assert.ok(!sim.colony.ants.includes(black));
  assert.equal(red.alive, true);
  assert.equal(lion.health, 100);
  assert.equal(lion.hungryTicks, 0);
  for (let i = 0; i < 29; i += 1) system.update([sim.colony, sim.rivalColony]);
  assert.equal(red.alive, true);
  system.update([sim.colony, sim.rivalColony]);
  assert.equal(red.alive, false);
  assert.ok(!sim.rivalColony.ants.includes(red));
  const before = Array.from(sim.colony._antGrid);
  sim.colony.rebuildAntGridFromAnts();
  assert.deepEqual(Array.from(sim.colony._antGrid), before);
});

test('save/load preserves predators, hunger, cooldown and future seeded spawning; reset repopulates', () => {
  const sim = new SimulationCore('save-predators');
  sim.antLionSystem.update([]);
  sim.world.antLions[0].health = 35;
  sim.world.antLions[0].cooldown = 15;
  const saved = JSON.parse(JSON.stringify(sim.serialize({})));
  const restored = new SimulationCore('other');
  restored.loadFromSerialized(saved);
  assert.deepEqual(restored.antLionSystem.serialize(), sim.antLionSystem.serialize());
  sim.antLionSystem.clear();
  restored.antLionSystem.clear();
  for (let i = 0; i < 30; i += 1) {
    sim.antLionSystem.update([], { antLionSpawnInterval: 5 });
    restored.antLionSystem.update([], { antLionSpawnInterval: 5 });
  }
  assert.deepEqual(restored.antLionSystem.serialize(), sim.antLionSystem.serialize());
  assert.equal(restored.world.antLions.length, 4);
  restored.clearWorld();
  assert.equal(restored.world.antLions.length, 0);
  restored.reset('reset');
  assert.equal(restored.world.antLions.length, 4);
  delete saved.antLions;
  restored.loadFromSerialized(saved);
  assert.equal(restored.world.antLions.length, 4);
});

test('edited terrain removes invalid pits and loading cannot exceed the cap', () => {
  const sim = new SimulationCore('terrain');
  const lion = sim.world.antLions[0];
  sim.world.setTerrain(sim.world.index(lion.x, lion.y), TERRAIN.WATER);
  sim.antLionSystem.update([]);
  assert.equal(sim.world.antLions.length, 3);
  const saved = sim.antLionSystem.serialize();
  saved.lions = Array.from({ length: 12 }, () => ({ ...saved.lions[0] }));
  sim.antLionSystem.load(saved);
  assert.equal(sim.world.antLions.length, 4);
});
