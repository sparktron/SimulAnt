/*
    Ant behavior state machine and movement simulation.

    Each ant maintains a deterministic FSM with states like FORAGE_SEARCH,
    RETURN_HOME, DIG, NURSE, etc. Every tick, an ant:
    1. Senses the world (location, nearby food, pheromones, entrance)
    2. Checks for hazards (water/enemies)
    3. Makes pre-movement decisions (eating, depositing)
    4. Decides movement intent and moves one tile
    5. Re-checks hazards at new location
    6. Applies vital drains (hunger, health)

    Key design patterns:
    - Uses seeded RNG for determinism (never Math.random())
    - Movement is discrete (1 tile/tick) with theta continuous for smooth steering
    - Pheromone steering combines correlated random walk + local field gradients
    - Worker roles (forage/dig/nurse) switch based on colony needs
    - Health/hunger drive behavior: low health → return to nest, starvation → eat
*/

import { TERRAIN } from './world.js';
import { isInNestSpatial } from './behavior/NestState.js';

const DEBUG_ANT_FLOW_LOGS = false;

const SENESCENCE_START_FRACTION = 0.8;

/*
    Box-Muller transform: produces Gaussian random samples from uniform distribution.

    Critical: Must use seeded RNG, never Math.random(), to preserve determinism.
    Used for ant heading/steering noise and behavior variance.
*/
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

  static getJobColor(state, workFocus, role = 'worker') {
    if (role === 'soldier') return '#9a5aff';  // Bright purple for soldiers

    switch (state) {
      // Foraging jobs - gold/yellow
      case 'FORAGE_SEARCH':
      case 'GO_TO_FOOD':
      case 'SEEK_FOOD_HEAL':
        return '#ffd700';

      // Returning home - cyan/light blue
      case 'RETURN_HOME':
      case 'RETURN_NEST_TO_EAT':
      case 'RETURN_TO_NEST_HEAL':
        return '#00d4ff';

      // Eating/feeding - green
      case 'EAT':
        return '#00ff00';

      // Hauling/storing - orange
      case 'HAUL_DIRT':
      case 'STORE_FOOD_IN_NEST':
      case 'PICKUP':
        return '#ff8c00';

      // Queen-related jobs - magenta/hot pink
      case 'FEED_QUEEN':
      case 'DELIVER_QUEEN_FOOD':
      case 'PICKUP_QUEEN_FOOD':
      case 'SEEK_QUEEN_FOOD':
        return '#ff1493';

      // Digging - red/brown
      case 'DIG':
      case 'FORCE_DIG':
        return '#d2691e';

      // Nursing - light green/mint
      case 'NURSE':
        return '#66ff99';

      // Leaving nest - light gray
      case 'EXIT_NEST':
        return '#d3d3d3';

      // Fallback/other - dark gray
      case 'IDLE':
      default:
        return '#808080';
    }
  }

  constructor(x, y, rng, role = 'worker') {
    this.id = `ant-${Math.floor(rng.range(0, 1e9))}`;
    this.x = x;
    this.y = y;
    // dir is an index into DIRS (0-7 for 8 cardinal+diagonal directions)
    this.dir = rng.int(DIRS.length);
    this.hungerMax = 100;
    this.healthMax = 100;
    // Start with varied hunger (20-100) to desynchronize threshold crossings
    // so the colony doesn't all starve/eat at the same tick
    this.hunger = 20 + rng.int(81);
    // Initial health ranges from 75%-100% for variance
    this.health = this.healthMax * (0.75 + rng.range(0, 0.25));
    // Hunger drain per sim-second. Lowered 30% from previous values
    // (worker idle 1.8→1.3, move 2.0→1.4; soldier idle 2.2→1.5,
    // move 4.5→3.0). With the half-pellet cap and 40-nutrition pellets
    // in place, the binding constraint is total consumption versus
    // forager throughput. Telemetry showed 84 ants demanding ~168
    // nutrition/sec against ~40/sec delivered; cutting demand to ~120
    // brings the colony into a recoverable range.
    this.hungerDrainRates = {
      idle: role === 'soldier' ? 1.5 : 1.3,
      move: role === 'soldier' ? 3.0 : 1.4,
      dig: 3.5,
      fight: 5.0,
    };
    this.state = role === 'soldier' ? 'PATROL' : 'FORAGE_SEARCH';
    this.carrying = null;
    this.carryingType = 'none';
    this.baseColor = Ant.getDefaultBaseColor(role);
    this.originalBaseColor = this.baseColor;
    this.jobColor = Ant.getJobColor(this.state, 'forage', role);
    this._cachedJobState = this.state;
    this._cachedJobWorkFocus = 'forage';
    this.alive = true;
    this.role = role;
    this.stepCounter = 0;
    // Age/lifespan system for natural mortality.
    //
    // Lifespan was 2400-3200 ticks (workers) / 1800-2400 (soldiers) — at
    // 30 ticks/sim-sec that's 60-107 sim-sec, which produced a sharp
    // old-age death wave: the entire founding cohort (all spawned at
    // age 0) hit senescence in lockstep at ~tick 3000, exactly when the
    // colony also hit its food-throughput ceiling. The compounded crash
    // killed every long-run save in telemetry.
    //
    // 2.5× longer lifespan (workers 6000-8000, soldiers 4500-6000) gives
    // the queen enough time to ramp up replacement births before the
    // first cohort ages out, and spreads same-cohort deaths across a
    // wider 800-1500 tick range thanks to the larger random spread.
    this.age = 0;
    this.maxAge = role === 'soldier' ? 4500 + rng.int(1500) : 6000 + rng.int(2000);
    // Per-ant aging rate jitter (v0.27.2): each ant ages slightly faster
    // or slower than the wall clock. 0.85–1.15 = ±15% spread on top of
    // the already-randomized maxAge, so effective-lifespan variance
    // compounds rather than just tracking spawn-time variance.
    // Critical for breaking the SECOND-generation cohort wave: the
    // founding-cohort stagger (v0.26.5) protects the colony for the
    // first cycle, but births that happen in the food-rich expansion
    // phase tend to cluster in a narrow window, and without aging
    // jitter they'd hit senescence together as gen-2 — repeating the
    // crash one cohort later.
    this.agingRate = 0.85 + rng.range(0, 0.30);
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
    // Initial scatter is a one-time push to disperse ants at simulation start.
    // Once an ant has cleared the scatter radius, this is set true and all
    // subsequent exits skip straight to pheromone-guided foraging.
    this._hasInitiallyScattered = false;
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
    // Re-derive in-nest status from the post-movement position so the
    // carry-hunger surcharge follows whether the ant is currently in transit,
    // not whether it started the tick underground.
    const inNestAfter = isInNestSpatial(world, this.x, this.y)
      || (world.isUndergroundTile(this.x, this.y)
        && (context.entrance ? this.y > context.entrance.y : false));
    this.#applyVitals(colony, config, context.dt, didMove, inNestAfter);
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
      if (didMove && this.stepCounter % config.homeDepositIntervalTicks === 0 && config.enablePheromones !== false) {
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
            // Immediately transition to EXIT_NEST so the ant doesn't get pulled
            // back by home pheromone fallback logic. Stagger nest departures:
            // small random delay so ants don't all rush the entrance on the same
            // tick. The previous 5-20 tick window was long enough that hungry
            // waves serialized through the eat → idle → exit pipeline and clogged
            // the entrance.
            this.state = 'EXIT_NEST';
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
      // Deposit scales up with distance from the nest so the gradient points
      // outward: strong near the food source, weak near the entrance.
      // Foragers following the gradient are naturally pulled toward food.
      const trailScale = Math.min(
        config.maxFoodTrailScale ?? 4.0,
        1 + distToNest * (config.foodTrailDistanceScale ?? 1.0) * 0.05,
      );
      // Fade IN the deposit over the first foodDepositMinDistance tiles, so
      // carriers don't build a pheromone hotspot at the entrance. Without
      // this, all returning ants funnel through the same few entrance tiles
      // and stack deposits there — creating a local maximum that pulls
      // searchers BACK to the nest instead of out to the food source.
      const foodFadeRadius = config.foodDepositMinDistance ?? 8;
      const entranceFadeFraction = foodFadeRadius > 0
        ? Math.min(1, Math.max(0, distToNest / foodFadeRadius))
        : 1;
      if (config.enablePheromones !== false && entranceFadeFraction > 0) {
        world.toFood[context.idx] = Math.min(
          config.pheromoneMaxClamp,
          world.toFood[context.idx] + config.depositFood * trailScale * entranceFadeFraction,
        );
      }

      // Follow the existing food trail back to the nest so all returners share
      // a single corridor instead of cutting their own diagonal shortcuts.
      // Only switch to direct shaft entry when right at the entrance mouth.
      const entranceShaftRadius = (context.entrance?.radius ?? 1) + 2;
      if (distToNest < entranceShaftRadius && context.entrance) {
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
      this.state = 'EXIT_NEST';
      if (this._nestDepartureDelay > 0) {
        this._nestDepartureDelay -= 1;
        return false;
      }
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
          this.#aimThetaAtEntrance(colony);
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
        this.#aimThetaAtEntrance(colony);
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
    // Skip the update when the ant is on a strong food trail — its theta
    // shouldn't keep drifting against pheromone steering, otherwise the
    // headingBias term injects sporadic course changes on a clear trail.
    const trailAtAnt = world.toFood[context.idx] ?? 0;
    const onClearTrail = trailAtAnt > (config.trailLockThreshold ?? 1.0);
    if (!onClearTrail) {
      this.#updateWanderHeading(rng, world, config);
    }
    // Home pheromone is meant to be a *gradient toward the entrance*, not a
    // uniform background. If searching ants paint it everywhere they wander,
    // diffusion saturates the foraging area and the gradient flattens — which
    // (a) makes returning ants drift instead of commute, and (b) elevates the
    // food trail's contrast vs noise. Restrict deposition to a band around
    // the entrance so the field stays peaked there.
    const distToEntranceForDeposit = context.entrance
      ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y)
      : 0;
    // Home deposit scales INVERSELY with distance from the entrance: full
    // strength at the mouth, zero at homeDepositMinDistance. Without the fade,
    // foragers walking the consolidated food corridor outward dump uniform
    // home pheromone along it, creating a ridge that PEAKS away from the
    // entrance — returners then climb that ridge backwards into the corridor.
    // The fade guarantees a strict gradient pointing toward the entrance.
    const homeFadeRadius = config.homeDepositMinDistance ?? 20;
    const homeDepositFraction = Math.max(0, 1 - distToEntranceForDeposit / homeFadeRadius);
    if (this.stepCounter % config.homeDepositIntervalTicks === 0 && homeDepositFraction > 0.01 && config.enablePheromones !== false) {
      world.toHome[context.idx] = Math.min(
        config.pheromoneMaxClamp,
        world.toHome[context.idx] + config.depositHome * homeDepositFraction,
      );
    }

    const distFromEntrance = context.entrance
      ? Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y)
      : 0;
    const innerScatterRadius = config.innerScatterRadius ?? 20;

    // Scatter push on every exit — needed to push ants past the entrance-local
    // food pheromone peak deposited by returners. The radius is kept small
    // (config default 6) so the push is only 1–2 steps and never causes the
    // long diagonal march the larger radius produced.
    const onFoodTrail = world.toFood[context.idx] > 0.5;
    const nearEntranceScatter = !context.inNest && context.entrance
      && (
        distFromEntrance < innerScatterRadius
        || (!onFoodTrail && distFromEntrance < (config.nearEntranceScatterRadius ?? 8))
      );
    if (nearEntranceScatter && context.entrance) {
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
      colony.recordDeath('hazard');
      return true;
    }

    if (config.enablePheromones !== false) {
      world.danger[idx] = Math.min(config.pheromoneMaxClamp, world.danger[idx] + config.dangerDeposit);
    }
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

  /*
      Updates ant vitals: age, hunger, health with work-based penalties and recovery.

      Health/hunger system:
      - Hunger drains from movement/carrying/fighting at configured rates
      - Starving (hunger <= 0) triggers rapid health loss (starvation penalty)
      - Health drains from work (movement, carrying) independently of hunger
      - Well-fed ants (hunger > 65%) passively regen health if healthy
      - Natural death: age (after maxAge * 0.8, senescence drains health)
      - Starvation death: when health reaches 0

      This creates emergent behavior:
      - Ants must balance work/exploration with returning to eat
      - Carrying food is taxing, so trips are naturally limited
      - Natural lifespan prevents ant bloat in stable conditions
  */
  #applyVitals(colony, config, dt, didMove, inNest) {
    // Increment age for natural lifespan tracking
    // Per-ant aging rate (set in constructor, ±15% jitter) advances age
    // unevenly so a synchronized birth cohort still spreads out its
    // deaths over the senescence window.
    this.age += this.agingRate ?? 1;

    const hungerDrain = didMove ? this.hungerDrainRates.move : this.hungerDrainRates.idle;
    if (this.role === 'soldier') {
      // Soldiers pay only the base move/idle hunger cost — no carry surcharge
      // (they don't haul) and no work-health drain.
      this.hunger = Math.max(0, this.hunger - hungerDrain * dt);
    } else {
      // Hunger mechanics with work penalties. Carry surcharge is for surface
      // transit only — moving a few tiles inside the nest to a drop point or
      // queen tile shouldn't pay the long-haul tax. Hauling dirt is the
      // exception: we want that to feel costly, so we keep the surcharge for
      // HAUL_DIRT regardless of location.
      const carrySurchargeApplies = !!this.carrying?.type && (this.state === 'HAUL_DIRT' || !inNest);
      const carryingHungerCost = carrySurchargeApplies ? (config.carryingHungerDrainRate ?? 0) : 0;
      const fightHungerCost = this.state === 'FIGHT' ? (config.fightingHungerDrainRate ?? 0) : 0;
      this.hunger = Math.max(0, this.hunger - (hungerDrain + carryingHungerCost + fightHungerCost) * dt);

      // Health degradation from work. Same location-aware gate as hunger: carry
      // drain only counts during surface transit (or dirt hauls).
      const healthWorkDrain = (didMove ? (config.healthWorkMoveDrainRate ?? 0) : (config.healthWorkIdleDrainRate ?? 0))
        + (carrySurchargeApplies ? (config.healthWorkCarryDrainRate ?? 0) : 0)
        + (this.state === 'FIGHT' ? (config.healthWorkFightDrainRate ?? 0) : 0);
      this.health = Math.max(0, this.health - healthWorkDrain * dt);
    }

    // Starvation damage, fed-state regen, and old-age decline are identical for
    // every caste — funnel both role paths through one helper so they can never
    // drift apart (a soldier-only or worker-only edit would otherwise diverge,
    // the exact failure mode seen in the engine-lifecycle rebuild paths).
    this.#applyStarvationRegenAging(config, dt);

    if (this.health <= 0) {
      this.alive = false;
      colony.recordDeath(this.#deathCause());
    }
  }

  /**
   * Caste-independent vitals: starvation damage, fed-state passive regen, and
   * old-age decline — applied in this fixed order for every ant.
   *
   * Passive regen threshold (hunger > 50%) sits below the post-meal hunger
   * level (eat at 35% + 25 = 60%) so workers heal between trips; anything
   * higher would block regen for the normal feed cycle. Senescent ants still
   * heal but at half rate, so age drain still wins and they fade out gradually
   * across the senescence window instead of collapsing mid-window.
   */
  #applyStarvationRegenAging(config, dt) {
    if (this.hunger <= 0) {
      this.health = Math.max(0, this.health - (config.healthDrainRate ?? 0) * dt);
    }

    if (this.hunger > this.hungerMax * 0.5 && this.health < this.healthMax) {
      const regenRate = Math.max(0, config.healthRegenRate ?? 0);
      const senescenceFactor = this.age > this.maxAge * SENESCENCE_START_FRACTION ? 0.5 : 1;
      this.health = Math.min(this.healthMax, this.health + regenRate * senescenceFactor * dt);
    }

    if (this.age > this.maxAge * SENESCENCE_START_FRACTION) {
      const ageFactor = (this.age - this.maxAge * SENESCENCE_START_FRACTION) / (this.maxAge * (1 - SENESCENCE_START_FRACTION));
      this.health = Math.max(0, this.health - ageFactor * 2 * dt);
    }
  }

  /**
   * Best-guess cause for the death that just occurred.
   *
   * Starvation if hunger has been driven to zero; oldAge if the ant is in
   * the senescence window (age > 80% of maxAge); otherwise "other" — which
   * covers work-damage attrition and edge cases.
   */
  #deathCause() {
    if (this.hunger <= 0) return 'starvation';
    if (this.age > this.maxAge * SENESCENCE_START_FRACTION) return 'oldAge';
    return 'other';
  }

  /*
      Moves ant by evaluating pheromone gradient + momentum + directional bias.

      Algorithm:
      1. Compute weight for each of 8 directions based on pheromone concentration
      2. Apply directional penalties (hard-block reverse, discourage back-diagonals)
      3. Add steering contribution from heading/meander (correlated random walk)
      4. Sample by weighted distribution to pick movement
      5. Returns true if ant moved, false if all neighbors are blocked

      Key insight: Combining pheromone strength (followAlpha/followBeta) with
      directional momentum prevents jitter and keeps trails stable. The threshold
      logic lets ants lock onto trails without constantly recomputing the gradient.
  */
  #moveByPheromone(world, rng, config, channel, entrance, colony, trailAttractionField = null) {
    if (!colony) colony = this._currentColony;
    const field = channel === 'home' ? world.toHome : world.toFood;
    const epsilon = 0.001;
    const reverseDir = (this.dir + 4) % DIRS.length;
    const homeScentWeight = this.#getHomeScentWeight(config, entrance);
    const enforceEntranceCorridor = this.#isEntranceTransitState() && !!entrance;

    // (Previous behavior: when carriers were on weak pheromone we bypassed the
    // weighted steering and ran a greedy descent toward the entrance. The
    // greedy step always picked the closest-distance neighbor, which produced
    // perfectly straight return paths even when natural wander would have been
    // realistic. With the gentler homeTieBiasScaleCarrying and restored
    // returnCarryNoiseScale, the weighted steering keeps carriers oriented
    // toward the entrance without erasing all per-step variance, so the
    // fallback is no longer needed.)

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
        ? Math.min(uncappedPherContribution, config.homeScentMaxContributionPerStep ?? 999)
        : uncappedPherContribution;
      // Angular distance from the ant's last-moved direction.  delta=0 forward,
      // 1 forward-45°, 2 sideways, 3 back-45°, 4 reverse.  Hard-block reverse so
      // ants never flip 180°; strongly discourage back-diagonals.  Net effect:
      // the candidate set is effectively forward, forward-45°, or sideways —
      // a smooth gait instead of pheromone-driven jitter.
      const delta = Math.min(
        (d - this.dir + DIRS.length) % DIRS.length,
        (this.dir - d + DIRS.length) % DIRS.length,
      );
      let directionalMult;
      if (delta === 0) directionalMult = 1.6;        // forward
      else if (delta === 1) directionalMult = 1.3;   // forward-45°
      else if (delta === 2) directionalMult = 0.5;   // sideways
      else if (delta === 3) directionalMult = 0.05;  // back-45°
      else directionalMult = 0;                      // reverse — forbidden
      const momentum = 0;
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
          // Boost the home goal-vector bias when carrying food so the nest
          // direction reliably beats momentum (0.3) even on a weakly-trailed
          // tile — otherwise carriers drift in their last wander direction.
          const carrying = this.carrying?.type === 'food';
          const scale = carrying
            ? (config.homeTieBiasScaleCarrying ?? 0.6)
            : (config.homeTieBiasScale ?? 0.05);
          tieBias = progress * scale;
        } else {
          // Normalize by step length (same pattern as home channel) so the
          // magnitude is ≈ ±scale regardless of how far from the nest the ant
          // is.  The old formula (neighborDist * scale) produced absolute values
          // of ~9+ at search distances, swamping headingBias (0.20) and
          // momentum (0.3) and making all 8 directions nearly equally weighted —
          // the correlated walk had no influence and ants appeared to bounce
          // randomly.  outwardProgress ≈ +1 stepping directly away from nest,
          // ≈ -1 stepping directly toward it.
          const antDist = Math.hypot(this.x - entrance.x, this.y - entrance.y) + 0.001;
          const stepLen = Math.hypot(DIRS[d][0], DIRS[d][1]);
          const outwardProgress = (neighborDist - antDist) / stepLen;
          tieBias = outwardProgress * (config.foodTieBiasScale ?? 0.18);
        }
      }

      // Reduce wander noise when the ant is already locked onto a trail so it
      // follows pheromone all the way to the source instead of drifting off.
      // Strong-trail noise is essentially zero so foragers walk a clean line
      // along the corridor instead of jittering off and on it every few ticks.
      const carryingFood = this.carrying?.type === 'food';
      const currentTrailValue = field[world.index(this.x, this.y)] ?? 0;
      const trailLockThreshold = config.trailLockThreshold ?? 1.0;
      const onClearTrail = !carryingFood && channel === 'food' && currentTrailValue > trailLockThreshold;
      const onWeakTrail = !carryingFood && channel === 'food' && currentTrailValue > 0.1;
      const noiseReduction = carryingFood ? (config.returnCarryNoiseScale ?? 0.15) : onClearTrail ? 0.0 : onWeakTrail ? 0.25 : 1.0;
      const pherBoost = carryingFood && channel === 'home' ? 2.0 : 1.0;  // 2x home pheromone boost

      // Trail re-acquisition: if this ant was on a trail recently but lost it,
      // bias toward the last known trail direction for a few ticks.
      let reacquireBias = 0;
      if (!onWeakTrail && channel === 'food' && this._ticksSinceOnTrail < 5 && this._lastTrailDir >= 0) {
        reacquireBias = d === this._lastTrailDir ? 0.4 : 0;
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

      // Trail corridor lock: when returning with food, multiply this candidate's
      // weight by a boost proportional to the food trail value on that tile.
      // Multiplicative so it scales with the dominant home-pheromone signal and
      // always tips the balance toward the existing corridor over a blank tile.
      let trailBoost = 1.0;
      if (trailAttractionField) {
        const tv = trailAttractionField[nidx] ?? 0;
        if (tv > 0.1) {
          trailBoost = 1.0 + Math.min(tv * (config.returnTrailBoostScale ?? 0.15), config.returnTrailBoostMax ?? 3.0);
        }
      }

      // Apply the directional multiplier to the steering signal so the gait
      // term overrides pheromone differences smaller than ~3×.  Reverse is
      // killed outright (mult=0); back-45° barely survives.  Penalties are
      // applied AFTER the multiplier so danger/reverse subtractions still bite.
      const steerSignal = (boostedPherContribution + tieBias + reacquireBias + headingContrib) * directionalMult * trailBoost;
      const weight = Math.max(0, steerSignal + noise - reversePenalty - dangerPenalty - crowdingPenalty);
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
    if (config.enablePheromones !== false) {
      world.toHome[idx] = Math.min(config.pheromoneMaxClamp, world.toHome[idx] + config.depositHome * 1.4);
    }

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

  #aimThetaAtEntrance(colony) {
    const entrance = colony?.nearestEntrance?.(this.x, this.y);
    if (!entrance) return;
    this.theta = Math.atan2(entrance.y - this.y, entrance.x - this.x);
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
    if (!entrance) return config.homeScentBaseWeight ?? 1.0;

    const distance = Math.hypot(this.x - entrance.x, this.y - entrance.y);
    const falloffStart = Math.max(0, config.homeScentFalloffStartDist ?? 10);
    const falloffEnd = Math.max(falloffStart + 0.0001, config.homeScentFalloffEndDist ?? 100);
    const minFalloff = Math.min(1, Math.max(0, config.homeScentMinFalloff ?? 0.1));
    const t = Math.min(1, Math.max(0, (distance - falloffStart) / (falloffEnd - falloffStart)));
    const distanceFalloff = 1 - (1 - minFalloff) * t;

    const returningToNest = this.carrying?.type === 'food'
      || this.state === 'RETURN_HOME'
      || this.state === 'RETURN_TO_NEST_HEAL'
      || this.state === 'RETURN_NEST_TO_EAT';
    const stateScale = returningToNest ? (config.homeScentReturnStateScale ?? 1.0) : (config.homeScentSearchStateScale ?? 0.3);

    // Boost scent weight when carrying food and close to entrance
    let proximityBoost = 1.0;
    if (this.carrying?.type === 'food' && distance < 60) {
      proximityBoost = 1 + (1 - distance / 60) * 3.0;  // up to 4x boost at entrance
    }

    return (config.homeScentBaseWeight ?? 1.0) * distanceFalloff * stateScale * proximityBoost;
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
    // Workers and soldiers eat from nest stores. Breeders do not — they exist
    // for caste-balance bookkeeping and have no active behavior loop.
    // Excluding soldiers (the earlier policy) guaranteed they starved within
    // ~30 sec, draining colony births with no return.
    if (this.role !== 'worker' && this.role !== 'soldier') return false;

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

    // Cap field-eating at half the pellet unless the ant is critical (<40%
    // health). Without this, a low-health forager consumes the full meal
    // ration (workerEatNutrition=25) from a typical 12-nutrition pellet,
    // delivering nothing. Capping at half guarantees the colony gets at
    // least half of every found pellet while still letting the forager
    // refuel enough to make the return trip.
    const critical = this.#isCriticalHealth();
    const requested = critical
      ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition ?? nutrition)
      : (config.workerEatNutrition ?? nutrition);
    const fieldCap = critical ? nutrition : nutrition / 2;
    const consumed = Math.min(nutrition, requested, fieldCap);
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

    // Same cap as #consumePelletForHealthThenCarry — never eat more than half
    // the cargo unless the carrier is in critical health. Workers between
    // 40–50% health were previously consuming entire pellets en route,
    // turning every foraging trip into a net-zero or net-negative delivery
    // for the colony.
    const critical = this.#isCriticalHealth();
    const requested = critical
      ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition)
      : (config.workerEatNutrition ?? available);
    const cargoCap = critical ? available : available / 2;
    const consumed = Math.min(available, requested, cargoCap);
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

  // Critical = "drop everything and eat right now." Threshold raised from 25%
  // so an ant in real trouble triggers emergency eating before it's seconds
  // from death (with the 25% floor, the override only fired after sustained
  // damage). Combined with the cooldown bypass in #tryEatFromNest, critical
  // ants can re-feed every tick until hunger is full or they're stable.
  #isCriticalHealth() {
    return this.health < this.healthMax * 0.4;
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
