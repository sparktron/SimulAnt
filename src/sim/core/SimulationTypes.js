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

    pheromoneMaxClamp: Math.max(1, clampNonNegativeNumber(config.pheromoneMaxClamp, 10)),

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

    queenEggTicks: clampPositiveInt(config.queenEggTicks, 1),
    queenEggFoodCost: clampNonNegativeNumber(config.queenEggFoodCost, 0),
    queenHungerDrain: clampNonNegativeNumber(config.queenHungerDrain, 0),
    queenEatNutrition: clampNonNegativeNumber(config.queenEatNutrition, 0),
    queenHealthDrainRate: clampNonNegativeNumber(config.queenHealthDrainRate, 0),

    workerEatNutrition: clampNonNegativeNumber(config.workerEatNutrition, 0),
    starvationRecoveryHealth: clampNonNegativeNumber(config.starvationRecoveryHealth, 0),
    healthDrainRate: clampNonNegativeNumber(config.healthDrainRate, 0),
    healthRegenRate: clampNonNegativeNumber(config.healthRegenRate, 0),
    carryingHungerDrainRate: clampNonNegativeNumber(config.carryingHungerDrainRate, 0),
    fightingHungerDrainRate: clampNonNegativeNumber(config.fightingHungerDrainRate, 0),

    soldierSpawnChance: clamp01(config.soldierSpawnChance, 0),
    foodVisionRadius: clampPositiveInt(config.foodVisionRadius, 1),
    homeDepositMinDistance: clampNonNegativeNumber(config.homeDepositMinDistance, 0),
    nearEntranceScatterRadius: clampNonNegativeNumber(config.nearEntranceScatterRadius, 0),
    foodTrailDistanceScale: clampNonNegativeNumber(config.foodTrailDistanceScale, 0),
    maxFoodTrailScale: Math.max(1, clampNonNegativeNumber(config.maxFoodTrailScale, 1)),

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
      underground: world.isUnderground(x, y),
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
