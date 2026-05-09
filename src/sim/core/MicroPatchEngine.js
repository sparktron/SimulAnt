import { getPatchCellState, sanitizeTickConfig } from './SimulationTypes.js';

/*
    Local-rules simulation: encapsulates three deterministic phases.

    Responsibilities:
    - Accepts world/colony/dig system references
    - Receives external state (food pellets, nest entrances) each tick
    - Enforces strict phase ordering for determinism
    - Validates config before each phase

    Phase order (FIXED, DO NOT REORDER):
    1. Colony.update: all ants sense & act, queen reproduces, brood gestates
    2. DigSystem.update: tunneling fronts advance, dirt carriers assigned
    3. World.updatePheromones: evaporation + diffusion of all three fields

    This order ensures:
    - Ants move/deposit before their pheromones spread (prevents lookahead)
    - Digging creates passages for next tick's ant movement
    - Pheromone diffusion only happens after all deposits are complete

    Changing phase order will break emergent behavior (even if the code still runs).
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
