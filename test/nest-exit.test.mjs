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
