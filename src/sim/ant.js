import { TERRAIN } from './world.js';
import { isInNestSpatial } from './behavior/NestState.js';

const DEBUG_ANT_FLOW_LOGS = false;

// Box-Muller transform — normally distributed variate via the seeded rng.
// Must use rng, not Math.random(), to preserve simulation determinism.
function gaussianRandom(rng) {
  const u = Math.max(1e-10, rng.range(0, 1));
  const v = rng.range(0, 1);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

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
      move: role === 'soldier' ? 4.5 : 2.0,
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
    this._lastNestEatTick = -Infinity;
    // Trail re-acquisition: remember last on-trail direction for a few ticks
    // so the ant can find the trail again if it drifts off momentarily.
    this._lastTrailDir = -1;
    this._ticksSinceOnTrail = Infinity;
    // Stagger nest departures to avoid traffic jams at the entrance.
    this._nestDepartureDelay = 0;
    // Phase 1: persistent heading for correlated random walk.
    // theta is a continuous angle in radians; prevTurn and turnSign carry
    // inter-tick correlation state for the meander model.
    this.theta = Math.atan2(DIRS[this.dir][1], DIRS[this.dir][0]);
    this.prevTurn = 0;
    this.turnSign = 1;
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
    const entrance = colony.nearestEntrance(this.x, this.y);
    const inNestSpatial = isInNestSpatial(world, this.x, this.y);
    const inNestStructure = world.isUndergroundTile(this.x, this.y);
    // Treat tunnel/chamber tiles below the entrance mouth as "in nest" for
    // behavior routing so ants in the vertical shaft keep EXIT_NEST/RETURN
    // intent instead of running surface-forage logic in a chokepoint.
    // Keep the exact mouth row as surface to preserve no-feeding-on-mouth
    // behavior and avoid ants camping at the exit tile.
    const aboveOrAtMouth = entrance ? this.y <= entrance.y : false;
    const inNest = inNestSpatial || (inNestStructure && !aboveOrAtMouth);

    if (inNest) this.failedSurfaceFoodSearchTicks = 0;
    this.stepCounter += 1;

    return {
      dt,
      idx,
      inNest,
      inNestInterior: inNestSpatial,
      entrance,
    };
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
      if (this.#tryEatFromNest(colony, context.inNestInterior, config)) {
        this.state = 'EAT';
      }

      if (this.#tryEatNearbyPellet(colony, config)) {
        this.state = 'EAT';
      }
    }

    // randomTurnChance is superseded by the correlated random walk in
    // #updateWanderHeading; the memoryless random-kick is intentionally removed.
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
        // Phase 3: soldier food-channel fallback is a wandering context.
        // Advance theta so headingContrib in #moveByPheromone steers it
        // with the same smoothness as worker FORAGE_SEARCH.
        this.#updateWanderHeading(rng, world, config);
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
          didMove = this.#moveThroughEntranceShaft(world, context.entrance, targetY, rng);
        }
        if (!didMove) didMove = this.#moveThroughEntranceShaft(world, context.entrance, context.entrance.y, rng);
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
            // Stagger nest departures: small random delay so ants don't all
            // rush the entrance on the same tick. The previous 5-20 tick
            // window was long enough that hungry waves serialized through
            // the eat → idle → exit pipeline and clogged the entrance.
            this._nestDepartureDelay = 2 + rng.int(4);
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
          didMove = this.#moveThroughEntranceShaft(world, context.entrance, context.entrance.y - 1, rng);
          if (didMove) return didMove;
        }
      }

      const distToNest = context.entrance ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y) : 0;
      // Food-trail reinforcement: when a returning ant walks over an existing
      // food trail, the pheromone is multiplied by 1.25× AND the normal deposit
      // is added.  This makes popular trails grow exponentially stronger while
      // unused branches fade away — a positive feedback loop that consolidates
      // foraging traffic onto the best routes.
      const existingFood = world.toFood[context.idx];
      const foodDeposit = config.depositFood;
      const amplified = existingFood > 0.1
        ? existingFood * 1.25 + foodDeposit
        : existingFood + foodDeposit;
      world.toFood[context.idx] = Math.min(config.pheromoneMaxClamp, amplified);

      // When reasonably close to nest, navigate directly; farther out, follow pheromone
      // with food-trail gravitation so returning ants reinforce existing trails
      // rather than carving new paths.
      if (distToNest < 40 && context.entrance) {
        didMove = this.#moveThroughEntranceShaft(
          world,
          context.entrance,
          this.#getNestEntryTargetY(world, context.entrance),
          rng,
        );
      } else {
        didMove = this.#moveByPheromone(world, rng, config, 'home', context.entrance, null, world.toFood);
        if (!didMove && context.entrance) {
          didMove = this.#moveThroughEntranceShaft(world, context.entrance, context.entrance.y, rng);
        }
      }
      return didMove;
    }

    // Foragers exit nest when not carrying anything
    if (this.workFocus === 'forage' && context.inNest && context.entrance) {
      const returnHungerThreshold = Math.max(
        0,
        Math.min(1, config.surfaceReturnToNestHungerThreshold ?? 0.65),
      );
      const shouldContinueIntoNestForFood = !context.inNestInterior
        && colony.foodStored > 0
        && this.hunger < this.hungerMax * returnHungerThreshold;
      if (shouldContinueIntoNestForFood) {
        this.state = 'RETURN_NEST_TO_EAT';
        return this.#moveThroughEntranceShaft(
          world,
          context.entrance,
          this.#getNestEntryTargetY(world, context.entrance),
          rng,
        );
      }

      // Stagger departures: after eating, wait a random delay before leaving
      // so ants don't all rush the entrance at once.
      if (this._nestDepartureDelay > 0) {
        this._nestDepartureDelay -= 1;
        this.state = 'IDLE';
        return false;
      }
      this.state = 'EXIT_NEST';
      const exitTargetY = context.entrance.y - 1;
      // Scatter exits along a wider band so foragers fan out instead of
      // clustering at the same few tiles.  Uses double the entrance radius
      // plus padding so ants emerge across an 8-10 tile front.
      const radius = Math.max(1, (context.entrance.radius ?? 1) * 2 + 2);
      const scatter = this.#entranceColumnOffset(radius);
      const scatteredX = context.entrance.x + scatter;
      if (world.isPassable(scatteredX, exitTargetY)) {
        return this.#moveToward(world, scatteredX, exitTargetY, rng);
      }
      if (world.isPassable(context.entrance.x, exitTargetY)) {
        return this.#moveThroughEntranceShaft(world, context.entrance, exitTargetY, rng);
      }
      return this.#moveThroughEntranceShaft(world, context.entrance, context.entrance.y, rng);
    }

    if (this.#isLowHealth() && !context.inNest) {
      this.state = 'RETURN_TO_NEST_HEAL';
      if (context.entrance) {
        return this.#moveThroughEntranceShaft(
          world,
          context.entrance,
          this.#getNestEntryTargetY(world, context.entrance),
          rng,
        );
      }
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
      if (context.entrance) didMove = this.#moveThroughEntranceShaft(world, context.entrance, context.entrance.y, rng);
      return didMove;
    }

    if (context.inNest && context.entrance) {
      const distanceToEntrance = Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y);
      if (distanceToEntrance > (context.entrance.radius ?? 1)) {
        this.state = 'EXIT_NEST';
        return this.#moveThroughEntranceShaft(world, context.entrance, context.entrance.y, rng);
      }

      this.state = 'EXIT_NEST';
      const exitTargetY = context.entrance.y - 1;
      if (world.isPassable(context.entrance.x, exitTargetY)) {
        return this.#moveThroughEntranceShaft(world, context.entrance, exitTargetY, rng);
      }
    }

    const visible = colony.findVisiblePellet(this.x, this.y, config.foodVisionRadius);
    if (visible) {
      this.failedSurfaceFoodSearchTicks = 0;
      if (this.x === visible.x && this.y === visible.y) {
        // In an abundant food source with health below 60%, eat a pellet
        // for personal health before picking up one to carry home.  This
        // keeps foragers alive on long trips and doesn't waste food since
        // the source is plentiful.
        const abundantFood = colony.countVisiblePellets(this.x, this.y, config.foodVisionRadius) >= 3;
        const needsPersonalFood = this.health < this.healthMax * 0.6;
        if (this.#isLowHealth()) {
          this.#consumePelletForHealthThenCarry(colony, visible, config);
          this.state = 'EAT';
        } else if (abundantFood && needsPersonalFood) {
          // Eat this pellet outright for health, then next tick pick up another to carry
          this.#consumePelletForHealth(colony, visible, config);
          this.state = 'EAT';
        } else {
          visible.takenByAntId = this.id;
          this.carrying = {
            type: 'food',
            pelletId: visible.id,
            pelletNutrition: visible.nutrition,
            pickupDistance: this.#distanceToEntrance(colony),
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
      const abundantFoodHere = colony.countVisiblePellets(this.x, this.y, config.foodVisionRadius) >= 3;
      const needsFoodHere = this.health < this.healthMax * 0.6;
      if (this.#isLowHealth()) {
        this.#consumePelletForHealthThenCarry(colony, onPellet, config);
        this.state = 'EAT';
      } else if (abundantFoodHere && needsFoodHere) {
        this.#consumePelletForHealth(colony, onPellet, config);
        this.state = 'EAT';
      } else {
        onPellet.takenByAntId = this.id;
        this.carrying = {
          type: 'food',
          pelletId: onPellet.id,
          pelletNutrition: onPellet.nutrition,
          pickupDistance: this.#distanceToEntrance(colony),
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
        this.hunger < this.hungerMax * 0.15
        || (
          this.failedSurfaceFoodSearchTicks >= maxMissTicks
          && this.hunger < this.hungerMax * returnHungerThreshold
        )
      );

      if (shouldReturnToNestForFood && context.entrance) {
        this.state = 'RETURN_NEST_TO_EAT';
        return this.#moveThroughEntranceShaft(
          world,
          context.entrance,
          this.#getNestEntryTargetY(world, context.entrance),
          rng,
        );
      }
    }

    this.state = 'FORAGE_SEARCH';
    // Advance the persistent heading (this.theta) via correlated random walk.
    // The heading then steers #moveByPheromone through the headingBias weight
    // term; this.dir stays on the actual last-moved direction for momentum/
    // reversal-penalty correctness.
    this.#updateWanderHeading(rng, world, config);
    // Home pheromone is meant to be a *gradient toward the entrance*, not a
    // uniform background. If searching ants paint it everywhere they wander,
    // diffusion saturates the foraging area and the gradient flattens — which
    // (a) makes returning ants drift instead of commute, and (b) elevates the
    // food trail's contrast vs noise. Restrict deposition to a band around
    // the entrance so the field stays peaked there.
    const distToEntranceForDeposit = context.entrance
      ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y)
      : 0;
    if (this.stepCounter % config.homeDepositIntervalTicks === 0
        && distToEntranceForDeposit < (config.homeDepositMinDistance ?? 20)) {
      world.toHome[context.idx] = Math.min(config.pheromoneMaxClamp, world.toHome[context.idx] + config.depositHome);
    }

    // Only scatter ants that are very close to the entrance AND not already
    // on a food trail. Previously the scatter radius was 30 tiles, covering
    // most of the foraging range and overriding pheromone following entirely —
    // ants would drift randomly instead of walking the trail to the food source.
    const distFromEntrance = context.entrance
      ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y)
      : 0;
    const onFoodTrail = world.toFood[context.idx] > 0.5;
    // Within a wide ring around the entrance, scatter outward unconditionally —
    // returners deposit food pheromone *along the entire return path*, with a
    // local maximum at the entrance. Pheromone-following alone keeps fresh
    // foragers cycling through that field at low radius; they rarely make it
    // out to the food source. Override pheromone steering with a hard outward
    // push until the ant is well clear of the entrance basin.
    const innerScatterRadius = 20;
    const nearEntranceScatter = !context.inNest && context.entrance && (
      distFromEntrance < innerScatterRadius
      || (!onFoodTrail && distFromEntrance < (config.nearEntranceScatterRadius ?? 8))
    );
    if (nearEntranceScatter && context.entrance) {
      // Preserve a strong radial push away from the entrance and keep jitter
      // small so ants don't get kicked back inward by noise near the mouth.
      const awayX = this.x - context.entrance.x;
      const awayY = this.y - context.entrance.y;
      const awayLen = Math.max(1, Math.hypot(awayX, awayY));
      const pushDistance = 10 + rng.int(7);
      const jitterX = rng.int(5) - 2;
      const jitterY = rng.int(5) - 2;
      const ax = this.x + Math.round((awayX / awayLen) * pushDistance) + jitterX;
      const ay = this.y + Math.round((awayY / awayLen) * pushDistance) + jitterY;
      didMove = this.#moveToward(world, ax, ay, rng);
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

    if (this.role === 'soldier') {
      const hungerDrain = didMove ? this.hungerDrainRates.move : this.hungerDrainRates.idle;
      this.hunger = Math.max(0, this.hunger - hungerDrain * dt);

      if (this.hunger <= 0) {
        this.health = Math.max(0, this.health - config.healthDrainRate * dt);
      }

      if (this.hunger > this.hungerMax * 0.65 && this.health < this.healthMax && this.age <= this.maxAge * 0.8) {
        const regenRate = Math.max(0, config.healthRegenRate ?? 0);
        this.health = Math.min(this.healthMax, this.health + regenRate * dt);
      }

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

    // Passive health regen when well-fed (hunger > 65%), but not once the ant
    // has entered the senescence zone — age drain should be able to run its
    // course without regen extending life past maxAge.
    if (this.hunger > this.hungerMax * 0.65 && this.health < this.healthMax && this.age <= this.maxAge * 0.8) {
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

  #moveByPheromone(world, rng, config, channel, entrance, colony, trailAttractionField = null) {
    if (!colony) colony = this._currentColony;
    const field = channel === 'home' ? world.toHome : world.toFood;
    const epsilon = 0.001;
    const reverseDir = (this.dir + 4) % DIRS.length;
    const homeScentWeight = this.#getHomeScentWeight(config, entrance);
    const enforceEntranceCorridor = this.#isEntranceTransitState() && !!entrance;
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
      if (enforceEntranceCorridor && this.#violatesEntranceCorridor(nx, ny, entrance)) {
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

      // Reduce wander noise when the ant is already locked onto a trail so it
      // follows pheromone all the way to the source instead of drifting off.
      const carryingFood = this.carrying?.type === 'food';
      const currentTrailValue = field[world.index(this.x, this.y)] ?? 0;
      const onStrongTrail = !carryingFood && channel === 'food' && currentTrailValue > 0.1;
      const noiseReduction = carryingFood ? 0.2 : onStrongTrail ? 0.25 : 1.0;
      const pherBoost = carryingFood && channel === 'home' ? 2.0 : 1.0;  // 2x home pheromone boost

      // Trail re-acquisition: if this ant was on a trail recently but lost it,
      // bias toward the last known trail direction for a few ticks.
      let reacquireBias = 0;
      if (!onStrongTrail && channel === 'food' && this._ticksSinceOnTrail < 5 && this._lastTrailDir >= 0) {
        reacquireBias = d === this._lastTrailDir ? 0.4 : 0;
      }

      // Trail-reinforcement gravitation: when returning with food, bias toward
      // tiles that already have food pheromone so the ant walks along the
      // existing trail corridor instead of creating a parallel path.
      let trailAttraction = 0;
      if (trailAttractionField) {
        const attractValue = trailAttractionField[nidx] ?? 0;
        if (attractValue > 0.1) {
          trailAttraction = Math.min(attractValue * 0.3, 2.0);
        }
      }

      const noise = rng.range(0, config.wanderNoise * noiseReduction);
      const boostedPherContribution = pherContribution * pherBoost;

      // Heading alignment: soft bias toward the persistent exploration heading
      // (this.theta, maintained by #updateWanderHeading).  Uses the dot product
      // so alignment decays smoothly as the candidate direction diverges from
      // theta.  Only applied to the food channel during free search so it does
      // not fight goal-directed home-pheromone steering.
      let headingContrib = 0;
      if (channel === 'food') {
        const headingBias = config.headingBias ?? 0.20;
        const dirLen = Math.hypot(DIRS[d][0], DIRS[d][1]);
        const dot = (DIRS[d][0] / dirLen) * Math.cos(this.theta)
                  + (DIRS[d][1] / dirLen) * Math.sin(this.theta);
        headingContrib = Math.max(0, dot) * headingBias;
      }

      const weight = Math.max(0, boostedPherContribution + momentum + tieBias + noise + reacquireBias + trailAttraction + headingContrib - reversePenalty - dangerPenalty - crowdingPenalty);
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
    // Update trail re-acquisition memory: remember direction while on trail
    const movedTrailValue = field[world.index(tx, ty)] ?? 0;
    if (channel === 'food') {
      if (movedTrailValue > 0.1) {
        this._lastTrailDir = chosenDir;
        this._ticksSinceOnTrail = 0;
      } else {
        this._ticksSinceOnTrail += 1;
      }
    }

    const prevX = this.x;
    const prevY = this.y;
    this.x = tx;
    this.y = ty;
    this.dir = chosenDir;
    // Keep theta consistent with the direction actually taken so the correlated
    // walk in #updateWanderHeading builds on real movement, not desired heading.
    this.theta = Math.atan2(DIRS[this.dir][1], DIRS[this.dir][0]);
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
    if (context.entrance) {
      return this.#moveThroughEntranceShaft(
        world,
        context.entrance,
        this.#getNestEntryTargetY(world, context.entrance),
        rng,
      );
    }
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
      return this.#moveThroughEntranceShaft(
        world,
        context.entrance,
        this.#getNestEntryTargetY(world, context.entrance),
        rng,
      );
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

    // Feed the queen if she is hungry or her health is declining
    const queen = colony.queen;
    const queenNeedsFood = queen.hunger < queen.hungerMax * 0.25
      || queen.health < queen.healthMax * 0.6;
    if (queen?.alive && !this.carrying?.type
        && queenNeedsFood
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

    // Tend brood: move toward the brood area.
    // Each nurse gets a stable per-ant offset so they spread across the chamber
    // rather than all converging on the same tile.
    if (colony.larvae.length > 0) {
      const idSeed = parseInt(this.id.replace(/\D/g, ''), 10) || 0;
      const offsetX = (idSeed % 7) - 3;            // -3 to +3
      const offsetY = (Math.floor(idSeed / 7) % 5) - 2;  // -2 to +2
      const broodX = Math.max(0, Math.min(world.width - 1, world.nestX + 4 + offsetX));
      const broodY = Math.max(world.nestY + 2, Math.min(world.height - 1, world.nestY + 5 + offsetY));
      const distToBrood = Math.hypot(this.x - broodX, this.y - broodY);
      if (distToBrood > 3) {
        this.state = 'NURSE_TEND_BROOD';
        return this.#moveToward(world, broodX, broodY, rng);
      }
    }

    // Default: wander nest exploring.
    // Phase 3: nurse idle wander uses the correlated random walk too.
    this.#updateWanderHeading(rng, world, config);
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
      return this.#moveThroughEntranceShaft(
        world,
        context.entrance,
        this.#getNestEntryTargetY(world, context.entrance),
        rng,
      );
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

    // Wander near current position in tunnels.
    // Phase 3: digger at-front wander uses the correlated random walk too.
    this.#updateWanderHeading(rng, world, config);
    return this.#moveByPheromone(world, rng, config, 'food', context.entrance);
  }

  #getNestEntryTargetY(world, entrance) {
    const baseX = entrance?.x ?? this.x;
    const baseY = entrance?.y ?? world.entranceY ?? world.nestY;
    const maxDepthSearch = 6;

    // The target is always below the ant's current position — if the ant is
    // already in the shaft (below entrance.y), aim deeper instead of pulling
    // it back up to the entrance mouth. This keeps ants moving toward the
    // chamber when the entrance sits above the surface/underground boundary.
    const searchFrom = Math.max(baseY, this.y);
    for (let dy = 1; dy <= maxDepthSearch; dy += 1) {
      const candidateY = Math.min(world.height - 1, searchFrom + dy);
      if (world.isPassable(baseX, candidateY)) {
        return candidateY;
      }
    }
    return searchFrom;
  }

  #moveThroughEntranceShaft(world, entrance, targetY, rng) {
    if (!entrance) return false;
    const shaftHalfWidth = Math.max(1, (entrance.radius ?? 1) + 1);
    return this.#moveToward(world, entrance.x, targetY, rng, {
      entranceX: entrance.x,
      entranceY: entrance.y,
      shaftHalfWidth,
    });
  }

  #isEntranceTransitState() {
    return this.state === 'RETURN_HOME'
      || this.state === 'RETURN_NEST_TO_EAT'
      || this.state === 'RETURN_TO_NEST_HEAL'
      || this.state === 'EXIT_NEST'
      || this.state === 'STORE_FOOD_IN_NEST'
      || this.state === 'HAUL_DIRT'
      || this.state === 'NURSE_ENTER_NEST'
      || this.state === 'DIG_ENTER_NEST'
      || this.state === 'RETURN_NEST_FOR_QUEEN_FOOD';
  }

  #violatesEntranceCorridor(nextX, nextY, entrance) {
    if (!entrance) return false;
    if (!(nextY > entrance.y)) return false;

    const shaftHalfWidth = Math.max(1, (entrance.radius ?? 1) + 1);
    const currentDx = Math.abs(this.x - entrance.x);
    const nextDx = Math.abs(nextX - entrance.x);
    if (nextDx <= shaftHalfWidth) return false;

    // Never allow a descent from mouth-or-above into the lower band unless
    // the ant is already aligned with the shaft corridor.
    if (this.y <= entrance.y) return true;

    const movingTowardCorridor = nextDx < currentDx;
    const climbingTowardMouth = nextY < this.y;
    return !movingTowardCorridor && !climbingTowardMouth;
  }

  #distanceToEntrance(colony) {
    const entrance = colony?.nearestEntrance?.(this.x, this.y);
    if (!entrance) return 0;
    return Math.hypot(this.x - entrance.x, this.y - entrance.y);
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
    // Disable crowding penalty near the entrance — entrances are *supposed*
    // to be crowded (they're chokepoints).  The penalty should only apply on
    // open trails and foraging areas to spread ants out.
    const entrance = colony.nearestEntrance(x, y);
    if (entrance) {
      const distToEntrance = Math.hypot(x - entrance.x, y - entrance.y);
      if (distToEntrance < 4) return 0;
    }

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
    // Keep crowding avoidance soft and bounded. A hard quadratic penalty
    // can zero out all pheromone weights near dense nest traffic, causing
    // ants to ignore trails and mill around the entrance basin.
    const onTileCount = colony.countAntsAt(x, y);
    const localPenalty = Math.max(0, onTileCount - 1) * 0.35;
    const nearbyPenalty = nearbyAntCount * 0.05;
    return Math.min(3, localPenalty + nearbyPenalty);
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
      const storeNearlyFull = colony.foodStored >= storeTarget;
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
    // Only workers eat from nest stores.
    if (this.role !== 'worker') return false;

    // Cooldown: prevent ants from eating every single tick in the nest.
    // 30 ticks between meals unless critically starving.
    const eatCooldown = config.nestEatCooldownTicks ?? 30;
    const ticksSinceLastEat = this.stepCounter - this._lastNestEatTick;
    const critical = this.#isCriticalHealth();
    if (!critical && ticksSinceLastEat < eatCooldown) return false;

    // Hunger-based eating: eat when hungry, not when health dips.
    // Health regenerates passively when hunger > 65%, so feeding hunger
    // is the correct lever.  Critical-health ants still get priority.
    const hungry = this.hunger < this.hungerMax * 0.35;
    if (!hungry && !critical) return false;

    const requested = critical
      ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition)
      : config.workerEatNutrition;
    // Clamp intake to remaining hunger capacity so we don't waste food.
    // If hunger is already full there is nothing to absorb — passive regen
    // (hunger > 65%) will restore health without consuming colony stores.
    const hungerCapacity = Math.max(0, this.hungerMax - this.hunger);
    if (hungerCapacity <= 0) return false;
    const requestedIntake = Math.max(1, Math.min(requested, hungerCapacity));

    const consumed = colony.consumeFromStore(requestedIntake);
    if (consumed <= 0) return false;

    this._lastNestEatTick = this.stepCounter;
    this.hunger = Math.min(this.hungerMax, this.hunger + consumed);
    const healthGain = consumed * (config.healthEatRecoveryRate ?? 0);
    // Recovery bonus only applies when the ant is actually starving, not when
    // health is low for other reasons (old age, combat damage, etc.).
    const isStarving = this.hunger < this.hungerMax * 0.1;
    this.health = Math.min(this.healthMax, this.health + healthGain + (critical && isStarving ? config.starvationRecoveryHealth : 0));
    return true;
  }

  #tryEatNearbyPellet(colony, config) {
    if (!this.#isLowHealth()) return false;
    const pellet = colony.findAvailablePelletAt(this.x, this.y);
    if (!pellet) return false;
    this.#consumePelletForHealthThenCarry(colony, pellet, config);
    return true;
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
        pickupDistance: this.#distanceToEntrance(colony),
      };
      this.carryingType = 'food';
    }
  }

  #consumePelletForHealth(colony, pellet, config) {
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
    colony.removePelletById(pellet.id);
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

  #moveToward(world, tx, ty, rng, constraints = null) {
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
      if (constraints) {
        const entranceX = constraints.entranceX;
        const entranceY = constraints.entranceY;
        const hasCorridor = Number.isFinite(entranceX)
          && Number.isFinite(entranceY)
          && Number.isFinite(constraints.shaftHalfWidth);
        if (hasCorridor && this.#violatesEntranceCorridor(nx, ny, {
          x: entranceX,
          y: entranceY,
          radius: Math.max(0, constraints.shaftHalfWidth - 1),
        })) {
          continue;
        }
      }
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
      this.theta = Math.atan2(DIRS[this.dir][1], DIRS[this.dir][0]);
      if (colony && (prevX !== this.x || prevY !== this.y)) {
        colony.moveAntInGrid(prevX, prevY, this.x, this.y);
      }
      return true;
    }

    return false;
  }

  // Convert a continuous heading angle (radians) to the nearest of the 8 DIRS.
  #thetaToDir(theta) {
    let bestDir = 0;
    let bestDot = -Infinity;
    const cx = Math.cos(theta);
    const cy = Math.sin(theta);
    for (let i = 0; i < DIRS.length; i++) {
      const d = DIRS[i];
      const len = Math.hypot(d[0], d[1]);
      const dot = (d[0] / len) * cx + (d[1] / len) * cy;
      if (dot > bestDot) { bestDot = dot; bestDir = i; }
    }
    return bestDir;
  }

  // Phase 4: smooth danger avoidance as a turn term.
  //
  // Samples world.danger at +/-45° off theta at `dangerTurnLookahead` tiles
  // and returns a signed turn proportional to the lateral gradient.  The
  // ant smoothly curves away from rising danger before the discrete
  // dangerPenalty in #moveByPheromone has to scatter it at the boundary.
  //
  // Returns 0 when both sides read negligible danger so we don't burn turn
  // budget on noise far from any hazard.
  #computeDangerTurn(world, config) {
    const lookahead = config.dangerTurnLookahead ?? 2;
    const gain      = config.dangerTurnGain      ?? 0.40;
    const sideAngle = Math.PI / 4;

    const sampleAt = (angle) => {
      const tx = Math.round(this.x + Math.cos(angle) * lookahead);
      const ty = Math.round(this.y + Math.sin(angle) * lookahead);
      if (!world.inBounds(tx, ty)) return 0;
      return world.danger[world.index(tx, ty)] || 0;
    };

    const leftDanger  = sampleAt(this.theta + sideAngle);
    const rightDanger = sampleAt(this.theta - sideAngle);

    if (leftDanger < 1e-6 && rightDanger < 1e-6) return 0;

    // Positive gradient → more danger on the left → turn right (negative).
    // Normalize by (sum + epsilon) so the term saturates instead of growing
    // unboundedly with strong fields; the outer clamp finishes the job.
    const gradient = (leftDanger - rightDanger) / (leftDanger + rightDanger + 1e-6);
    return -gradient * gain;
  }

  // Phase 2: smooth obstacle avoidance as a turn term.
  //
  // Probes three points at `obstacleLookahead` tiles ahead of the persistent
  // heading (theta): straight-ahead, +45°, -45°.  Returns a signed turn
  // (radians) that nudges theta away from impassable tiles.  Magnitude is
  // controlled by `obstacleTurnGain`.  The result is small enough to compose
  // additively with the meander/noise terms; the outer clamp keeps total
  // turn-per-tick bounded.
  //
  // This catches walls *before* the ant moves into them so the correlated
  // walk curves smoothly along corridors and around obstacles, rather than
  // relying solely on #moveByPheromone's wall-passability rejection (which
  // produces abrupt scattering when the ant is shoved against a wall).
  #computeObstacleTurn(world, config) {
    const lookahead = config.obstacleLookahead ?? 2;
    const sideAngle = Math.PI / 4;
    const gain      = config.obstacleTurnGain ?? 0.30;

    const blockedAt = (angle) => {
      const tx = Math.round(this.x + Math.cos(angle) * lookahead);
      const ty = Math.round(this.y + Math.sin(angle) * lookahead);
      return !world.isPassable(tx, ty);
    };

    const aheadBlocked = blockedAt(this.theta);
    const leftBlocked  = blockedAt(this.theta + sideAngle);
    const rightBlocked = blockedAt(this.theta - sideAngle);

    if (aheadBlocked) {
      // Strong avoidance when wall is straight ahead — turn whichever side
      // is open.  When both sides are open, break the tie by continuing the
      // current rotation (prevTurn sign) so we don't oscillate.  When both
      // are blocked we leave the turn at zero and let the outer pipeline
      // (meander noise + #moveByPheromone wall rejection) handle the dead
      // end without locking us into a hard turn that just hits another wall.
      if (!leftBlocked && rightBlocked)        return +gain * 1.5;
      if (!rightBlocked && leftBlocked)        return -gain * 1.5;
      if (!leftBlocked && !rightBlocked)       return (this.prevTurn >= 0 ? +1 : -1) * gain * 1.5;
      return 0;
    }
    if (leftBlocked  && !rightBlocked) return -gain;
    if (rightBlocked && !leftBlocked) return +gain;
    return 0;
  }

  // Correlated random walk: advances this.theta by a bounded, smoothed turn.
  // this.dir is intentionally left unchanged here — see the NOTE below.
  // Called from every wandering context (worker FORAGE_SEARCH, soldier patrol
  // food-channel fallback, nurse idle wander, digger at-front wander).
  // Goal-directed states (#moveToward, return-to-nest, deliver-food, etc.)
  // deliberately skip the wander update so theta does not drift while the
  // ant has an explicit destination.
  //
  // Turn model (per tick):
  //   meanderTurn  = turnSign * meanderAmplitude * U(0.4, 1.0)
  //   noiseTurn    = sigma * N(0, 1)
  //   obstacleTurn = #computeObstacleTurn(world, config)   (Phase 2)
  //   dangerTurn   = #computeDangerTurn(world, config)     (Phase 4)
  //   rawTurn      = rho * prevTurn + noiseTurn + meanderTurn + obstacleTurn + dangerTurn
  //   clampedTurn  = clamp(rawTurn, -maxTurnRate, maxTurnRate)
  //   theta       += clampedTurn
  //
  // pheromoneTurn and goalTurn from the spec are intentionally NOT added as
  // turn terms here.  They are handled elsewhere: the food/home pheromone
  // gradient steers via the weighted-direction selection in #moveByPheromone
  // (where headingContrib also lives), and explicit goal-directed movement
  // (return-to-nest, go-to-food) is handled by #moveToward, which redirects
  // motion outright rather than nudging the wander heading.  Composing all
  // four into a single turn-sum would double-count the goal/pheromone signal
  // and fight #moveByPheromone's selection.
  #updateWanderHeading(rng, world, config) {
    // NOTE: spec defaults (sigma=0.35, meanderAmp=0.25) are calibrated for a
    // continuous-position system moving a fraction of a tile per tick.  In our
    // discrete 1-tile/tick system those values cause the ant to turn ~30°/tick
    // and trace tight circles.  Defaults here are scaled ~7× smaller so that
    // direction changes occur roughly every 5-10 ticks, producing organic arcs.
    const rho           = config.walkRho           ?? 0.75;
    const sigma         = config.walkSigma         ?? 0.05;
    const maxTurnRate   = config.walkMaxTurnRate   ?? 0.45;
    const meanderAmp    = config.meanderAmplitude  ?? 0.05;
    // pTurnSignFlip: probability the sign PERSISTS this tick (no flip).
    const pPersist      = config.pTurnSignFlip     ?? 0.85;

    if (rng.chance(1 - pPersist)) this.turnSign *= -1;

    const meanderTurn  = this.turnSign * meanderAmp * rng.range(0.4, 1.0);
    const noiseTurn    = sigma * gaussianRandom(rng);
    const obstacleTurn = world ? this.#computeObstacleTurn(world, config) : 0;
    const dangerTurn   = world ? this.#computeDangerTurn(world, config)   : 0;
    const rawTurn      = rho * this.prevTurn + noiseTurn + meanderTurn + obstacleTurn + dangerTurn;
    const clamped      = Math.max(-maxTurnRate, Math.min(maxTurnRate, rawTurn));

    this.prevTurn = clamped;
    this.theta   += clamped;
    // NOTE: this.dir is intentionally NOT updated here.  Keeping this.dir on
    // the actual last-moved direction ensures that (a) the momentum bias in
    // #moveByPheromone reflects where the ant really came from, and (b) the
    // reversal penalty targets the true reverse of that direction rather than
    // the wander heading's opposite.  Theta steers via the headingBias term
    // added to #moveByPheromone's weight calculation instead.
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
