/*
    Worker/soldier movement-decision handlers — the terminal branches of the
    #decideAndMove dispatcher, extracted from ant.js (decideAndMove split, see
    docs/ant-decomposition-plan.md).

    Each function is one self-contained behavior the dispatcher commits to:
    soldier patrol, dirt hauling, food return, nest exit, pellet pickup, and the
    default forage-search. #decideAndMove keeps the guard ladder and the two
    non-terminal (fall-through) blocks; everything terminal lives here.

    Pure relocation of branch bodies — the dispatcher calls them at the exact
    point their code previously ran, so the per-tick rng.* order is unchanged
    (verified by the replay-hash test).
*/

import * as steering from './steering.js';
import * as navigation from './navigation.js';
import * as vitals from './vitals.js';

export function soldierPatrol(ant, world, colony, rng, config, context) {
  let didMove = false;
  ant.state = 'PATROL';
  // Soldiers patrol the nest perimeter, depositing home pheromone near hazards
  if (context.entrance) {
    const distToNest = Math.hypot(ant.x - context.entrance.x, ant.y - context.entrance.y);
    const patrolRadius = config.nearEntranceScatterRadius + 5;
    if (distToNest > patrolRadius) {
      didMove = steering.moveToward(ant, world, context.entrance.x, context.entrance.y, rng);
    } else {
      didMove = steering.moveByPheromone(ant, world, rng, config, 'home', context.entrance, colony);
    }
  }
  if (!didMove) {
    // Phase 3: soldier food-channel fallback is a wandering context.
    // Advance theta so headingContrib in #moveByPheromone steers it
    // with the same smoothness as worker FORAGE_SEARCH.
    steering.updateWanderHeading(ant, rng, world, config);
    didMove = steering.moveByPheromone(ant, world, rng, config, 'food', context.entrance, colony);
  }
  // Soldiers deposit home pheromone while patrolling
  if (didMove && ant.stepCounter % config.homeDepositIntervalTicks === 0 && config.enablePheromones !== false) {
    world.depositToHome(context.idx, config.depositHome * 0.5, config.pheromoneMaxClamp);
  }
  return didMove;
}

export function haulDirt(ant, world, colony, rng, config, context) {
  let didMove = false;
  ant.state = 'HAUL_DIRT';
  if (context.entrance) {
    const entranceRadius = Math.max(1, context.entrance.radius ?? 1);
    const nearEntranceX = Math.abs(ant.x - context.entrance.x) <= entranceRadius + 1;
    const reachedSurface = ant.y <= context.entrance.y;

    if (reachedSurface && nearEntranceX) {
      colony.recordDirtDeposit(ant.carrying.amount ?? 1, context.entrance.x, context.entrance.y);
      ant.carrying = null;
      ant.carryingType = 'none';
      return didMove;
    }

    const targetY = context.inNest ? context.entrance.y - 1 : Math.min(ant.y, context.entrance.y - 1);
    if (world.isPassable(context.entrance.x, targetY)) {
      didMove = steering.moveThroughEntranceShaft(ant, world, context.entrance, targetY, rng);
    }
    if (!didMove) didMove = steering.moveThroughEntranceShaft(ant, world, context.entrance, context.entrance.y, rng);
    if (!didMove) didMove = steering.moveByPheromone(ant, world, rng, config, 'home', context.entrance);
    return didMove;
  }

  return steering.moveByPheromone(ant, world, rng, config, 'home', context.entrance);
}

