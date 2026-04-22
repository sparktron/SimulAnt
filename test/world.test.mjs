import test from 'node:test';
import assert from 'node:assert/strict';
import { World, TERRAIN } from '../src/sim/world.js';

// --- Construction ---

test('world initializes with correct dimensions', () => {
  const world = new World(64, 64);

  assert.equal(world.width, 64);
  assert.equal(world.height, 64);
  assert.equal(world.size, 64 * 64);
  assert.equal(world.terrain.length, 64 * 64);
});

test('world terrain: surface is GROUND, underground is SOIL', () => {
  const world = new World(32, 32);

  // Above nestY should be GROUND
  assert.equal(world.terrain[world.index(5, 0)], TERRAIN.GROUND);
  assert.equal(world.terrain[world.index(5, world.nestY - 1)], TERRAIN.GROUND);

  // Below nestY should be SOIL (except carved nest)
  const farX = 0;
  const deepY = world.height - 1;
  assert.equal(world.terrain[world.index(farX, deepY)], TERRAIN.SOIL);
});

// --- Bounds and Indexing ---

test('inBounds correctly validates coordinates', () => {
  const world = new World(16, 16);

  assert.ok(world.inBounds(0, 0));
  assert.ok(world.inBounds(15, 15));
  assert.ok(!world.inBounds(-1, 0));
  assert.ok(!world.inBounds(0, -1));
  assert.ok(!world.inBounds(16, 0));
  assert.ok(!world.inBounds(0, 16));
});

test('index maps 2D to 1D correctly', () => {
  const world = new World(32, 32);

  assert.equal(world.index(0, 0), 0);
  assert.equal(world.index(1, 0), 1);
  assert.equal(world.index(0, 1), 32);
  assert.equal(world.index(5, 3), 3 * 32 + 5);
});

// --- Passability ---

test('GROUND, TUNNEL, CHAMBER are passable', () => {
  const world = new World(16, 16);

  world.terrain[world.index(1, 1)] = TERRAIN.GROUND;
  world.terrain[world.index(2, 2)] = TERRAIN.TUNNEL;
  world.terrain[world.index(3, 3)] = TERRAIN.CHAMBER;

  assert.ok(world.isPassable(1, 1));
  assert.ok(world.isPassable(2, 2));
  assert.ok(world.isPassable(3, 3));
});

test('WALL, WATER, SOIL are impassable', () => {
  const world = new World(16, 16);

  world.terrain[world.index(1, 1)] = TERRAIN.WALL;
  world.terrain[world.index(2, 2)] = TERRAIN.WATER;
  world.terrain[world.index(3, 3)] = TERRAIN.SOIL;

  assert.ok(!world.isPassable(1, 1));
  assert.ok(!world.isPassable(2, 2));
  assert.ok(!world.isPassable(3, 3));
});

test('HAZARD is passable (ants must enter to trigger death)', () => {
  const world = new World(16, 16);
  world.terrain[world.index(5, 5)] = TERRAIN.HAZARD;

  assert.ok(world.isPassable(5, 5), 'HAZARD should be passable so ants can walk on it');
});

test('out-of-bounds coordinates are impassable', () => {
  const world = new World(16, 16);

  assert.ok(!world.isPassable(-1, 5));
  assert.ok(!world.isPassable(5, 16));
});

// --- Underground Check ---

test('isUnderground correctly identifies tunnel and chamber', () => {
  const world = new World(16, 16);

  world.terrain[world.index(1, 1)] = TERRAIN.TUNNEL;
  world.terrain[world.index(2, 2)] = TERRAIN.CHAMBER;
  world.terrain[world.index(3, 3)] = TERRAIN.GROUND;
  world.terrain[world.index(4, 4)] = TERRAIN.SOIL;

  assert.ok(world.isUnderground(1, 1));
  assert.ok(world.isUnderground(2, 2));
  assert.ok(!world.isUnderground(3, 3));
  assert.ok(!world.isUnderground(4, 4));
});

// --- Paint Circle ---

