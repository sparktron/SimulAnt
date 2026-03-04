import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

function createConfig() {
  return {
    tickSeconds: 1 / 30,
    antCap: 400,
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

function getLowerHalfStartY(world) {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = world.nestY + 1; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      if (!world.isPassable(x, y)) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return world.nestY + 1;
  return minY + Math.floor((maxY - minY + 1) / 2);
}

test('deterministic regression: same seed + config yields identical snapshot', () => {
  const config = createConfig();
  const runA = new SimulationCore('determinism-seed');
  const runB = new SimulationCore('determinism-seed');

  for (let i = 0; i < 40; i += 1) {
    runA.update(config);
    runB.update(config);
  }

  const snapshotA = runA.serialize({});
  const snapshotB = runB.serialize({});

  assert.deepEqual(snapshotA, snapshotB);
});

test('patch-local model exposes typed terrain/pheromone/food state', () => {
  const sim = new SimulationCore('patch-model-seed');
  const x = sim.world.nestX;
  const y = sim.world.nestY;

  const patch = sim.getPatchState(x, y);
  assert.equal(patch.x, x);
  assert.equal(patch.y, y);
  assert.equal(typeof patch.terrain.kind, 'string');
  assert.equal(typeof patch.terrain.passable, 'boolean');
  assert.equal(typeof patch.pheromones.toFood, 'number');
  assert.equal(typeof patch.food.pellets, 'number');
});

test('macro/micro integration: scheduler advances deterministic tick and keeps territory state stable', () => {
  const sim = new SimulationCore('macro-micro-seed');
  const config = createConfig();
  const before = sim.macroEngine.serialize();

  sim.update(config);
  sim.update(config);

  assert.equal(sim.tick, 2);
  assert.deepEqual(sim.macroEngine.serialize(), before);
});

test('tick config sanitization prevents invalid diffusion cadence values', () => {
  const sim = new SimulationCore('sanitization-seed');
  const config = createConfig();
  config.diffIntervalTicks = 0;

  assert.doesNotThrow(() => sim.update(config));
  assert.equal(sim.tick, 1);
});

test('macro home territory follows nest tool relocation', () => {
  const sim = new SimulationCore('macro-home-sync-seed');
  const targetX = sim.world.nestX + 10;
  const targetY = sim.world.nestY + 2;

  sim.applyTool('nest', targetX, targetY, 2);

  const home = sim.macroEngine.serialize().territories.find((territory) => territory.id === 'territory-home');
  assert.ok(home);
  assert.equal(home.centerX, targetX);
  assert.equal(home.centerY, targetY);
});

test('nest relocation also repositions queen marker state away from entrance', () => {
  const sim = new SimulationCore('queen-marker-sync-seed');
  const targetX = sim.world.nestX - 8;
  const targetY = sim.world.nestY + 1;

  sim.applyTool('nest', targetX, targetY, 2);

  const lowerHalfStartY = getLowerHalfStartY(sim.world);

  assert.equal(sim.colony.queen.x, targetX);
  assert.ok(sim.colony.queen.y >= lowerHalfStartY);
  assert.equal(sim.nestEntrances[0].x, targetX);
  assert.equal(sim.nestEntrances[0].y, targetY);
});

test('queen movement remains in lower nest half and is capped at 10% ant speed', () => {
  const sim = new SimulationCore('queen-safety-speed-seed');
  const config = createConfig();

  sim.colony.ants = [];
  sim.colony.queen.x = sim.world.nestX;
  sim.colony.queen.y = sim.world.nestY + 2;
  sim.colony.queen.moveProgress = 0;

  const lowerHalfStartY = getLowerHalfStartY(sim.world);
  const startX = sim.colony.queen.x;
  const startY = sim.colony.queen.y;

  for (let i = 0; i < 9; i += 1) sim.update(config);
  assert.equal(sim.colony.queen.x, startX);
  assert.equal(sim.colony.queen.y, startY);

  sim.update(config);
  const movedDistance = Math.hypot(sim.colony.queen.x - startX, sim.colony.queen.y - startY);
  assert.ok(movedDistance <= Math.SQRT2);

  for (let i = 0; i < 120; i += 1) sim.update(config);
  assert.ok(sim.colony.queen.y >= lowerHalfStartY);
});

test('macro load sanitizes malformed saved territories and restores home territory', () => {
  const sim = new SimulationCore('macro-sanitize-seed');
  sim.macroEngine.loadFromSerialized({
    territories: [{ id: null }, { id: 'enemy', centerX: Infinity, centerY: NaN, owner: 123 }],
  });

  const territories = sim.macroEngine.serialize().territories;
  const home = territories.find((territory) => territory.id === 'territory-home');
  const enemy = territories.find((territory) => territory.id === 'enemy');

  assert.ok(home);
  assert.equal(home.centerX, sim.world.nestX);
  assert.equal(home.centerY, sim.world.nestY);
  assert.equal(enemy.owner, '123');
  assert.equal(enemy.centerX, sim.world.nestX);
  assert.equal(enemy.centerY, sim.world.nestY);
});


test('tick config sanitization clamps ant and colony safety-critical knobs', () => {
  const unsafe = {
    tickSeconds: -1,
    antCap: -5,
    diffIntervalTicks: 0,
    homeDepositIntervalTicks: 0,
    hazardDeathChance: 5,
    randomTurnChance: -0.1,
    queenEggTicks: 0,
    workerEatNutrition: -12,
    healthDrainRate: -1,
    soldierSpawnChance: 2,
    foodVisionRadius: 0,
  };

  const safe = sanitizeTickConfig(unsafe);

  assert.equal(safe.tickSeconds, 1 / 30);
  assert.equal(safe.antCap, 2000);
  assert.equal(safe.diffIntervalTicks, 1);
  assert.equal(safe.homeDepositIntervalTicks, 1);
  assert.equal(safe.hazardDeathChance, 1);
  assert.equal(safe.randomTurnChance, 0);
  assert.equal(safe.queenEggTicks, 1);
  assert.equal(safe.workerEatNutrition, 0);
  assert.equal(safe.healthDrainRate, 0);
  assert.equal(safe.soldierSpawnChance, 1);
  assert.equal(safe.foodVisionRadius, 1);
});

test('deterministic regression survives unsafe external config inputs via sanitizer', () => {
  const unsafeConfig = createConfig();
  unsafeConfig.diffIntervalTicks = 0;
  unsafeConfig.homeDepositIntervalTicks = 0;
  unsafeConfig.hazardDeathChance = 9;
  unsafeConfig.randomTurnChance = -5;
  unsafeConfig.soldierSpawnChance = 7;

  const runA = new SimulationCore('determinism-unsafe-seed');
  const runB = new SimulationCore('determinism-unsafe-seed');

  for (let i = 0; i < 30; i += 1) {
    runA.update(unsafeConfig);
    runB.update(unsafeConfig);
  }

  assert.deepEqual(runA.serialize({}), runB.serialize({}));
});


test('workers deposit carried food into persistent nestFoodPellets at nest entrance', () => {
  const sim = new SimulationCore('nest-food-deposit-seed');
  const config = createConfig();
  const ant = sim.colony.ants[0];
  const entrance = sim.nestEntrances[0];

  ant.x = entrance.x;
  ant.y = entrance.y;
  ant.hunger = ant.hungerMax;
  ant.carrying = { type: 'food', pelletId: 'test-pellet', pelletNutrition: 3 };
  ant.carryingType = 'food';

  sim.update(config);

  assert.equal(sim.colony.nestFoodPellets.length > 0, true);
  assert.equal(sim.colony.foodStored >= 3, true);
  assert.equal(ant.carrying, null);
  assert.equal(ant.carryingType, 'none');
});

test('nestFoodPellets survive serialization/load', () => {
  const sim = new SimulationCore('nest-food-persist-seed');
  sim.colony.depositPellet(2.5, sim.world.nestX, sim.world.nestY + 3, sim.nestEntrances[0]);

  const serialized = sim.serialize({});
  const restored = new SimulationCore('other-seed');
  restored.loadFromSerialized(serialized);

  assert.equal(restored.colony.nestFoodPellets.length, 1);
  assert.equal(restored.colony.nestFoodPellets[0].amount, 2.5);
});
