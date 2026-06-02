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
import * as vitals from './ant/vitals.js';
import * as navigation from './ant/navigation.js';
import * as steering from './ant/steering.js';
import { DIRS } from './ant/constants.js';

const DEBUG_ANT_FLOW_LOGS = false;


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
    vitals.applyVitals(this, colony, config, context.dt, didMove, inNestAfter);
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
      if (vitals.tryEatFromNest(this, colony, context.inNestInterior, config)) {
        this.state = 'EAT';
      }

      if (vitals.tryEatNearbyPellet(this, colony, config)) {
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
          didMove = steering.moveToward(this, world, context.entrance.x, context.entrance.y, rng);
        } else {
          didMove = steering.moveByPheromone(this, world, rng, config, 'home', context.entrance, colony);
        }
      }
      if (!didMove) {
        // Phase 3: soldier food-channel fallback is a wandering context.
        // Advance theta so headingContrib in #moveByPheromone steers it
        // with the same smoothness as worker FORAGE_SEARCH.
        steering.updateWanderHeading(this, rng, world, config);
        didMove = steering.moveByPheromone(this, world, rng, config, 'food', context.entrance, colony);
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
          didMove = steering.moveThroughEntranceShaft(this, world, context.entrance, targetY, rng);
        }
        if (!didMove) didMove = steering.moveThroughEntranceShaft(this, world, context.entrance, context.entrance.y, rng);
        if (!didMove) didMove = steering.moveByPheromone(this, world, rng, config, 'home', context.entrance);
        return didMove;
      }

      return steering.moveByPheromone(this, world, rng, config, 'home', context.entrance);
    }

    if (this.carrying?.type === 'food') {
      this.failedSurfaceFoodSearchTicks = 0;

      if (vitals.isLowHealth(this)) {
        vitals.consumeCarriedFoodForHealth(this, config);
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
          didMove = steering.moveToward(this, world, dropPoint.x, dropPoint.y, rng);
          if (!didMove) didMove = steering.moveByPheromone(this, world, rng, config, 'home', context.entrance);
          return didMove;
        }

        // No storage tile available (nest not excavated enough yet).
        // Exit back to the surface so the ant doesn't freeze at the entrance boundary.
        this.state = 'RETURN_HOME';
        if (context.entrance) {
          didMove = steering.moveThroughEntranceShaft(this, world, context.entrance, context.entrance.y - 1, rng);
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
        didMove = steering.moveThroughEntranceShaft(this, 
          world,
          context.entrance,
          navigation.getNestEntryTargetY(this,world, context.entrance),
          rng,
        );
      } else {
        didMove = steering.moveByPheromone(this, world, rng, config, 'home', context.entrance, null, world.toFood);
        if (!didMove && context.entrance) {
          didMove = steering.moveThroughEntranceShaft(this, world, context.entrance, context.entrance.y, rng);
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
        return steering.moveThroughEntranceShaft(this, 
          world,
          context.entrance,
          navigation.getNestEntryTargetY(this,world, context.entrance),
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
      const scatter = navigation.entranceColumnOffset(this, radius);
      const scatteredX = context.entrance.x + scatter;
      if (world.isPassable(scatteredX, exitTargetY)) {
        return steering.moveToward(this, world, scatteredX, exitTargetY, rng);
      }
      if (world.isPassable(context.entrance.x, exitTargetY)) {
        return steering.moveThroughEntranceShaft(this, world, context.entrance, exitTargetY, rng);
      }
      return steering.moveThroughEntranceShaft(this, world, context.entrance, context.entrance.y, rng);
    }

    if (vitals.isLowHealth(this) && !context.inNest) {
      this.state = 'RETURN_TO_NEST_HEAL';
      if (context.entrance) {
        return steering.moveThroughEntranceShaft(this, 
          world,
          context.entrance,
          navigation.getNestEntryTargetY(this,world, context.entrance),
          rng,
        );
      }
      return steering.moveByPheromone(this, world, rng, config, 'home', context.entrance);
    }

    if (this.workFocus === 'nurse' && !vitals.needsForage(this, colony)) {
      return this.#runNurseBehavior(world, colony, rng, config, context);
    }

    if (this.workFocus === 'dig' && !vitals.needsForage(this, colony)) {
      return this.#runDiggerBehavior(world, colony, rng, config, context);
    }

    if (!vitals.needsForage(this, colony)) {
      return didMove;
    }
    if (vitals.isCriticalHealth(this)) {
      this.state = 'RETURN_TO_NEST_HEAL';
      if (context.entrance) didMove = steering.moveThroughEntranceShaft(this, world, context.entrance, context.entrance.y, rng);
      return didMove;
    }

    if (context.inNest && context.entrance) {
      const distanceToEntrance = Math.hypot(this.x - context.entrance.x, this.y - context.entrance.y);
      if (distanceToEntrance > (context.entrance.radius ?? 1)) {
        this.state = 'EXIT_NEST';
        return steering.moveThroughEntranceShaft(this, world, context.entrance, context.entrance.y, rng);
      }

      this.state = 'EXIT_NEST';
      const exitTargetY = context.entrance.y - 1;
      if (world.isPassable(context.entrance.x, exitTargetY)) {
        return steering.moveThroughEntranceShaft(this, world, context.entrance, exitTargetY, rng);
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
        if (vitals.isLowHealth(this)) {
          vitals.consumePelletForHealthThenCarry(this,colony, visible, config);
          this.state = 'EAT';
        } else if (abundantFood && needsPersonalFood) {
          // Eat this pellet outright for health, then next tick pick up another to carry
          vitals.consumePelletForHealth(this,colony, visible, config);
          this.state = 'EAT';
        } else {
          visible.takenByAntId = this.id;
          this.carrying = {
            type: 'food',
            pelletId: visible.id,
            pelletNutrition: visible.nutrition,
            pickupDistance: navigation.distanceToEntrance(this, colony),
          };
          this.carryingType = 'food';
          colony.removePelletById(visible.id);
          this.state = 'PICKUP';
          navigation.aimThetaAtEntrance(this, colony);
        }
      } else {
        this.state = vitals.isLowHealth(this) ? 'SEEK_FOOD_HEAL' : 'GO_TO_FOOD';
        didMove = steering.moveToward(this, world, visible.x, visible.y, rng);
      }
      return didMove;
    }

    const onPellet = colony.findAvailablePelletAt(this.x, this.y);
    if (onPellet) {
      this.failedSurfaceFoodSearchTicks = 0;
      const abundantFoodHere = colony.countVisiblePellets(this.x, this.y, config.foodVisionRadius) >= 3;
      const needsFoodHere = this.health < this.healthMax * 0.6;
      if (vitals.isLowHealth(this)) {
        vitals.consumePelletForHealthThenCarry(this,colony, onPellet, config);
        this.state = 'EAT';
      } else if (abundantFoodHere && needsFoodHere) {
        vitals.consumePelletForHealth(this,colony, onPellet, config);
        this.state = 'EAT';
      } else {
        onPellet.takenByAntId = this.id;
        this.carrying = {
          type: 'food',
          pelletId: onPellet.id,
          pelletNutrition: onPellet.nutrition,
          pickupDistance: navigation.distanceToEntrance(this, colony),
        };
        this.carryingType = 'food';
        colony.removePelletById(onPellet.id);
        this.state = 'PICKUP';
        navigation.aimThetaAtEntrance(this, colony);
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
        return steering.moveThroughEntranceShaft(this, 
          world,
          context.entrance,
          navigation.getNestEntryTargetY(this,world, context.entrance),
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
      steering.updateWanderHeading(this, rng, world, config);
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
      didMove = steering.moveToward(this, world, ax, ay, rng);
    }
    if (!didMove) didMove = steering.moveByPheromone(this, world, rng, config, 'food', context.entrance);
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
      return steering.moveByPheromone(this, world, rng, config, 'home', entrance, colony);
    }
    if (!didMove) {
      return steering.moveByPheromone(this, world, rng, config, 'food', entrance, colony);
    }
    return didMove;
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
      return steering.moveToward(this, world, queen.x, queen.y, rng);
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
      if (visiblePellet) return steering.moveToward(this, world, visiblePellet.x, visiblePellet.y, rng);
      return steering.moveByPheromone(this, world, rng, config, 'food', context.entrance, colony);
    }

    this.state = 'RETURN_NEST_FOR_QUEEN_FOOD';
    if (context.entrance) {
      return steering.moveThroughEntranceShaft(this, 
        world,
        context.entrance,
        navigation.getNestEntryTargetY(this,world, context.entrance),
        rng,
      );
    }
    return steering.moveByPheromone(this, world, rng, config, 'home', context.entrance, colony);
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
      return steering.moveThroughEntranceShaft(this, 
        world,
        context.entrance,
        navigation.getNestEntryTargetY(this,world, context.entrance),
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
        return steering.moveToward(this, world, queen.x, queen.y, rng);
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
        return steering.moveToward(this, world, broodX, broodY, rng);
      }
    }

    // Default: wander nest exploring.
    // Phase 3: nurse idle wander uses the correlated random walk too.
    steering.updateWanderHeading(this, rng, world, config);
    return steering.moveByPheromone(this, world, rng, config, 'food', context.entrance);
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
      return steering.moveThroughEntranceShaft(this, 
        world,
        context.entrance,
        navigation.getNestEntryTargetY(this,world, context.entrance),
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
        return steering.moveToward(this, world, digTarget.x, digTarget.y, rng);
      }
      // At the front — wander nearby so DigSystem can assign us
      this.state = 'DIG_AT_FRONT';
    }

    // Wander near current position in tunnels.
    // Phase 3: digger at-front wander uses the correlated random walk too.
    steering.updateWanderHeading(this, rng, world, config);
    return steering.moveByPheromone(this, world, rng, config, 'food', context.entrance);
  }









}
