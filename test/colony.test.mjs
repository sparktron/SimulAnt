import test from 'node:test';
import assert from 'node:assert/strict';
import { Colony } from '../src/sim/colony.js';
import { World, TERRAIN } from '../src/sim/world.js';
import { SeededRng } from '../src/sim/rng.js';
import { Ant } from '../src/sim/ant.js';

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
  // Bootstrap food: Math.max(2000, initialAnts * 25) — gives the colony
  // enough runway (30–60 sim sec) to establish foraging trails before
  // steady-state consumption catches up.
  assert.equal(colony.foodStored, 2000);
});

test('colony queen starts alive with full vitals', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('queen-init');
  const colony = new Colony(world, rng, 10);

  assert.ok(colony.queen.alive);
  assert.equal(colony.queen.hunger, 100);
  assert.equal(colony.queen.health, 100);
});

test('founding cohort spawns with staggered initial age, not all zero', () => {
  // Without this stagger, every founding ant hits senescence in the same
  // ~800-tick window, producing a death wave that crashes the colony at
  // its first peak (see telemetry from v0.26.3 7350-tick run).
  const world = new World(64, 64);
  const rng = new SeededRng('founding-age-spread');
  const colony = new Colony(world, rng, 40);

  const ages = colony.ants.map((a) => a.age);
  const zeroCount = ages.filter((a) => a === 0).length;
  const uniqueAges = new Set(ages).size;
  const minAge = Math.min(...ages);
  const maxAge = Math.max(...ages);

  assert.ok(zeroCount < 5, `Expected most founding ants to have non-zero age; got ${zeroCount}/40 at age 0`);
  assert.ok(uniqueAges > 20, `Expected meaningful age variety in founding cohort; got ${uniqueAges} unique ages`);
  assert.ok(maxAge - minAge > 1000, `Founding cohort should span >1000 ticks (got ${minAge}..${maxAge})`);
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

// --- Health-scaled Egg Laying ---

test('queen egg-laying rate scales down as her health drops', () => {
  // At full health the queen lays ~1 egg per queenEggTicks; at half health
  // the same number of ticks should yield roughly half the eggs.
  function countEggsAtHealth(healthFraction) {
    const world = new World(64, 64);
    const rng = new SeededRng(`lay-rate-${healthFraction}`);
    const colony = new Colony(world, rng, 0);
    const config = createTestConfig();
    config.queenEggTicks = 4;
    config.queenEggFoodCost = 0;
    config.queenEggHealthCost = 0;
    config.queenLayingMinHealth = 0;
    config.queenHungerDrain = 0;        // hold the queen's vitals steady
    config.queenHealthDrainRate = 0;
    config.queenHealthRecoveryPerNutrition = 0;
    // Keep foodStored well above target so the food-reserve lay multiplier
    // (added in v0.27.1) doesn't confound the pure health-scaling test.
    colony.foodStored = 100000;
    colony.foodStoreTarget = 100;
    colony.setNestEntrances([]);
    colony.setSurfaceFoodPellets([]);
    colony.queen.health = colony.queen.healthMax * healthFraction;
    colony.queen.hunger = colony.queen.hungerMax;

    const eggsBefore = colony.queen.eggsLaid;
    for (let i = 0; i < 200; i += 1) {
      colony.update(config);
      // foodStoreTarget recomputes to max(100, ants × 5) each update; force
      // it back so foodFraction stays pinned at 1.
      colony.foodStored = 100000;
    }
    return colony.queen.eggsLaid - eggsBefore;
  }

  const fullHealthEggs = countEggsAtHealth(1.0);
  const halfHealthEggs = countEggsAtHealth(0.5);

  assert.ok(fullHealthEggs > 0, 'Queen at full health should lay eggs');
  assert.ok(
    halfHealthEggs < fullHealthEggs * 0.7,
    `Half-health queen should lay markedly fewer eggs (full=${fullHealthEggs}, half=${halfHealthEggs})`,
  );
});

test('queen stops laying entirely below queenLayingMinHealth', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('lay-stop');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();
  config.queenEggTicks = 1;
  config.queenEggFoodCost = 0;
  config.queenEggHealthCost = 0;
  config.queenLayingMinHealth = 0.5;
  config.queenHungerDrain = 0;
  config.queenHealthDrainRate = 0;
  config.queenHealthRecoveryPerNutrition = 0;
  colony.foodStored = 100;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);
  // Sit the queen just below the threshold (with the queen-hungry consume
  // disabled above, this stays put across the update loop).
  colony.queen.health = colony.queen.healthMax * 0.4;
  colony.queen.hunger = colony.queen.hungerMax;

  const eggsBefore = colony.queen.eggsLaid;
  for (let i = 0; i < 100; i += 1) colony.update(config);

  assert.equal(colony.queen.eggsLaid, eggsBefore, 'Queen below min-health floor should not lay');
});

