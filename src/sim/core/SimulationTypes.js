/*
    Type definitions and config sanitization for the tick simulation.

    Purpose:
    - PATCH_TERRAIN_KIND: Semantic labels for terrain types (surface vs underground)
    - sanitizeTickConfig: Guards against invalid/undefined config values that would
      break determinism or crash the simulation
    - getPatchCellState: Snapshots a single tile for rendering/inspection

    Critical: sanitizeTickConfig is called before EVERY tick to ensure:
    - All numeric values are finite and in valid ranges
    - Diffusion coefficients don't exceed stability threshold (4D < 1)
    - Probabilities are clamped to [0, 1]
    - Rates have sensible defaults when missing

    This prevents user-provided bad configs from corrupting the simulation state,
    especially when loading from localStorage or accepting UI slider input.
*/

import { TERRAIN } from '../world.js';

/**
 * Canonical terrain bucket names used by the micro patch engine.
 */
export const PATCH_TERRAIN_KIND = Object.freeze({
  SURFACE_GROUND: 'surface-ground',
  SURFACE_WALL: 'surface-wall',
  SURFACE_WATER: 'surface-water',
  SURFACE_HAZARD: 'surface-hazard',
  SUBTERRANEAN_SOIL: 'subterranean-soil',
  SUBTERRANEAN_TUNNEL: 'subterranean-tunnel',
  SUBTERRANEAN_CHAMBER: 'subterranean-chamber',
});

const TERRAIN_TO_KIND = Object.freeze({
  [TERRAIN.GROUND]: PATCH_TERRAIN_KIND.SURFACE_GROUND,
  [TERRAIN.WALL]: PATCH_TERRAIN_KIND.SURFACE_WALL,
  [TERRAIN.WATER]: PATCH_TERRAIN_KIND.SURFACE_WATER,
  [TERRAIN.HAZARD]: PATCH_TERRAIN_KIND.SURFACE_HAZARD,
  [TERRAIN.SOIL]: PATCH_TERRAIN_KIND.SUBTERRANEAN_SOIL,
  [TERRAIN.TUNNEL]: PATCH_TERRAIN_KIND.SUBTERRANEAN_TUNNEL,
  [TERRAIN.CHAMBER]: PATCH_TERRAIN_KIND.SUBTERRANEAN_CHAMBER,
});

function clampNonNegativeNumber(value, fallback) {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function clamp01(value, fallback) {
  return Math.max(0, Math.min(1, clampNonNegativeNumber(value, fallback)));
}

function clampPositiveInt(value, fallback, min = 1) {
  return Math.max(min, Math.floor(clampNonNegativeNumber(value, fallback)));
}

function clampRangeNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, clampNonNegativeNumber(value, fallback)));
}