export function carryFood(ant, world, colony, rng, config, context) {
  let didMove = false;
  ant.failedSurfaceFoodSearchTicks = 0;

  if (vitals.isLowHealth(ant)) {
    vitals.consumeCarriedFoodForHealth(ant, config);
    if (!ant.carrying?.type) {
      ant.state = 'EAT';
      return didMove;
    }
  }

  ant.state = 'RETURN_HOME';
  if (context.inNest) {
    const dropPoint = colony.findNestFoodDropPoint(context.entrance, ant.x, ant.y);
    if (dropPoint) {
      if (ant.x === dropPoint.x && ant.y === dropPoint.y) {
        colony.depositFoodFromAnt(ant, context.entrance, dropPoint);
        // Immediately transition to EXIT_NEST so the ant doesn't get pulled
        // back by home pheromone fallback logic. Stagger nest departures:
        // small random delay so ants don't all rush the entrance on the same
        // tick. The previous 5-20 tick window was long enough that hungry
        // waves serialized through the eat → idle → exit pipeline and clogged
        // the entrance.
        ant.state = 'EXIT_NEST';
        ant._nestDepartureDelay = 2 + rng.int(4);
        return didMove;
      }

      ant.state = 'STORE_FOOD_IN_NEST';
      didMove = steering.moveToward(ant, world, dropPoint.x, dropPoint.y, rng);
      if (!didMove) didMove = steering.moveByPheromone(ant, world, rng, config, 'home', context.entrance);
      return didMove;
    }

    // No storage tile available (nest not excavated enough yet).
    // Exit back to the surface so the ant doesn't freeze at the entrance boundary.
    ant.state = 'RETURN_HOME';
    if (context.entrance) {
      didMove = steering.moveThroughEntranceShaft(ant, world, context.entrance, context.entrance.y - 1, rng);
      if (didMove) return didMove;
    }
  }

  const distToNest = context.entrance ? Math.hypot(ant.x - context.entrance.x, ant.y - context.entrance.y) : 0;
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
  // Adaptive recruitment decay (config.adaptiveTrail): a carrier's trail-laying
  // strength starts high at pickup (seeded in pickUpPellet*, richer sources →
  // higher budget) and decays each tick on the way home. Ants that march
  // straight back from a rich live cluster lay a strong corridor; ants that
  // wander, or returned from a marginal/depleting source, lay almost nothing —
  // so trails to dead sources fade fast and the field consolidates onto the
  // clusters ants are actually still harvesting. Default off = identity factor.
  let recruitFactor = 1;
  if (config.adaptiveTrail) {
    ant._recruitBudget = (ant._recruitBudget ?? 0) * (config.recruitDecayPerStep ?? 0.97);
    recruitFactor = ant._recruitBudget;
  }
  // Never lay a food trail on an in-nest/underground tile (review bug #7): if a
  // carrier reaches here via the nest fall-through (no drop point + blocked
  // shaft), depositing here paints a ghost corridor in the tunnels that pulls
  // searchers at a spot no food was ever found. Food trails are a surface signal.
  if (config.enablePheromones !== false && !context.inNest && entranceFadeFraction > 0 && recruitFactor > 0) {
    world.depositToFood(
      context.idx,
      config.depositFood * trailScale * entranceFadeFraction * recruitFactor,
      config.pheromoneMaxClamp,
    );
  }

  // Follow the existing food trail back to the nest so all returners share
  // a single corridor instead of cutting their own diagonal shortcuts.
  // Only switch to direct shaft entry when right at the entrance mouth.
  const entranceShaftRadius = (context.entrance?.radius ?? 1) + 2;
  if (distToNest < entranceShaftRadius && context.entrance) {
    didMove = steering.moveThroughEntranceShaft(ant, 
      world,
      context.entrance,
      navigation.getNestEntryTargetY(ant,world, context.entrance),
      rng,
    );
  } else {
    didMove = steering.moveByPheromone(ant, world, rng, config, 'home', context.entrance, null, world.toFood);
    if (!didMove && context.entrance) {
      didMove = steering.moveThroughEntranceShaft(ant, world, context.entrance, context.entrance.y, rng);
    }
  }
  return didMove;
}

