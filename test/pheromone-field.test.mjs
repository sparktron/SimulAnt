import test from 'node:test';
import assert from 'node:assert/strict';
import { World, TERRAIN } from '../src/sim/world.js';

// Phase 1 — pheromone field-math invariants. The active-cell updater in
// World.#updatePheromonesField claims to be byte-identical to a naive full-grid
// diffusion/evaporation sweep, and the double-buffer + active-list bookkeeping
// must stay in lockstep with the field. Nothing enforced either before. These
// tests lock the field math so steering/tuning work can trust it. See the
// Phase 0/1 review and docs/pheromone-strategy.md.

function allGround(world) {
  world.terrain.fill(TERRAIN.GROUND);
  world.markTerrainDirty();
}

function foodMass(world) {
  let sum = 0;
  for (let i = 0; i < world.size; i += 1) sum += world.toFood[i];
  return sum;
}

// ---------------------------------------------------------------------------
// 1. Interior diffusion conserves mass exactly. A single hot cell surrounded by
//    passable cells (no walls, no grid edge in reach) must redistribute its
//    value with zero loss when evaporation is off — the canonical invariant of
//    a conservative diffusion kernel.
// ---------------------------------------------------------------------------
test('interior diffusion conserves mass when evaporation is off', () => {
  const world = new World(32, 32);
  allGround(world);
  world.depositToFood(world.index(16, 16), 8.0);

  const config = {
    tickSeconds: 1, evapFood: 0, evapHome: 0, evapDanger: 0,
    diffFood: 0.2, diffHome: 0, diffDanger: 0,
    diffIntervalTicks: 1, pheromoneMaxClamp: 1000,
  };

  const before = foodMass(world);
  world.updatePheromones(config, 1);
  const after = foodMass(world);

  assert.equal(before, 8.0);
  assert.ok(Math.abs(after - 8.0) < 1e-6, `interior mass must be conserved, got ${after}`);
  // The split is exact: center keeps (1 - 4D), each of 4 neighbors gets D*center.
  assert.ok(Math.abs(world.toFood[world.index(16, 16)] - 6.4) < 1e-6, 'center retains (1-4D)*c');
  assert.ok(Math.abs(world.toFood[world.index(15, 16)] - 0.4) < 1e-6, 'each neighbor gets D*c');
});

// ---------------------------------------------------------------------------
// 2. Evaporation removes exactly lambda*dt per tick on an isolated cell (no
//    diffusion), so the decay rate is the configured one — not an emergent
//    artifact of the kernel.
// ---------------------------------------------------------------------------
test('evaporation decays an isolated cell at exactly (1 - lambda*dt) per tick', () => {
  const world = new World(16, 16);
  allGround(world);
  const idx = world.index(5, 5);
  world.depositToFood(idx, 10.0);

  const config = {
    tickSeconds: 0.5, evapFood: 0.4, evapHome: 0, evapDanger: 0,
    diffFood: 0, diffHome: 0, diffDanger: 0,
    diffIntervalTicks: 1, pheromoneMaxClamp: 1000,
  };

  world.updatePheromones(config, 1);
  // lambda*dt = 0.4 * 0.5 = 0.2  ->  value = 10 * (1 - 0.2) = 8.0
  assert.ok(Math.abs(world.toFood[idx] - 8.0) < 1e-6, `expected 8.0, got ${world.toFood[idx]}`);
});

// ---------------------------------------------------------------------------
// 3. Boundary leak characterization (review bug #8). The kernel subtracts the
//    full 4D from every cell but only RECEIVES flux from passable neighbors, so
//    a cell loses D*value into each wall/edge neighbor. This pins the CURRENT
//    (absorbing-boundary) behavior so an accidental change is caught.
//
//    NOTE: this is non-conservative at walls. A no-flux (reflecting) boundary —
//    decayFactor computed per cell as (1 - lambda - D*passableNeighborCount) —
//    would conserve mass and slow home-scent decay in tunnels (diffHome 0.18 =>
//    ~9%/tick extra loss on a 2-wall tunnel cell). Changing it moves the
//    pheromone-bench field hash and needs an A/B, so it is deliberately a
//    separate decision, not folded into this test.
// ---------------------------------------------------------------------------
test('diffusion leaks D*value into each wall neighbor (absorbing boundary, bug #8)', () => {
  const config = {
    tickSeconds: 1, evapFood: 0, evapHome: 0, evapDanger: 0,
    diffFood: 0.2, diffHome: 0, diffDanger: 0, // D = 0.05
    diffIntervalTicks: 1, pheromoneMaxClamp: 1000,
  };

  // One wall neighbor -> leak D*c*1 = 0.4
  const w1 = new World(32, 32);
  allGround(w1);
  w1.terrain[w1.index(17, 16)] = TERRAIN.WALL;
  w1.markTerrainDirty();
  w1.depositToFood(w1.index(16, 16), 8.0);
  w1.updatePheromones(config, 1);
  assert.ok(Math.abs(foodMass(w1) - 7.6) < 1e-6, `1-wall leak should be 0.4, mass=${foodMass(w1)}`);

  // Tunnel (two opposing wall neighbors) -> leak D*c*2 = 0.8
  const w2 = new World(32, 32);
  allGround(w2);
  w2.terrain[w2.index(16, 15)] = TERRAIN.WALL;
  w2.terrain[w2.index(16, 17)] = TERRAIN.WALL;
  w2.markTerrainDirty();
  w2.depositToFood(w2.index(16, 16), 8.0);
  w2.updatePheromones(config, 1);
  assert.ok(Math.abs(foodMass(w2) - 7.2) < 1e-6, `2-wall leak should be 0.8, mass=${foodMass(w2)}`);
});

