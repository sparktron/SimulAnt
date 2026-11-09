import test from 'node:test';
import assert from 'node:assert/strict';
import { World, TERRAIN } from '../src/sim/world.js';
import { Ant } from '../src/sim/ant.js';
import { Colony } from '../src/sim/colony.js';
import { DigSystem } from '../src/sim/DigSystem.js';
import { SeededRng } from '../src/sim/rng.js';
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { UNREACHABLE } from '../src/sim/behavior/NestExitField.js';
import { moveThroughEntranceShaft } from '../src/sim/ant/steering.js';
import * as vitals from '../src/sim/ant/vitals.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

const CONFIG = sanitizeTickConfig(getDefaultConfig());

// 32x32 world (nestY = 16) with one mouth at (10,16). A shaft drops to y=24,
// runs east to x=16, then climbs back up to a dead-end pocket at (16,19). The
// straight line from the pocket to the mouth crosses solid soil, which is the
// shape that used to trap greedy exit steering beside dug breach shafts.
function pocketWorld() {
  const world = new World(32, 32);
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      world.terrain[world.index(x, y)] = y > world.nestY ? TERRAIN.SOIL : TERRAIN.GROUND;
    }
  }
  const carve = (x, y) => { world.terrain[world.index(x, y)] = TERRAIN.TUNNEL; };
  for (let y = 16; y <= 24; y += 1) carve(10, y);
  for (let x = 10; x <= 16; x += 1) carve(x, 24);
  for (let y = 19; y <= 24; y += 1) carve(16, y);
  world.markTerrainDirty();
  const entrance = { id: 'entrance-main', x: 10, y: 16, radius: 2 };
  const colony = new Colony(world, new SeededRng('nest-exit-colony'), 0, { homeX: 10, homeY: 16 });
  colony.setNestEntrances([entrance]);
  return { world, colony, entrance };
}

function placeAnt(colony, x, y, seed = 'nest-exit-ant') {
  const ant = new Ant(x, y, new SeededRng(seed), 'worker');
  ant._currentColony = colony;
  colony.ants.push(ant);
  colony.rebuildAntGridFromAnts();
  return ant;
}

test('nest exit field measures tunnel walking distance, not straight-line distance', () => {
  const { world, colony } = pocketWorld();
  const field = colony.getNestExitField();
  assert.equal(field.distanceAt(10, 16), 0);
  assert.equal(field.distanceAt(10, 17), 1);
  // Shaft (7) + diagonal turn (1) + corridor (4) + diagonal turn (1) + climb (4).
  assert.equal(field.distanceAt(16, 19), 17);
  assert.equal(field.distanceAt(12, 15), UNREACHABLE, 'surface tiles are outside the field');
  assert.equal(field.distanceAt(13, 20), UNREACHABLE, 'solid soil is unreachable');

  // Digging a direct connection is picked up on the next lookup.
  for (let x = 11; x <= 15; x += 1) world.setTerrain(world.index(x, 18), TERRAIN.TUNNEL);
  assert.ok(colony.getNestExitField().distanceAt(16, 19) < 17);
});

test('exiting ants climb out of a pocket that traps greedy steering', () => {
  const run = (useField) => {
    const { world, colony, entrance } = pocketWorld();
    const ant = placeAnt(colony, 16, 19);
    if (!useField) ant._currentColony = null;
    const rng = new SeededRng('pocket-escape');
    for (let step = 1; step <= 40; step += 1) {
      moveThroughEntranceShaft(ant, world, entrance, entrance.y - 1, rng);
      if (ant.y <= entrance.y) return step;
    }
    return null;
  };
  assert.equal(run(false), null, 'greedy steering alone stays stuck in the pocket');
  const steps = run(true);
  assert.ok(steps !== null && steps <= 20, `field steering should reach the mouth, took ${steps}`);
});

test('climbing the exit field keeps the ant spatial hash in sync', () => {
  const { world, colony, entrance } = pocketWorld();
  const ant = placeAnt(colony, 16, 19);
  const rng = new SeededRng('pocket-grid');
  for (let step = 0; step < 5; step += 1) moveThroughEntranceShaft(ant, world, entrance, entrance.y, rng);
  assert.equal(colony.countAntsAt(16, 19), 0);
  assert.equal(colony.countAntsAt(ant.x, ant.y), 1);
});

