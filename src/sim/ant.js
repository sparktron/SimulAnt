import { TERRAIN } from './world.js';

const DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
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
    this.carryingType = 'none';
    this.baseColor = role === 'soldier' ? '#d93828' : '#1a1208';
    this.alive = true;
    this.role = role;
    this.stepCounter = 0;
  }

  update(world, colony, rng, config) {
    if (!this.alive) return;

    if (this.carrying?.type === 'food') {
      this.carryingType = 'food';
    } else if (this.carryingType === 'food') {
      this.carryingType = 'none';
    }

    const dt = config.tickSeconds || 1 / 30;
    const idx = world.index(this.x, this.y);
    const inNest = this.y >= world.nestY;

    if (this.role === 'worker' && this.#tryEatFromNest(colony, inNest, config)) this.state = 'EAT';

    const entrance = colony.nearestEntrance(this.x, this.y);
    this.stepCounter += 1;

    if (this.role === 'worker' && !this.carrying?.type && rng.chance(config.randomTurnChance)) {
      this.dir = (this.dir + (rng.chance(0.5) ? 1 : DIRS.length - 1)) % DIRS.length;
    }

    if (this.role === 'worker' && this.carrying?.type === 'food' && entrance) {
      const distance = Math.hypot(this.x - entrance.x, this.y - entrance.y);
      if (distance <= (entrance.radius ?? 2)) {
        colony.depositPellet(this.carrying.pelletNutrition || 0);
        this.carrying = null;
        this.carryingType = 'none';
        this.state = 'DEPOSIT';
      }
    }

    let didMove = false;
    if (this.role === 'worker') {
      if (this.carrying?.type === 'food') {
        this.state = 'RETURN_HOME';
        const distToNest = entrance ? Math.hypot(this.x - entrance.x, this.y - entrance.y) : 0;
        const trailScale = Math.min(config.maxFoodTrailScale, 1 + distToNest * config.foodTrailDistanceScale * 0.05);
        const foodDeposit = config.depositFood * trailScale;
        world.toFood[idx] = Math.min(config.pheromoneMaxClamp, world.toFood[idx] + foodDeposit);
        didMove = entrance
          ? this.#moveToward(world, entrance.x, entrance.y, rng)
          : this.#moveByPheromone(world, rng, config, 'home', entrance);
        if (!didMove) didMove = this.#moveByPheromone(world, rng, config, 'home', entrance);
      } else if (this.#needsForage(colony)) {
        const nearEntrance = entrance ? Math.hypot(this.x - entrance.x, this.y - entrance.y) < config.homeDepositMinDistance : false;
        if (!nearEntrance && this.stepCounter % config.homeDepositIntervalTicks === 0) {
          world.toHome[idx] = Math.min(config.pheromoneMaxClamp, world.toHome[idx] + config.depositHome);
        }

        const visible = colony.findVisiblePellet(this.x, this.y, config.foodVisionRadius);
        if (visible) {
          if (this.x === visible.x && this.y === visible.y) {
            visible.takenByAntId = this.id;
            this.carrying = {
              type: 'food',
              pelletId: visible.id,
              pelletNutrition: visible.nutrition,
            };
            this.carryingType = 'food';
            colony.removePelletById(visible.id);
            this.state = 'PICKUP';
          } else {
            this.state = 'GO_TO_FOOD';
            didMove = this.#moveToward(world, visible.x, visible.y, rng);
          }
        } else {
          const onPellet = colony.findAvailablePelletAt(this.x, this.y);
          if (onPellet) {
            onPellet.takenByAntId = this.id;
            this.carrying = {
              type: 'food',
              pelletId: onPellet.id,
              pelletNutrition: onPellet.nutrition,
            };
            this.carryingType = 'food';
            colony.removePelletById(onPellet.id);
            this.state = 'PICKUP';
          } else {
            this.state = 'FORAGE_SEARCH';
            const nearEntrance = entrance
              ? Math.hypot(this.x - entrance.x, this.y - entrance.y) < config.nearEntranceScatterRadius
              : false;
            if (nearEntrance && entrance) {
              const ax = this.x + (this.x - entrance.x);
              const ay = this.y + (this.y - entrance.y);
              didMove = this.#moveToward(world, ax, ay, rng);
            }
            if (!didMove) didMove = this.#moveByPheromone(world, rng, config, 'food', entrance);
          }
        }
      }
    }

    const terrain = world.terrain[idx];
    if (terrain === TERRAIN.HAZARD) {
      if (rng.chance(config.hazardDeathChance)) {
        this.alive = false;
        colony.deaths += 1;
        return;
      }
      world.danger[idx] = Math.min(config.pheromoneMaxClamp, world.danger[idx] + config.dangerDeposit);
    }

    if (!didMove && this.carrying?.type === 'food') {
      didMove = this.#moveByPheromone(world, rng, config, 'home', entrance);
    } else if (!didMove) {
      didMove = this.#moveByPheromone(world, rng, config, 'food', entrance);
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

  #moveByPheromone(world, rng, config, channel, entrance) {
    const field = channel === 'home' ? world.toHome : world.toFood;
    const epsilon = 0.001;
    const reverseDir = (this.dir + 4) % DIRS.length;
    const weights = [];
    let total = 0;

    for (let i = 0; i < DIRS.length; i += 1) {
      const d = i;
      const nx = this.x + DIRS[d][0];
      const ny = this.y + DIRS[d][1];
      if (!world.isPassable(nx, ny)) {
        weights.push({ d, w: 0 });
        continue;
      }

      const nidx = world.index(nx, ny);
      const pher = Math.pow(field[nidx] + epsilon, config.followAlpha);
      const momentum = d === this.dir ? config.momentumBias : 0;
      const reversePenalty = d === reverseDir ? config.reversePenalty : 0;

      let tieBias = 0;
      if (entrance) {
        const dist = Math.hypot(nx - entrance.x, ny - entrance.y);
        tieBias = channel === 'home' ? -dist * 0.01 : dist * 0.01;
      }

      const noise = rng.range(0, config.wanderNoise);
      const weight = Math.max(0, pher * config.followBeta + momentum + tieBias + noise - reversePenalty);
      weights.push({ d, w: weight });
      total += weight;
    }

    let chosenDir = this.dir;
    if (total > 0.0001) {
      let pick = rng.range(0, total);
      for (let i = 0; i < weights.length; i += 1) {
        pick -= weights[i].w;
        if (pick <= 0) {
          chosenDir = weights[i].d;
          break;
        }
      }
    } else if (channel === 'home' && entrance) {
      return this.#moveToward(world, entrance.x, entrance.y, rng);
    } else {
      chosenDir = (this.dir + (rng.chance(0.5) ? 1 : DIRS.length - 1)) % DIRS.length;
    }

    const tx = this.x + DIRS[chosenDir][0];
    const ty = this.y + DIRS[chosenDir][1];
    if (!world.isPassable(tx, ty)) return false;
    this.x = tx;
    this.y = ty;
    this.dir = chosenDir;
    return true;
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
}