test('queen egg-laying rate tapers as colony food reserves shrink', () => {
  // Companion to the health-scaling test, isolating the food-reserve
  // multiplier added in v0.27.1. Queen is healthy; the only variable is
  // foodStored relative to foodStoreTarget. Low food → fewer eggs.
  function countEggsAtFoodFraction(foodFraction) {
    const world = new World(64, 64);
    const rng = new SeededRng(`food-lay-rate-${foodFraction}`);
    const colony = new Colony(world, rng, 0);
    const config = createTestConfig();
    config.queenEggTicks = 4;
    config.queenEggFoodCost = 0;       // free eggs so foodStored stays stable
    config.queenEggHealthCost = 0;
    config.queenLayingMinHealth = 0;
    config.queenHungerDrain = 0;
    config.queenHealthDrainRate = 0;
    config.queenHealthRecoveryPerNutrition = 0;
    colony.foodStoreTarget = 100;
    colony.queen.health = colony.queen.healthMax;
    colony.queen.hunger = colony.queen.hungerMax;
    colony.setNestEntrances([]);
    colony.setSurfaceFoodPellets([]);

    const eggsBefore = colony.queen.eggsLaid;
    for (let i = 0; i < 200; i += 1) {
      // Pin foodStored and foodStoreTarget every tick so the lay-multiplier
      // sees a stable foodFraction across the run.
      colony.foodStored = foodFraction * 100;
      colony.foodStoreTarget = 100;
      colony.update(config);
    }
    return colony.queen.eggsLaid - eggsBefore;
  }

  const fullStoreEggs = countEggsAtFoodFraction(1.0);
  const lowStoreEggs = countEggsAtFoodFraction(0.3);

  assert.ok(fullStoreEggs > 0, 'Queen with full stores should lay eggs');
  assert.ok(
    lowStoreEggs < fullStoreEggs * 0.7,
    `Low-store queen should lay markedly fewer eggs (full=${fullStoreEggs}, low=${lowStoreEggs})`,
  );
});

// --- Trophallaxis ---

// Walls in all 8 neighbors of (cx, cy) except for the one tile listed in `keepOpen`,
// so each ant pinned at the center can't move during its own update.
function pinAntsInPlace(world, cx, cy, keepOpen = []) {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const tx = cx + dx;
      const ty = cy + dy;
      if (keepOpen.some((p) => p.x === tx && p.y === ty)) continue;
      world.terrain[world.index(tx, ty)] = TERRAIN.WALL;
    }
  }
}

test('trophallaxis transfers hunger from a fed neighbor to a hungry one', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('trophallaxis');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();
  config.trophallaxisRate = 30;                       // amplified for a single-tick test
  config.trophallaxisDonorMinHungerFraction = 0.6;
  config.trophallaxisRecipientMaxHungerFraction = 0.4;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  // Pin two ants on adjacent tiles so trophallaxis sees a stable arrangement.
  pinAntsInPlace(world, 20, 20, [{ x: 21, y: 20 }]);
  pinAntsInPlace(world, 21, 20, [{ x: 20, y: 20 }]);

  colony.ants = [];
  const a = new Ant(20, 20, rng, 'worker');
  const b = new Ant(21, 20, rng, 'worker');
  a.hunger = 10;          // recipient
  b.hunger = 90;          // donor
  a.health = a.healthMax;
  b.health = b.healthMax;
  colony.ants.push(a, b);

  colony.update(config);

  assert.ok(a.hunger > 10, `Hungry ant should have received transfer (was 10, now ${a.hunger})`);
  assert.ok(b.hunger < 90, `Fed ant should have donated hunger (was 90, now ${b.hunger})`);
});

test('trophallaxis skips ants without an adjacent fed donor', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('trophallaxis-alone');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();
  config.trophallaxisRate = 30;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  pinAntsInPlace(world, 5, 5);

  colony.ants = [];
  const lonely = new Ant(5, 5, rng, 'worker');
  lonely.hunger = 10;
  lonely.health = lonely.healthMax;
  colony.ants.push(lonely);

  const before = lonely.hunger;
  colony.update(config);

  // Lonely ant might lose a sliver to natural drain, but should not gain hunger.
  assert.ok(lonely.hunger <= before, 'Lonely hungry ant should not gain hunger from nowhere');
});