test('fed foragers keep moving on the surface when the food store is full', () => {
  const sim = new SimulationCore('fed-forager-surface');
  const ant = sim.colony.ants.find((a) => a.role === 'worker');
  Object.assign(ant, {
    x: 40, y: 60, workFocus: 'forage', carrying: null,
    hunger: ant.hungerMax, health: ant.healthMax,
  });
  sim.colony.ants = [ant];
  sim.rivalColony.ants = [];
  sim.colony.foodStored = sim.colony.foodStoreTarget * 10;
  sim.colony.rebuildAntGridFromAnts();
  sim.rivalColony.rebuildAntGridFromAnts();
  sim.microEngine.setExternalState({
    foodPellets: [], nestEntrances: sim.nestEntrances, rivalNestEntrances: sim.rivalNestEntrances,
  });
  assert.equal(vitals.needsForage(ant, sim.colony), false, 'precondition: store full, ant fed');

  const visited = new Set();
  for (let i = 0; i < 30; i += 1) {
    ant.update(sim.world, sim.colony, sim.rng, CONFIG);
    visited.add(`${ant.x},${ant.y}`);
  }
  assert.ok(visited.size > 5, `forager should keep searching, visited ${visited.size} tiles`);
});

test('reset carves only the two colony nests, with no ownerless nest at map centre', () => {
  const sim = new SimulationCore('no-phantom-nest');
  const { world } = sim;
  const centerX = Math.floor(world.width / 2);
  for (let y = world.nestY; y <= world.nestY + 14; y += 1) {
    for (let x = centerX - 2; x <= centerX + 2; x += 1) {
      assert.equal(world.isUndergroundTile(x, y), false, `unexpected tunnel at (${x},${y})`);
    }
  }
  assert.ok(world.isUndergroundTile(sim.colony.homeX, world.nestY + 5));
  assert.ok(world.isUndergroundTile(sim.rivalColony.homeX, world.nestY + 5));
});

test('dig branch fronts only spawn from the colony\'s own side of the map', () => {
  // Both nests share one terrain grid. Fill the rival half with tunnel so a
  // territory-blind spawner would branch there almost every time, and carve a
  // little home tunnel so the spawner still has somewhere legal to branch.
  const world = new World(256, 256);
  const homeX = 64;
  for (let y = world.nestY + 3; y < world.height; y += 1) {
    for (let x = 140; x < world.width; x += 1) world.terrain[world.index(x, y)] = TERRAIN.TUNNEL;
    for (let x = 80; x <= 100; x += 1) world.terrain[world.index(x, y)] = TERRAIN.TUNNEL;
  }
  world.markTerrainDirty();
  const colony = new Colony(world, new SeededRng('dig-territory-colony'), 0, { homeX, homeY: world.nestY });
  const dig = new DigSystem(world, colony, new SeededRng('dig-territory'));
  dig.autoDig = true; // dig without ants so the branch roll still fires

  // Record each front where it first appears; fronts later walk as they dig.
  const known = new Set(dig.fronts);
  const spawnedAt = [];
  for (let t = 0; t < 6000 && spawnedAt.length < 4; t += 1) {
    dig.update(CONFIG);
    for (const front of dig.fronts) {
      if (known.has(front)) continue;
      known.add(front);
      spawnedAt.push(front.x);
    }
  }
  assert.ok(spawnedAt.length > 0, 'spawner should branch from the home tunnel');
  for (const x of spawnedAt) {
    assert.ok(Math.abs(x - homeX) <= world.width / 4, `branch front spawned at x=${x}`);
  }
});

// --- Hurt foragers heal in the nest instead of ping-ponging at the mouth ---

function healSetup(seed, count, { health = 0.3, hunger = 1 } = {}) {
  const sim = new SimulationCore(seed);
  const colony = sim.colony;
  sim.microEngine.setExternalState({
    foodPellets: [], nestEntrances: sim.nestEntrances, rivalNestEntrances: sim.rivalNestEntrances,
  });
  const field = colony.getNestExitField();
  // Start every healer on one tile just inside the shaft, the worst case for
  // both the old exit bounce and for clumping.
  const entrance = sim.nestEntrances[0];
  const startY = entrance.y + 2;
  const startX = [0, -1, 1].map((dx) => entrance.x + dx)
    .find((x) => field.distanceAt(x, startY) > 0);
  const workers = colony.ants.filter((a) => a.role === 'worker').slice(0, count);
  for (const ant of workers) {
    Object.assign(ant, {
      x: startX, y: startY, workFocus: 'forage', carrying: null, carryingType: 'none',
      hunger: ant.hungerMax * hunger, health: ant.healthMax * health, state: 'RETURN_TO_NEST_HEAL',
      _nestDepartureDelay: 0,
    });
  }
  colony.ants = workers;
  sim.rivalColony.ants = [];
  colony.rebuildAntGridFromAnts();
  sim.rivalColony.rebuildAntGridFromAnts();
  return { sim, colony, workers, entrance, field };
}

const NO_REGEN = { ...CONFIG, healthRegenRate: 0, healthDrainRate: 0 };

