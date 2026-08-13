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
- `CombatSystem`: deterministic same-tile rival engagement and duel resolution.
- `SimulationTypes`: typed patch-state snapshot + config sanitization.

## Deterministic tick contract

All ticks are processed in this strict order:

1. **Macro phase** (`MacroEngine.update`)  
   - Strategic state only. No randomness outside supplied seeded RNG systems.
2. **Micro phase** (`MicroPatchEngine.update`)  
   1. Black colony update (`colony.update`): local sensing, movement, resource
      interactions, vitals, and hazards.
   2. Red colony update (`rivalColony.update`) using the same local rules and
      shared surface food field.
   3. Combat resolution (`combatSystem.resolve`): opposing ants sharing a tile
      roll once to engage, then alternate role-weighted attacks until one dies.
   4. Dig update (`digSystem.update`): deterministic front iteration with seeded randomness and bounded safety loops.
   5. Pheromone update (`world.updatePheromones`): evaporation every tick, diffusion on `tick % diffIntervalTicks === 0`.

### Conflict-resolution rules

- **Movement arbitration**: ants are updated in stable array order; earlier ants claim opportunities first (e.g., pellets).
- **Food pickup conflict**: first ant to mark a pellet (`takenByAntId`) owns it; pellet is removed once claimed.
- **Rival collision conflict**: opposing pairs are visited in stable colony and
  ant-array order. Each ant can enter at most one battle per tick.
- **Combat**: engagement uses `combatEngageChance` (25% by default). Attacks
  alternate from a seeded initiative roll until one participant reaches zero
  health; sanitized soldier damage is always greater than worker damage.
- **Ant actions**: behavior branches return `{ moved, allowFallback }`. Completed
  local work and intentional waiting suppress fallback movement; failed movement
  attempts may request one pheromone-guided fallback step.
- **Hazard effects**: hazard kill checks are local to the ant tile. The initial
  tile is checked before decisions and a changed tile is checked after the final
  movement, including fallback, so hazard entry resolves in the same tick.
- **Pheromone decay/spread**: decay then optional diffusion, both clamped to `pheromoneMaxClamp`.
- **Dig conflicts**: front progress is bounded and sanitized; invalid saved values are clamped before update.

## Why this supports emergence without a director

The scheduler only enforces deterministic sequencing; it does not author outcomes. Colony growth, trail networks, digging topology, and risk patterns continue to emerge from local rules and seeded randomness in ants/dig fronts rather than central orchestration.
