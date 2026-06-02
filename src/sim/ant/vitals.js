/*
    Ant vitals and feeding behavior — extracted from ant.js (Phase 1 of the
    decomposition plan, see docs/ant-decomposition-plan.md).

    Pure free functions taking the ant as the first argument. No RNG is used in
    this cluster, so it carries no determinism risk: the per-tick rng.* call
    sequence is unaffected by this extraction.
*/

import { distanceToEntrance } from './navigation.js';

// Fraction of maxAge at which senescence (old-age health decline) begins.
const SENESCENCE_START_FRACTION = 0.8;

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
export function applyVitals(ant, colony, config, dt, didMove, inNest) {
  // Increment age for natural lifespan tracking
  // Per-ant aging rate (set in constructor, ±15% jitter) advances age
  // unevenly so a synchronized birth cohort still spreads out its
  // deaths over the senescence window.
  ant.age += ant.agingRate ?? 1;

  const hungerDrain = didMove ? ant.hungerDrainRates.move : ant.hungerDrainRates.idle;
  if (ant.role === 'soldier') {
    // Soldiers pay only the base move/idle hunger cost — no carry surcharge
    // (they don't haul) and no work-health drain.
    ant.hunger = Math.max(0, ant.hunger - hungerDrain * dt);
  } else {
    // Hunger mechanics with work penalties. Carry surcharge is for surface
    // transit only — moving a few tiles inside the nest to a drop point or
    // queen tile shouldn't pay the long-haul tax. Hauling dirt is the
    // exception: we want that to feel costly, so we keep the surcharge for
    // HAUL_DIRT regardless of location.
    const carrySurchargeApplies = !!ant.carrying?.type && (ant.state === 'HAUL_DIRT' || !inNest);
    const carryingHungerCost = carrySurchargeApplies ? (config.carryingHungerDrainRate ?? 0) : 0;
    const fightHungerCost = ant.state === 'FIGHT' ? (config.fightingHungerDrainRate ?? 0) : 0;
    ant.hunger = Math.max(0, ant.hunger - (hungerDrain + carryingHungerCost + fightHungerCost) * dt);

    // Health degradation from work. Same location-aware gate as hunger: carry
    // drain only counts during surface transit (or dirt hauls).
    const healthWorkDrain = (didMove ? (config.healthWorkMoveDrainRate ?? 0) : (config.healthWorkIdleDrainRate ?? 0))
      + (carrySurchargeApplies ? (config.healthWorkCarryDrainRate ?? 0) : 0)
      + (ant.state === 'FIGHT' ? (config.healthWorkFightDrainRate ?? 0) : 0);
    ant.health = Math.max(0, ant.health - healthWorkDrain * dt);
  }

  // Starvation damage, fed-state regen, and old-age decline are identical for
  // every caste — funnel both role paths through one helper so they can never
  // drift apart (a soldier-only or worker-only edit would otherwise diverge,
  // the exact failure mode seen in the engine-lifecycle rebuild paths).
  applyStarvationRegenAging(ant, config, dt);

  if (ant.health <= 0) {
    ant.alive = false;
    colony.recordDeath(deathCause(ant));
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
export function applyStarvationRegenAging(ant, config, dt) {
  if (ant.hunger <= 0) {
    ant.health = Math.max(0, ant.health - (config.healthDrainRate ?? 0) * dt);
  }

  if (ant.hunger > ant.hungerMax * 0.5 && ant.health < ant.healthMax) {
    const regenRate = Math.max(0, config.healthRegenRate ?? 0);
    const senescenceFactor = ant.age > ant.maxAge * SENESCENCE_START_FRACTION ? 0.5 : 1;
    ant.health = Math.min(ant.healthMax, ant.health + regenRate * senescenceFactor * dt);
  }

  if (ant.age > ant.maxAge * SENESCENCE_START_FRACTION) {
    const ageFactor = (ant.age - ant.maxAge * SENESCENCE_START_FRACTION) / (ant.maxAge * (1 - SENESCENCE_START_FRACTION));
    ant.health = Math.max(0, ant.health - ageFactor * 2 * dt);
  }
}

/**
 * Best-guess cause for the death that just occurred.
 *
 * Starvation if hunger has been driven to zero; oldAge if the ant is in
 * the senescence window (age > 80% of maxAge); otherwise "other" — which
 * covers work-damage attrition and edge cases.
 */
export function deathCause(ant) {
  if (ant.hunger <= 0) return 'starvation';
  if (ant.age > ant.maxAge * SENESCENCE_START_FRACTION) return 'oldAge';
  return 'other';
}

export function needsForage(ant, colony) {
  // Role-aware: specialists (nurse/dig) stay on duty unless personally starving.
  const isSpecialist = ant.workFocus === 'nurse' || ant.workFocus === 'dig';
  if (isSpecialist) {
    return ant.hunger < ant.hungerMax * 0.15;
  }

  // Foragers: this is their *job*. They should keep working as long as the
  // colony has room to grow its reserves. Previously they idled as soon as
  // they were personally fed AND the store was above 25% of target, which
  // caused them to cluster at the entrance and refuse to walk the pheromone
  // trails. Keep them foraging until the store is nearly full.
  if (ant.workFocus === 'forage') {
    const storeTarget = Math.max(1, colony.foodStoreTarget);
    const storeNearlyFull = colony.foodStored >= storeTarget;
    if (!storeNearlyFull) return true;
    // Even at target, still forage if personally hungry.
    return ant.hunger < ant.hungerMax * 0.6;
  }

  // Unspecialized workers fall back to the legacy hunger/shortage heuristic.
  const personallyHungry = ant.hunger < ant.hungerMax * 0.4;
  const criticalFoodShortage = colony.foodStored < Math.max(1, colony.foodStoreTarget * 0.25);
  return personallyHungry || criticalFoodShortage;
}

export function tryEatFromNest(ant, colony, inNest, config) {
  if (!inNest) return false;
  // Workers and soldiers eat from nest stores. Breeders do not — they exist
  // for caste-balance bookkeeping and have no active behavior loop.
  // Excluding soldiers (the earlier policy) guaranteed they starved within
  // ~30 sec, draining colony births with no return.
  if (ant.role !== 'worker' && ant.role !== 'soldier') return false;

  // Cooldown: prevent ants from eating every single tick in the nest.
  // 30 ticks between meals unless critically starving.
  const eatCooldown = config.nestEatCooldownTicks ?? 30;
  const ticksSinceLastEat = ant.stepCounter - ant._lastNestEatTick;
  const critical = isCriticalHealth(ant);
  if (!critical && ticksSinceLastEat < eatCooldown) return false;

  // Hunger-based eating: eat when hungry, not when health dips.
  // Health regenerates passively when hunger > 65%, so feeding hunger
  // is the correct lever.  Critical-health ants still get priority.
  const hungry = ant.hunger < ant.hungerMax * 0.35;
  if (!hungry && !critical) return false;

  const requested = critical
    ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition)
    : config.workerEatNutrition;
  // Clamp intake to remaining hunger capacity so we don't waste food.
  // If hunger is already full there is nothing to absorb — passive regen
  // (hunger > 65%) will restore health without consuming colony stores.
  const hungerCapacity = Math.max(0, ant.hungerMax - ant.hunger);
  if (hungerCapacity <= 0) return false;
  const requestedIntake = Math.max(1, Math.min(requested, hungerCapacity));

  const consumed = colony.consumeFromStore(requestedIntake);
  if (consumed <= 0) return false;

  ant._lastNestEatTick = ant.stepCounter;
  ant.hunger = Math.min(ant.hungerMax, ant.hunger + consumed);
  const healthGain = consumed * (config.healthEatRecoveryRate ?? 0);
  // Recovery bonus only applies when the ant is actually starving, not when
  // health is low for other reasons (old age, combat damage, etc.).
  const isStarving = ant.hunger < ant.hungerMax * 0.1;
  ant.health = Math.min(ant.healthMax, ant.health + healthGain + (critical && isStarving ? config.starvationRecoveryHealth : 0));
  return true;
}

export function tryEatNearbyPellet(ant, colony, config) {
  if (!isLowHealth(ant)) return false;
  const pellet = colony.findAvailablePelletAt(ant.x, ant.y);
  if (!pellet) return false;
  consumePelletForHealthThenCarry(ant, colony, pellet, config);
  return true;
}

export function consumePelletForHealthThenCarry(ant, colony, pellet, config) {
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
  const critical = isCriticalHealth(ant);
  const requested = critical
    ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition ?? nutrition)
    : (config.workerEatNutrition ?? nutrition);
  const fieldCap = critical ? nutrition : nutrition / 2;
  const consumed = Math.min(nutrition, requested, fieldCap);
  const healthRecoveryRate = Math.max(0, config.healthEatRecoveryRate ?? 0);

  ant.hunger = Math.min(ant.hungerMax, ant.hunger + consumed);
  ant.health = Math.min(ant.healthMax, ant.health + consumed * healthRecoveryRate);

  const remainingNutrition = Math.max(0, nutrition - consumed);
  colony.removePelletById(pellet.id);
  if (remainingNutrition > 0.0001) {
    ant.carrying = {
      type: 'food',
      pelletId: pellet.id,
      pelletNutrition: remainingNutrition,
      pickupDistance: distanceToEntrance(ant, colony),
    };
    ant.carryingType = 'food';
  }
}