test('hurt, fed foragers stay underground and drift slowly instead of bouncing at the mouth', () => {
  const { sim, colony, workers, entrance, field } = healSetup('heal-no-bounce', 1);
  const [ant] = workers;
  const visited = new Set();
  let moves = 0;
  for (let i = 0; i < 240; i += 1) {
    const before = `${ant.x},${ant.y}`;
    ant.update(sim.world, colony, sim.rng, NO_REGEN);
    const after = `${ant.x},${ant.y}`;
    if (after !== before) moves += 1;
    visited.add(after);
    assert.ok(ant.y > entrance.y, `hurt forager surfaced at tick ${i} (${after}, ${ant.state})`);
  }
  assert.equal(ant.state, 'HEAL_IN_NEST');
  assert.ok(field.distanceAt(ant.x, ant.y) >= 5, 'healer should leave the entrance shaft');
  assert.ok(visited.size > 8, `healer should keep wandering, visited ${visited.size} tiles`);
  assert.ok(moves < 120, `healer should move slowly, moved on ${moves} of 240 ticks`);
});

test('a group of healers spreads out instead of clumping', () => {
  const { sim, colony, workers } = healSetup('heal-spread', 10);
  for (let i = 0; i < 300; i += 1) {
    for (const ant of workers) ant.update(sim.world, colony, sim.rng, NO_REGEN);
  }
  const tiles = new Map();
  for (const ant of workers) {
    assert.equal(ant.state, 'HEAL_IN_NEST');
    const k = `${ant.x},${ant.y}`;
    tiles.set(k, (tiles.get(k) ?? 0) + 1);
  }
  assert.ok(Math.max(...tiles.values()) <= 2, `tile shared by ${Math.max(...tiles.values())} healers`);
  assert.ok(tiles.size >= 7, `10 healers should occupy most of 10 tiles, got ${tiles.size}`);
  for (const ant of workers) assert.equal(colony.countAntsAt(ant.x, ant.y), tiles.get(`${ant.x},${ant.y}`));
});

test('healers go back out once recovered past the resume threshold, not at the low-health line', () => {
  const { sim, colony, workers, entrance } = healSetup('heal-resume', 1, { health: 0.6 });
  const [ant] = workers;
  ant.state = 'HEAL_IN_NEST';
  ant._recoveringInNest = true;
  for (let i = 0; i < 20; i += 1) ant.update(sim.world, colony, sim.rng, NO_REGEN);
  assert.equal(ant.state, 'HEAL_IN_NEST', 'still recovering between 50% and 75%');

  ant.health = ant.healthMax * 0.8;
  let surfaced = false;
  for (let i = 0; i < 200 && !surfaced; i += 1) {
    ant.update(sim.world, colony, sim.rng, NO_REGEN);
    surfaced = ant.y <= entrance.y;
  }
  assert.ok(surfaced, `recovered forager should head back out (state ${ant.state})`);
});

test('a hurt forager with an empty store and an empty stomach goes foraging', () => {
  const { sim, colony, workers, entrance } = healSetup('heal-no-food', 1, { hunger: 0.4 });
  const [ant] = workers;
  colony.foodStored = 0;
  let surfaced = false;
  for (let i = 0; i < 200 && !surfaced; i += 1) {
    ant.update(sim.world, colony, sim.rng, NO_REGEN);
    surfaced = ant.y <= entrance.y;
  }
  assert.ok(surfaced, 'with nothing to eat, resting cannot heal; the ant should forage');
});

test('a recovering healer that eats mid-recovery keeps healing instead of leaving', () => {
  // 55% health is above the low-health line, so only recovery intent keeps it
  // in. 34% hunger is below the 35% meal line, so it eats on its first update,
  // and eating overwrites state with EAT.
  const { sim, colony, workers, entrance } = healSetup('heal-meal', 1, { health: 0.55, hunger: 0.34 });
  const [ant] = workers;
  ant.state = 'HEAL_IN_NEST';
  ant._recoveringInNest = true;
  colony.foodStored = 500;
  const hungerBefore = ant.hunger;
  for (let i = 0; i < 60; i += 1) {
    ant.update(sim.world, colony, sim.rng, NO_REGEN);
    assert.ok(ant.y > entrance.y, `healer left after eating at tick ${i} (${ant.state})`);
  }
  assert.ok(ant.hunger > hungerBefore, 'precondition: the healer ate from the store');
  assert.equal(ant.state, 'HEAL_IN_NEST');
});

test('recovery intent survives save and load', () => {
  const { sim, colony, workers } = healSetup('heal-save', 1);
  const [ant] = workers;
  for (let i = 0; i < 5; i += 1) ant.update(sim.world, colony, sim.rng, NO_REGEN);
  assert.equal(ant._recoveringInNest, true);
  const restored = Colony.fromSerialized(sim.world, new SeededRng('heal-save-load'), colony.serialize());
  assert.equal(restored.ants[0]._recoveringInNest, true);
});