// ---------------------------------------------------------------------------
// 4. Active-cell update === naive full-grid sweep. This is the correctness
//    guarantee for the optimization that only touches non-zero cells and their
//    neighbors. A faithful full-grid reference is run in parallel over many
//    random deposits (with walls) across all three channels and must match the
//    live field bit-for-bit.
// ---------------------------------------------------------------------------
function fullSweep(src, mask, w, h, lambda, D, clampMax) {
  const dst = new Float32Array(src.length);
  const decayFactor = Math.max(0, 1 - lambda - 4 * D);
  const threshold = 1e-4;
  for (let idx = 0; idx < src.length; idx += 1) {
    if (!mask[idx]) { dst[idx] = 0; continue; }
    const x = idx % w;
    const y = (idx - x) / w;
    const center = src[idx];
    let value;
    if (center < threshold) {
      if (D === 0) { dst[idx] = 0; continue; }
      let sum = 0; let has = false;
      if (x > 0 && mask[idx - 1] && src[idx - 1] >= threshold) { sum += src[idx - 1]; has = true; }
      if (x < w - 1 && mask[idx + 1] && src[idx + 1] >= threshold) { sum += src[idx + 1]; has = true; }
      if (y > 0 && mask[idx - w] && src[idx - w] >= threshold) { sum += src[idx - w]; has = true; }
      if (y < h - 1 && mask[idx + w] && src[idx + w] >= threshold) { sum += src[idx + w]; has = true; }
      if (!has) { dst[idx] = 0; continue; }
      const v = Math.max(0, Math.min(clampMax, D * sum));
      value = v < 1e-5 ? 0 : v;
    } else {
      let sum = 0;
      if (x > 0 && mask[idx - 1]) sum += src[idx - 1];
      if (x < w - 1 && mask[idx + 1]) sum += src[idx + 1];
      if (y > 0 && mask[idx - w]) sum += src[idx - w];
      if (y < h - 1 && mask[idx + w]) sum += src[idx + w];
      const v = Math.max(0, Math.min(clampMax, decayFactor * center + D * sum));
      value = v < 1e-5 ? 0 : v;
    }
    dst[idx] = value;
  }
  return dst;
}