test('paintCircle modifies correct cells within radius', () => {
  const world = new World(32, 32);
  const painted = [];

  world.paintCircle(16, 16, 2, (idx, x, y) => {
    painted.push({ x, y });
  });

  assert.ok(painted.length > 0);
  for (const p of painted) {
    const dist = Math.hypot(p.x - 16, p.y - 16);
    assert.ok(dist <= 2, `Painted cell (${p.x},${p.y}) should be within radius 2`);
  }
});

test('paintCircle respects world bounds', () => {
  const world = new World(16, 16);
  const painted = [];

  // Circle at corner
  world.paintCircle(0, 0, 5, (idx, x, y) => {
    painted.push({ x, y });
  });

  for (const p of painted) {
    assert.ok(world.inBounds(p.x, p.y), `Painted cell should be in bounds`);
  }
});

// --- Pheromone Evaporation ---

test('pheromone evaporation reduces values over time', () => {
  const world = new World(16, 16);
  const idx = world.index(5, 5);
  world.terrain[idx] = TERRAIN.GROUND;
  world.toFood[idx] = 5.0;
  world.toHome[idx] = 5.0;
  world.danger[idx] = 5.0;

  const config = {
    tickSeconds: 1 / 30,
    evapFood: 0.1,
    evapHome: 0.55,
    evapDanger: 0.35,
    diffFood: 0.2,
    diffHome: 0.1,
    diffDanger: 0.12,
    diffIntervalTicks: 2,
    pheromoneMaxClamp: 10,
  };

  world.updatePheromones(config, 1); // odd tick, no diffusion

  assert.ok(world.toFood[idx] < 5.0, 'Food pheromone should evaporate');
  assert.ok(world.toHome[idx] < 5.0, 'Home pheromone should evaporate');
  assert.ok(world.danger[idx] < 5.0, 'Danger pheromone should evaporate');
});

test('pheromone values clamp to zero below threshold', () => {
  const world = new World(16, 16);
  const idx = world.index(5, 5);
  world.terrain[idx] = TERRAIN.GROUND;
  world.toFood[idx] = 0.00001; // very small

  const config = {
    tickSeconds: 1 / 30,
    evapFood: 10, // aggressive evaporation
    evapHome: 0.55,
    evapDanger: 0.35,
    diffFood: 0,
    diffHome: 0,
    diffDanger: 0,
    diffIntervalTicks: 2,
    pheromoneMaxClamp: 10,
  };

  world.updatePheromones(config, 1);

  assert.equal(world.toFood[idx], 0, 'Tiny pheromone value should clamp to 0');
});

// --- Diffusion ---

test('pheromone diffusion spreads values to passable neighbors', () => {
  const world = new World(16, 16);
  // Make a small passable area
  for (let y = 3; y <= 7; y += 1) {
    for (let x = 3; x <= 7; x += 1) {
      world.terrain[world.index(x, y)] = TERRAIN.GROUND;
    }
  }

  world.toFood[world.index(5, 5)] = 8.0;

  const config = {
    tickSeconds: 1 / 30,
    evapFood: 0,
    evapHome: 0,
    evapDanger: 0,
    diffFood: 0.5,
    diffHome: 0.1,
    diffDanger: 0.1,
    diffIntervalTicks: 1,
    pheromoneMaxClamp: 10,
  };

  world.updatePheromones(config, 1); // tick 1 is divisible by 1

  assert.ok(world.toFood[world.index(4, 5)] > 0, 'Pheromone should diffuse left');
  assert.ok(world.toFood[world.index(6, 5)] > 0, 'Pheromone should diffuse right');
  assert.ok(world.toFood[world.index(5, 4)] > 0, 'Pheromone should diffuse up');
  assert.ok(world.toFood[world.index(5, 6)] > 0, 'Pheromone should diffuse down');
});

