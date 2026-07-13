/*
    Ant behavior state machine and movement simulation.

    Each ant maintains a deterministic FSM with states like FORAGE_SEARCH,
    RETURN_HOME, DIG, NURSE, etc. Every tick, an ant:
    1. Senses the world (location, nearby food, pheromones, entrance)
    2. Chooses behavior and movement, including pre-movement hazards
    3. Applies post-movement hazards, fallback movement, and vital drains

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
import * as roles from './ant/roles.js';
import * as decisions from './ant/decisions.js';
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

  // Deterministic per-ant offset (-15..+15) on the surface-search miss
  // threshold, derived from the id so it survives save/load. Anything derived
  // from the id must be recomputed wherever the id is (re)assigned — see
  // Colony.fromSerialized, which restores saved ids over constructor-random ones.
  static missThresholdOffsetFromId(id) {
    const antIdNumeric = Number.parseInt(String(id ?? '').slice(4), 10) || 0;
    return (antIdNumeric % 31) - 15;
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
    this.surfaceSearchMissThresholdOffsetTicks = Ant.missThresholdOffsetFromId(this.id);
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

    const context = this.#sensePhase(world, colony, config);
    const decision = this.#choosePhase(world, colony, rng, config, context);
    if (decision.halted) return;

    this.#applyPhase(world, colony, rng, config, context, decision.didMove);
  }

  /**
   * Prepares all local state needed by the decision phase.
   *
   * Keep this phase free of random draws: its output is consumed by the later
   * phases without changing the established replay order.
   */
  #sensePhase(world, colony, config) {
    this._currentColony = colony;

    if (this.carrying?.type === 'food' || this.carrying?.type === 'queen-food') {
      this.carryingType = 'food';
    } else if (this.carryingType === 'food') {
      this.carryingType = 'none';
    }

    return this.#senseLocalContext(world, colony, config);
  }

  /**
   * Resolves pre-movement hazards, local actions, and the movement decision.
   */
  #choosePhase(world, colony, rng, config, context) {
    if (this.#resolveHazard(world, colony, rng, config, context.idx)) {
      return { halted: true, didMove: false };
    }

    this.#applyPreMoveDecisions(colony, rng, config, context);

    return {
      halted: false,
      didMove: this.#decideAndMove(world, colony, rng, config, context),
    };
  }

  /**
   * Finalizes a chosen action with post-movement safety checks and vitals.
   */
  #applyPhase(world, colony, rng, config, context, didMove) {
    const currentIdx = world.index(this.x, this.y);
    if (currentIdx !== context.idx && this.#resolveHazard(world, colony, rng, config, currentIdx)) return;

    const moved = this.#applyFallbackMovement(world, colony, rng, config, context.entrance, didMove);
    // Re-derive in-nest status from the post-movement position so the
    // carry-hunger surcharge follows whether the ant is currently in transit,
    // not whether it started the tick underground.
    const inNestAfter = isInNestSpatial(world, this.x, this.y)
      || (world.isUndergroundTile(this.x, this.y)
        && (context.entrance ? this.y > context.entrance.y : false));
    vitals.applyVitals(this, colony, config, context.dt, moved, inNestAfter);
  }

  /**
   * Collects frequently reused per-tick local context.
   *
   * Returns derived values used by decision and movement phases so downstream
   * logic stays deterministic and avoids recomputing index/entrance lookups.
   */
  #senseLocalContext(world, colony, config) {
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

    // Wander is the correlated random walk in #updateWanderHeading; the old
    // memoryless random-kick (the removed randomTurnChance knob) is intentionally
    // not reinstated here.
  }

  /**
   * Chooses movement intent and executes one step when possible.
   *
   * Encodes worker foraging/return heuristics and pheromone-driven steering.
   * Returns whether movement occurred this tick.
   */
  #decideAndMove(world, colony, rng, config, context) {
    if (this.role === 'soldier') {
      return decisions.soldierPatrol(this, world, colony, rng, config, context);
    }

    if (this.role !== 'worker') return false;

    if (roles.isQueenFoodCourier(this, colony)) {
      return roles.runQueenCourierBehavior(this, world, colony, rng, config, context);
    }

    // Carrying checks must come before exit-nest: ants with cargo handle it first.
    if (this.carrying?.type === 'dirt') {
      return decisions.haulDirt(this, world, colony, rng, config, context);
    }

    if (this.carrying?.type === 'food') {
      return decisions.carryFood(this, world, colony, rng, config, context);
    }

    // Foragers exit the nest when not carrying anything.
    if (this.workFocus === 'forage' && context.inNest && context.entrance) {
      return decisions.foragerExitNest(this, world, colony, rng, config, context);
    }

    if (vitals.isLowHealth(this) && !context.inNest) {
      this.state = 'RETURN_TO_NEST_HEAL';
      if (context.entrance) {
        return steering.moveThroughEntranceShaft(
          this,
          world,
          context.entrance,
          navigation.getNestEntryTargetY(this, world, context.entrance),
          rng,
        );
      }
      return steering.moveByPheromone(this, world, rng, config, 'home', context.entrance);
    }

    if (this.workFocus === 'nurse' && !vitals.needsForage(this, colony)) {
      return roles.runNurseBehavior(this, world, colony, rng, config, context);
    }

    if (this.workFocus === 'dig' && !vitals.needsForage(this, colony)) {
      return roles.runDiggerBehavior(this, world, colony, rng, config, context);
    }

    if (!vitals.needsForage(this, colony)) {
      return false;
    }

    if (vitals.isCriticalHealth(this)) {
      this.state = 'RETURN_TO_NEST_HEAL';
      if (context.entrance) {
        return steering.moveThroughEntranceShaft(this, world, context.entrance, context.entrance.y, rng);
      }
      return false;
    }

    // Non-terminal: may exit the nest, or fall through to pellet search below.
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
      return decisions.pickUpVisiblePellet(this, world, colony, rng, config, context, visible);
    }

    const onPellet = colony.findAvailablePelletAt(this.x, this.y);
    if (onPellet) {
      return decisions.pickUpPelletHere(this, world, colony, rng, config, context, onPellet);
    }

    // Non-terminal: may head back to the nest to eat, or fall through to forage.
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
        return steering.moveThroughEntranceShaft(
          this,
          world,
          context.entrance,
          navigation.getNestEntryTargetY(this, world, context.entrance),
          rng,
        );
      }
    }

    return decisions.forageSearch(this, world, colony, rng, config, context);
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
      world.depositDanger(idx, config.dangerDeposit, config.pheromoneMaxClamp);
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
}