test('laying an egg costs the queen health', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('lay-cost');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();
  config.queenEggTicks = 1;
  config.queenEggFoodCost = 0;
  config.queenEggHealthCost = 0.5;
  config.queenLayingMinHealth = 0;
  config.queenHungerDrain = 0;
  config.queenHealthDrainRate = 0;
  config.queenHealthRecoveryPerNutrition = 0;
  colony.foodStored = 100;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);
  colony.queen.health = colony.queen.healthMax;
  colony.queen.hunger = colony.queen.hungerMax;

  const healthBefore = colony.queen.health;
  colony.update(config);

  assert.ok(colony.queen.eggsLaid > 0, 'Queen should lay at least one egg this tick');
  assert.ok(
    colony.queen.health < healthBefore,
    `Queen health should drop after laying (before=${healthBefore}, after=${colony.queen.health})`,
  );
});

// --- Ant Spawning ---

test('colony spawns ants when food and brood are available', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('spawn-ants');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();
  config.broodGestationSeconds = 0.001;  // Fast gestation for testing

  colony.foodStored = 200;
  colony.queen.brood = 5;
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);

  // Need multiple updates for larvae to progress through 4 stages
  for (let i = 0; i < 50; i += 1) colony.update(config);

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

// --- Cause-of-Death Telemetry ---

test('recordDeath increments both deaths and the matching cause bucket', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('death-cause-basic');
  const colony = new Colony(world, rng, 0);

  colony.recordDeath('starvation');
  colony.recordDeath('hazard');
  colony.recordDeath('oldAge');
  colony.recordDeath('mystery');  // unknown cause should fall through to other

  assert.equal(colony.deaths, 4);
  assert.equal(colony.deathsByCause.starvation, 1);
  assert.equal(colony.deathsByCause.hazard, 1);
  assert.equal(colony.deathsByCause.oldAge, 1);
  assert.equal(colony.deathsByCause.other, 1);
});

test('starving ants register as starvation deaths', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('starvation-cause');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();
  colony.setNestEntrances([]);
  colony.setSurfaceFoodPellets([]);
  colony.foodStored = 0;

  const ant = new Ant(world.nestX, world.nestY - 5, rng, 'worker');
  ant.hunger = 0;
  ant.health = 0.01;
  ant.age = 100;             // well below senescence so cause is unambiguous
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  assert.equal(ant.alive, false);
  assert.equal(colony.deathsByCause.starvation, 1, 'starving death should be bucketed as starvation');
});

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

test('getTotalStoredFood returns the canonical foodStored, not the pellet ledger', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('food-ledger-total');
  const colony = new Colony(world, rng, 0);

  colony.foodStored = 10;
  colony.nestFoodPellets = [{ x: world.nestX, y: world.nestY + 2, amount: 6 }];
  assert.equal(colony.getTotalStoredFood(), 10, 'returns foodStored, not max');

  // foodStored is canonical even when the pellet ledger has drifted above it
  // (e.g. after egg-laying deducts from foodStored but not pellets). The getter
  // reports the true spendable total, not the inflated pellet sum.
  colony.foodStored = 4;
  colony.nestFoodPellets = [{ x: world.nestX, y: world.nestY + 2, amount: 7 }];
  assert.equal(colony.getTotalStoredFood(), 4, 'canonical foodStored wins over a drifted pellet ledger');
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

// --- Spatial Hash Grid (countAntsAt) ---

test('countAntsAt returns 0 when no ants present', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('grid-empty');
  const colony = new Colony(world, rng, 0);
  const config = createTestConfig();
  colony.update(config);

  assert.equal(colony.countAntsAt(10, 10), 0);
});

test('countAntsAt returns correct count after grid rebuild', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('grid-count');
  const colony = new Colony(world, rng, 5);

  // Place all ants at the same position
  for (const ant of colony.ants) {
    ant.x = 20;
    ant.y = 20;
  }
  // Manually rebuild the grid (update() would move ants)
  colony._antGrid.clear();
  for (const ant of colony.ants) {
    if (!ant.alive) continue;
    const key = `${ant.x},${ant.y}`;
    colony._antGrid.set(key, (colony._antGrid.get(key) || 0) + 1);
  }

  assert.equal(colony.countAntsAt(20, 20), 5);
  assert.equal(colony.countAntsAt(10, 10), 0);
});

