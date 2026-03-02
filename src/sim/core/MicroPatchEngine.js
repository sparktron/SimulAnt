import { getPatchCellState, sanitizeTickConfig } from './SimulationTypes.js';

/**
 * Micro patch simulation: deterministic local updates for ants, digging, and pheromones.
 * Phase order is fixed to preserve current gameplay outcomes.
 */
export class MicroPatchEngine {
  constructor(world, colony, digSystem) {
    this.world = world;
    this.colony = colony;
    this.digSystem = digSystem;
  }

  setExternalState({ foodPellets, nestEntrances }) {
    this.colony.setSurfaceFoodPellets(foodPellets);
    this.colony.setNestEntrances(nestEntrances);
  }

  update({ tick, config }) {
    const safeConfig = sanitizeTickConfig(config);

    // Phase 1: per-ant sensing/decisions + local interactions.
    this.colony.update(safeConfig);

    // Phase 2: underground excavation front progression.
    this.digSystem.update(safeConfig);

    // Phase 3: global field transforms from local diffusion/evaporation rules.
    this.world.updatePheromones(safeConfig, tick);
  }

  getPatchState(x, y, foodPellets) {
    return getPatchCellState(this.world, foodPellets, x, y);
  }
}
