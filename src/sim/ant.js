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

export const ROLE = {
  WORKER: 'worker',
  SOLDIER: 'soldier',
  MALE: 'male',
  BREEDER: 'breeder',
};

export class Ant {
  constructor(x, y, role, rng) {
    this.x = x;
    this.y = y;
    this.role = role;
    this.dir = rng.int(DIRS.length);
    this.energy = role === ROLE.SOLDIER ? 720 : 520;
    this.health = role === ROLE.SOLDIER ? 130 : 100;
    this.hunger = 0;
    this.carrying = 0;
    this.underground = true;
    this.alive = true;
  }

  update(world, colony, rng, config) {
    if (!this.alive) return;

    const idx = world.index(this.x, this.y);
    const nearNest = world.nestInfluence[idx] > 0.96;

    if (nearNest && this.carrying > 0) {
      colony.storeFood(this.carrying);
      this.carrying = 0;
      this.energy = Math.min(this.energy + 120, 900);
      this.hunger = Math.max(0, this.hunger - 30);
      this.underground = true;
    }

    if (!this.underground && world.terrain[idx] === TERRAIN.HAZARD) {
      const risk = this.role === ROLE.SOLDIER ? config.hazardDeathChance * 0.5 : config.hazardDeathChance;
      if (rng.chance(risk)) {
        this.alive = false;
        colony.deaths += 1;
        return;
      }
      world.danger[idx] += config.dangerDeposit;
    }

    if (!this.underground && this.carrying === 0 && world.food[idx] > 0.01) {
      const amount = Math.min(config.foodPickupRate, world.food[idx]);
      world.food[idx] -= amount;
      this.carrying = amount;
    }

    if (this.role === ROLE.WORKER && this.underground && this.carrying === 0) {
      this.tryDig(world, colony, rng, config);
    }

    if (this.carrying > 0) {
      world.toFood[idx] += config.toFoodDeposit;
      this.stepByGradient(world, rng, world.nestInfluence, world.toHome, world.danger, true);
    } else {
      world.toHome[idx] += config.toHomeDeposit;
      this.stepByGradient(world, rng, world.toFood, world.nestInfluence, world.danger, false);
    }

    this.hunger += 1;
    this.energy -= this.role === ROLE.SOLDIER ? 1.3 : 1;
    if (this.hunger > 380) this.health -= 0.4;

    if (this.energy <= 0 || this.health <= 0) {
      this.alive = false;
      colony.deaths += 1;
    }
  }

  tryDig(world, colony, rng, config) {
    if (!rng.chance(config.digChance)) return;

    for (let i = 0; i < DIRS.length; i += 1) {
      const d = rng.int(DIRS.length);
      const nx = this.x + DIRS[d][0];
      const ny = this.y + DIRS[d][1];
      if (!world.inBounds(nx, ny)) continue;
      if (world.tryDigTunnel(nx, ny)) {
        colony.dugTiles += 1;
        this.energy -= 2;
        break;
      }
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

      const surfacePassable = world.isSurfacePassable(nx, ny);
      const tunnelPassable = world.isUndergroundPassable(nx, ny);
      if (this.underground && !tunnelPassable) continue;
      if (!this.underground && !surfacePassable) continue;

      const nidx = world.index(nx, ny);
      const primary = primaryField[nidx] * 1.25;
      const secondary = secondaryField[nidx] * 0.8;
      const danger = dangerField[nidx] * 2.0;
      const randomness = rng.range(0, 0.35);
      const inertia = i === 0 ? 0.45 : 0;
      const score = primary + secondary + randomness + inertia - danger;

      if (headingHome && world.nestInfluence[nidx] > 0.98) {
        this.x = nx;
        this.y = ny;
        this.dir = d;
        if (!this.underground && this.carrying > 0) this.underground = true;
        return;
      }

      if (score > bestScore) {
        bestScore = score;
        bestDir = d;
      }
    }

    // Leave nest to surface to forage.
    if (this.underground && this.carrying === 0 && world.nestInfluence[world.index(this.x, this.y)] > 0.98 && rng.chance(0.06)) {
      this.underground = false;
    }

    if (rng.chance(0.08)) {
      bestDir = (bestDir + (rng.chance(0.5) ? 1 : DIRS.length - 1)) % DIRS.length;
    }

    const tx = this.x + DIRS[bestDir][0];
    const ty = this.y + DIRS[bestDir][1];
    const canStep = this.underground ? world.isUndergroundPassable(tx, ty) : world.isSurfacePassable(tx, ty);
    if (canStep) {
      this.x = tx;
      this.y = ty;
      this.dir = bestDir;
      return;
    }

    for (let i = 0; i < DIRS.length; i += 1) {
      const d = rng.int(DIRS.length);
      const nx = this.x + DIRS[d][0];
      const ny = this.y + DIRS[d][1];
      const passable = this.underground ? world.isUndergroundPassable(nx, ny) : world.isSurfacePassable(nx, ny);
      if (passable) {
        this.x = nx;
        this.y = ny;
        this.dir = d;
        break;
      }
    }
  }
}
