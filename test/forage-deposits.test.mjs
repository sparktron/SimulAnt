import test from 'node:test';
import assert from 'node:assert/strict';
import { World, TERRAIN } from '../src/sim/world.js';
import { Ant } from '../src/sim/ant.js';
import { SeededRng } from '../src/sim/rng.js';
import { carryFood } from '../src/sim/ant/decisions.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

// Review bug #7: a carrier that is in the nest with no available food drop point
// AND a blocked entrance shaft falls through carryFood's nest-handling into the
// generic deposit block, laying food pheromone on an underground tile. Food
// trails are a SURFACE foraging signal; ghost deposits in tunnels are exactly the
// false-signal class the net-negative-trails work fought on the surface. The fix
// guards the deposit with !context.inNest.

const CONFIG = sanitizeTickConfig(getDefaultConfig());

// A carrier trapped on a tile with all-impassable neighbors: findNestFoodDropPoint
// returns null and the entrance-shaft move fails, so carryFood reaches the deposit
// block. Distance to the (far) entrance keeps the entrance-fade fraction at 1, and
// a seeded recruit budget keeps recruitFactor > 0, so a deposit WOULD fire.
function trappedCarrier(world, ax, ay) {
  const rng = new SeededRng('bug7');
  world.terrain[world.index(ax, ay)] = TERRAIN.TUNNEL;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      world.terrain[world.index(ax + dx, ay + dy)] = TERRAIN.WALL;
    }
  }
  world.markTerrainDirty();
  const ant = new Ant(ax, ay, rng, 'worker');
  ant.health = ant.healthMax;
  ant.carrying = { type: 'food', pelletNutrition: 5 };
  ant.carryingType = 'food';
  ant._recruitBudget = 1.6; // as if just seeded at a rich pickup
  return { ant, rng };
}

const colonyStub = { findNestFoodDropPoint: () => null };

function context(world, ax, ay, inNest) {
  return {
    dt: 1 / 30,
    idx: world.index(ax, ay),
    inNest,
    inNestInterior: inNest,
    entrance: { x: ax + 10, y: ay, radius: 1 }, // far enough that entrance-fade = 1
  };
}

test('a carrier in the nest never lays food pheromone underground (bug #7)', () => {
  const world = new World(24, 24);
  const ax = 8; const ay = 8;
  const { ant, rng } = trappedCarrier(world, ax, ay);
  const ctx = context(world, ax, ay, /* inNest */ true);

  carryFood(ant, world, colonyStub, rng, CONFIG, ctx);

  assert.equal(world.toFood[world.index(ax, ay)], 0,
    'no toFood should be deposited on an underground/in-nest tile');
});

test('the same carrier on the surface DOES lay a trail (guard is in-nest-specific)', () => {
  const world = new World(24, 24);
  const ax = 8; const ay = 8;
  const { ant, rng } = trappedCarrier(world, ax, ay);
  const ctx = context(world, ax, ay, /* inNest */ false);

  carryFood(ant, world, colonyStub, rng, CONFIG, ctx);

  assert.ok(world.toFood[world.index(ax, ay)] > 0,
    'a surface carrier far from the entrance should still lay a food trail');
});