test('countAntsAt excludes dead ants', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('grid-dead');
  const colony = new Colony(world, rng, 3);

  for (const ant of colony.ants) {
    ant.x = 15;
    ant.y = 15;
  }
  colony.ants[0].alive = false;
  // Manually rebuild the grid
  colony._antGrid.clear();
  for (const ant of colony.ants) {
    if (!ant.alive) continue;
    const key = `${ant.x},${ant.y}`;
    colony._antGrid.set(key, (colony._antGrid.get(key) || 0) + 1);
  }

  assert.equal(colony.countAntsAt(15, 15), 2);
});

// --- Nest Food Tile Set ---

test('nest food Set tracks pellets correctly', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('food-set');
  const colony = new Colony(world, rng, 0);

  // Directly add pellets to test the Set rebuild
  const px = world.nestX;
  const py = world.nestY + 3;
  colony.nestFoodPellets.push({ x: px, y: py, amount: 5 });
  colony.nestFoodPellets.push({ x: px + 1, y: py, amount: 10 });

  // Clear and rebuild (simulating what update does)
  colony._nestFoodTiles.clear();
  for (const pellet of colony.nestFoodPellets) {
    if (pellet.amount > 0.0001) {
      colony._nestFoodTiles.add(`${Math.round(pellet.x)},${Math.round(pellet.y)}`);
    }
  }

  assert.ok(colony._nestFoodTiles.has(`${px},${py}`));
  assert.ok(colony._nestFoodTiles.has(`${px + 1},${py}`));
  assert.ok(!colony._nestFoodTiles.has(`${px + 5},${py + 5}`));
});

test('nest food Set excludes depleted pellets', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('food-depleted');
  const colony = new Colony(world, rng, 0);

  colony.nestFoodPellets.push({ x: 10, y: 35, amount: 5 });
  colony.nestFoodPellets.push({ x: 11, y: 35, amount: 0.00001 }); // below threshold

  colony._nestFoodTiles.clear();
  for (const pellet of colony.nestFoodPellets) {
    if (pellet.amount > 0.0001) {
      colony._nestFoodTiles.add(`${Math.round(pellet.x)},${Math.round(pellet.y)}`);
    }
  }

  assert.ok(colony._nestFoodTiles.has('10,35'));
  assert.ok(!colony._nestFoodTiles.has('11,35'), 'Depleted pellet should not be in Set');
});

// --- Queen Safe Tile Search ---

test('queen safe tile is within search radius of nest', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('queen-safe');
  const colony = new Colony(world, rng, 0);

  const qx = colony.queen.x;
  const qy = colony.queen.y;
  assert.ok(Math.abs(qx - world.nestX) <= 30, 'Queen X should be within search radius');
  assert.ok(qy > world.nestY, 'Queen Y should be below nest');
  assert.ok(qy - world.nestY <= 30, 'Queen Y should be within search radius');
});

// --- Food conservation ---

test('depositFoodFromAnt keeps the ant cargo when the drop point cannot be resolved', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('deposit-leak-guard');
  const colony = new Colony(world, rng, 0);

  const ant = new Ant(world.nestX, world.nestY + 4, rng, 'worker');
  ant.carrying = { type: 'food', pelletId: 'p1', pelletNutrition: 30, pickupDistance: 5 };
  ant.carryingType = 'food';
  const dropPoint = { x: ant.x, y: ant.y };
  const foodBefore = colony.foodStored;

  // Force depositPellet's internal drop-point resolution to fail, simulating a
  // fully congested nest food area. The ant must NOT lose its cargo.
  colony.findNestFoodDropPoint = () => null;

  const ok = colony.depositFoodFromAnt(ant, null, dropPoint);
  assert.equal(ok, false, 'deposit should report failure');
  assert.equal(colony.foodStored, foodBefore, 'no phantom food should be added on failure');
  assert.equal(ant.carryingType, 'food', 'ant must keep its cargo to retry next tick');
  assert.equal(ant.carrying?.pelletNutrition, 30, 'cargo nutrition must be preserved');
});

// --- Queen succession (S7) ---

function killQueen(colony) {
  colony.queen.alive = false;
  colony.queen.health = 0;
  colony.queenDeaths = 1;
  colony._queenDeathCounter = colony._updateCounter;
}

