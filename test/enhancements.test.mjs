import test from 'node:test';
import assert from 'node:assert/strict';
import { Ant } from '../src/sim/ant.js';
import { World, TERRAIN } from '../src/sim/world.js';
import { Colony } from '../src/sim/colony.js';
import { SeededRng } from '../src/sim/rng.js';
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { ColonyStats } from '../src/sim/ColonyStats.js';
import { FoodPellet } from '../src/sim/Food.js';

function createTestConfig() {
  return {
    tickSeconds: 1 / 30,
    antCap: 200,
    evapFood: 0.1,
    evapHome: 0.55,
    evapDanger: 0.35,
    diffFood: 0.2,
    diffHome: 0.1,
    diffDanger: 0.12,
    diffIntervalTicks: 2,
    depositFood: 1.2,
    depositHome: 0.12,
    dangerDeposit: 0.6,
    hazardDeathChance: 0.02,
    foodPickupRate: 0.7,
    digChance: 0.04,
    digEnergyCost: 8,
    digHomeBoost: 0.9,
    queenEggTicks: 20,
    queenEggFoodCost: 0.8,
    queenHungerDrain: 2.8,
    queenEatNutrition: 8,
    queenHealthDrainRate: 7,
    workerEatNutrition: 25,
    starvationRecoveryHealth: 5,
    healthDrainRate: 10,
    healthRegenRate: 1,
    soldierSpawnChance: 0.2,
    foodVisionRadius: 7,
    followAlpha: 1.5,
    followBeta: 3.4,
    wanderNoise: 0.06,
    randomTurnChance: 0.045,
    momentumBias: 0.3,
    reversePenalty: 0.9,
    homeDepositIntervalTicks: 3,
    homeDepositMinDistance: 10,
    nearEntranceScatterRadius: 9,
    foodTrailDistanceScale: 1.1,
    maxFoodTrailScale: 3.2,
    pheromoneMaxClamp: 10,
  };
}

// ============================================================
// Enhancement #1: Ant Age/Lifespan
// ============================================================

test('ant has age and maxAge properties', () => {
  const rng = new SeededRng('age-init');
  const ant = new Ant(10, 10, rng, 'worker');

  assert.equal(ant.age, 0);
  assert.ok(ant.maxAge > 0, 'maxAge should be positive');
  assert.ok(ant.maxAge >= 2400, 'Worker maxAge should be at least 2400');
});

test('soldier has shorter lifespan than worker', () => {
  const rng1 = new SeededRng('age-soldier');
  const rng2 = new SeededRng('age-soldier');
  const soldier = new Ant(10, 10, rng1, 'soldier');
  const worker = new Ant(10, 10, rng2, 'worker');

  // Soldiers: 1800-2400, Workers: 2400-3200
  assert.ok(soldier.maxAge < worker.maxAge, 'Soldier should have shorter lifespan');
});

test('ant age increments each tick', () => {
  const rng = new SeededRng('age-tick');
  const world = new World(64, 64);
  const colony = new Colony(world, rng, 0);
  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(world.nestX, world.nestY - 5, rng, 'worker');
  colony.ants.push(ant);
  const config = createTestConfig();

  ant.update(world, colony, rng, config);
  assert.equal(ant.age, 1);
  ant.update(world, colony, rng, config);
  assert.equal(ant.age, 2);
});

test('ant health declines in old age', () => {
  const rng = new SeededRng('age-decline');
  const world = new World(64, 64);
  const colony = new Colony(world, rng, 0);
  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);
  colony.foodStored = 10000;

  const ant = new Ant(world.nestX, world.nestY - 5, rng, 'worker');
  ant.hunger = 100;
  ant.health = 100;
  ant.age = ant.maxAge * 0.85; // past 80% threshold
  colony.ants.push(ant);

  const config = createTestConfig();
  for (let i = 0; i < 50; i += 1) {
    ant.hunger = 100; // keep well-fed to isolate age effect
    ant.update(world, colony, rng, config);
    if (!ant.alive) break;
  }

  assert.ok(ant.health < 100, 'Old ant should have reduced health');
});

test('ant age survives serialization', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('age-serial');
  const colony = new Colony(world, rng, 3);

  colony.ants[0].age = 500;
  colony.ants[0].maxAge = 2500;

  const data = colony.serialize();
  const restored = Colony.fromSerialized(world, new SeededRng('other'), data);

  assert.equal(restored.ants[0].age, 500);
  assert.equal(restored.ants[0].maxAge, 2500);
});

// ============================================================
// Enhancement #2: Colony Statistics
// ============================================================

test('ColonyStats records samples', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('stats-record');
  const colony = new Colony(world, rng, 20);
  colony.foodStored = 50;

  const stats = new ColonyStats();
  stats.record(30, colony);

  const latest = stats.getLatest();
  assert.ok(latest);
  assert.equal(latest.tick, 30);
  assert.equal(latest.population, 20);
  assert.ok(latest.avgHunger > 0);
  assert.ok(latest.avgHealth > 0);
  assert.equal(latest.foodStored, 50);
});

