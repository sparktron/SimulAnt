# Core Simulation Architecture (Deterministic)

## Update plan (incremental)

1. Separate the simulation into explicit boundaries: macro strategy, micro patch simulation, and tick scheduler.
2. Keep existing gameplay behavior by preserving existing per-tick phase order.
3. Add typed patch-state models for terrain/food/pheromones/hazards for testability and UI reads.
4. Validate/sanitize tick config at the simulation boundary to avoid undefined state transitions.
5. Add deterministic and locality-focused tests before expanding macro behavior.

## Module boundaries

- `TickScheduler`: deterministic orchestration only.
- `MacroEngine`: strategic territory layer boundary (currently stable/no-op state transitions).
- `MicroPatchEngine`: deterministic local rules for ants, digging, and pheromone fields.
- `SimulationTypes`: typed patch-state snapshot + config sanitization.

## Deterministic tick contract

All ticks are processed in this strict order:

1. **Macro phase** (`MacroEngine.update`)  
   - Strategic state only. No randomness outside supplied seeded RNG systems.
2. **Micro phase** (`MicroPatchEngine.update`)  
   1. Colony update (`colony.update`): ant local sensing, movement decisions, pickup/deposit, hunger/health, hazard checks.  
   2. Dig update (`digSystem.update`): deterministic front iteration with seeded randomness and bounded safety loops.  
   3. Pheromone update (`world.updatePheromones`): evaporation every tick, diffusion on `tick % diffIntervalTicks === 0`.

### Conflict-resolution rules

- **Movement arbitration**: ants are updated in stable array order; earlier ants claim opportunities first (e.g., pellets).
- **Food pickup conflict**: first ant to mark a pellet (`takenByAntId`) owns it; pellet is removed once claimed.
- **Hazard effects**: hazard kill checks are local to ant tile and resolved during ant update.
- **Pheromone decay/spread**: decay then optional diffusion, both clamped to `pheromoneMaxClamp`.
- **Dig conflicts**: front progress is bounded and sanitized; invalid saved values are clamped before update.

## Why this supports emergence without a director

The scheduler only enforces deterministic sequencing; it does not author outcomes. Colony growth, trail networks, digging topology, and risk patterns continue to emerge from local rules and seeded randomness in ants/dig fronts rather than central orchestration.
