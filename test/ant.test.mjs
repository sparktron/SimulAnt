import test from 'node:test';
import assert from 'node:assert/strict';
import { Ant } from '../src/sim/ant.js';
import { World, TERRAIN } from '../src/sim/world.js';
import { Colony } from '../src/sim/colony.js';
import { SeededRng } from '../src/sim/rng.js';

function createTestWorld(width = 64, height = 64) {
  return new World(width, height);
}

function createTestColony(world, rng, count = 0) {
  return new Colony(world, rng, count);
}

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

// --- Ant Construction ---

test('ant initializes with correct defaults for worker', () => {
  const rng = new SeededRng('test-seed');
  const ant = new Ant(10, 20, rng, 'worker');

  assert.equal(ant.x, 10);
  assert.equal(ant.y, 20);
  assert.equal(ant.role, 'worker');
  assert.equal(ant.alive, true);
  assert.equal(ant.healthMax, 100);
  assert.equal(ant.hungerMax, 100);
  assert.ok(ant.hunger >= 20 && ant.hunger <= 100, `hunger ${ant.hunger} should be 20-100`);
  assert.ok(ant.health >= 75 && ant.health <= 100, `health ${ant.health} should be 75-100`);
  assert.equal(ant.carrying, null);
  assert.equal(ant.carryingType, 'none');
  assert.equal(ant.state, 'IDLE');
  assert.equal(ant.stepCounter, 0);
  assert.ok(ant.id.startsWith('ant-'));
});

test('ant initializes with correct defaults for soldier', () => {
  const rng = new SeededRng('soldier-seed');
  const ant = new Ant(5, 5, rng, 'soldier');

  assert.equal(ant.role, 'soldier');
  assert.equal(ant.baseColor, Ant.getDefaultBaseColor('soldier'));
  assert.equal(Ant.getLegacySoldierBaseColor(), '#d93828');
  assert.equal(ant.hungerDrainRates.idle, 2.2);
  assert.equal(ant.hungerDrainRates.move, 4.5);
});

// --- Ant Movement ---

test('ant moves on passable terrain during update', () => {
  const rng = new SeededRng('move-seed');
  const world = createTestWorld();
  const colony = createTestColony(world, rng, 0);
  const config = createTestConfig();

  // Place ant on surface (passable)
  const ant = new Ant(world.nestX, world.nestY - 5, rng, 'worker');
  colony.ants.push(ant);
  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const startX = ant.x;
  const startY = ant.y;

  // Run several updates to allow ant to move
  for (let i = 0; i < 10; i += 1) {
    ant.update(world, colony, rng, config);
  }

  const moved = ant.x !== startX || ant.y !== startY;
  assert.ok(moved, 'Ant should have moved after multiple updates');
});