export function foragerExitNest(ant, world, colony, rng, config, context) {
  const returnHungerThreshold = Math.max(
    0,
    Math.min(1, config.surfaceReturnToNestHungerThreshold ?? 0.65),
  );
  const shouldContinueIntoNestForFood = !context.inNestInterior
    && colony.foodStored > 0
    && ant.hunger < ant.hungerMax * returnHungerThreshold;
  if (shouldContinueIntoNestForFood) {
    ant.state = 'RETURN_NEST_TO_EAT';
    return steering.moveThroughEntranceShaft(ant, 
      world,
      context.entrance,
      navigation.getNestEntryTargetY(ant,world, context.entrance),
      rng,
    );
  }

  // Stagger departures: after eating, wait a random delay before leaving
  // so ants don't all rush the entrance at once.
  ant.state = 'EXIT_NEST';
  if (ant._nestDepartureDelay > 0) {
    ant._nestDepartureDelay -= 1;
    return false;
  }
  const exitTargetY = context.entrance.y - 1;
  // Scatter exits along a wider band so foragers fan out instead of
  // clustering at the same few tiles.  Uses double the entrance radius
  // plus padding so ants emerge across an 8-10 tile front.
  const radius = Math.max(1, (context.entrance.radius ?? 1) * 2 + 2);
  const scatter = navigation.entranceColumnOffset(ant, radius);
  const scatteredX = context.entrance.x + scatter;
  if (world.isPassable(scatteredX, exitTargetY)) {
    return steering.moveToward(ant, world, scatteredX, exitTargetY, rng);
  }
  if (world.isPassable(context.entrance.x, exitTargetY)) {
    return steering.moveThroughEntranceShaft(ant, world, context.entrance, exitTargetY, rng);
  }
  return steering.moveThroughEntranceShaft(ant, world, context.entrance, context.entrance.y, rng);
}

export function pickUpVisiblePellet(ant, world, colony, rng, config, context, pellet) {
  let didMove = false;
  ant.failedSurfaceFoodSearchTicks = 0;
  if (ant.x === pellet.x && ant.y === pellet.y) {
    // In an abundant food source with health below 60%, eat a pellet
    // for personal health before picking up one to carry home.  This
    // keeps foragers alive on long trips and doesn't waste food since
    // the source is plentiful.
    const abundantFood = colony.countVisiblePellets(ant.x, ant.y, config.foodVisionRadius) >= 3;
    const needsPersonalFood = ant.health < ant.healthMax * 0.6;
    if (vitals.isLowHealth(ant)) {
      vitals.consumePelletForHealthThenCarry(ant,colony, pellet, config);
      ant.state = 'EAT';
    } else if (abundantFood && needsPersonalFood) {
      // Eat this pellet outright for health, then next tick pick up another to carry
      vitals.consumePelletForHealth(ant,colony, pellet, config);
      ant.state = 'EAT';
    } else {
      pellet.takenByAntId = ant.id;
      ant.carrying = {
        type: 'food',
        pelletId: pellet.id,
        pelletNutrition: pellet.nutrition,
        pickupDistance: navigation.distanceToEntrance(ant, colony),
      };
      ant.carryingType = 'food';
      // Seed adaptive recruitment budget: rich sources recruit harder.
      if (config.adaptiveTrail) {
        ant._recruitBudget = abundantFood ? (config.recruitRichBudget ?? 1.6) : 1;
      }
      colony.removePelletById(pellet.id);
      ant.state = 'PICKUP';
      navigation.aimThetaAtEntrance(ant, colony);
    }
  } else {
    ant.state = vitals.isLowHealth(ant) ? 'SEEK_FOOD_HEAL' : 'GO_TO_FOOD';
    didMove = steering.moveToward(ant, world, pellet.x, pellet.y, rng);
  }
  return didMove;
}

