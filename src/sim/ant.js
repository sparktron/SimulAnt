import { TERRAIN } from './world.js';

const DEBUG_ANT_FLOW_LOGS = false;

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
  static getDefaultBaseColor(role = 'worker') {
    if (role === 'soldier') {
      return '#7a4a9a';  // Brighter purple for soldiers
    }
    return '#1a1208';  // Dark brown for workers
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
    // Start with varied hunger (20-100) to desynchronize threshold crossings
    this.hunger = 20 + rng.int(81);
    // Initial health ranges from 75%-100% for variance
    this.health = this.healthMax * (0.75 + rng.range(0, 0.25));
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
    // Age/lifespan system for natural mortality
    this.age = 0;
    this.maxAge = role === 'soldier' ? 1800 + rng.int(600) : 2400 + rng.int(800);
    // Work specialization and behavior tracking
    this.workFocus = 'forage';
    this.failedSurfaceFoodSearchTicks = 0;
    const antIdNumeric = Number.parseInt(this.id.slice(4), 10) || 0;
    this.surfaceSearchMissThresholdOffsetTicks = (antIdNumeric % 31) - 15;
    this.lastSteeringDebug = null;
  }

  /**
   * Executes one ant behavior tick.
   *
   * Called by Colony.update for each living ant. Reads world/colony context,
   * updates movement + behavior state machine, and mutates hunger/health.
   */
  update(world, colony, rng, config) {
    if (!this.alive) return;
    this._currentColony = colony;

    if (this.carrying?.type === 'food' || this.carrying?.type === 'queen-food') {
      this.carryingType = 'food';
    } else if (this.carryingType === 'food') {
      this.carryingType = 'none';
    }

    const context = this.#sense(world, colony, config);
    if (this.#resolveHazard(world, colony, rng, config, context.idx)) return;

    this.#applyPreMoveDecisions(colony, rng, config, context);

    let didMove = this.#decideAndMove(world, colony, rng, config, context);

    const currentIdx = world.index(this.x, this.y);
    if (currentIdx !== context.idx && this.#resolveHazard(world, colony, rng, config, currentIdx)) return;

    didMove = this.#applyFallbackMovement(world, colony, rng, config, context.entrance, didMove);
    this.#applyVitals(colony, config, context.dt, didMove);
  }

  /**
   * Collects frequently reused per-tick local context.
   *
   * Returns derived values used by decision and movement phases so downstream
   * logic stays deterministic and avoids recomputing index/entrance lookups.
   */
  #sense(world, colony, config) {
    const dt = config.tickSeconds || 1 / 30;
    const idx = world.index(this.x, this.y);
    const inNest = this.y >= world.nestY;
    const entrance = colony.nearestEntrance(this.x, this.y);

    if (inNest) this.failedSurfaceFoodSearchTicks = 0;
    this.stepCounter += 1;

    return { dt, idx, inNest, entrance };
  }

  /**
   * Handles pre-movement state transitions.
   *
   * Runs immediate actions like eating/depositing before path decisions.
   * Side effects include changing ant state and optionally depositing food.
   */
  #applyPreMoveDecisions(colony, rng, config, context) {
    // Skip eating when already carrying something — prevents double-dipping
    // (eating from nest store while simultaneously carrying food to deposit)
    if (!this.carrying?.type) {
      if (this.#tryEatFromNest(colony, context.inNest, config)) {
        this.state = 'EAT';
      }

      if (this.#tryEatNearbyPellet(colony, config)) {
        this.state = 'EAT';
      }
    }

    if (this.role === 'worker' && !this.carrying?.type && rng.chance(config.randomTurnChance)) {
      this.dir = (this.dir + (rng.chance(0.5) ? 1 : DIRS.length - 1)) % DIRS.length;
    }
  }

  /**
   * Chooses movement intent and executes one step when possible.
   *
   * Encodes worker foraging/return heuristics and pheromone-driven steering.
   * Returns whether movement occurred this tick.
   */
  #decideAndMove(world, colony, rng, config, context) {
    let didMove = false;

    if (this.role === 'soldier') {
      this.state = 'PATROL';
      // Soldiers patrol the nest perimeter, depositing home pheromone near hazards
      if (context.entrance) {
        const distToNest = Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y);
        const patrolRadius = config.nearEntranceScatterRadius + 5;
        if (distToNest > patrolRadius) {
          didMove = this.#moveToward(world, context.entrance.x, context.entrance.y, rng);
        } else {
          didMove = this.#moveByPheromone(world, rng, config, 'home', context.entrance, colony);
        }
      }
      if (!didMove) {
        didMove = this.#moveByPheromone(world, rng, config, 'food', context.entrance, colony);
      }
      // Soldiers deposit home pheromone while patrolling
      if (didMove && this.stepCounter % config.homeDepositIntervalTicks === 0) {
        world.toHome[context.idx] = Math.min(config.pheromoneMaxClamp, world.toHome[context.idx] + config.depositHome * 0.5);
      }
      return didMove;
    }

    if (this.role !== 'worker') return didMove;

    if (this.#isQueenFoodCourier(colony)) {
      return this.#runQueenCourierBehavior(world, colony, rng, config, context);
    }

    // Carrying checks must come before exit-nest: ants with cargo handle it first
    if (this.carrying?.type === 'dirt') {
      this.state = 'HAUL_DIRT';
      if (context.entrance) {
        const entranceRadius = Math.max(1, context.entrance.radius ?? 1);
        const nearEntranceX = Math.abs(this.x - context.entrance.x) <= entranceRadius + 1;
        const reachedSurface = this.y <= context.entrance.y;

        if (reachedSurface && nearEntranceX) {
          colony.recordDirtDeposit(this.carrying.amount ?? 1, context.entrance.x, context.entrance.y);
          this.carrying = null;
          this.carryingType = 'none';
          return didMove;
        }

        const targetY = context.inNest ? context.entrance.y - 1 : Math.min(this.y, context.entrance.y - 1);
        if (world.isPassable(context.entrance.x, targetY)) {
          didMove = this.#moveToward(world, context.entrance.x, targetY, rng);
        }
        if (!didMove) didMove = this.#moveToward(world, context.entrance.x, context.entrance.y, rng);
        if (!didMove) didMove = this.#moveByPheromone(world, rng, config, 'home', context.entrance);
        return didMove;
      }

      return this.#moveByPheromone(world, rng, config, 'home', context.entrance);
    }

    if (this.carrying?.type === 'food') {
      this.failedSurfaceFoodSearchTicks = 0;

      if (this.#isLowHealth()) {
        this.#consumeCarriedFoodForHealth(config);
        if (!this.carrying?.type) {
          this.state = 'EAT';
          return didMove;
        }
      }

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

        // No storage tile available (nest not excavated enough yet).
        // Exit back to the surface so the ant doesn't freeze at the entrance boundary.
        this.state = 'RETURN_HOME';
        if (context.entrance) {
          didMove = this.#moveToward(world, context.entrance.x, context.entrance.y - 1, rng);
          if (didMove) return didMove;
        }
      }

      const distToNest = context.entrance ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y) : 0;
      const trailScale = Math.min(config.maxFoodTrailScale, 1 + distToNest * config.foodTrailDistanceScale * 0.05);
      const foodDeposit = config.depositFood * trailScale;
      world.toFood[context.idx] = Math.min(config.pheromoneMaxClamp, world.toFood[context.idx] + foodDeposit);

      // When reasonably close to nest, navigate directly; farther out, follow pheromone
      if (distToNest < 40 && context.entrance) {
        didMove = this.#moveToward(world, context.entrance.x, this.#getNestEntryTargetY(world, context.entrance), rng);
      } else {
        didMove = this.#moveByPheromone(world, rng, config, 'home', context.entrance);
        if (!didMove && context.entrance) {
          didMove = this.#moveToward(world, context.entrance.x, context.entrance.y, rng);
        }
      }
      return didMove;
    }

    // Foragers exit nest when not carrying anything
    if (this.workFocus === 'forage' && context.inNest && context.entrance) {
      this.state = 'EXIT_NEST';
      const exitTargetY = context.entrance.y - 1;
      // Scatter exits along the entrance width so a crowd of foragers doesn't
      // all race to the same single tile. Each ant picks a deterministic
      // column offset based on its id, spreading load across the 3-wide shaft.
      const radius = Math.max(1, context.entrance.radius ?? 1);
      const scatter = this.#entranceColumnOffset(radius);
      const scatteredX = context.entrance.x + scatter;
      if (world.isPassable(scatteredX, exitTargetY)) {
        return this.#moveToward(world, scatteredX, exitTargetY, rng);
      }
      if (world.isPassable(context.entrance.x, exitTargetY)) {
        return this.#moveToward(world, context.entrance.x, exitTargetY, rng);
      }
      return this.#moveToward(world, context.entrance.x, context.entrance.y, rng);
    }

    if (this.#isLowHealth() && !context.inNest) {
      this.state = 'RETURN_TO_NEST_HEAL';
      if (context.entrance) return this.#moveToward(world, context.entrance.x, this.#getNestEntryTargetY(world, context.entrance), rng);
      return this.#moveByPheromone(world, rng, config, 'home', context.entrance);
    }

    if (this.workFocus === 'nurse' && !this.#needsForage(colony)) {
      return this.#runNurseBehavior(world, colony, rng, config, context);
    }

    if (this.workFocus === 'dig' && !this.#needsForage(colony)) {
      return this.#runDiggerBehavior(world, colony, rng, config, context);
    }

    if (!this.#needsForage(colony)) {
      return didMove;
    }
    if (this.#isCriticalHealth()) {
      this.state = 'RETURN_TO_NEST_HEAL';
      if (context.entrance) didMove = this.#moveToward(world, context.entrance.x, context.entrance.y, rng);
      return didMove;
    }

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

    const visible = colony.findVisiblePellet(this.x, this.y, config.foodVisionRadius);
    if (visible) {
      this.failedSurfaceFoodSearchTicks = 0;
      if (this.x === visible.x && this.y === visible.y) {
        if (this.#isLowHealth()) {
          this.#consumePelletForHealthThenCarry(colony, visible, config);
          this.state = 'EAT';
        } else {
          visible.takenByAntId = this.id;
          this.carrying = {
            type: 'food',
            pelletId: visible.id,
            pelletNutrition: visible.nutrition,
          };
          this.carryingType = 'food';
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
      this.failedSurfaceFoodSearchTicks = 0;
      if (this.#isLowHealth()) {
        this.#consumePelletForHealthThenCarry(colony, onPellet, config);
        this.state = 'EAT';
      } else {
        onPellet.takenByAntId = this.id;
        this.carrying = {
          type: 'food',
          pelletId: onPellet.id,
          pelletNutrition: onPellet.nutrition,
        };
        this.carryingType = 'food';
        colony.removePelletById(onPellet.id);
        this.state = 'PICKUP';
      }
      return didMove;
    }

    if (!context.inNest) {
      this.failedSurfaceFoodSearchTicks += 1;
      const missThresholdOffset = colony.ants.length > 1
        ? this.surfaceSearchMissThresholdOffsetTicks
        : 0;
      const maxMissTicks = Math.max(
        1,
        (config.surfaceFoodSearchMaxMissTicks ?? 90) + missThresholdOffset,
      );
      const returnHungerThreshold = Math.max(0, Math.min(1, config.surfaceReturnToNestHungerThreshold ?? 0.65));
      const shouldReturnToNestForFood = colony.foodStored > 0 && (
        this.hunger < this.hungerMax * 0.25
        || (
          this.failedSurfaceFoodSearchTicks >= maxMissTicks
          && this.hunger < this.hungerMax * returnHungerThreshold
        )
      );

      if (shouldReturnToNestForFood && context.entrance) {
        this.state = 'RETURN_NEST_TO_EAT';
        return this.#moveToward(world, context.entrance.x, this.#getNestEntryTargetY(world, context.entrance), rng);
      }
    }

    this.state = 'FORAGE_SEARCH';
    if (this.stepCounter % config.homeDepositIntervalTicks === 0) {
      world.toHome[context.idx] = Math.min(config.pheromoneMaxClamp, world.toHome[context.idx] + config.depositHome);
    }
    const nearEntranceScatter = context.entrance
      ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y) < config.nearEntranceScatterRadius
      : false;
    if (nearEntranceScatter && context.entrance) {
      const ax = this.x + (this.x - context.entrance.x) + rng.int(20) - 10;
      const ay = this.y + (this.y - context.entrance.y) + rng.int(20) - 10;
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

  #applyFallbackMovement(world, colony, rng, config, entrance, didMove) {
    if (!didMove && this.carrying?.type) {
      return this.#moveByPheromone(world, rng, config, 'home', entrance, colony);
    }
    if (!didMove) {
      return this.#moveByPheromone(world, rng, config, 'food', entrance, colony);
    }
    return didMove;
  }

  #applyVitals(colony, config, dt, didMove) {
    // Increment age for natural lifespan tracking
    this.age += 1;

    // Soldier hunger is currently modeled as static:
    // - soldiers do not consume colony stores (worker-only feeding),
    // - soldiers also do not metabolically drain hunger each tick.
    // They still age and can die from old age and hazards.
    if (this.role === 'soldier') {
      if (this.age > this.maxAge * 0.8) {
        const ageFactor = (this.age - this.maxAge * 0.8) / (this.maxAge * 0.2);
        this.health = Math.max(0, this.health - ageFactor * 2 * dt);
      }
      if (this.health <= 0) {
        this.alive = false;
        colony.deaths += 1;
      }
      return;
    }

    // Hunger mechanics with work penalties
    const hungerDrain = didMove ? this.hungerDrainRates.move : this.hungerDrainRates.idle;
    const carryingHungerCost = this.carrying?.type ? (config.carryingHungerDrainRate ?? 0) : 0;
    const fightHungerCost = this.state === 'FIGHT' ? (config.fightingHungerDrainRate ?? 0) : 0;
    this.hunger = Math.max(0, this.hunger - (hungerDrain + carryingHungerCost + fightHungerCost) * dt);

    // Health degradation from work
    const healthWorkDrain = (didMove ? (config.healthWorkMoveDrainRate ?? 0) : (config.healthWorkIdleDrainRate ?? 0))
      + (this.carrying?.type ? (config.healthWorkCarryDrainRate ?? 0) : 0)
      + (this.state === 'FIGHT' ? (config.healthWorkFightDrainRate ?? 0) : 0);
    this.health = Math.max(0, this.health - healthWorkDrain * dt);

    if (this.hunger <= 0) {
      this.health = Math.max(0, this.health - config.healthDrainRate * dt);
    }

    // Passive health regen when well-fed (hunger > 65%)
    if (this.hunger > this.hungerMax * 0.65 && this.health < this.healthMax) {
      const regenRate = Math.max(0, config.healthRegenRate ?? 0);
      this.health = Math.min(this.healthMax, this.health + regenRate * dt);
    }

    // Old age: health declines gradually in last 20% of lifespan
    if (this.age > this.maxAge * 0.8) {
      const ageFactor = (this.age - this.maxAge * 0.8) / (this.maxAge * 0.2);
      this.health = Math.max(0, this.health - ageFactor * 2 * dt);
    }

    if (this.health <= 0) {
      this.alive = false;
      colony.deaths += 1;
    }
  }

  #moveByPheromone(world, rng, config, channel, entrance, colony) {
    if (!colony) colony = this._currentColony;
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

      // Danger avoidance: reduce weight for tiles with danger pheromone.
      // Configurable so tuning can be tightened without altering steering math.
      const dangerAvoidanceWeight = config.dangerAvoidanceWeight ?? 1.25;
      const dangerPenalty = world.danger[nidx] * dangerAvoidanceWeight;

      // Crowding avoidance: reduce weight toward congested tiles
      const crowdingPenalty = colony ? this.#getCrowdingPenalty(nx, ny, colony) : 0;

      let tieBias = 0;
      if (entrance) {
        const neighborDist = Math.hypot(nx - entrance.x, ny - entrance.y);
        if (channel === 'home') {
          // Normalize by step length so bias is consistent at any distance from nest.
          // progress ≈ +1 stepping directly toward nest, -1 stepping directly away.
          const antDist = Math.hypot(this.x - entrance.x, this.y - entrance.y) + 0.001;
          const stepLen = Math.hypot(DIRS[d][0], DIRS[d][1]);
          const progress = (antDist - neighborDist) / stepLen;
          tieBias = progress * config.homeTieBiasScale;
        } else {
          tieBias = neighborDist * config.foodTieBiasScale;
        }
      }

      // Ants carrying food wander less and focus on home pheromone
      const carryingFood = this.carrying?.type === 'food';
      const noiseReduction = carryingFood ? 0.2 : 1.0;  // 80% noise reduction when carrying
      const pherBoost = carryingFood && channel === 'home' ? 2.0 : 1.0;  // 2x home pheromone boost
      const noise = rng.range(0, config.wanderNoise * noiseReduction);
      const boostedPherContribution = pherContribution * pherBoost;
      const weight = Math.max(0, boostedPherContribution + momentum + tieBias + noise - reversePenalty - dangerPenalty - crowdingPenalty);
      weights.push({
        d,
        w: weight,
        components: {
          pheromone: pherContribution,
          momentum,
          tieBias,
          noise,
          reversePenalty,
          dangerPenalty,
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
      const safestDirs = [];
      let lowestDanger = Number.POSITIVE_INFINITY;
      for (let i = 0; i < DIRS.length; i += 1) {
        const nx = this.x + DIRS[i][0];
        const ny = this.y + DIRS[i][1];
        if (!world.isPassable(nx, ny)) continue;
        const danger = world.danger[world.index(nx, ny)];
        if (danger + 1e-6 < lowestDanger) {
          lowestDanger = danger;
          safestDirs.length = 0;
          safestDirs.push(i);
        } else if (Math.abs(danger - lowestDanger) <= 1e-6) {
          safestDirs.push(i);
        }
      }
      if (safestDirs.length > 0) {
        chosenDir = this.#pickDirectionalCandidate(safestDirs, rng);
      } else {
        chosenDir = (this.dir + (rng.chance(0.5) ? 1 : DIRS.length - 1)) % DIRS.length;
      }
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
    const prevX = this.x;
    const prevY = this.y;
    this.x = tx;
    this.y = ty;
    this.dir = chosenDir;
    if (colony && (prevX !== this.x || prevY !== this.y)) {
      colony.moveAntInGrid(prevX, prevY, this.x, this.y);
    }
    return true;
  }


  #isQueenFoodCourier(colony) {
    return colony.isQueenFoodCourier(this.id);
  }

  #runQueenCourierBehavior(world, colony, rng, config, context) {
    let didMove = false;
    const queen = colony.queen;
    if (!queen?.alive) return didMove;

    if (this.carrying?.type === 'queen-food') {
      const distanceToQueen = Math.hypot(this.x - queen.x, this.y - queen.y);
      if (distanceToQueen <= 1.5) {
        colony.feedQueen(this.carrying.pelletNutrition, config);
        this.carrying = null;
        this.carryingType = 'none';
        this.state = 'FEED_QUEEN';
        return didMove;
      }

      this.state = 'DELIVER_QUEEN_FOOD';
      return this.#moveToward(world, queen.x, queen.y, rng);
    }

    if (context.inNest) {
      const pickupNutrition = colony.pickupQueenFoodRation(config.queenCourierPickupNutrition ?? 6);
      if (pickupNutrition > 0) {
        this.carrying = {
          type: 'queen-food',
          pelletId: null,
          pelletNutrition: pickupNutrition,
        };
        this.carryingType = 'food';
        this.state = 'PICKUP_QUEEN_FOOD';
        return didMove;
      }

      this.state = 'SEEK_QUEEN_FOOD';
      const visiblePellet = colony.findVisiblePellet(this.x, this.y, config.foodVisionRadius);
      if (visiblePellet) return this.#moveToward(world, visiblePellet.x, visiblePellet.y, rng);
      return this.#moveByPheromone(world, rng, config, 'food', context.entrance, colony);
    }

    this.state = 'RETURN_NEST_FOR_QUEEN_FOOD';
    if (context.entrance) return this.#moveToward(world, context.entrance.x, this.#getNestEntryTargetY(world, context.entrance), rng);
    return this.#moveByPheromone(world, rng, config, 'home', context.entrance, colony);
  }

  /**
   * Nurse behavior: feed the queen, tend larvae, and maintain the nest.
   *
   * Priority order:
   * 1. If outside nest, return inside
   * 2. If carrying queen-food, deliver to queen
   * 3. If queen is hungry and food is available, pick up food for queen
   * 4. Spread overcrowded larvae
   * 5. Wander the nest
   */
  #runNurseBehavior(world, colony, rng, config, context) {
    this.state = 'NURSE';

    // Enter the nest if outside
    if (!context.inNest && context.entrance) {
      this.state = 'NURSE_ENTER_NEST';
      return this.#moveToward(world, context.entrance.x, this.#getNestEntryTargetY(world, context.entrance), rng);
    }

    // If carrying queen-food, deliver it
    if (this.carrying?.type === 'queen-food') {
      const queen = colony.queen;
      if (queen?.alive) {
        const distToQueen = Math.hypot(this.x - queen.x, this.y - queen.y);
        if (distToQueen <= 1.5) {
          colony.feedQueen(this.carrying.pelletNutrition, config);
          this.carrying = null;
          this.carryingType = 'none';
          this.state = 'NURSE_FEED_QUEEN';
          return false;
        }
        this.state = 'NURSE_DELIVER_QUEEN_FOOD';
        return this.#moveToward(world, queen.x, queen.y, rng);
      }
      // Queen dead — drop the food
      this.carrying = null;
      this.carryingType = 'none';
    }

    // Feed the queen if she's actually hungry and not enough couriers already
    const queen = colony.queen;
    if (queen?.alive && !this.carrying?.type
        && queen.hunger < queen.hungerMax * 0.4
        && colony.foodStored > 2
        && colony.countQueenFoodCouriers() < 2) {
      const pickupAmount = config.queenCourierPickupNutrition ?? 6;
      const nutrition = colony.pickupQueenFoodRation(pickupAmount);
      if (nutrition > 0) {
        this.carrying = {
          type: 'queen-food',
          pelletId: null,
          pelletNutrition: nutrition,
        };
        this.carryingType = 'food';
        this.state = 'NURSE_PICKUP_QUEEN_FOOD';
        return false;
      }
    }

    // Spread overcrowded larvae periodically (every ~60 ticks per nurse)
    if (this.stepCounter % 60 === 0 && colony.larvae.length > 1) {
      colony.spreadLarvae(rng);
    }

    // Tend brood: move toward the brood area
    if (colony.larvae.length > 0) {
      const broodX = Math.max(0, Math.min(world.width - 1, world.nestX + 4));
      const broodY = Math.max(world.nestY + 2, Math.min(world.height - 1, world.nestY + 8));
      const distToBrood = Math.hypot(this.x - broodX, this.y - broodY);
      // Stay near the brood but don't pile on top — wander within 6 tiles
      if (distToBrood > 6) {
        this.state = 'NURSE_TEND_BROOD';
        return this.#moveToward(world, broodX, broodY, rng);
      }
    }

    // Default: wander nest exploring
    return this.#moveByPheromone(world, rng, config, 'food', context.entrance);
  }

  /**
   * Digger behavior: actively seek and work at dig fronts.
   *
   * Priority order:
   * 1. If outside nest, return inside
   * 2. If carrying dirt, haul it to the surface (handled by carrying check above)
   * 3. Move toward the nearest active dig front
   * 4. Deposit home pheromone to help others navigate
   */
  #runDiggerBehavior(world, colony, rng, config, context) {
    this.state = 'DIG';

    // Enter the nest if outside
    if (!context.inNest && context.entrance) {
      this.state = 'DIG_ENTER_NEST';
      return this.#moveToward(world, context.entrance.x, this.#getNestEntryTargetY(world, context.entrance), rng);
    }

    // Deposit home pheromone to help navigation
    const idx = world.index(this.x, this.y);
    world.toHome[idx] = Math.min(config.pheromoneMaxClamp, world.toHome[idx] + config.depositHome * 1.4);

    // Move toward the nearest active dig front
    const digTarget = colony.getActiveDigFrontPosition(this.x, this.y);
    if (digTarget) {
      const distToFront = Math.hypot(this.x - digTarget.x, this.y - digTarget.y);
      if (distToFront > 2) {
        this.state = 'DIG_MOVE_TO_FRONT';
        return this.#moveToward(world, digTarget.x, digTarget.y, rng);
      }
      // At the front — wander nearby so DigSystem can assign us
      this.state = 'DIG_AT_FRONT';
    }

    // Wander near current position in tunnels
    return this.#moveByPheromone(world, rng, config, 'food', context.entrance);
  }

  #getNestEntryTargetY(world, entrance) {
    const baseX = entrance?.x ?? this.x;
    const baseY = entrance?.y ?? world.nestY;
    const maxDepthSearch = 6;

    for (let dy = 1; dy <= maxDepthSearch; dy += 1) {
      const candidateY = Math.min(world.height - 1, baseY + dy);
      if (world.isPassable(baseX, candidateY)) {
        return candidateY;
      }
    }
    return baseY;
  }

  #entranceColumnOffset(radius) {
    // Deterministic per-ant scatter across the entrance width.
    // Parse the id suffix once — cached so sorts/comparisons remain cheap.
    if (this._entranceColumnOffset === undefined) {
      const numericPart = Number.parseInt((this.id || '').slice(4), 10) || 0;
      const span = Math.max(1, radius * 2 + 1);
      this._entranceColumnOffset = (numericPart % span) - Math.floor(span / 2);
    }
    return this._entranceColumnOffset;
  }

  #getHomeScentWeight(config, entrance) {
    if (!entrance) return config.homeScentBaseWeight;

    const distance = Math.hypot(this.x - entrance.x, this.y - entrance.y);
    const falloffStart = Math.max(0, config.homeScentFalloffStartDist);
    const falloffEnd = Math.max(falloffStart + 0.0001, config.homeScentFalloffEndDist);
    const minFalloff = Math.min(1, Math.max(0, config.homeScentMinFalloff));
    const t = Math.min(1, Math.max(0, (distance - falloffStart) / (falloffEnd - falloffStart)));
    const distanceFalloff = 1 - (1 - minFalloff) * t;

    const returningToNest = this.carrying?.type === 'food'
      || this.state === 'RETURN_HOME'
      || this.state === 'RETURN_TO_NEST_HEAL'
      || this.state === 'RETURN_NEST_TO_EAT';
    const stateScale = returningToNest ? config.homeScentReturnStateScale : config.homeScentSearchStateScale;

    // Boost scent weight when carrying food and close to entrance
    let proximityBoost = 1.0;
    if (this.carrying?.type === 'food' && distance < 60) {
      proximityBoost = 1 + (1 - distance / 60) * 3.0;  // up to 4x boost at entrance
    }

    return config.homeScentBaseWeight * distanceFalloff * stateScale * proximityBoost;
  }

  #getCrowdingPenalty(x, y, colony) {
    // Count nearby ants (within 2 tiles) to detect crowding
    let nearbyAntCount = 0;
    const range = 2;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (dx === 0 && dy === 0) continue; // Don't count self
        const checkX = x + dx;
        const checkY = y + dy;
        nearbyAntCount += colony.countAntsAt(checkX, checkY);
      }
    }
    // Exponential penalty: scales quadratically with ant count
    // Single ant nearby = 1.5 penalty, 2 ants = 6.0, 3 ants = 13.5, etc.
    return nearbyAntCount * nearbyAntCount * 1.5;
  }

  #needsForage(colony) {
    // Role-aware: specialists (nurse/dig) stay on duty unless personally starving.
    const isSpecialist = this.workFocus === 'nurse' || this.workFocus === 'dig';
    if (isSpecialist) {
      return this.hunger < this.hungerMax * 0.15;
    }

    // Foragers: this is their *job*. They should keep working as long as the
    // colony has room to grow its reserves. Previously they idled as soon as
    // they were personally fed AND the store was above 25% of target, which
    // caused them to cluster at the entrance and refuse to walk the pheromone
    // trails. Keep them foraging until the store is nearly full.
    if (this.workFocus === 'forage') {
      const storeTarget = Math.max(1, colony.foodStoreTarget);
      const storeNearlyFull = colony.foodStored >= storeTarget * 0.9;
      if (!storeNearlyFull) return true;
      // Even at target, still forage if personally hungry.
      return this.hunger < this.hungerMax * 0.6;
    }

    // Unspecialized workers fall back to the legacy hunger/shortage heuristic.
    const personallyHungry = this.hunger < this.hungerMax * 0.4;
    const criticalFoodShortage = colony.foodStored < Math.max(1, colony.foodStoreTarget * 0.25);
    return personallyHungry || criticalFoodShortage;
  }

  #tryEatFromNest(colony, inNest, config) {
    if (!inNest) return false;

    // Only eat when health drops below 60%
    const healthBelowThreshold = this.health < this.healthMax * 0.6;
    if (!healthBelowThreshold) return false;

    const critical = this.#isCriticalHealth();

    const requested = critical
      ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition)
      : config.workerEatNutrition;
    // Clamp intake to remaining hunger capacity in the common case to avoid
    // wasting colony food. When hunger is already full, cap intake to the
    // nutrition actually needed for health recovery so full-hunger workers can
    // heal without draining excess rations.
    const hungerCapacity = Math.max(0, this.hungerMax - this.hunger);
    let requestedIntake = 0;
    if (hungerCapacity > 0) {
      requestedIntake = Math.min(requested, hungerCapacity);
    } else {
      const healthDeficit = Math.max(0, this.healthMax - this.health);
      const criticalBonus = critical ? Math.max(0, config.starvationRecoveryHealth ?? 0) : 0;
      const remainingRecovery = Math.max(0, healthDeficit - criticalBonus);
      const healthRecoveryRate = Math.max(0, config.healthEatRecoveryRate ?? 0);
      if (healthRecoveryRate > 0) {
        const nutritionForRecovery = remainingRecovery / healthRecoveryRate;
        requestedIntake = Math.min(requested, nutritionForRecovery);
      }
    }
    if (requestedIntake <= 0) return false;

    const consumed = colony.consumeFromStore(requestedIntake);
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
    this.#consumePelletForHealthThenCarry(colony, pellet, config);
    return true;
  }

  #consumePelletForHealth(colony, pellet, config) {
    const nutrition = Math.max(0, pellet?.nutrition || 0);
    colony.removePelletById(pellet.id);
    this.hunger = Math.min(this.hungerMax, this.hunger + nutrition);
    this.health = Math.min(this.healthMax, this.health + nutrition * (config.healthEatRecoveryRate ?? 0));
  }

  #consumePelletForHealthThenCarry(colony, pellet, config) {
    const nutrition = Math.max(0, pellet?.nutrition || 0);
    if (nutrition <= 0) {
      colony.removePelletById(pellet.id);
      return;
    }

    const requested = this.#isCriticalHealth()
      ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition ?? nutrition)
      : (config.workerEatNutrition ?? nutrition);
    const consumed = Math.min(nutrition, requested);
    const healthRecoveryRate = Math.max(0, config.healthEatRecoveryRate ?? 0);

    this.hunger = Math.min(this.hungerMax, this.hunger + consumed);
    this.health = Math.min(this.healthMax, this.health + consumed * healthRecoveryRate);

    const remainingNutrition = Math.max(0, nutrition - consumed);
    colony.removePelletById(pellet.id);
    if (remainingNutrition > 0.0001) {
      this.carrying = {
        type: 'food',
        pelletId: pellet.id,
        pelletNutrition: remainingNutrition,
      };
      this.carryingType = 'food';
    }
  }

  #consumeCarriedFoodForHealth(config) {
    if (this.carrying?.type !== 'food') return;
    const available = Math.max(0, this.carrying.pelletNutrition || 0);
    if (available <= 0) {
      this.carrying = null;
      this.carryingType = 'none';
      return;
    }

    const requested = this.#isCriticalHealth()
      ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition)
      : (config.workerEatNutrition ?? available);
    const consumed = Math.min(available, requested);
    const recoveryRate = Math.max(0, config.healthEatRecoveryRate ?? 0);
    this.hunger = Math.min(this.hungerMax, this.hunger + consumed);
    this.health = Math.min(this.healthMax, this.health + consumed * recoveryRate);

    const remaining = Math.max(0, available - consumed);
    if (remaining <= 0.0001) {
      this.carrying = null;
      this.carryingType = 'none';
      return;
    }
    this.carrying.pelletNutrition = remaining;
  }

  #isLowHealth() {
    return this.health < this.healthMax * 0.5;
  }

  #isCriticalHealth() {
    return this.health < this.healthMax * 0.25;
  }

  #moveToward(world, tx, ty, rng) {
    // Score each passable neighbor by distance-to-target plus a crowding penalty.
    // Without the crowding term, every exit/enter goal sends ants to the exact
    // same tile and they stack indefinitely at the entrance column.
    const scored = [];
    let bestScore = Number.POSITIVE_INFINITY;
    const colony = this._currentColony;

    for (let i = 0; i < DIRS.length; i += 1) {
      const nx = this.x + DIRS[i][0];
      const ny = this.y + DIRS[i][1];
      if (!world.isPassable(nx, ny)) continue;
      const d = Math.hypot(tx - nx, ty - ny);
      const crowd = colony ? colony.countAntsAt(nx, ny) : 0;
      // Each already-present ant costs ~0.6 units of distance equivalence.
      // Strong enough to prefer an empty sidestep over a 1-tile-better but occupied target,
      // but weak enough that ants still make progress through lightly crowded tunnels.
      const score = d + crowd * 0.6;
      if (score < bestScore - 1e-9) {
        bestScore = score;
        scored.length = 0;
        scored.push(i);
      } else if (score < bestScore + 1e-9) {
        scored.push(i);
      }
    }

    if (scored.length > 0) {
      const bestDir = this.#pickDirectionalCandidate(scored, rng);
      const prevX = this.x;
      const prevY = this.y;
      this.x += DIRS[bestDir][0];
      this.y += DIRS[bestDir][1];
      this.dir = bestDir;
      if (colony && (prevX !== this.x || prevY !== this.y)) {
        colony.moveAntInGrid(prevX, prevY, this.x, this.y);
      }
      return true;
    }

    return false;
  }

  #pickDirectionalCandidate(candidates, rng) {
    if (!candidates?.length) return this.dir;
    if (candidates.length === 1) return candidates[0];

    const reverseDir = (this.dir + 4) % DIRS.length;
    let totalWeight = 0;
    const weightedCandidates = candidates.map((candidateDir) => {
      let weight = 1;
      if (candidateDir === this.dir) {
        weight = 4;
      } else if (candidateDir === reverseDir) {
        weight = 0.8;
      } else {
        const delta = Math.min(
          (candidateDir - this.dir + DIRS.length) % DIRS.length,
          (this.dir - candidateDir + DIRS.length) % DIRS.length,
        );
        weight = delta === 1 ? 2.5 : 1.6;
      }
      totalWeight += weight;
      return { candidateDir, weight };
    });

    let pick = rng.range(0, totalWeight);
    for (let i = 0; i < weightedCandidates.length; i += 1) {
      pick -= weightedCandidates[i].weight;
      if (pick <= 0) return weightedCandidates[i].candidateDir;
    }
    return weightedCandidates[weightedCandidates.length - 1].candidateDir;
  }
}