test('queen succession promotes a healthy heir after the delay, consuming an ant + food', () => {
  const world = new World(96, 96);
  world.setNest(48, 48);
  const colony = new Colony(world, new SeededRng('succession'), 20);
  const config = createTestConfig();
  config.queenSuccessionDelayTicks = 50;
  config.queenSuccessionFoodCost = 60;
  colony.foodStored = 500;
  killQueen(colony);

  const antsBefore = colony.ants.length;
  let revived = false;
  for (let t = 0; t < 200 && !revived; t += 1) {
    colony.update(config);
    if (colony.queen.alive) revived = true;
  }

  assert.ok(revived, 'queen should be reborn after the succession delay');
  assert.equal(colony.queenSuccessions, 1, 'one succession recorded');
  assert.ok(colony.ants.length < antsBefore, 'an heir was consumed into the royal role');
  assert.ok(colony.foodStored <= 500 - 60, 'royal-jelly cost was paid');
  assert.ok(colony.queen.health > 0 && colony.queen.health <= colony.queen.healthMax, 'reborn queen has partial health');
});

test('queen succession does not fire before the delay elapses', () => {
  const world = new World(96, 96);
  world.setNest(48, 48);
  const colony = new Colony(world, new SeededRng('succession-delay'), 20);
  const config = createTestConfig();
  config.queenSuccessionDelayTicks = 100;
  config.queenSuccessionFoodCost = 0;
  colony.foodStored = 500;
  killQueen(colony);

  for (let t = 0; t < 40; t += 1) colony.update(config);
  assert.equal(colony.queen.alive, false, 'no early promotion before the delay');
  assert.equal(colony.queenSuccessions, 0);
});

test('queen succession waits when food is insufficient', () => {
  const world = new World(96, 96);
  world.setNest(48, 48);
  const colony = new Colony(world, new SeededRng('succession-poor'), 20);
  const config = createTestConfig();
  config.queenSuccessionDelayTicks = 10;
  config.queenSuccessionFoodCost = 100000; // unaffordable
  colony.foodStored = 50;
  killQueen(colony);

  for (let t = 0; t < 100; t += 1) colony.update(config);
  assert.equal(colony.queen.alive, false, 'cannot afford the royal-jelly cost → no succession');
  assert.equal(colony.queenSuccessions, 0);
});

test('queen succession waits when there is no eligible heir', () => {
  const world = new World(96, 96);
  world.setNest(48, 48);
  const colony = new Colony(world, new SeededRng('succession-noheir'), 20);
  const config = createTestConfig();
  config.queenSuccessionDelayTicks = 5;
  config.queenSuccessionFoodCost = 0;
  config.queenSuccessionMinHealthFraction = 0.5;
  colony.foodStored = 500;
  // Make every ant too unhealthy to inherit.
  for (const ant of colony.ants) ant.health = colony.queen.healthMax * 0.1;
  killQueen(colony);

  for (let t = 0; t < 50; t += 1) {
    colony.update(config);
    // keep ants pinned unhealthy so none qualifies
    for (const ant of colony.ants) ant.health = Math.min(ant.health, colony.queen.healthMax * 0.1);
  }
  assert.equal(colony.queen.alive, false, 'no healthy heir → queen stays dead');
  assert.equal(colony.queenSuccessions, 0);
});

// --- Food accounting canonical model (KNOWN_ISSUES #2) ---

test('food accounting: getTotalStoredFood returns the canonical foodStored', () => {
  const world = new World(96, 96);
  world.setNest(48, 48);
  const colony = new Colony(world, new SeededRng('food-canon'), 10);
  assert.equal(colony.getTotalStoredFood(), colony.foodStored);
});

test('food accounting: consumeFromStore keeps foodStored == virtual + pellet ledger', () => {
  const world = new World(96, 96);
  world.setNest(48, 48);
  const colony = new Colony(world, new SeededRng('food-invariant'), 10);

  const drift = () => Math.abs(
    colony.foodStored - (colony._virtualFoodStored + colony.getNestPelletNutritionTotal()),
  );
  assert.ok(drift() < 1e-6, 'invariant holds at construction (all virtual)');

  // Deposit physical pellets — both foodStored and the pellet ledger grow.
  colony.depositPellet(100, 48, 54);
  colony.depositPellet(80, 50, 55);
  assert.ok(drift() < 1e-6, 'invariant holds after deposits');

  // Small consume drains the virtual (bootstrap) reserve first.
  colony.consumeFromStore(50);
  assert.ok(drift() < 1e-6, 'invariant holds after a small consume (virtual)');

  // Drain most of the store so consumption reaches the physical pellets.
  colony.consumeFromStore(colony.foodStored - 10);
  assert.ok(drift() < 1e-6, 'invariant holds after consuming into physical pellets');
});