test('active-cell update is byte-identical to a naive full-grid sweep', () => {
  const W = 24; const H = 24;
  const world = new World(W, H);
  allGround(world);
  // Carve a few walls so the masked branches are exercised.
  for (const [x, y] of [[10, 10], [10, 11], [10, 12], [13, 8], [5, 14], [14, 14]]) {
    world.terrain[world.index(x, y)] = TERRAIN.WALL;
  }
  world.markTerrainDirty();

  // Build the same mask the world uses (passable = not WALL/WATER/SOIL).
  const mask = new Uint8Array(world.size);
  for (let i = 0; i < world.size; i += 1) {
    const t = world.terrain[i];
    mask[i] = (t !== TERRAIN.WALL && t !== TERRAIN.WATER && t !== TERRAIN.SOIL) ? 1 : 0;
  }

  const config = {
    tickSeconds: 1 / 30,
    evapFood: 0.25, evapHome: 0.015, evapDanger: 0.08,
    diffFood: 0.2, diffHome: 0.18, diffDanger: 0.12,
    diffIntervalTicks: 2, pheromoneMaxClamp: 150,
  };
  const dt = config.tickSeconds;
  const cadence = config.diffIntervalTicks;

  // Parallel reference fields.
  let refFood = new Float32Array(world.size);
  let refHome = new Float32Array(world.size);
  let refDanger = new Float32Array(world.size);

  // Deterministic LCG so the test is reproducible.
  let seed = 0x1234abcd;
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const passableCells = [];
  for (let i = 0; i < world.size; i += 1) if (mask[i]) passableCells.push(i);

  for (let tick = 1; tick <= 50; tick += 1) {
    // Apply 1–3 identical deposits to both the world and the reference.
    const nDeposits = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < nDeposits; k += 1) {
      const idx = passableCells[Math.floor(rand() * passableCells.length)];
      const amt = rand() * 5;
      const ch = Math.floor(rand() * 3);
      if (ch === 0) { world.depositToFood(idx, amt); refFood[idx] += amt; }
      else if (ch === 1) { world.depositToHome(idx, amt); refHome[idx] += amt; }
      else { world.depositDanger(idx, amt); refDanger[idx] += amt; }
    }

    world.updatePheromones(config, tick);

    const shouldDiffuse = tick % cadence === 0;
    refFood = fullSweep(refFood, mask, W, H, config.evapFood * dt, (shouldDiffuse ? config.diffFood : 0) / 4, config.pheromoneMaxClamp);
    refHome = fullSweep(refHome, mask, W, H, config.evapHome * dt, (shouldDiffuse ? config.diffHome : 0) / 4, config.pheromoneMaxClamp);
    refDanger = fullSweep(refDanger, mask, W, H, config.evapDanger * dt, (shouldDiffuse ? config.diffDanger : 0) / 4, config.pheromoneMaxClamp);

    for (let i = 0; i < world.size; i += 1) {
      assert.equal(world.toFood[i], refFood[i], `toFood mismatch at ${i} on tick ${tick}`);
      assert.equal(world.toHome[i], refHome[i], `toHome mismatch at ${i} on tick ${tick}`);
      assert.equal(world.danger[i], refDanger[i], `danger mismatch at ${i} on tick ${tick}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Double-buffer / active-list lockstep. After an update the active list must
//    equal exactly the set of non-zero cells in the live field — no missing
//    cells (which would never evaporate) and no stale/duplicate entries (which
//    would bloat the candidate pass). Also verify the disable path fully clears
//    fields and lists, and that re-enabling resumes correctly.
// ---------------------------------------------------------------------------
function assertListMatchesField(world, list, field, label) {
  const nonZero = new Set();
  for (let i = 0; i < world.size; i += 1) if (field[i] !== 0) nonZero.add(i);
  const listSet = new Set(list);
  assert.equal(listSet.size, list.length, `${label}: active list has duplicates`);
  assert.equal(listSet.size, nonZero.size, `${label}: active list size != non-zero count`);
  for (const idx of list) assert.ok(nonZero.has(idx), `${label}: list entry ${idx} is zero in field`);
}

test('active lists stay in lockstep with the live fields across ticks', () => {
  const world = new World(24, 24);
  allGround(world);
  const config = {
    tickSeconds: 1 / 30,
    evapFood: 0.25, evapHome: 0.015, evapDanger: 0.08,
    diffFood: 0.2, diffHome: 0.18, diffDanger: 0.12,
    diffIntervalTicks: 2, pheromoneMaxClamp: 150,
  };

  let seed = 0x55aa55aa;
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  for (let tick = 1; tick <= 30; tick += 1) {
    world.depositToFood(world.index(2 + Math.floor(rand() * 20), 2 + Math.floor(rand() * 20)), rand() * 4);
    world.depositToHome(world.index(2 + Math.floor(rand() * 20), 2 + Math.floor(rand() * 20)), rand() * 4);
    world.updatePheromones(config, tick);
    assertListMatchesField(world, world._activeFood, world.toFood, `food tick ${tick}`);
    assertListMatchesField(world, world._activeHome, world.toHome, `home tick ${tick}`);
    assertListMatchesField(world, world._activeDanger, world.danger, `danger tick ${tick}`);
  }
});

test('disabling pheromones clears every field and active list', () => {
  const world = new World(16, 16);
  allGround(world);
  world.depositToFood(world.index(5, 5), 5.0);
  world.depositToHome(world.index(6, 6), 5.0);
  world.depositDanger(world.index(7, 7), 5.0);

  const config = {
    tickSeconds: 1 / 30, evapFood: 0.25, evapHome: 0.015, evapDanger: 0.08,
    diffFood: 0.2, diffHome: 0.18, diffDanger: 0.12,
    diffIntervalTicks: 1, pheromoneMaxClamp: 150,
    enablePheromones: false,
  };
  world.updatePheromones(config, 1);

  for (let i = 0; i < world.size; i += 1) {
    assert.equal(world.toFood[i], 0);
    assert.equal(world.toHome[i], 0);
    assert.equal(world.danger[i], 0);
  }
  assert.equal(world._activeFood.length, 0);
  assert.equal(world._activeHome.length, 0);
  assert.equal(world._activeDanger.length, 0);

  // Re-enable and confirm a fresh deposit resumes normal evaporation.
  config.enablePheromones = true;
  world.depositToFood(world.index(8, 8), 4.0);
  world.updatePheromones(config, 2);
  assert.ok(world.toFood[world.index(8, 8)] > 0 && world.toFood[world.index(8, 8)] < 4.0, 'resumes after re-enable');
});