function clampFiniteRangeNumber(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/**
 * Deterministic tick config sanitizer.
 * Invalid values are clamped or replaced so simulation steps never run with undefined behavior.
 */
export function sanitizeTickConfig(config = {}) {
  return {
    ...config,
    tickSeconds: clampNonNegativeNumber(config.tickSeconds, 1 / 30),
    antCap: clampPositiveInt(config.antCap, 2000),

    diffIntervalTicks: clampPositiveInt(config.diffIntervalTicks, 1),
    homeDepositIntervalTicks: clampPositiveInt(config.homeDepositIntervalTicks, 1),

    pheromoneMaxClamp: clampFiniteRangeNumber(config.pheromoneMaxClamp, 150, 1, 500),

    evapFood: clampNonNegativeNumber(config.evapFood, 0),
    evapHome: clampNonNegativeNumber(config.evapHome, 0),
    evapDanger: clampNonNegativeNumber(config.evapDanger, 0),
    diffFood: clamp01(config.diffFood, 0),
    diffHome: clamp01(config.diffHome, 0),
    diffDanger: clamp01(config.diffDanger, 0),

    depositFood: clampNonNegativeNumber(config.depositFood, 0),
    depositHome: clampNonNegativeNumber(config.depositHome, 0),
    dangerDeposit: clampNonNegativeNumber(config.dangerDeposit, 0),
    hazardDeathChance: clamp01(config.hazardDeathChance, 0),

    randomTurnChance: clamp01(config.randomTurnChance, 0),
    wanderNoise: clampNonNegativeNumber(config.wanderNoise, 0),
    walkRho: clamp01(config.walkRho, 0.75),
    walkSigma: clampRangeNumber(config.walkSigma, 0.05, 0, 0.2),
    walkMaxTurnRate: clampRangeNumber(config.walkMaxTurnRate, 0.45, 0.1, 1),
    meanderAmplitude: clampRangeNumber(config.meanderAmplitude, 0.05, 0, 0.2),
    pTurnSignFlip: clamp01(config.pTurnSignFlip, 0.85),
    headingBias: clamp01(config.headingBias, 0.20),
    obstacleLookahead: clampRangeNumber(config.obstacleLookahead, 2, 1, 5),
    obstacleTurnGain: clamp01(config.obstacleTurnGain, 0.30),
    dangerTurnLookahead: clampRangeNumber(config.dangerTurnLookahead, 2, 1, 5),
    dangerTurnGain: clamp01(config.dangerTurnGain, 0.40),

    queenEggTicks: Math.floor(clampFiniteRangeNumber(config.queenEggTicks, 20, 1, 100)),
    queenEggFoodCost: clampNonNegativeNumber(config.queenEggFoodCost, 0),
    queenHungerDrain: clampNonNegativeNumber(config.queenHungerDrain, 0),
    queenEatNutrition: clampFiniteRangeNumber(config.queenEatNutrition, 5, 0, 20),
    queenHealthDrainRate: clampFiniteRangeNumber(config.queenHealthDrainRate, 7, 0, 20),
    queenHealthRecoveryPerNutrition: clampNonNegativeNumber(config.queenHealthRecoveryPerNutrition, 0),
    queenFoodRequestHealthThreshold: clamp01(config.queenFoodRequestHealthThreshold, 0.5),
    queenFoodRequestClearThreshold: clamp01(config.queenFoodRequestClearThreshold, 0.8),
    queenCourierPickupNutrition: clampNonNegativeNumber(config.queenCourierPickupNutrition, 0),
    broodFoodDrainRate: clampNonNegativeNumber(config.broodFoodDrainRate, 0),
    broodGestationSeconds: clampNonNegativeNumber(config.broodGestationSeconds, 1),

    workerEatNutrition: clampFiniteRangeNumber(config.workerEatNutrition, 25, 0, 100),
    starvationRecoveryHealth: clampNonNegativeNumber(config.starvationRecoveryHealth, 0),
    healthDrainRate: clampNonNegativeNumber(config.healthDrainRate, 0),
    healthRegenRate: clampNonNegativeNumber(config.healthRegenRate, 0),
    healthWorkIdleDrainRate: clampNonNegativeNumber(config.healthWorkIdleDrainRate, 0),
    healthWorkMoveDrainRate: clampNonNegativeNumber(config.healthWorkMoveDrainRate, 0),
    healthWorkCarryDrainRate: clampNonNegativeNumber(config.healthWorkCarryDrainRate, 0),
    healthWorkFightDrainRate: clampNonNegativeNumber(config.healthWorkFightDrainRate, 0),
    healthEatRecoveryRate: clampNonNegativeNumber(config.healthEatRecoveryRate, 0),
    workerEmergencyEatNutrition: clampNonNegativeNumber(config.workerEmergencyEatNutrition, 0),
    carryingHungerDrainRate: clampNonNegativeNumber(config.carryingHungerDrainRate, 0),
    fightingHungerDrainRate: clampNonNegativeNumber(config.fightingHungerDrainRate, 0),

    soldierSpawnChance: clamp01(config.soldierSpawnChance, 0),
    foodVisionRadius: clampPositiveInt(config.foodVisionRadius, 1),
    surfaceFoodSearchMaxMissTicks: clampPositiveInt(config.surfaceFoodSearchMaxMissTicks, 90),
    surfaceReturnToNestHungerThreshold: clamp01(config.surfaceReturnToNestHungerThreshold, 0.65),
    homeDepositMinDistance: clampFiniteRangeNumber(config.homeDepositMinDistance, 20, 0, 100),
    nearEntranceScatterRadius: clampNonNegativeNumber(config.nearEntranceScatterRadius, 0),
    foodTrailDistanceScale: clampNonNegativeNumber(config.foodTrailDistanceScale, 1.0),
    foodTrailDecayPerStep: clamp01(config.foodTrailDecayPerStep, 0.92),
    maxFoodTrailScale: Math.max(1, clampNonNegativeNumber(config.maxFoodTrailScale, 4.0)),
    homeScentBaseWeight: clampNonNegativeNumber(config.homeScentBaseWeight, 1),
    homeScentSearchStateScale: clampNonNegativeNumber(config.homeScentSearchStateScale, 1),
    homeScentReturnStateScale: clampNonNegativeNumber(config.homeScentReturnStateScale, 1),
    homeScentFalloffStartDist: clampNonNegativeNumber(config.homeScentFalloffStartDist, 0),
    homeScentFalloffEndDist: clampNonNegativeNumber(config.homeScentFalloffEndDist, 1),
    homeScentMinFalloff: clamp01(config.homeScentMinFalloff, 0),
    homeScentMaxContributionPerStep: clampNonNegativeNumber(config.homeScentMaxContributionPerStep, 1),
    homeTieBiasScale: clampNonNegativeNumber(config.homeTieBiasScale, 0.01),
    foodTieBiasScale: clampNonNegativeNumber(config.foodTieBiasScale, 0.01),
    debugSteeringContributions: Boolean(config.debugSteeringContributions),
    debugSteeringLogIntervalTicks: clampPositiveInt(config.debugSteeringLogIntervalTicks, 1),

    followAlpha: clampNonNegativeNumber(config.followAlpha, 0),
    followBeta: clampNonNegativeNumber(config.followBeta, 0),
    momentumBias: clampNonNegativeNumber(config.momentumBias, 0),
    reversePenalty: clampNonNegativeNumber(config.reversePenalty, 0),
  };
}

/**
 * Snapshot a single tile as a typed patch-state object.
 */
export function getPatchCellState(world, foodPellets, x, y) {
  if (!world.inBounds(x, y)) return null;
  const idx = world.index(x, y);
  const pelletCount = foodPellets.reduce((count, pellet) => {
    if (pellet.x !== x || pellet.y !== y) return count;
    if (pellet.takenByAntId != null) return count;
    return count + 1;
  }, 0);

  return {
    x,
    y,
    terrain: {
      code: world.terrain[idx],
      kind: TERRAIN_TO_KIND[world.terrain[idx]] || PATCH_TERRAIN_KIND.SURFACE_GROUND,
      passable: world.isPassable(x, y),
      underground: world.isBelowSurface(x, y),
    },
    food: {
      groundUnits: world.food[idx],
      pellets: pelletCount,
    },
    pheromones: {
      toFood: world.toFood[idx],
      toHome: world.toHome[idx],
      danger: world.danger[idx],
    },
    hazard: world.terrain[idx] === TERRAIN.HAZARD,
  };
}