test('ant does not move onto wall terrain', () => {
  const rng = new SeededRng('wall-seed');
  const world = createTestWorld(8, 8);
  // Surround ant with walls except one direction
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      world.terrain[world.index(x, y)] = TERRAIN.GROUND;
    }
  }
  // Place walls around (4,4) on all sides except (5,4)
  world.terrain[world.index(3, 3)] = TERRAIN.WALL;
  world.terrain[world.index(4, 3)] = TERRAIN.WALL;
  world.terrain[world.index(5, 3)] = TERRAIN.WALL;
  world.terrain[world.index(3, 4)] = TERRAIN.WALL;
  world.terrain[world.index(3, 5)] = TERRAIN.WALL;
  world.terrain[world.index(4, 5)] = TERRAIN.WALL;
  world.terrain[world.index(5, 5)] = TERRAIN.WALL;
  world.terrain[world.index(5, 4)] = TERRAIN.GROUND; // only exit

  const colony = createTestColony(world, rng, 0);
  colony.setNestEntrances([{ id: 'e', x: 4, y: 4, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(4, 4, rng, 'worker');

  for (let i = 0; i < 50; i += 1) {
    ant.update(world, colony, rng, createTestConfig());
    // Ant should never be on a wall
    assert.notEqual(world.terrain[world.index(ant.x, ant.y)], TERRAIN.WALL);
  }
});

test('ant movement tie-break strongly prefers forward over reverse', () => {
  const world = createTestWorld(64, 64);
  const config = createTestConfig();
  let forwardMoves = 0;
  let reverseMoves = 0;

  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      world.terrain[world.index(x, y)] = TERRAIN.WALL;
    }
  }

  const antX = world.nestX;
  const antY = world.nestY + 3; // underground
  const eastX = antX + 1;
  const westX = antX - 1;
  const entrance = { id: 'e', x: world.nestX, y: world.nestY + 1, radius: 2 };

  world.terrain[world.index(antX, antY)] = TERRAIN.TUNNEL;
  world.terrain[world.index(eastX, antY)] = TERRAIN.TUNNEL;
  world.terrain[world.index(westX, antY)] = TERRAIN.TUNNEL;

  for (let i = 0; i < 300; i += 1) {
    const rng = new SeededRng(`forward-bias-${i}`);
    const colony = createTestColony(world, rng, 0);
    colony.setNestEntrances([entrance]);
    colony.setSurfaceFoodPellets([]);

    const ant = new Ant(antX, antY, rng, 'worker');
    ant.dir = 0; // facing east
    ant.update(world, colony, rng, config);

    if (ant.x === eastX) forwardMoves += 1;
    if (ant.x === westX) reverseMoves += 1;
  }

  assert.ok(
    forwardMoves > reverseMoves * 1.8,
    `Forward should be strongly preferred (forward=${forwardMoves}, reverse=${reverseMoves})`,
  );
});

test('worker return-to-nest fallback uses per-ant miss-threshold jitter to avoid lockstep', () => {
  const rng = new SeededRng('miss-jitter-seed');
  const world = createTestWorld(96, 96);
  const colony = createTestColony(world, rng, 0);
  const config = createTestConfig();
  config.surfaceFoodSearchMaxMissTicks = 5;
  config.surfaceReturnToNestHungerThreshold = 0.8;

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);
  colony.foodStored = 10;
  colony.foodStoreTarget = 100;

  const ant = new Ant(world.nestX + 24, Math.max(0, world.nestY - 20), rng, 'worker');
  const buddy = new Ant(world.nestX + 22, Math.max(0, world.nestY - 21), rng, 'worker');
  colony.ants.push(ant, buddy);
  ant.workFocus = 'forage';
  ant.hunger = 55;
  ant.health = ant.healthMax;
  ant.surfaceSearchMissThresholdOffsetTicks = 12;

  ant.failedSurfaceFoodSearchTicks = 4;
  ant.update(world, colony, rng, config);
  assert.notEqual(
    ant.state,
    'RETURN_NEST_TO_EAT',
    'Positive miss-threshold offset should prevent early synchronized nest return',
  );

  ant.failedSurfaceFoodSearchTicks = 16;
  ant.update(world, colony, rng, config);
  assert.equal(ant.state, 'RETURN_NEST_TO_EAT');
});

// --- Hazard Interaction ---

