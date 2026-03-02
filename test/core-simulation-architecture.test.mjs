import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/sim/SimulationCore.js';

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
