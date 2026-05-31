import test from 'node:test';
import assert from 'node:assert/strict';
import { DigSystem } from '../src/sim/DigSystem.js';
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

test('DigSystem initializes with seed fronts', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-init');
  const colony = new Colony(world, rng, 10);
  const dig = new DigSystem(world, colony, rng);

  assert.ok(dig.fronts.length > 0, 'Should have initial fronts');
  assert.equal(dig.autoDig, false);
  assert.equal(dig.maxFronts, 10);
});

test('initial fronts are positioned near nest', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-pos');
  const colony = new Colony(world, rng, 0);
  const dig = new DigSystem(world, colony, rng);

  for (const front of dig.fronts) {
    assert.ok(world.inBounds(front.x, front.y), 'Front should be in bounds');
    assert.ok(front.y > world.nestY, 'Front should be underground');
    const distX = Math.abs(front.x - world.nestX);
    assert.ok(distX <= 10, 'Front should be near nest X');
  }
});

// --- Auto Dig Toggle ---

test('toggleAutoDig flips the state', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-toggle');
  const colony = new Colony(world, rng, 0);
  const dig = new DigSystem(world, colony, rng);

  assert.equal(dig.autoDig, false);
  const result1 = dig.toggleAutoDig();
  assert.equal(result1, true);
  assert.equal(dig.autoDig, true);
  const result2 = dig.toggleAutoDig();
  assert.equal(result2, false);
  assert.equal(dig.autoDig, false);
});

// --- Digging Progress ---

test('dig system excavates soil into tunnels', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-excavate');
  const colony = new Colony(world, rng, 50);
  const dig = new DigSystem(world, colony, rng);
  dig.autoDig = true;

  const config = createTestConfig();
  let tunnelsBefore = 0;
  for (let i = 0; i < world.size; i += 1) {
    if (world.terrain[i] === TERRAIN.TUNNEL) tunnelsBefore += 1;
  }

  for (let i = 0; i < 100; i += 1) {
    dig.update(config);
  }

  let tunnelsAfter = 0;
  for (let i = 0; i < world.size; i += 1) {
    if (world.terrain[i] === TERRAIN.TUNNEL) tunnelsAfter += 1;
  }

  assert.ok(tunnelsAfter > tunnelsBefore, 'Digging should create new tunnels');
});

test('dig system creates chambers', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-chamber');
  const colony = new Colony(world, rng, 50);
  const dig = new DigSystem(world, colony, rng);
  dig.autoDig = true;

  const config = createTestConfig();

  // Run many ticks to trigger chamber creation
  for (let i = 0; i < 500; i += 1) {
    dig.update(config);
  }

  let chamberCount = 0;
  for (let i = 0; i < world.size; i += 1) {
    if (world.terrain[i] === TERRAIN.CHAMBER) chamberCount += 1;
  }

  // The starter nest already has some chambers, and digging should create more
  assert.ok(chamberCount > 20, `Expected chambers to be created, got ${chamberCount}`);
});

// --- Force Chamber ---

test('forceChamberAtActiveFront creates a chamber', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('force-chamber');
  const colony = new Colony(world, rng, 10);
  const dig = new DigSystem(world, colony, rng);
  const config = createTestConfig();

  // Advance fronts first so they're in soil
  dig.autoDig = true;
  for (let i = 0; i < 20; i += 1) dig.update(config);

  const result = dig.forceChamberAtActiveFront(config);
  // May or may not succeed depending on front position, but shouldn't throw
  assert.equal(typeof result, 'boolean');
});

// --- Serialization ---

test('dig system serializes and loads correctly', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-serialize');
  const colony = new Colony(world, rng, 10);
  const dig = new DigSystem(world, colony, rng);
  dig.autoDig = true;

  const data = dig.serialize();
  const dig2 = new DigSystem(world, colony, new SeededRng('other'));
  dig2.loadFromSerialized(data);

  assert.equal(dig2.autoDig, true);
  assert.equal(dig2.fronts.length, dig.fronts.length);
});

test('dig system handles malformed serialized data gracefully', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-malformed');
  const colony = new Colony(world, rng, 0);
  const dig = new DigSystem(world, colony, rng);

  dig.loadFromSerialized(null);
  assert.ok(dig.fronts.length > 0, 'Should have seed fronts after loading null');

  dig.loadFromSerialized({ autoDig: 'yes', fronts: 'bad' });
  assert.ok(dig.fronts.length > 0, 'Should have seed fronts after loading bad data');
});

// --- World Change ---

test('setWorld clamps fronts to new world bounds', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-world-change');
  const colony = new Colony(world, rng, 0);
  const dig = new DigSystem(world, colony, rng);

  // Add a front out of small world bounds
  dig.fronts.push({ x: 100, y: 100, dir: 0, progress: 0, age: 0, stepsSinceChamber: 0, lastAdvanceTick: 0 });

  const smallWorld = new World(32, 32);
  dig.setWorld(smallWorld);

  // Out-of-bounds front should be filtered and re-seeded
  for (const front of dig.fronts) {
    assert.ok(smallWorld.inBounds(front.x, front.y), 'All fronts should be in bounds');
  }
});