export function consumePelletForHealth(ant, colony, pellet, config) {
  const nutrition = Math.max(0, pellet?.nutrition || 0);
  if (nutrition <= 0) {
    colony.removePelletById(pellet.id);
    return;
  }

  const requested = isCriticalHealth(ant)
    ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition ?? nutrition)
    : (config.workerEatNutrition ?? nutrition);
  const consumed = Math.min(nutrition, requested);
  const healthRecoveryRate = Math.max(0, config.healthEatRecoveryRate ?? 0);

  ant.hunger = Math.min(ant.hungerMax, ant.hunger + consumed);
  ant.health = Math.min(ant.healthMax, ant.health + consumed * healthRecoveryRate);
  colony.removePelletById(pellet.id);
}

export function consumeCarriedFoodForHealth(ant, config) {
  if (ant.carrying?.type !== 'food') return;
  const available = Math.max(0, ant.carrying.pelletNutrition || 0);
  if (available <= 0) {
    ant.carrying = null;
    ant.carryingType = 'none';
    return;
  }

  // Same cap as consumePelletForHealthThenCarry — never eat more than half
  // the cargo unless the carrier is in critical health. Workers between
  // 40–50% health were previously consuming entire pellets en route,
  // turning every foraging trip into a net-zero or net-negative delivery
  // for the colony.
  const critical = isCriticalHealth(ant);
  const requested = critical
    ? (config.workerEmergencyEatNutrition ?? config.workerEatNutrition)
    : (config.workerEatNutrition ?? available);
  const cargoCap = critical ? available : available / 2;
  const consumed = Math.min(available, requested, cargoCap);
  const recoveryRate = Math.max(0, config.healthEatRecoveryRate ?? 0);
  ant.hunger = Math.min(ant.hungerMax, ant.hunger + consumed);
  ant.health = Math.min(ant.healthMax, ant.health + consumed * recoveryRate);

  const remaining = Math.max(0, available - consumed);
  if (remaining <= 0.0001) {
    ant.carrying = null;
    ant.carryingType = 'none';
    return;
  }
  ant.carrying.pelletNutrition = remaining;
}

export function isLowHealth(ant) {
  return ant.health < ant.healthMax * 0.5;
}

// Critical = "drop everything and eat right now." Threshold raised from 25%
// so an ant in real trouble triggers emergency eating before it's seconds
// from death (with the 25% floor, the override only fired after sustained
// damage). Combined with the cooldown bypass in tryEatFromNest, critical
// ants can re-feed every tick until hunger is full or they're stable.
export function isCriticalHealth(ant) {
  return ant.health < ant.healthMax * 0.4;
}
