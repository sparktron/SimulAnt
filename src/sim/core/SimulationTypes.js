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

/**
 * Deterministic tick config sanitizer.
 * Invalid values are clamped or replaced so simulation steps never run with undefined behavior.
 */
export function sanitizeTickConfig(config = {}) {
  const safeDiffInterval = Math.max(1, Math.floor(clampNonNegativeNumber(config.diffIntervalTicks, 1)));
  return {
    ...config,
    tickSeconds: clampNonNegativeNumber(config.tickSeconds, 1 / 30),
    diffIntervalTicks: safeDiffInterval,
    pheromoneMaxClamp: Math.max(1, clampNonNegativeNumber(config.pheromoneMaxClamp, 10)),
    evapFood: clampNonNegativeNumber(config.evapFood, 0),
    evapHome: clampNonNegativeNumber(config.evapHome, 0),
    evapDanger: clampNonNegativeNumber(config.evapDanger, 0),
    diffFood: clampNonNegativeNumber(config.diffFood, 0),
    diffHome: clampNonNegativeNumber(config.diffHome, 0),
    diffDanger: clampNonNegativeNumber(config.diffDanger, 0),
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