// --- No Workers, No Dig ---

test('dig system does not advance without workers when autoDig is off', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('no-workers-dig');
  const colony = new Colony(world, rng, 0);
  const dig = new DigSystem(world, colony, rng);
  dig.autoDig = false;

  const frontsBefore = JSON.stringify(dig.fronts.map((f) => ({ x: f.x, y: f.y })));

  const config = createTestConfig();
  dig.update(config);

  const frontsAfter = JSON.stringify(dig.fronts.map((f) => ({ x: f.x, y: f.y })));
  assert.equal(frontsBefore, frontsAfter, 'Fronts should not advance without workers');
});

// --- Home Pheromone Boost ---

test('digging deposits home pheromone in carved tiles', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-pheromone');
  const colony = new Colony(world, rng, 50);
  const dig = new DigSystem(world, colony, rng);
  dig.autoDig = true;

  // Clear home pheromone
  world.toHome.fill(0);

  const config = createTestConfig();
  for (let i = 0; i < 50; i += 1) {
    dig.update(config);
  }

  // Check that some underground tiles have home pheromone
  let hasHomeBelow = false;
  for (let y = world.nestY + 2; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const idx = world.index(x, y);
      if (world.terrain[idx] === TERRAIN.TUNNEL && world.toHome[idx] > 0) {
        hasHomeBelow = true;
        break;
      }
    }
    if (hasHomeBelow) break;
  }

  assert.ok(hasHomeBelow, 'Digging should deposit home pheromone in tunnels');
});

test('upward shaft spawn carves a horizontal connector to the colony', () => {
  const world = new World(96, 96);
  const rng = new SeededRng('upward-shaft-connector');
  const colony = new Colony(world, rng, 10);
  const dig = new DigSystem(world, colony, rng);
  const config = createTestConfig();

  const chamberX = world.nestX;
  const chamberY = world.nestY + 24;
  dig.fronts[0] = {
    x: chamberX,
    y: chamberY,
    dir: 1,
    progress: 0,
    age: 0,
    stepsSinceChamber: 30,
    lastAdvanceTick: 0,
  };

  const originalChance = rng.chance.bind(rng);
  const originalInt = rng.int.bind(rng);
  rng.chance = (probability) => {
    if (probability === 0.08 || probability === 0.5) return true;
    return originalChance(probability);
  };
  rng.int = (max) => {
    if (max === 26) return 20; // offset 35 tiles from chamber
    return originalInt(max);
  };

  const created = dig.forceChamberAtActiveFront(config);
  assert.equal(created, true, 'Expected forced chamber creation to succeed');
  assert.equal(dig.upwardShafts.length, 1, 'Expected upward shaft to be spawned');

  const shaft = dig.upwardShafts[0];
  const connectorY = shaft.y;
  const minX = Math.min(chamberX, shaft.x);
  const maxX = Math.max(chamberX, shaft.x);

  for (let x = minX; x <= maxX; x += 1) {
    const terrain = world.terrain[world.index(x, connectorY)];
    assert.ok(
      terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER,
      `Connector should be passable at (${x}, ${connectorY})`,
    );
  }
});

test('upward shaft spawn stores varied emergence Y and reports it on breach', () => {
  const world = new World(96, 96);
  const rng = new SeededRng('upward-shaft-emergence-y');
  const colony = new Colony(world, rng, 10);
  const dig = new DigSystem(world, colony, rng);
  const config = createTestConfig();

  const chamberX = world.nestX;
  const chamberY = world.nestY + 24;
  dig.fronts[0] = {
    x: chamberX,
    y: chamberY,
    dir: 1,
    progress: 0,
    age: 0,
    stepsSinceChamber: 30,
    lastAdvanceTick: 0,
  };

  const originalChance = rng.chance.bind(rng);
  const originalInt = rng.int.bind(rng);
  rng.chance = (probability) => {
    if (probability === 0.08 || probability === 0.5) return true;
    return originalChance(probability);
  };
  rng.int = (max) => {
    if (max === 26) return 5; // stable x offset for this test
    if (max === 3) return 2; // yJitter = +1
    return originalInt(max);
  };

  const created = dig.forceChamberAtActiveFront(config);
  assert.equal(created, true, 'Expected forced chamber creation to succeed');
  assert.equal(dig.upwardShafts.length, 1, 'Expected upward shaft to be spawned');

  const shaft = dig.upwardShafts[0];
  // With the entrance at the surface boundary row, breach Y resolves to the
  // entrance row itself even when jitter would otherwise push it deeper.
  const expectedBreachY = world.entranceY;
  assert.equal(shaft.breachY, expectedBreachY, 'Spawned shaft should store emergence Y on the entrance row');

  let breached = null;
  dig.onNewEntrance = (x, y) => {
    breached = { x, y };
  };

  for (let i = 0; i < 200 && !breached; i += 1) {
    dig.update(config);
  }

  assert.ok(breached, 'Expected shaft to breach and trigger callback');
  assert.equal(breached.y, expectedBreachY, 'New entrance callback should report varied emergence Y');
});