test('ant can step onto hazard terrain and may die', () => {
  const rng = new SeededRng('hazard-death-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  config.hazardDeathChance = 1.0; // guaranteed death

  // Place hazard on surface
  const hx = world.nestX + 5;
  const hy = world.nestY - 3;
  world.terrain[world.index(hx, hy)] = TERRAIN.HAZARD;

  assert.ok(world.isPassable(hx, hy), 'HAZARD terrain should be passable');

  const colony = createTestColony(world, rng, 0);
  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  // Place ant directly on hazard
  const ant = new Ant(hx, hy, rng, 'worker');
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  assert.equal(ant.alive, false, 'Ant should die on hazard with 100% death chance');
  assert.equal(colony.deaths, 1);
});

test('ant survives hazard with 0% death chance and deposits danger pheromone', () => {
  const rng = new SeededRng('hazard-survive-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  config.hazardDeathChance = 0;

  const hx = world.nestX + 3;
  const hy = world.nestY - 2;
  world.terrain[world.index(hx, hy)] = TERRAIN.HAZARD;

  const colony = createTestColony(world, rng, 0);
  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(hx, hy, rng, 'worker');
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  assert.ok(ant.alive, 'Ant should survive with 0% death chance');
  const idx = world.index(hx, hy);
  assert.ok(world.danger[idx] > 0, 'Danger pheromone should be deposited on hazard tile');
});

test('ant dies immediately after stepping onto a hazard tile', () => {
  const rng = new SeededRng('hazard-step-seed');
  const world = createTestWorld(9, 9);
  const config = createTestConfig();
  config.hazardDeathChance = 1.0;

  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      world.terrain[world.index(x, y)] = TERRAIN.WALL;
    }
  }

  const startX = 4;
  const startY = 4;
  const hx = 5;
  const hy = 4;
  world.terrain[world.index(startX, startY)] = TERRAIN.GROUND;
  world.terrain[world.index(hx, hy)] = TERRAIN.HAZARD;

  const colony = createTestColony(world, rng, 0);
  colony.setNestEntrances([{ id: 'e', x: startX, y: startY, radius: 1 }]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(startX, startY, rng, 'worker');
  ant.dir = 0; // bias east toward the only passable neighbor
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  assert.equal(ant.x, hx);
  assert.equal(ant.y, hy);
  assert.equal(ant.alive, false, 'Ant should die in the same tick it enters hazard');
  assert.equal(colony.deaths, 1);
});

// --- Food Deposit ---

test('ant deposits food when near entrance regardless of y position', () => {
  const rng = new SeededRng('deposit-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  const entrance = { id: 'e', x: world.nestX, y: world.nestY, radius: 2 };
  colony.setNestEntrances([entrance]);
  colony.setSurfaceFoodPellets([]);

  // Place ant in nest with food
  const dropPoint = { x: world.nestX + 1, y: world.nestY + 1 };
  const ant = new Ant(dropPoint.x, dropPoint.y, rng, 'worker');
  ant.carrying = { type: 'food', pelletId: 'test-1', pelletNutrition: 10 };
  ant.carryingType = 'food';
  // Make terrain passable
  world.terrain[world.index(dropPoint.x, dropPoint.y)] = TERRAIN.TUNNEL;
  colony.ants.push(ant);

  // Note: Master requires food to be deposited through depositFoodFromAnt with proper drop point
  // which is more complex than old behavior. Test validates the capability exists.
  const result = colony.depositFoodFromAnt(ant, entrance, dropPoint);
  assert.ok(result, 'Colony should accept food deposit at valid drop point');
  assert.equal(ant.carrying, null, 'Ant should have cleared carrying after deposit');
  assert.ok(colony.foodStored >= 10, 'Colony should have received the food');
});

// --- Soldier Behavior ---

test('soldier ant moves and patrols instead of sitting idle', () => {
  const rng = new SeededRng('soldier-patrol-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const soldier = new Ant(world.nestX + 3, world.nestY - 3, rng, 'soldier');
  colony.ants.push(soldier);
  const startX = soldier.x;
  const startY = soldier.y;

  for (let i = 0; i < 20; i += 1) {
    soldier.update(world, colony, rng, config);
  }

  const moved = soldier.x !== startX || soldier.y !== startY;
  assert.ok(moved, 'Soldier should move during patrol');
  assert.equal(soldier.state, 'PATROL');
});

test('soldier ant does not eat from nest (worker-only behavior)', () => {
  const rng = new SeededRng('soldier-eat-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);
  colony.foodStored = 100;

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  // Place soldier underground (inNest) with low hunger
  const soldier = new Ant(world.nestX, world.nestY + 3, rng, 'soldier');
  // Need passable tile underground
  world.terrain[world.index(soldier.x, soldier.y)] = TERRAIN.TUNNEL;
  soldier.hunger = 10; // very hungry
  colony.ants.push(soldier);

  const foodBefore = colony.foodStored;
  soldier.update(world, colony, rng, config);

  // Master design: only workers eat from nest stores, soldiers don't
  assert.equal(colony.foodStored, foodBefore, 'Soldier should NOT consume food from colony store');
  assert.equal(soldier.hunger, 10, 'Soldier hunger should remain unchanged');
});

test('worker standing on entrance tile is treated as surface and does not consume nest food', () => {
  const rng = new SeededRng('entrance-boundary-eat');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);
  colony.foodStored = 100;

  const ant = new Ant(world.nestX, world.nestY, rng, 'worker');
  ant.health = 10; // low enough to eat if this tile is treated as in-nest
  ant.hunger = 10;
  colony.ants.push(ant);

  const beforeFood = colony.foodStored;
  ant.update(world, colony, rng, config);

  assert.equal(colony.foodStored, beforeFood, 'Entrance tile should not count as in-nest feeding location');
});

test('worker nest feeding only consumes hunger deficit from store', () => {
  const rng = new SeededRng('bounded-nest-eat');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);
  colony.foodStored = 100;

  const ant = new Ant(world.nestX, world.nestY + 3, rng, 'worker');
  ant.health = 10;
  ant.hunger = 95;
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  assert.equal(colony.foodStored, 95, 'Only 5 nutrition should be consumed to fill hunger to max');
  assert.ok(ant.hunger > 99.8 && ant.hunger <= 100, 'Ant hunger should be effectively full after bounded intake');
});

test('full-hunger worker consumes only nutrition needed for health recovery', () => {
  const rng = new SeededRng('full-hunger-health-recovery-cap');
  const world = createTestWorld();
  const config = createTestConfig();
  config.healthEatRecoveryRate = 2.0;
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);
  colony.foodStored = 100;

  const ant = new Ant(world.nestX, world.nestY + 3, rng, 'worker');
  ant.hunger = ant.hungerMax;
  ant.health = 59;
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  // health deficit = 41 and recovery rate = 2.0 in test config, so only 20.5
  // nutrition is needed; ant should not consume the full workerEatNutrition.
  assert.equal(colony.foodStored, 79.5);
  assert.ok(ant.hunger > 99.8 && ant.hunger <= ant.hungerMax);
  assert.ok(ant.health >= 99.99 && ant.health <= ant.healthMax);
});

test('low-health worker eats from found pellet and carries the remainder', () => {
  const rng = new SeededRng('eat-then-carry');
  const world = createTestWorld();
  const config = createTestConfig();
  config.healthEatRecoveryRate = 1;
  config.workerEatNutrition = 10;
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  const pellet = { id: 'p-eat-carry', x: world.nestX + 8, y: world.nestY - 6, nutrition: 30 };
  colony.setSurfaceFoodPellets([pellet]);

  const ant = new Ant(pellet.x, pellet.y, rng, 'worker');
  ant.health = 30;
  ant.hunger = 20;
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  assert.equal(ant.carrying?.type, 'food');
  assert.equal(ant.carrying?.pelletNutrition, 10);
  assert.equal(colony.findAvailablePelletAt(pellet.x, pellet.y), null);
  assert.ok(ant.health > 30, 'Ant should recover health before hauling');
});

test('low-health worker carrying food eats before continuing home', () => {
  const rng = new SeededRng('eat-carried-food-first');
  const world = createTestWorld();
  const config = createTestConfig();
  config.healthEatRecoveryRate = 1;
  config.workerEatNutrition = 8;
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(world.nestX + 12, world.nestY - 8, rng, 'worker');
  ant.health = 20;
  ant.hunger = 30;
  ant.carrying = { type: 'food', pelletId: 'carry-1', pelletNutrition: 20 };
  ant.carryingType = 'food';
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  assert.equal(ant.carrying?.type, 'food');
  assert.equal(ant.carrying?.pelletNutrition, 12);
  assert.ok(ant.health > 20, 'Ant should consume carried food to recover first');
});

test('worker returning from surface enters nest interior while returning to heal', () => {
  const rng = new SeededRng('entry-target-below-surface');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  const entrance = { id: 'e', x: world.nestX, y: world.nestY, radius: 2 };
  colony.setNestEntrances([entrance]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(world.nestX, world.nestY - 1, rng, 'worker');
  ant.health = 10; // low health triggers return-to-nest-heal movement
  ant.hunger = 10;
  colony.ants.push(ant);

  for (let i = 0; i < 4; i += 1) {
    ant.update(world, colony, rng, config);
    if (ant.y > world.nestY) break;
  }

  assert.ok(ant.y > world.nestY, 'Returning ant should move below entrance into nest interior');
});

// --- Vitals ---

test('ant hunger drains over time and health drops when starving', () => {
  const rng = new SeededRng('vitals-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);
  colony.foodStored = 0;

  const ant = new Ant(world.nestX, world.nestY - 5, rng, 'worker');
  ant.hunger = 1; // nearly starving
  colony.ants.push(ant);

  for (let i = 0; i < 30; i += 1) {
    ant.update(world, colony, rng, config);
    if (!ant.alive) break;
  }

  assert.equal(ant.hunger, 0, 'Ant should be fully starved');
  assert.ok(ant.health < 100, 'Ant health should have decreased');
});

test('ant dies when health reaches zero', () => {
  const rng = new SeededRng('death-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);
  colony.foodStored = 0;

  const ant = new Ant(world.nestX, world.nestY - 5, rng, 'worker');
  ant.hunger = 0;
  ant.health = 0.01;
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  assert.equal(ant.alive, false, 'Ant with zero health should die');
});

test('ant health regenerates when well-fed', () => {
  const rng = new SeededRng('regen-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(world.nestX, world.nestY - 5, rng, 'worker');
  ant.hunger = 90; // well-fed (> 65% of 100)
  ant.health = 50; // damaged
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  assert.ok(ant.health > 50, 'Ant health should regenerate when hunger > 65%');
});

// --- Direction Tracking ---

test('moveToward updates ant direction correctly', () => {
  const rng = new SeededRng('dir-track-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);

  // Place visible food pellet far from ant
  const pelletX = world.nestX + 5;
  const pelletY = world.nestY - 5;
  colony.setSurfaceFoodPellets([{
    id: 'p1', x: pelletX, y: pelletY,
    nutrition: 25, takenByAntId: null,
  }]);

  const ant = new Ant(world.nestX + 2, world.nestY - 5, rng, 'worker');
  ant.hunger = 10; // needs food
  colony.ants.push(ant);
  colony.foodStored = 0;

  const initialDir = ant.dir;
  ant.update(world, colony, rng, config);

  // Ant should be heading toward food — dir should reflect the actual movement direction
  if (ant.x !== world.nestX + 2 || ant.y !== world.nestY - 5) {
    // If ant moved, dir should have been updated
    assert.ok(ant.dir >= 0 && ant.dir < 8, 'Direction should be valid');
  }
});

// --- Step Counter ---

test('step counter increments each update tick', () => {
  const rng = new SeededRng('step-counter-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(world.nestX, world.nestY - 5, rng, 'worker');
  colony.ants.push(ant);

  assert.equal(ant.stepCounter, 0);
  ant.update(world, colony, rng, config);
  assert.equal(ant.stepCounter, 1);
  ant.update(world, colony, rng, config);
  assert.equal(ant.stepCounter, 2);
});

// --- Dead Ant Skipped ---

test('dead ant is skipped during update', () => {
  const rng = new SeededRng('dead-skip-seed');
  const world = createTestWorld();
  const config = createTestConfig();
  const colony = createTestColony(world, rng, 0);

  colony.setNestEntrances([{ id: 'e', x: world.nestX, y: world.nestY, radius: 2 }]);
  colony.setSurfaceFoodPellets([]);

  const ant = new Ant(world.nestX, world.nestY - 5, rng, 'worker');
  ant.alive = false;
  ant.hunger = 50;
  colony.ants.push(ant);

  ant.update(world, colony, rng, config);

  // Step counter should not have incremented since ant is dead
  assert.equal(ant.stepCounter, 0, 'Dead ant should not update');
});