test('diffIntervalTicks gates diffusion while preserving evaporation', () => {
  const world = new World(16, 16);
  for (let y = 3; y <= 7; y += 1) {
    for (let x = 3; x <= 7; x += 1) {
      world.terrain[world.index(x, y)] = TERRAIN.GROUND;
    }
  }

  const center = world.index(5, 5);
  const left = world.index(4, 5);
  world.toFood[center] = 8.0;

  const config = {
    tickSeconds: 1 / 30,
    evapFood: 0.1,
    evapHome: 0,
    evapDanger: 0,
    diffFood: 0.5,
    diffHome: 0,
    diffDanger: 0,
    diffIntervalTicks: 2,
    pheromoneMaxClamp: 10,
  };

  world.updatePheromones(config, 1);
  assert.equal(world.toFood[left], 0, 'No diffusion should occur on non-cadence ticks');
  assert.ok(world.toFood[center] < 8.0, 'Evaporation should still occur on non-cadence ticks');

  world.updatePheromones(config, 2);
  assert.ok(world.toFood[left] > 0, 'Diffusion should occur on cadence ticks');
});

test('pheromone diffusion does not spread through walls', () => {
  const world = new World(16, 16);
  for (let y = 3; y <= 7; y += 1) {
    for (let x = 3; x <= 7; x += 1) {
      world.terrain[world.index(x, y)] = TERRAIN.GROUND;
    }
  }
  // Wall to the right of (5,5)
  world.terrain[world.index(6, 5)] = TERRAIN.WALL;
  world.toFood[world.index(5, 5)] = 8.0;

  const config = {
    tickSeconds: 1 / 30,
    evapFood: 0,
    evapHome: 0,
    evapDanger: 0,
    diffFood: 0.5,
    diffHome: 0.1,
    diffDanger: 0.1,
    diffIntervalTicks: 1,
    pheromoneMaxClamp: 10,
  };

  world.updatePheromones(config, 1);

  assert.equal(world.toFood[world.index(6, 5)], 0, 'Pheromone should not diffuse into walls');
});

// --- Serialization ---

test('world serializes and deserializes correctly', () => {
  const world = new World(32, 32);
  world.terrain[world.index(10, 10)] = TERRAIN.TUNNEL;
  world.toFood[world.index(5, 5)] = 3.5;
  world.toHome[world.index(6, 6)] = 2.1;
  world.danger[world.index(7, 7)] = 1.0;

  const serialized = world.serialize();
  const restored = World.fromSerialized(serialized);

  assert.equal(restored.width, 32);
  assert.equal(restored.height, 32);
  assert.equal(restored.terrain[restored.index(10, 10)], TERRAIN.TUNNEL);
  assert.ok(Math.abs(restored.toFood[restored.index(5, 5)] - 3.5) < 0.001);
  assert.ok(Math.abs(restored.toHome[restored.index(6, 6)] - 2.1) < 0.001);
  assert.equal(restored.nestX, world.nestX);
  assert.equal(restored.nestY, world.nestY);
});

// --- Pheromone Stats ---

test('getPheromoneStats returns accurate summary', () => {
  const world = new World(16, 16);
  // All surface is GROUND (passable)
  world.toFood[world.index(5, 5)] = 4.0;
  world.toHome[world.index(6, 5)] = 2.0;

  const stats = world.getPheromoneStats();

  assert.equal(stats.maxFood, 4.0);
  assert.equal(stats.maxHome, 2.0);
  assert.ok(stats.avgFood > 0);
  assert.ok(stats.avgHome > 0);
});

// --- Nest Influence ---

test('nest influence is highest at nest center', () => {
  const world = new World(64, 64);

  const centerIdx = world.index(world.nestX, world.nestY);
  const farIdx = world.index(0, 0);

  assert.ok(world.nestInfluence[centerIdx] > world.nestInfluence[farIdx],
    'Nest influence should be highest at center');
});

// --- Set Nest ---

test('setNest updates nest position and recomputes influence', () => {
  const world = new World(64, 64);
  const oldX = world.nestX;

  world.setNest(10, 10);

  assert.equal(world.nestX, 10);
  assert.equal(world.nestY, 10);
  assert.notEqual(world.nestX, oldX);
});
