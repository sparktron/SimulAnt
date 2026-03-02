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
  constructor(x, y, rng, role = 'worker') {
    this.id = `ant-${Math.floor(rng.range(0, 1e9))}`;
    this.x = x;
    this.y = y;
    this.dir = rng.int(DIRS.length);
    this.hungerMax = 100;
    this.healthMax = 100;
    this.hunger = 80 + rng.int(20);
    this.health = this.healthMax;
    this.hungerDrainRates = {
      idle: role === 'soldier' ? 2.2 : 1.8,
      move: role === 'soldier' ? 4.5 : 3.2,
      dig: 5.0,
      fight: 7.0,
    };
    this.state = 'IDLE';
    this.carrying = null;
    this.alive = true;
    this.role = role;
  }

  update(world, colony, rng, config) {
    if (!this.alive) return;

    const dt = config.tickSeconds || 1 / 30;
    const idx = world.index(this.x, this.y);
    const nearNest = world.nestInfluence[idx] > 0.94;
    const inNest = this.y >= world.nestY;

    if (this.role === 'worker' && this.#tryEatFromNest(colony, inNest, config)) {
      this.state = 'EAT';
    }

    if (nearNest && this.carrying?.type === 'food') {
      const delivered = colony.depositPellet(this.carrying.pelletNutrition || 0);
      if (delivered > 0) this.carrying = null;
      this.state = 'DEPOSIT';
    }

    let didMove = false;
    if (this.role === 'worker' && this.carrying?.type === 'food') {
      this.state = 'CARRY_TO_NEST';
      didMove = this.#moveToward(world, world.nestX, world.nestY, rng);
    } else if (this.role === 'worker' && this.#needsForage(colony)) {
      const pellet = colony.findAvailablePelletAt(this.x, this.y);
      if (pellet) {
        pellet.takenByAntId = this.id;
        this.carrying = {
          type: 'food',
          pelletId: pellet.id,
          pelletNutrition: pellet.nutrition,
        };
        colony.removePelletById(pellet.id);
        this.state = 'PICKUP';
      } else {
        this.state = 'FORAGE_SEARCH';
      }
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

    if (!didMove && this.carrying?.type === 'food') {
      world.toFood[idx] += config.toFoodDeposit;
      this.stepByGradient(world, rng, world.nestInfluence, world.toHome, world.danger, true);
      didMove = true;
    } else if (!didMove) {
      world.toHome[idx] += config.toHomeDeposit;
      this.stepByGradient(world, rng, world.toFood, world.nestInfluence, world.danger, false);
      didMove = true;
    }

    const drain = didMove ? this.hungerDrainRates.move : this.hungerDrainRates.idle;
    this.hunger = Math.max(0, this.hunger - drain * dt);
    if (this.hunger <= 0) {
      this.health = Math.max(0, this.health - config.healthDrainRate * dt);
    } else if (this.health < this.healthMax && this.hunger > this.hungerMax * 0.65) {
      this.health = Math.min(this.healthMax, this.health + config.healthRegenRate * dt);
    }

    if (this.health <= 0) {
      this.alive = false;
      colony.deaths += 1;
    }
  }

  #needsForage(colony) {
    return this.hunger < this.hungerMax * 0.4 || colony.foodStored < colony.foodStoreTarget;
  }

  #tryEatFromNest(colony, inNest, config) {
    if (!inNest || this.hunger >= this.hungerMax * 0.7) return false;
    const consumed = colony.consumeFromStore(config.workerEatNutrition);
    if (consumed <= 0) return false;
    const wasStarving = this.hunger <= 0;
    this.hunger = Math.min(this.hungerMax, this.hunger + consumed);
    if (wasStarving) this.health = Math.min(this.healthMax, this.health + config.starvationRecoveryHealth);
    return true;
  }

  #moveToward(world, tx, ty, rng) {
    let bestX = this.x;
    let bestY = this.y;
    let bestD = Number.POSITIVE_INFINITY;

    for (let i = 0; i < DIRS.length; i += 1) {
      const nx = this.x + DIRS[i][0];
      const ny = this.y + DIRS[i][1];
      if (!world.isPassable(nx, ny)) continue;
      const d = Math.hypot(tx - nx, ty - ny);
      if (d < bestD || (d === bestD && rng.chance(0.5))) {
        bestD = d;
        bestX = nx;
        bestY = ny;
      }
    }

    if (bestX !== this.x || bestY !== this.y) {
      this.x = bestX;
      this.y = bestY;
      return true;
    }

    return false;
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
      if (terrain === TERRAIN.WALL || terrain === TERRAIN.WATER || terrain === TERRAIN.SOIL) continue;

      const primary = primaryField[nidx] * 1.2;
      const secondary = secondaryField[nidx] * 0.8;
      const danger = dangerField[nidx] * 2.2;
      const randomness = rng.range(0, 0.4);
      const inertia = i === 0 ? 0.5 : 0;
      const roleBias = this.role === 'soldier' ? world.danger[nidx] * 0.4 : 0;
      const score = primary + secondary + randomness + inertia + roleBias - danger;

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
