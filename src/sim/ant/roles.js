/*
  Ant role behaviors — extracted from ant.js (Phase 4 of the decomposition
  plan, see docs/ant-decomposition-plan.md).

  Per-role behavior loops dispatched from #decideAndMove: queen-food couriers,
  nurses (queen feeding + larval tending), and diggers (working dig fronts).
  These sit at the top of the dependency chain, calling steering + navigation
  primitives; nothing calls back into them except the dispatcher.

  Pure relocation: every rng.* call stays in its original order, verified by
  the replay-hash test.
*/

import * as steering from './steering.js';
import * as navigation from './navigation.js';

export function isQueenFoodCourier(ant, colony) {
  return colony.isQueenFoodCourier(ant.id);
}

export function runQueenCourierBehavior(ant, world, colony, rng, config, context) {
  let didMove = false;
  const queen = colony.queen;
  if (!queen?.alive) return didMove;

  if (ant.carrying?.type === 'queen-food') {
    const distanceToQueen = Math.hypot(ant.x - queen.x, ant.y - queen.y);
    if (distanceToQueen <= 1.5) {
      colony.feedQueen(ant.carrying.pelletNutrition, config);
      ant.carrying = null;
      ant.carryingType = 'none';
      ant.state = 'FEED_QUEEN';
      return didMove;
    }

    ant.state = 'DELIVER_QUEEN_FOOD';
    return steering.moveToward(ant, world, queen.x, queen.y, rng);
  }

  if (context.inNest) {
    const pickupNutrition = colony.pickupQueenFoodRation(config.queenCourierPickupNutrition ?? 6);
    if (pickupNutrition > 0) {
      ant.carrying = {
        type: 'queen-food',
        pelletId: null,
        pelletNutrition: pickupNutrition,
      };
      ant.carryingType = 'food';
      ant.state = 'PICKUP_QUEEN_FOOD';
      return didMove;
    }

    ant.state = 'SEEK_QUEEN_FOOD';
    const visiblePellet = colony.findVisiblePellet(ant.x, ant.y, config.foodVisionRadius);
    if (visiblePellet) return steering.moveToward(ant, world, visiblePellet.x, visiblePellet.y, rng);
    return steering.moveByPheromone(ant, world, rng, config, 'food', context.entrance, colony);
  }

  ant.state = 'RETURN_NEST_FOR_QUEEN_FOOD';
  if (context.entrance) {
    return steering.moveThroughEntranceShaft(ant, 
      world,
      context.entrance,
      navigation.getNestEntryTargetY(ant,world, context.entrance),
      rng,
    );
  }
  return steering.moveByPheromone(ant, world, rng, config, 'home', context.entrance, colony);
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
    return steering.moveThroughEntranceShaft(ant, 
      world,
      context.entrance,
      navigation.getNestEntryTargetY(ant,world, context.entrance),
      rng,
    );
  }

  // If carrying queen-food, deliver it
  if (ant.carrying?.type === 'queen-food') {
    const queen = colony.queen;
    if (queen?.alive) {
      const distToQueen = Math.hypot(ant.x - queen.x, ant.y - queen.y);
      if (distToQueen <= 1.5) {
        colony.feedQueen(ant.carrying.pelletNutrition, config);
        ant.carrying = null;
        ant.carryingType = 'none';
        ant.state = 'NURSE_FEED_QUEEN';
        return false;
      }
      ant.state = 'NURSE_DELIVER_QUEEN_FOOD';
      return steering.moveToward(ant, world, queen.x, queen.y, rng);
    }
    // Queen dead — drop the food
    ant.carrying = null;
    ant.carryingType = 'none';
  }

  // Feed the queen if she is hungry or her health is declining.
  // Guard on queen?.alive BEFORE reading her vitals — the previous order
  // dereferenced queen.hunger a line above the null-safe check it relied on.
  const queen = colony.queen;
  const queenNeedsFood = !!queen
    && (queen.hunger < queen.hungerMax * 0.25 || queen.health < queen.healthMax * 0.6);
  if (queen?.alive && !ant.carrying?.type
      && queenNeedsFood
      && colony.foodStored > 2
      && colony.countQueenFoodCouriers() < 2) {
    const pickupAmount = config.queenCourierPickupNutrition ?? 6;
    const nutrition = colony.pickupQueenFoodRation(pickupAmount);
    if (nutrition > 0) {
      ant.carrying = {
        type: 'queen-food',
        pelletId: null,
        pelletNutrition: nutrition,
      };
      ant.carryingType = 'food';
      ant.state = 'NURSE_PICKUP_QUEEN_FOOD';
      return false;
    }
  }

  // Spread overcrowded larvae periodically (every ~60 ticks per nurse)
  if (ant.stepCounter % 60 === 0 && colony.larvae.length > 1) {
    colony.spreadLarvae();
  }

  // Tend brood: move toward the brood area.
  // Each nurse gets a stable per-ant offset so they spread across the chamber
  // rather than all converging on the same tile.
  if (colony.larvae.length > 0) {
    const idSeed = parseInt(ant.id.replace(/\D/g, ''), 10) || 0;
    const offsetX = (idSeed % 7) - 3;            // -3 to +3
    const offsetY = (Math.floor(idSeed / 7) % 5) - 2;  // -2 to +2
    const broodX = Math.max(0, Math.min(world.width - 1, world.nestX + 4 + offsetX));
    const broodY = Math.max(world.nestY + 2, Math.min(world.height - 1, world.nestY + 5 + offsetY));
    const distToBrood = Math.hypot(ant.x - broodX, ant.y - broodY);
    if (distToBrood > 3) {
      ant.state = 'NURSE_TEND_BROOD';
      return steering.moveToward(ant, world, broodX, broodY, rng);
    }
  }

  // Default: wander nest exploring.
  // Phase 3: nurse idle wander uses the correlated random walk too.
  steering.updateWanderHeading(ant, rng, world, config);
  return steering.moveByPheromone(ant, world, rng, config, 'food', context.entrance);
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
    return steering.moveThroughEntranceShaft(ant, 
      world,
      context.entrance,
      navigation.getNestEntryTargetY(ant,world, context.entrance),
      rng,
    );
  }

  // Deposit home pheromone to help navigation
  const idx = world.index(ant.x, ant.y);
  if (config.enablePheromones !== false) {
    world.depositToHome(idx, config.depositHome * 1.4, config.pheromoneMaxClamp);
  }

  // Move toward the nearest active dig front
  const digTarget = colony.getActiveDigFrontPosition(ant.x, ant.y);
  if (digTarget) {
    const distToFront = Math.hypot(ant.x - digTarget.x, ant.y - digTarget.y);
    if (distToFront > 2) {
      ant.state = 'DIG_MOVE_TO_FRONT';
      return steering.moveToward(ant, world, digTarget.x, digTarget.y, rng);
    }
    // At the front — wander nearby so DigSystem can assign us
    ant.state = 'DIG_AT_FRONT';
  }

  // Wander near current position in tunnels.
  // Phase 3: digger at-front wander uses the correlated random walk too.
  steering.updateWanderHeading(ant, rng, world, config);
  return steering.moveByPheromone(ant, world, rng, config, 'food', context.entrance);
}
