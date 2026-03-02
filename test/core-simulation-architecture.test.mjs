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