test('ColonyStats tracks peak population', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('stats-peak');
  const colony = new Colony(world, rng, 50);
  const stats = new ColonyStats();

  stats.record(30, colony);
  assert.equal(stats.peakPopulation, 50);

  // Simulate population drop
  colony.ants.length = 30;
  stats.record(60, colony);
  assert.equal(stats.peakPopulation, 50, 'Peak should not decrease');
});

test('ColonyStats population trend', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('stats-trend');
  const colony = new Colony(world, rng, 20);
  const stats = new ColonyStats();

  stats.record(30, colony);

  // Add more ants
  for (let i = 0; i < 10; i += 1) {
    colony.ants.push(new Ant(world.nestX, world.nestY - 5, rng, 'worker'));
  }
  stats.record(60, colony);

  assert.equal(stats.getPopulationTrend(), 10);
});

test('ColonyStats respects maxSamples', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('stats-max');
  const colony = new Colony(world, rng, 10);
  const stats = new ColonyStats(5);

  for (let i = 0; i < 10; i += 1) {
    stats.record(i * 30, colony);
  }

  assert.equal(stats.samples.length, 5, 'Should cap at maxSamples');
});

test('ColonyStats getSummary returns comprehensive data', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('stats-summary');
  const colony = new Colony(world, rng, 15);
  colony.foodStored = 100;
  const stats = new ColonyStats();

  stats.record(30, colony);
  const summary = stats.getSummary();

  assert.ok(summary);
  assert.equal(summary.currentPopulation, 15);
  assert.equal(summary.foodStored, 100);
  assert.ok(summary.queenAlive);
  assert.equal(typeof summary.avgAge, 'number');
});

test('ColonyStats serialization round-trip', () => {
  const stats = new ColonyStats();
  stats.peakPopulation = 100;
  stats.totalFoodCollected = 500;
  stats.totalFoodConsumed = 300;

  const data = stats.serialize();
  const restored = new ColonyStats();
  restored.loadFromSerialized(data);

  assert.equal(restored.peakPopulation, 100);
  assert.equal(restored.totalFoodCollected, 500);
  assert.equal(restored.totalFoodConsumed, 300);
});

test('SimulationCore records stats periodically', () => {
  const sim = new SimulationCore('stats-integration');
  const config = createTestConfig();

  // Run 60 ticks (2 stat samples at tick 30 and 60)
  for (let i = 0; i < 60; i += 1) {
    sim.update(config);
  }

  assert.ok(sim.stats.samples.length >= 2, 'Should have recorded stats');
  const latest = sim.stats.getLatest();
  assert.ok(latest);
  assert.ok(latest.population > 0);
});

// ============================================================
// Enhancement #3: Danger Pheromone Avoidance
// ============================================================

test('ants avoid tiles with high danger pheromone', () => {
  const rng = new SeededRng('danger-avoid');
  const world = new World(32, 32);
  // Make a passable corridor
  for (let x = 0; x < 32; x += 1) {
    for (let y = 0; y < 16; y += 1) {
      world.terrain[world.index(x, y)] = TERRAIN.GROUND;
    }
  }

  // Place heavy danger to the east
  for (let x = 17; x < 22; x += 1) {
    for (let y = 5; y < 12; y += 1) {
      world.danger[world.index(x, y)] = 10;
    }
  }

  const colony = new Colony(world, rng, 0);
  colony.setNestEntrances([{ id: 'e', x: 5, y: 8, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(16, 8, rng, 'worker');
  colony.ants.push(ant);

  const config = createTestConfig();
  let enteredDanger = 0;
  for (let i = 0; i < 30; i += 1) {
    ant.update(world, colony, rng, config);
    if (world.danger[world.index(ant.x, ant.y)] > 5) {
      enteredDanger += 1;
    }
  }

  // Ant should mostly avoid high-danger tiles
  assert.ok(enteredDanger < 10, `Ant entered danger zone ${enteredDanger} times, expected less avoidance`);
});

// ============================================================
// Enhancement #4: Food Pellets (No Spoilage)
// ============================================================

test('FoodPellet stores base nutrition and reservation metadata', () => {
  const pellet = new FoodPellet('p1', 10, 10, 25);

  assert.equal(pellet.nutrition, 25);
  assert.equal(pellet.takenByAntId, null);
});

test('surface food pellets do not decay over time', () => {
  const sim = new SimulationCore('no-spoil-test');
  const config = createTestConfig();

  sim.foodPellets = [new FoodPellet('stable-pellet', 5, 5, 12)];

  for (let i = 0; i < 300; i += 1) sim.update(config);

  const pellet = sim.foodPellets.find((p) => p.id === 'stable-pellet');
  assert.ok(pellet, 'Pellet should still exist without spoilage');
  assert.equal(pellet.nutrition, 12, 'Pellet nutrition should remain unchanged');
});
