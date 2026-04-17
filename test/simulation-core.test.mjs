import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { TERRAIN } from '../src/sim/world.js';

function createConfig() {
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

// --- Initialization ---

test('SimulationCore initializes with default seed', () => {
  const sim = new SimulationCore();

  assert.equal(sim.tick, 0);
  assert.ok(sim.world);
  assert.ok(sim.colony);
  assert.ok(sim.digSystem);
  assert.equal(sim.nestEntrances.length, 1);
  assert.ok(sim.foodPellets.length > 0, 'Should have initial food clusters');
});

test('SimulationCore initializes with custom seed', () => {
  const sim = new SimulationCore('custom-seed');
  assert.equal(sim.seed, 'custom-seed');
});

// --- Update / Tick ---

test('update increments tick counter', () => {
  const sim = new SimulationCore('tick-test');
  const config = createConfig();

  sim.update(config);
  assert.equal(sim.tick, 1);

  sim.update(config);
  assert.equal(sim.tick, 2);
});

test('simulation runs 100 ticks without crashing', () => {
  const sim = new SimulationCore('stability-test');
  const config = createConfig();

  assert.doesNotThrow(() => {
    for (let i = 0; i < 100; i += 1) {
      sim.update(config);
    }
  });
});

// --- Food Management ---

test('spawnFoodCluster adds food pellets', () => {
  const sim = new SimulationCore('food-spawn');
  const before = sim.foodPellets.length;

  sim.spawnFoodCluster(sim.world.nestX + 20, sim.world.nestY - 10, 5, 10);

  assert.ok(sim.foodPellets.length > before, 'Food pellets should increase');
});

test('addFoodToStore increases colony food', () => {
  const sim = new SimulationCore('food-store');
  const before = sim.colony.foodStored;

  sim.addFoodToStore(50);

  assert.equal(sim.colony.foodStored, before + 50);
});

// --- Ant Finding ---

test('findAntNear returns an ant within distance', () => {
  const sim = new SimulationCore('find-ant');

  // Get an ant's position
  const ant = sim.colony.ants[0];
  const found = sim.findAntNear(ant.x, ant.y, 1);

  assert.ok(found, 'Should find an ant near the position');
  const dist = Math.hypot(found.x - ant.x, found.y - ant.y);
  assert.ok(dist <= 1, 'Found ant should be within distance');
});

test('findAntNear returns null when no ant nearby', () => {
  const sim = new SimulationCore('no-ant');
  const found = sim.findAntNear(-100, -100, 1);

  assert.equal(found, null);
});

test('findAntById returns correct ant', () => {
  const sim = new SimulationCore('find-by-id');
  const ant = sim.colony.ants[5];

  const found = sim.findAntById(ant.id);
  assert.ok(found);
  assert.equal(found.id, ant.id);
});

test('findAntById returns null for unknown id', () => {
  const sim = new SimulationCore('unknown-id');
  assert.equal(sim.findAntById('nonexistent'), null);
});

// --- Tool Application ---

test('applyTool food creates food pellets', () => {
  const sim = new SimulationCore('tool-food');
  const before = sim.foodPellets.length;

  sim.applyTool('food', sim.world.nestX + 20, sim.world.nestY - 10, 3);

  assert.ok(sim.foodPellets.length > before);
});

test('applyTool wall places wall terrain', () => {
  const sim = new SimulationCore('tool-wall');
  const x = sim.world.nestX + 15;
  const y = sim.world.nestY - 15;

  sim.applyTool('wall', x, y, 2);

  assert.equal(sim.world.terrain[sim.world.index(x, y)], TERRAIN.WALL);
});

test('applyTool water places water terrain', () => {
  const sim = new SimulationCore('tool-water');
  const x = sim.world.nestX - 15;
  const y = sim.world.nestY - 15;

  sim.applyTool('water', x, y, 2);

  assert.equal(sim.world.terrain[sim.world.index(x, y)], TERRAIN.WATER);
});

test('applyTool hazard places hazard terrain', () => {
  const sim = new SimulationCore('tool-hazard');
  const x = sim.world.nestX + 10;
  const y = sim.world.nestY - 10;

  sim.applyTool('hazard', x, y, 2);

  assert.equal(sim.world.terrain[sim.world.index(x, y)], TERRAIN.HAZARD);
});

test('applyTool erase clears terrain and pheromones', () => {
  const sim = new SimulationCore('tool-erase');
  const x = sim.world.nestX + 10;
  const y = sim.world.nestY - 10;

  // Place some stuff first
  sim.applyTool('wall', x, y, 2);
  sim.world.toFood[sim.world.index(x, y)] = 5.0;

  sim.applyTool('erase', x, y, 2);

  assert.equal(sim.world.terrain[sim.world.index(x, y)], TERRAIN.GROUND);
  assert.equal(sim.world.toFood[sim.world.index(x, y)], 0);
});

test('applyTool erase digs tunnel when used underground', () => {
  const sim = new SimulationCore('tool-erase-underground');
  const x = sim.world.nestX + 10;
  const y = sim.world.nestY + 10;
  const idx = sim.world.index(x, y);

  // Ensure target cell starts as compact soil.
  sim.world.terrain[idx] = TERRAIN.SOIL;
  sim.world.toHome[idx] = 3.2;

  sim.applyTool('erase', x, y, 1);

  assert.equal(sim.world.terrain[idx], TERRAIN.TUNNEL);
  assert.equal(sim.world.toHome[idx], 0);
});

test('applyTool erase removes food pellets in area', () => {
  const sim = new SimulationCore('tool-erase-pellets');
  const x = sim.world.nestX + 30;
  const y = sim.world.nestY - 10;

  sim.spawnFoodCluster(x, y, 2, 5);
  const before = sim.foodPellets.length;
  assert.ok(before > 0);

  sim.applyTool('erase', x, y, 5);

  assert.ok(sim.foodPellets.length < before, 'Erase should remove pellets');
});

test('applyTool nest relocates nest entrance', () => {
  const sim = new SimulationCore('tool-nest');
  const newX = sim.world.nestX + 20;
  const newY = sim.world.nestY + 5;

  sim.applyTool('nest', newX, newY, 2);

  assert.equal(sim.nestEntrances[0].x, newX);
  assert.equal(sim.nestEntrances[0].y, newY);
  assert.equal(sim.world.nestX, newX);
  assert.equal(sim.world.nestY, newY);
});

// --- Serialization ---

test('serialize and loadFromSerialized round-trip preserves state', () => {
  const sim = new SimulationCore('serial-test');
  const config = createConfig();

  for (let i = 0; i < 20; i += 1) sim.update(config);

  const serialized = sim.serialize({});
  const sim2 = new SimulationCore('other');
  sim2.loadFromSerialized(serialized);

  assert.equal(sim2.tick, sim.tick);
  assert.equal(sim2.seed, sim.seed);
  assert.equal(sim2.colony.ants.length, sim.colony.ants.length);
  assert.equal(sim2.nestEntrances.length, sim.nestEntrances.length);
  assert.equal(sim2.foodPellets.length, sim.foodPellets.length);
});

test('loadFromSerialized preserves pellet reservation state', () => {
  const sim = new SimulationCore('serial-food-pellets');
  const firstPellet = sim.foodPellets[0];
  assert.ok(firstPellet, 'Expected an initial food pellet');

  firstPellet.takenByAntId = 'ant-locked';

  const serialized = sim.serialize({});
  const sim2 = new SimulationCore('other');
  sim2.loadFromSerialized(serialized);

  const restored = sim2.foodPellets.find((pellet) => pellet.id === firstPellet.id);
  assert.ok(restored, 'Expected pellet to be restored by id');
  assert.equal(restored.takenByAntId, 'ant-locked');
});

test('loadFromSerialized handles missing nestEntrances gracefully', () => {
  const sim = new SimulationCore('missing-entrances');
  const config = createConfig();
  sim.update(config);

  const serialized = sim.serialize({});
  delete serialized.nestEntrances;

  const sim2 = new SimulationCore('other');
  sim2.loadFromSerialized(serialized);

  assert.equal(sim2.nestEntrances.length, 1, 'Should create default entrance');
});

// --- Reset ---

test('reset clears tick and reinitializes state', () => {
  const sim = new SimulationCore('reset-test');
  const config = createConfig();

  for (let i = 0; i < 50; i += 1) sim.update(config);
  assert.ok(sim.tick > 0);

  sim.reset('new-seed');

  assert.equal(sim.tick, 0);
  assert.equal(sim.seed, 'new-seed');
  assert.ok(sim.colony.ants.length > 0);
});

// --- Clear World ---

test('clearWorld resets terrain but preserves colony', () => {
  const sim = new SimulationCore('clear-test');
  const config = createConfig();

  for (let i = 0; i < 10; i += 1) sim.update(config);
  const antCount = sim.colony.ants.length;

  sim.clearWorld();

  assert.equal(sim.colony.ants.length, antCount, 'Colony should survive clear');
  assert.equal(sim.foodPellets.length, 0, 'Food pellets should be cleared');
  assert.equal(sim.world.toFood[sim.world.index(5, 5)], 0, 'Pheromones should be cleared');
});

// --- Excavation Callback ---

test('onExcavate updates entrance soil totals', () => {
  const sim = new SimulationCore('excavation-test');
  const entrance = sim.nestEntrances[0];
  const soilBefore = entrance.soilOnSurface;

  sim.onExcavate(5, sim.world.nestX, sim.world.nestY + 10);

  assert.ok(entrance.soilOnSurface > soilBefore, 'Soil should accumulate on surface');
  assert.ok(entrance.excavatedSoilTotal > 0);
});

// --- Auto Dig ---

test('toggleAutoDig returns new state', () => {
  const sim = new SimulationCore('autodig-test');

  const enabled = sim.toggleAutoDig();
  assert.equal(enabled, true);

  const disabled = sim.toggleAutoDig();
  assert.equal(disabled, false);
});

// --- Determinism ---

test('same seed produces identical results after many ticks', () => {
  const config = createConfig();

  const simA = new SimulationCore('determinism-deep');
  const simB = new SimulationCore('determinism-deep');

  for (let i = 0; i < 60; i += 1) {
    simA.update(config);
    simB.update(config);
  }

  const snapA = simA.serialize({});
  const snapB = simB.serialize({});

  assert.deepEqual(snapA, snapB, 'Same seed should produce identical state');
});
