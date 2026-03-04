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
  static getDefaultBaseColor(_role = 'worker') {
    return '#1a1208';
  }

  static getLegacySoldierBaseColor() {
    return '#d93828';
  }

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
    this.baseColor = Ant.getDefaultBaseColor(role);
    this.originalBaseColor = this.baseColor;
    this.alive = true;
    this.role = role;
    this.stepCounter = 0;
    this.workFocus = 'forage';
    this.lastSteeringDebug = null;
  }

  update(world, colony, rng, config) {
    if (!this.alive) return;

    const context = this.#sense(world, colony, config);

    this.#applyPreMoveDecisions(colony, rng, config, context);

    let didMove = this.#decideAndMove(world, colony, rng, config, context);

    if (this.#resolveHazard(world, colony, rng, config, context.idx)) return;

    didMove = this.#applyFallbackMovement(world, rng, config, context.entrance, didMove);
    this.#applyVitals(colony, config, context.dt, didMove);
  }

  #sense(world, colony, config) {
    const dt = config.tickSeconds || 1 / 30;
    const idx = world.index(this.x, this.y);
    const inNest = this.y >= world.nestY;
    const entrance = colony.nearestEntrance(this.x, this.y);

    this.stepCounter += 1;

    return { dt, idx, inNest, entrance };
  }

  #applyPreMoveDecisions(colony, rng, config, context) {
    if (this.role === 'worker' && this.#tryEatFromNest(colony, context.inNest, config)) {
      this.state = 'EAT';
    }

    if (this.role === 'worker' && this.#tryEatNearbyPellet(colony, config)) {
      this.state = 'EAT';
    }

    if (this.role === 'worker' && !this.carrying?.type && rng.chance(config.randomTurnChance)) {
      this.dir = (this.dir + (rng.chance(0.5) ? 1 : DIRS.length - 1)) % DIRS.length;
    }

  }

  #decideAndMove(world, colony, rng, config, context) {
    let didMove = false;
    if (this.role !== 'worker') return didMove;

    if (this.carrying?.type === 'dirt') {
      this.state = 'HAUL_DIRT';
      if (context.entrance) {
        const distanceToEntrance = Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y);
        const entranceRadius = Math.max(1, context.entrance.radius ?? 1);
        if (distanceToEntrance <= entranceRadius + 0.5) {
          colony.recordDirtDeposit(this.carrying.amount ?? 1, context.entrance.x, context.entrance.y);
          this.carrying = null;
          this.carryingType = 'none';
          return didMove;
        }

        didMove = this.#moveToward(world, context.entrance.x, context.entrance.y, rng);
        if (!didMove) didMove = this.#moveByPheromone(world, rng, config, 'home', context.entrance);
        return didMove;
      }

      return this.#moveByPheromone(world, rng, config, 'home', context.entrance);
    }

    if (this.carrying?.type === 'food') {
      this.state = 'RETURN_HOME';
      if (context.inNest) {
        const dropPoint = colony.findNestFoodDropPoint(context.entrance, this.x, this.y);
        if (dropPoint) {
          if (this.x === dropPoint.x && this.y === dropPoint.y) {
            colony.depositFoodFromAnt(this, context.entrance, dropPoint);
            return didMove;
          }

          this.state = 'STORE_FOOD_IN_NEST';
          didMove = this.#moveToward(world, dropPoint.x, dropPoint.y, rng);
          if (!didMove) didMove = this.#moveByPheromone(world, rng, config, 'home', context.entrance);
          return didMove;
        }
      }

      const distToNest = context.entrance ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y) : 0;
      const trailScale = Math.min(config.maxFoodTrailScale, 1 + distToNest * config.foodTrailDistanceScale * 0.05);
      const foodDeposit = config.depositFood * trailScale;
      world.toFood[context.idx] = Math.min(config.pheromoneMaxClamp, world.toFood[context.idx] + foodDeposit);
      didMove = context.entrance
        ? this.#moveToward(world, context.entrance.x, context.entrance.y, rng)
        : this.#moveByPheromone(world, rng, config, 'home', context.entrance);
      if (!didMove) didMove = this.#moveByPheromone(world, rng, config, 'home', context.entrance);
      return didMove;
    }

    if (this.workFocus === 'nurse' && !this.#needsForage(colony)) {
      this.state = 'NURSE';
      if (context.entrance) return this.#moveToward(world, context.entrance.x, context.entrance.y, rng);
      return this.#moveByPheromone(world, rng, config, 'home', context.entrance);
    }

    if (this.workFocus === 'dig' && !this.#needsForage(colony)) {
      this.state = 'DIG_SUPPORT';
      world.toHome[context.idx] = Math.min(config.pheromoneMaxClamp, world.toHome[context.idx] + config.depositHome * 1.4);
      return this.#moveByPheromone(world, rng, config, 'home', context.entrance);
    }

    if (!this.#needsForage(colony)) return didMove;
    if (this.#isCriticalHealth()) {
      this.state = 'RETURN_TO_NEST_HEAL';
      if (context.entrance) didMove = this.#moveToward(world, context.entrance.x, context.entrance.y, rng);
      return didMove;
    }

    if (!this.#needsForage(colony) && !this.#isLowHealth()) return didMove;

    if (context.inNest && context.entrance) {
      const distanceToEntrance = Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y);
      if (distanceToEntrance > (context.entrance.radius ?? 1)) {
        this.state = 'EXIT_NEST';
        return this.#moveToward(world, context.entrance.x, context.entrance.y, rng);
      }

      this.state = 'EXIT_NEST';
      const exitTargetY = context.entrance.y - 1;
      if (world.isPassable(context.entrance.x, exitTargetY)) {
        return this.#moveToward(world, context.entrance.x, exitTargetY, rng);
      }
    }

    const nearEntrance = context.entrance
      ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y) < config.homeDepositMinDistance
      : false;
    if (!nearEntrance && this.stepCounter % config.homeDepositIntervalTicks === 0) {
      world.toHome[context.idx] = Math.min(config.pheromoneMaxClamp, world.toHome[context.idx] + config.depositHome);
    }

    const visible = colony.findVisiblePellet(this.x, this.y, config.foodVisionRadius);
    if (visible) {
      if (this.x === visible.x && this.y === visible.y) {
        if (this.#isLowHealth()) {
          this.#consumePelletForHealth(colony, visible, config);
          this.state = 'EAT';
        } else {
          visible.takenByAntId = this.id;
          this.carrying = {
            type: 'food',
            pelletId: visible.id,
            pelletNutrition: visible.nutrition,
          };
          colony.removePelletById(visible.id);
          this.state = 'PICKUP';
        }
      } else {
        this.state = this.#isLowHealth() ? 'SEEK_FOOD_HEAL' : 'GO_TO_FOOD';
        didMove = this.#moveToward(world, visible.x, visible.y, rng);
      }
      return didMove;
    }

    const onPellet = colony.findAvailablePelletAt(this.x, this.y);
    if (onPellet) {
      if (this.#isLowHealth()) {
        this.#consumePelletForHealth(colony, onPellet, config);
        this.state = 'EAT';
      } else {
        onPellet.takenByAntId = this.id;
        this.carrying = {
          type: 'food',
          pelletId: onPellet.id,
          pelletNutrition: onPellet.nutrition,
        };
        colony.removePelletById(onPellet.id);
        this.state = 'PICKUP';
      }
      return didMove;
    }

    this.state = 'FORAGE_SEARCH';
    const nearEntranceScatter = context.entrance
      ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y) < config.nearEntranceScatterRadius
      : false;
    if (nearEntranceScatter && context.entrance) {
      const ax = this.x + (this.x - context.entrance.x);
      const ay = this.y + (this.y - context.entrance.y);
      didMove = context.inNest
        ? this.#moveToward(world, context.entrance.x, context.entrance.y, rng)
        : this.#moveToward(world, ax, ay, rng);
    }
    if (!didMove) didMove = this.#moveByPheromone(world, rng, config, 'food', context.entrance);
    return didMove;
  }

  #resolveHazard(world, colony, rng, config, idx) {
    const terrain = world.terrain[idx];
    if (terrain !== TERRAIN.HAZARD) return false;

    if (rng.chance(config.hazardDeathChance)) {
      this.alive = false;
      colony.deaths += 1;
      return true;
    }

    world.danger[idx] = Math.min(config.pheromoneMaxClamp, world.danger[idx] + config.dangerDeposit);
    return false;
  }

  #applyFallbackMovement(world, rng, config, entrance, didMove) {
    if (!didMove && this.carrying?.type) {
      return this.#moveByPheromone(world, rng, config, 'home', entrance);
    }
    if (!didMove) {
      return this.#moveByPheromone(world, rng, config, 'food', entrance);
    }
    return didMove;
  }

  #applyVitals(colony, config, dt, didMove) {
    const hungerDrain = didMove ? this.hungerDrainRates.move : this.hungerDrainRates.idle;
    const carryingHungerCost = this.carrying?.type ? (config.carryingHungerDrainRate ?? 0) : 0;
    const fightHungerCost = this.state === 'FIGHT' ? (config.fightingHungerDrainRate ?? 0) : 0;
    this.hunger = Math.max(0, this.hunger - (hungerDrain + carryingHungerCost + fightHungerCost) * dt);

    const healthWorkDrain = (didMove ? (config.healthWorkMoveDrainRate ?? 0) : (config.healthWorkIdleDrainRate ?? 0))
      + (this.carrying?.type ? (config.healthWorkCarryDrainRate ?? 0) : 0)
      + (this.state === 'FIGHT' ? (config.healthWorkFightDrainRate ?? 0) : 0);
    this.health = Math.max(0, this.health - healthWorkDrain * dt);

    if (this.hunger <= 0) {
      this.health = Math.max(0, this.health - config.healthDrainRate * dt);
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
    const homeScentWeight = this.#getHomeScentWeight(config, entrance);
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
      const rawPher = Math.pow(field[nidx] + epsilon, config.followAlpha);
      const scentScale = channel === 'home' ? homeScentWeight : 1;
      const uncappedPherContribution = rawPher * config.followBeta * scentScale;
      const pherContribution = channel === 'home'
        ? Math.min(uncappedPherContribution, config.homeScentMaxContributionPerStep)
        : uncappedPherContribution;
      const momentum = d === this.dir ? config.momentumBias : 0;
      const reversePenalty = d === reverseDir ? config.reversePenalty : 0;

      let tieBias = 0;
      if (entrance) {
        const dist = Math.hypot(nx - entrance.x, ny - entrance.y);
        tieBias = channel === 'home' ? -dist * config.homeTieBiasScale : dist * config.foodTieBiasScale;
      }

      const noise = rng.range(0, config.wanderNoise);
      const weight = Math.max(0, pherContribution + momentum + tieBias + noise - reversePenalty);
      weights.push({
        d,
        w: weight,
        components: {
          pheromone: pherContribution,
          momentum,
          tieBias,
          noise,
          reversePenalty,
        },
      });
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
    const chosenWeight = weights.find((weight) => weight.d === chosenDir);
    this.lastSteeringDebug = {
      channel,
      chosenDir,
      components: chosenWeight?.components || null,
      homeScentWeight: channel === 'home' ? homeScentWeight : 0,
      distanceToEntrance: entrance ? Math.hypot(this.x - entrance.x, this.y - entrance.y) : null,
    };
    this.x = tx;
    this.y = ty;
    this.dir = chosenDir;
    return true;
  }

  #getHomeScentWeight(config, entrance) {
    if (!entrance) return config.homeScentBaseWeight;

    const distance = Math.hypot(this.x - entrance.x, this.y - entrance.y);
    const falloffStart = Math.max(0, config.homeScentFalloffStartDist);
    const falloffEnd = Math.max(falloffStart + 0.0001, config.homeScentFalloffEndDist);
    const minFalloff = Math.min(1, Math.max(0, config.homeScentMinFalloff));
    const t = Math.min(1, Math.max(0, (distance - falloffStart) / (falloffEnd - falloffStart)));
    const distanceFalloff = 1 - (1 - minFalloff) * t;

    const returningToNest = this.carrying?.type === 'food' || this.state === 'RETURN_HOME';
    const stateScale = returningToNest ? config.homeScentReturnStateScale : config.homeScentSearchStateScale;

    return config.homeScentBaseWeight * distanceFalloff * stateScale;
  }

  #needsForage(colony) {
    return this.hunger < this.hungerMax * 0.4 || colony.foodStored < colony.foodStoreTarget;
  }

  #tryEatFromNest(colony, inNest, config) {
    if (!inNest) return false;

    const critical = this.#isCriticalHealth();
    const needsFood = this.hunger < this.hungerMax * 0.7;
    const needsHealth = this.#isLowHealth();
    if (!critical && !needsFood && !needsHealth) return false;

    const requested = critical
      ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition)
      : config.workerEatNutrition;
    const consumed = colony.consumeFromStore(requested);
    if (consumed <= 0) return false;

    this.hunger = Math.min(this.hungerMax, this.hunger + consumed);
    const healthGain = consumed * (config.healthEatRecoveryRate ?? 0);
    this.health = Math.min(this.healthMax, this.health + healthGain + (critical ? config.starvationRecoveryHealth : 0));
    return true;
  }

  #tryEatNearbyPellet(colony, config) {
    if (!this.#isLowHealth()) return false;
    const pellet = colony.findAvailablePelletAt(this.x, this.y);
    if (!pellet) return false;
    this.#consumePelletForHealth(colony, pellet, config);
    return true;
  }

  #consumePelletForHealth(colony, pellet, config) {
    const nutrition = Math.max(0, pellet?.nutrition || 0);
    colony.removePelletById(pellet.id);
    this.hunger = Math.min(this.hungerMax, this.hunger + nutrition);
    this.health = Math.min(this.healthMax, this.health + nutrition * (config.healthEatRecoveryRate ?? 0));
  }

  #isLowHealth() {
    return this.health < this.healthMax * 0.5;
  }

  #isCriticalHealth() {
    return this.health < this.healthMax * 0.25;
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
