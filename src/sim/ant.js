import { TERRAIN } from './world.js';

const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

export class Ant {
  constructor(x, y, rng) {
    this.x = x;
    this.y = y;
    this.dir = rng.int(DIRS.length);
    this.energy = 400 + rng.int(200);
    this.carrying = 0;
    this.alive = true;
  }

  update(world, colony, rng, config) {
    if (!this.alive) return;

    const idx = world.index(this.x, this.y);
    const nearNest = world.nestInfluence[idx] > 0.94;

    if (nearNest && this.carrying > 0) {
      colony.storeFood(this.carrying);
      this.carrying = 0;
      this.energy = Math.min(this.energy + 120, 700);
    }

    const terrain = world.terrain[idx];
    if (terrain === TERRAIN.HAZARD) {
      if (rng.chance(config.hazardDeathChance)) {
        this.alive = false;
        colony.deaths += 1;
        return;
      }
      world.danger[idx] += config.dangerDeposit;
    }

    if (this.carrying === 0 && world.food[idx] > 0.01) {
      const amount = Math.min(config.foodPickupRate, world.food[idx]);
      world.food[idx] -= amount;
      this.carrying = amount;
    }

    if (this.carrying > 0) {
      world.toFood[idx] += config.toFoodDeposit;
      this.stepByGradient(world, rng, world.nestInfluence, world.toHome, world.danger, true);
    } else {
      world.toHome[idx] += config.toHomeDeposit;
      this.stepByGradient(world, rng, world.toFood, world.nestInfluence, world.danger, false);
    }

    this.energy -= 1;
    if (this.energy <= 0) {
      this.alive = false;
      colony.deaths += 1;
    }
  }

  stepByGradient(world, rng, primaryField, secondaryField, dangerField, headingHome) {
    let bestDir = this.dir;
    let bestScore = -Infinity;

    for (let i = 0; i < DIRS.length; i += 1) {
      const d = (this.dir + i) % DIRS.length;
      const nx = this.x + DIRS[d][0];
      const ny = this.y + DIRS[d][1];
      if (!world.inBounds(nx, ny)) continue;
      const nidx = world.index(nx, ny);
      const terrain = world.terrain[nidx];
      if (terrain === TERRAIN.WALL || terrain === TERRAIN.WATER) continue;

      const primary = primaryField[nidx] * 1.2;
      const secondary = secondaryField[nidx] * 0.8;
      const danger = dangerField[nidx] * 2.2;
      const randomness = rng.range(0, 0.4);
      const inertia = i === 0 ? 0.5 : 0;
      const score = primary + secondary + randomness + inertia - danger;

      if (headingHome && world.nestInfluence[nidx] > 0.97) {
        this.x = nx;
        this.y = ny;
        this.dir = d;
        return;
      }

      if (score > bestScore) {
        bestScore = score;
        bestDir = d;
      }
    }

    if (rng.chance(0.08)) {
      bestDir = (bestDir + (rng.chance(0.5) ? 1 : DIRS.length - 1)) % DIRS.length;
    }

    const tx = this.x + DIRS[bestDir][0];
    const ty = this.y + DIRS[bestDir][1];
    if (world.isPassable(tx, ty)) {
      this.x = tx;
      this.y = ty;
      this.dir = bestDir;
      return;
    }

    // fallback random motion when blocked
    for (let i = 0; i < DIRS.length; i += 1) {
      const d = rng.int(DIRS.length);
      const nx = this.x + DIRS[d][0];
      const ny = this.y + DIRS[d][1];
      if (world.isPassable(nx, ny)) {
        this.x = nx;
        this.y = ny;
        this.dir = d;
        break;
      }
    }
  }
}