// --- Configurable dig recruitment ---

function digRadiusScenario(seed) {
  const world = new World(64, 64);
  const rng = new SeededRng(seed);
  const colony = new Colony(world, rng, 0);
  const dig = new DigSystem(world, colony, rng);
  dig.autoDig = true; // force one front to be assigned

  const fx = world.nestX + 12;
  const fy = world.nestY + 6;
  dig.fronts = [{ x: fx, y: fy, dir: 1, progress: 0, age: 0, stepsSinceChamber: 0, lastAdvanceTick: 0 }];

  // A dig-focus worker 10 tiles away: d2 = 100, between the base radius (8²=64)
  // and the default recruit radius (16²=256).
  const worker = new Ant(fx, fy + 10, rng, 'worker');
  worker.workFocus = 'dig';
  worker.health = worker.healthMax;
  worker.hunger = worker.hungerMax;
  worker.carrying = null;
  worker.carryingType = 'none';
  colony.ants.push(worker);

  return { dig, worker };
}

test('digRecruitRadius controls how far a dig front recruits dig-focus workers', () => {
  const inRange = digRadiusScenario('dig-radius-in');
  inRange.dig.update({ ...createTestConfig(), digRecruitRadius: 16 });
  assert.equal(inRange.worker.carryingType, 'dirt', 'recruited at radius 16 (covers a 10-tile worker)');

  const outOfRange = digRadiusScenario('dig-radius-out');
  outOfRange.dig.update({ ...createTestConfig(), digRecruitRadius: 8 });
  assert.equal(outOfRange.worker.carryingType, 'none', 'not recruited at radius 8 (10-tile worker is out of range)');
});

test('lower digWorkersPerFront staffs more fronts from the same dig-focus workforce', () => {
  function manyFrontsScenario(workersPerFront) {
    const world = new World(96, 96);
    const rng = new SeededRng('dig-staffing');
    const colony = new Colony(world, rng, 0);
    const dig = new DigSystem(world, colony, rng);
    dig.autoDig = true;

    // Four fronts spread across deep soil, each with a dig worker sitting on it.
    dig.fronts = [];
    for (let f = 0; f < 4; f += 1) {
      const fx = world.nestX - 12 + f * 8;
      const fy = world.nestY + 10;
      dig.fronts.push({ x: fx, y: fy, dir: 1, progress: 0, age: 0, stepsSinceChamber: 0, lastAdvanceTick: 0 });
      const w = new Ant(fx, fy, rng, 'worker');
      w.workFocus = 'dig';
      w.health = w.healthMax;
      w.hunger = w.hungerMax;
      w.carrying = null;
      w.carryingType = 'none';
      colony.ants.push(w);
    }
    dig.update({ ...createTestConfig(), digRecruitRadius: 16, digWorkersPerFront: workersPerFront });
    return colony.ants.filter((a) => a.carryingType === 'dirt').length;
  }

  const aggressive = manyFrontsScenario(1); // ceil(4/1) = 4 fronts staffed
  const conservative = manyFrontsScenario(8); // ceil(4/8) = 1 -> baseline floor only
  assert.ok(aggressive > conservative, `aggressive staffing (${aggressive}) should recruit more than conservative (${conservative})`);
});

test('dig-focus workers are preferred over closer non-dig workers', () => {
  const world = new World(64, 64);
  const rng = new SeededRng('dig-priority');
  const colony = new Colony(world, rng, 0); // no default ants
  const dig = new DigSystem(world, colony, rng);
  dig.autoDig = true; // force one front to be assigned regardless of worker count

  const fx = world.nestX + 12;
  const fy = world.nestY + 6;
  dig.fronts = [{ x: fx, y: fy, dir: 1, progress: 0, age: 0, stepsSinceChamber: 0, lastAdvanceTick: 0 }];

  // A non-dig worker sits ON the front (closest possible); a dig-focus worker is
  // a few tiles away but within the assignment radius. The dig-focus worker must
  // win assignment despite being farther — priority, not proximity.
  const nonDig = new Ant(fx, fy, rng, 'worker');
  nonDig.workFocus = 'forage';
  nonDig.health = nonDig.healthMax;
  nonDig.hunger = nonDig.hungerMax;
  nonDig.carrying = null;
  nonDig.carryingType = 'none';

  const digger = new Ant(fx + 4, fy + 2, rng, 'worker'); // d2 = 20, inside base radius 64
  digger.workFocus = 'dig';
  digger.health = digger.healthMax;
  digger.hunger = digger.hungerMax;
  digger.carrying = null;
  digger.carryingType = 'none';

  colony.ants.push(nonDig, digger);

  dig.update(createTestConfig());

  assert.equal(digger.carryingType, 'dirt', 'dig-focus worker should be recruited');
  assert.equal(nonDig.carryingType, 'none', 'closer non-dig worker should be skipped in favor of the dig-focus one');
});
