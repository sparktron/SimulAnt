/*
  Ant role behaviors — extracted from ant.js (Phase 4 of the decomposition
  plan, see docs/ant-decomposition-plan.md).

  Per-role behavior loops dispatched from #decideAndMove: queen-food couriers,
  nurses (queen feeding + larval tending), and diggers (working dig fronts).
  These sit at the top of the dependency chain, calling steering + navigation
  primitives; nothing calls back into them except the dispatcher.

  Every behavior returns an explicit { moved, allowFallback } action result so
  completed local work cannot be mistaken for a failed movement attempt.
*/

import * as steering from './steering.js';
import * as navigation from './navigation.js';
import { movementAction, STAY_ACTION } from './action-result.js';

export function isQueenFoodCourier(ant, colony) {
  return colony.isQueenFoodCourier(ant.id);
}

export function runQueenCourierBehavior(ant, world, colony, rng, config, context) {
  const queen = colony.queen;
  if (!queen?.alive) {
    if (ant.carrying?.type === 'queen-food') ant.carrying.type = 'food';
    return STAY_ACTION;
  }

  if (ant.carrying?.type === 'queen-food') {
    const distanceToQueen = Math.hypot(ant.x - queen.x, ant.y - queen.y);
    if (distanceToQueen <= 1.5) {
      colony.feedQueen(ant.carrying.pelletNutrition, config);
      ant.carrying = null;
      ant.carryingType = 'none';
      ant.state = 'FEED_QUEEN';
      return STAY_ACTION;
    }

    ant.state = 'DELIVER_QUEEN_FOOD';
    return movementAction(steering.moveTowardNest(ant, world, colony, queen, rng));
  }

  if (context.inNest) {
    const pickupNutrition = colony.reserveQueenFoodRation(config.queenCourierPickupNutrition ?? config.queenEatNutrition ?? 6, config);
    if (pickupNutrition > 0) {
      ant.carrying = {
        type: 'queen-food',
        pelletId: null,
        pelletNutrition: pickupNutrition,
      };
      ant.carryingType = 'food';
      ant.state = 'PICKUP_QUEEN_FOOD';
      return STAY_ACTION;
    }

    ant.state = 'SEEK_QUEEN_FOOD';
    const visiblePellet = colony.findVisiblePellet(ant.x, ant.y, config.foodVisionRadius);
    if (visiblePellet) {
      return movementAction(steering.moveToward(ant, world, visiblePellet.x, visiblePellet.y, rng));
    }
    return movementAction(
      steering.moveByPheromone(ant, world, rng, config, 'food', context.entrance, colony),
    );
  }

  ant.state = 'RETURN_NEST_FOR_QUEEN_FOOD';
  if (context.entrance) {
    return movementAction(steering.moveThroughEntranceShaft(ant,
      world,
      context.entrance,
      navigation.getNestEntryTargetY(ant,world, context.entrance),
      rng,
    ));
  }
  return movementAction(
    steering.moveByPheromone(ant, world, rng, config, 'home', context.entrance, colony),
  );
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
export function runNurseBehavior(ant, world, colony, rng, config, context) {
  ant.state = 'NURSE';

  // Enter the nest if outside
  if (!context.inNest && context.entrance) {
    ant.state = 'NURSE_ENTER_NEST';
    return movementAction(steering.moveThroughEntranceShaft(ant,
      world,
      context.entrance,
      navigation.getNestEntryTargetY(ant,world, context.entrance),
      rng,
    ));
  }

  if (ant.carrying?.type === 'brood-food') {
    if (!Number.isInteger(ant.carrying.targetX) || !Number.isInteger(ant.carrying.targetY)) {
      const nearbyLarva = colony.findHungryLarva(ant.x, ant.y, config.nurseBroodSensingRadius);
      if (nearbyLarva) {
        ant.carrying.targetX = nearbyLarva.x;
        ant.carrying.targetY = nearbyLarva.y;
      }
    }
    const target = { x: ant.carrying.targetX, y: ant.carrying.targetY };
    const larva = colony.findHungryLarvaAt(target.x, target.y);
    if (!larva) {
      ant.carrying.type = 'food';
      delete ant.carrying.targetX;
      delete ant.carrying.targetY;
      return STAY_ACTION;
    }
    if (ant.x !== target.x || ant.y !== target.y) {
      ant.state = 'NURSE_TEND_BROOD';
      return movementAction(steering.moveTowardNest(ant, world, colony, target, rng));
    }
    larva.nutrition = (larva.nutrition ?? 0) + ant.carrying.pelletNutrition;
    ant.carrying = null;
    ant.carryingType = 'none';
    ant.state = 'NURSE_FEED_BROOD';
    colony.spreadLarvae();
    return STAY_ACTION;
  }

  const queen = colony.queen;
  const queenNeedsFood = queen.alive
    && (queen.hunger < queen.hungerMax * (config.queenFoodRequestHungerThreshold ?? 0.2)
      || queen.health < queen.healthMax * 0.6);
  if (queenNeedsFood && colony.foodStored > 0 && colony.countQueenFoodCouriers() < 2) {
    return runQueenCourierBehavior(ant, world, colony, rng, config, context);
  }

  const nearbyLarva = colony.foodStored > 0
    ? colony.findHungryLarva(ant.x, ant.y, config.nurseBroodSensingRadius)
    : null;
  if (nearbyLarva) {
    const source = colony.getNestRationPoint();
    if (source && (ant.x !== source.x || ant.y !== source.y)) {
      ant.state = 'NURSE_PICKUP_BROOD_FOOD';
      return movementAction(steering.moveTowardNest(ant, world, colony, source, rng));
    }
    const ration = colony.consumeFromStore(config.nurseBroodRation ?? 4);
    if (ration > 0) {
      ant.carrying = {
        type: 'brood-food',
        pelletNutrition: ration,
        targetX: nearbyLarva.x,
        targetY: nearbyLarva.y,
      };
      ant.carryingType = 'food';
      ant.state = 'NURSE_PICKUP_BROOD_FOOD';
      return STAY_ACTION;
    }
  }

  // Default: wander nest exploring.
  // Phase 3: nurse idle wander uses the correlated random walk too.
  steering.updateWanderHeading(ant, rng, world, config);
  return movementAction(steering.moveByPheromone(ant, world, rng, config, 'food', context.entrance));
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
export function runDiggerBehavior(ant, world, colony, rng, config, context) {
  ant.state = 'DIG';

  // Enter the nest if outside
  if (!context.inNest && context.entrance) {
    ant.state = 'DIG_ENTER_NEST';
    return movementAction(steering.moveThroughEntranceShaft(ant,
      world,
      context.entrance,
      navigation.getNestEntryTargetY(ant,world, context.entrance),
      rng,
    ));
  }

  // Deposit home pheromone to help navigation
  const idx = world.index(ant.x, ant.y);
  if (config.enablePheromones !== false) {
    world.depositToHome(idx, config.depositHome * 1.4, config.pheromoneMaxClamp, colony.id);
  }

  // Move toward the nearest active dig front
  const digTarget = colony.getActiveDigFrontPosition(ant.x, ant.y, config.digRecruitRadius ?? 16);
  if (digTarget) {
    const distToFront = Math.hypot(ant.x - digTarget.x, ant.y - digTarget.y);
    if (distToFront > Math.SQRT2) {
      ant.state = 'DIG_MOVE_TO_FRONT';
      return movementAction(steering.moveTowardNest(ant, world, colony, digTarget, rng));
    }
    // At the front — wander nearby so DigSystem can assign us
    ant.state = 'DIG_AT_FRONT';
    return STAY_ACTION;
  }

  // Wander near current position in tunnels.
  // Phase 3: digger at-front wander uses the correlated random walk too.
  steering.updateWanderHeading(ant, rng, world, config);
  return movementAction(steering.moveByPheromone(ant, world, rng, config, 'food', context.entrance));
}

export function haulCorpse(ant, world, colony, rng, context) {
  ant.state = 'HAUL_CORPSE';
  if (!context.inNest && context.entrance) {
    const targetY = navigation.getNestEntryTargetY(ant, world, context.entrance);
    return movementAction(steering.moveThroughEntranceShaft(ant, world, context.entrance, targetY, rng));
  }
  const midden = colony.findChamberTile(colony.homeX + 5, colony.homeY + 8);
  if (midden && (ant.x !== midden.x || ant.y !== midden.y)) {
    return { moved: steering.moveTowardNest(ant, world, colony, midden, rng), allowFallback: false };
  }
  colony.corpses.push({
    id: ant.carrying.id,
    x: ant.x,
    y: ant.y,
    buried: Boolean(midden),
    expiresAt: colony._updateCounter + 900,
  });
  ant.carrying = null;
  ant.carryingType = 'none';
  return STAY_ACTION;
}
