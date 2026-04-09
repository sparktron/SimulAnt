import test from 'node:test';
import assert from 'node:assert/strict';
import { Colony } from '../src/sim/colony.js';
import { World, TERRAIN } from '../src/sim/world.js';
import { SeededRng } from '../src/sim/rng.js';

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

// --- Construction ---

test('colony initializes with correct ant count', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('colony-init');
  const colony = new Colony(world, rng, 50);

  assert.equal(colony.ants.length, 50);
  assert.equal(colony.births, 50);
  assert.equal(colony.deaths, 0);
  assert.equal(colony.foodStored, 5000);  // Colony starts with bootstrap food
});

test('colony queen starts alive with full vitals', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('queen-init');
  const colony = new Colony(world, rng, 10);

  assert.ok(colony.queen.alive);
  assert.equal(colony.queen.hunger, 100);
  assert.equal(colony.queen.health, 100);
});

test('all initial ants spawn near nest', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('spawn-loc');
  const colony = new Colony(world, rng, 20);

  for (const ant of colony.ants) {
    const dist = Math.hypot(ant.x - world.nestX, ant.y - world.nestY);
    assert.ok(dist <= 10, `Ant spawned too far from nest: ${dist}`);
  }
});

// --- Queen Survival ---

test('queen health drains when starving', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('queen-starve');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();

  colony.queen.hunger = 0;
  colony.foodStored = 0;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  const healthBefore = colony.queen.health;
  colony.update(config);

  assert.ok(colony.queen.health < healthBefore, 'Queen health should decrease when starving');
});

test('queen dies when health reaches zero', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('queen-death');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();

  colony.queen.hunger = 0;
  colony.queen.health = 0.001;
  colony.foodStored = 0;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  colony.update(config);

  assert.equal(colony.queen.alive, false);
});

test('queen eats from food store when hungry', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('queen-eat');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();

  colony.queen.hunger = 30; // below 40% threshold triggers eating
  colony.foodStored = 100;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  colony.update(config);

  assert.ok(colony.foodStored < 100, 'Queen should consume from food store');
});

// --- Egg Laying ---

test('queen lays eggs when food is available', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('egg-lay');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();
  config.queenEggTicks = 1; // lay immediately

  colony.foodStored = 100;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  const eggsBefore = colony.queen.eggsLaid;
  colony.update(config);

  assert.ok(colony.queen.eggsLaid > eggsBefore, 'Queen should lay eggs');
});

test('queen does not lay eggs without sufficient food', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('no-eggs');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();

  colony.foodStored = 0;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  const eggsBefore = colony.queen.eggsLaid;
  for (let i = 0; i < 30; i += 1) colony.update(config);

  assert.equal(colony.queen.eggsLaid, eggsBefore, 'Queen should not lay eggs without food');
});

// --- Ant Spawning ---

test('colony spawns ants when food and brood are available', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('spawn-ants');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();

  colony.foodStored = 200;
  colony.queen.brood = 5;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  colony.update(config);

  assert.ok(colony.ants.length > 0, 'Ants should be spawned from brood');
});

test('colony respects antCap limit', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('cap-test');
  const colony = new Colony(world, rng, 10);
  const config = createTestConfig();
  config.antCap = 10;

  colony.foodStored = 10000;
  colony.queen.brood = 100;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  colony.update(config);

  assert.ok(colony.ants.length <= 10, 'Colony should not exceed antCap');
});

// --- Dead Ant Removal ---

test('dead ants are removed from colony during update', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dead-removal');
  const colony = new Colony(world, rng, 5);
  const config = createTestConfig();
  config.antCap = 5;

  colony.foodStored = 0;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  // Kill two ants
  colony.ants[0].alive = false;
  colony.ants[2].alive = false;

  colony.update(config);

  assert.equal(colony.ants.length, 3, 'Dead ants should be removed');
  assert.ok(colony.ants.every((ant) => ant.alive), 'All remaining ants should be alive');
});

// --- Food Deposit ---

test('depositFoodFromAnt stores food and clears ant carrying', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('deposit-test');
  const colony = new Colony(world, rng, 1);

  const ant = colony.ants[0];
  ant.carrying = { type: 'food', pelletId: 'p1', pelletNutrition: 15 };
  ant.carryingType = 'food';

  const foodBefore = colony.foodStored;
  const result = colony.depositFoodFromAnt(ant, null);

  assert.ok(result);
  assert.equal(ant.carrying, null);
  assert.equal(ant.carryingType, 'none');
  assert.equal(colony.foodStored, foodBefore + 15);
  assert.equal(colony.nestFoodPellets.length, 1);
});

test('depositFoodFromAnt returns false for ant not carrying food', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('no-deposit');
  const colony = new Colony(world, rng, 1);

  const ant = colony.ants[0];
  ant.carrying = null;

  const result = colony.depositFoodFromAnt(ant, null);
  assert.equal(result, false);
});

// --- Food Store ---