export function pickUpPelletHere(ant, world, colony, rng, config, context, pellet) {
  let didMove = false;
  ant.failedSurfaceFoodSearchTicks = 0;
  const abundantFoodHere = colony.countVisiblePellets(ant.x, ant.y, config.foodVisionRadius) >= 3;
  const needsFoodHere = ant.health < ant.healthMax * 0.6;
  if (vitals.isLowHealth(ant)) {
    vitals.consumePelletForHealthThenCarry(ant,colony, pellet, config);
    ant.state = 'EAT';
  } else if (abundantFoodHere && needsFoodHere) {
    vitals.consumePelletForHealth(ant,colony, pellet, config);
    ant.state = 'EAT';
  } else {
    pellet.takenByAntId = ant.id;
    ant.carrying = {
      type: 'food',
      pelletId: pellet.id,
      pelletNutrition: pellet.nutrition,
      pickupDistance: navigation.distanceToEntrance(ant, colony),
    };
    ant.carryingType = 'food';
    // Seed adaptive recruitment budget: rich sources recruit harder.
    if (config.adaptiveTrail) {
      ant._recruitBudget = abundantFoodHere ? (config.recruitRichBudget ?? 1.6) : 1;
    }
    colony.removePelletById(pellet.id);
    ant.state = 'PICKUP';
    navigation.aimThetaAtEntrance(ant, colony);
  }
  return didMove;
}

export function forageSearch(ant, world, colony, rng, config, context) {
  let didMove = false;
  ant.state = 'FORAGE_SEARCH';
  // Advance the persistent heading (ant.theta) via correlated random walk.
  // Skip the update when the ant is on a strong food trail — its theta
  // shouldn't keep drifting against pheromone steering, otherwise the
  // headingBias term injects sporadic course changes on a clear trail.
  const trailAtAnt = world.toFood[context.idx] ?? 0;
  const onClearTrail = trailAtAnt > (config.trailLockThreshold ?? 1.0);
  if (!onClearTrail) {
    steering.updateWanderHeading(ant, rng, world, config);
  }
  // Home pheromone is meant to be a *gradient toward the entrance*, not a
  // uniform background. If searching ants paint it everywhere they wander,
  // diffusion saturates the foraging area and the gradient flattens — which
  // (a) makes returning ants drift instead of commute, and (b) elevates the
  // food trail's contrast vs noise. Restrict deposition to a band around
  // the entrance so the field stays peaked there.
  const distToEntranceForDeposit = context.entrance
    ? Math.hypot(ant.x - context.entrance.x, ant.y - context.entrance.y)
    : 0;
  // Home deposit scales INVERSELY with distance from the entrance: full
  // strength at the mouth, zero at homeDepositMinDistance. Without the fade,
  // foragers walking the consolidated food corridor outward dump uniform
  // home pheromone along it, creating a ridge that PEAKS away from the
  // entrance — returners then climb that ridge backwards into the corridor.
  // The fade guarantees a strict gradient pointing toward the entrance.
  const homeFadeRadius = config.homeDepositMinDistance ?? 20;
  const homeDepositFraction = Math.max(0, 1 - distToEntranceForDeposit / homeFadeRadius);
  if (ant.stepCounter % config.homeDepositIntervalTicks === 0 && homeDepositFraction > 0.01 && config.enablePheromones !== false) {
    world.depositToHome(
      context.idx,
      config.depositHome * homeDepositFraction,
      config.pheromoneMaxClamp,
    );
  }

  const distFromEntrance = context.entrance
    ? Math.hypot(ant.x - context.entrance.x, ant.y - context.entrance.y)
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
    const awayX = ant.x - context.entrance.x;
    const awayY = ant.y - context.entrance.y;
    const awayLen = Math.max(1, Math.hypot(awayX, awayY));
    const pushDistance = 10 + rng.int(7);
    const jitterX = rng.int(5) - 2;
    const jitterY = rng.int(5) - 2;
    const ax = ant.x + Math.round((awayX / awayLen) * pushDistance) + jitterX;
    const ay = ant.y + Math.round((awayY / awayLen) * pushDistance) + jitterY;
    didMove = steering.moveToward(ant, world, ax, ay, rng);
  }
  if (!didMove) didMove = steering.moveByPheromone(ant, world, rng, config, 'food', context.entrance);
  return didMove;
}