test('consumeFromStore reduces stored food correctly', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('consume-test');
  const colony = new Colony(world, rng, 0);
  colony.foodStored = 50;

  const consumed = colony.consumeFromStore(10);

  assert.equal(consumed, 10);
  assert.equal(colony.foodStored, 40);
});

test('consumeFromStore caps at available food', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('consume-cap');
  const colony = new Colony(world, rng, 0);
  colony.foodStored = 3;

  const consumed = colony.consumeFromStore(10);

  assert.equal(consumed, 3);
  assert.equal(colony.foodStored, 0);
});

test('consumeFromStore returns 0 for empty store', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('empty-store');
  const colony = new Colony(world, rng, 0);
  colony.foodStored = 0;

  assert.equal(colony.consumeFromStore(5), 0);
});

// --- Nearest Entrance ---

test('nearestEntrance returns closest entrance', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('entrance-test');
  const colony = new Colony(world, rng, 0);

  colony.setNestEntrances([
    { id: 'e1', x: 10, y: 10, radius: 2 },
    { id: 'e2', x: 50, y: 50, radius: 2 },
  ]);

  const nearest = colony.nearestEntrance(12, 12);
  assert.equal(nearest.id, 'e1');

  const nearest2 = colony.nearestEntrance(48, 48);
  assert.equal(nearest2.id, 'e2');
});

test('nearestEntrance returns null when no entrances', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('no-entrance');
  const colony = new Colony(world, rng, 0);
  colony.setNestEntrances([]);

  assert.equal(colony.nearestEntrance(5, 5), null);
});

// --- Pellet Search ---

test('findVisiblePellet finds nearest pellet within radius', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('vis-pellet');
  const colony = new Colony(world, rng, 0);

  colony.setSurfaceFoodPellets([
    { id: 'p1', x: 10, y: 10, nutrition: 25, takenByAntId: null },
    { id: 'p2', x: 12, y: 10, nutrition: 25, takenByAntId: null },
  ]);

  const found = colony.findVisiblePellet(11, 10, 5);
  assert.ok(found);
  // Should find nearest (distance 1 vs distance 1 — either is fine)
  assert.ok(found.id === 'p1' || found.id === 'p2');
});

test('findVisiblePellet ignores taken pellets', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('taken-pellet');
  const colony = new Colony(world, rng, 0);

  colony.setSurfaceFoodPellets([
    { id: 'p1', x: 10, y: 10, nutrition: 25, takenByAntId: 'ant-123' },
  ]);

  const found = colony.findVisiblePellet(10, 10, 5);
  assert.equal(found, null);
});

test('findVisiblePellet returns null when no pellets in range', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('no-pellet');
  const colony = new Colony(world, rng, 0);

  colony.setSurfaceFoodPellets([
    { id: 'p1', x: 50, y: 50, nutrition: 25, takenByAntId: null },
  ]);

  const found = colony.findVisiblePellet(10, 10, 5);
  assert.equal(found, null);
});

// --- Serialization ---

test('colony serializes and deserializes round-trip', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('serialize-test');
  const colony = new Colony(world, rng, 10);
  colony.foodStored = 42;
  colony.deaths = 3;

  const data = colony.serialize();
  const restored = Colony.fromSerialized(world, new SeededRng('other'), data);

  assert.equal(restored.foodStored, 42);
  assert.equal(restored.deaths, 3);
  assert.equal(restored.ants.length, 10);
  assert.ok(restored.queen.alive);
});

test('stepCounter survives serialization round-trip', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('step-serialize');
  const colony = new Colony(world, rng, 3);

  colony.ants[0].stepCounter = 42;
  colony.ants[1].stepCounter = 100;

  const data = colony.serialize();
  const restored = Colony.fromSerialized(world, new SeededRng('other'), data);

  assert.equal(restored.ants[0].stepCounter, 42);
  assert.equal(restored.ants[1].stepCounter, 100);
});

test('removePelletById removes correct pellet', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('remove-pellet');
  const colony = new Colony(world, rng, 0);

  colony.setSurfaceFoodPellets([
    { id: 'p1', x: 5, y: 5 },
    { id: 'p2', x: 10, y: 10 },
    { id: 'p3', x: 15, y: 15 },
  ]);

  colony.removePelletById('p2');

  assert.equal(colony.surfaceFoodPellets.length, 2);
  assert.ok(colony.surfaceFoodPellets.every((p) => p.id !== 'p2'));
});

// --- Queen Position ---

test('queen position is always below nestY', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('queen-pos');
  const colony = new Colony(world, rng, 0);

  assert.ok(colony.queen.y > world.nestY, 'Queen should be below nest surface');
});

test('syncQueenPositionToNest repositions queen', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('queen-sync');
  const colony = new Colony(world, rng, 0);

  const oldY = colony.queen.y;
  world.setNest(20, 20);
  colony.syncQueenPositionToNest(20, 20);

  assert.ok(colony.queen.y > 20, 'Queen should be below new nestY');
});
