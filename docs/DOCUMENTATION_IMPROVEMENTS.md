# Documentation Improvements (2026-05-09)

## Overview

Added strategic, high-quality comments to the SimulAnt codebase focusing on comprehension for junior and mid-level developers. Documentation follows these principles:

1. **Explain WHY**, not WHAT — code already shows what it does
2. **Focus on non-obvious logic** — why decisions were made, constraints, tradeoffs
3. **Document systems, not lines** — file headers explain responsibility and role
4. **Avoid comment rot** — describe intent, not implementation details
5. **Target complex systems** — concurrency, state machines, math-heavy code, timing

## Files Documented

### Core Simulation (src/sim/)

#### ant.js (1,700+ lines)
- **File header**: Explains deterministic FSM, five-phase tick, movement patterns
- **#sense()**: Context collection for decision-making
- **#moveByPheromone()**: Pheromone steering algorithm (gradient + momentum + bias)
- **#applyVitals()**: Health/hunger mechanics and starvation feedback loop
- **gaussianRandom()**: Box-Muller for deterministic Gaussian distribution

**Key insight documented**: Combining pheromone strength with directional momentum prevents jitter; threshold logic prevents constant recomputation.

#### colony.js (1,100+ lines)
- **File header**: Colony systems (ants, queen, brood, food, workforce)
- **#chooseWeightedDeficit()**: Role/focus allocation via deficit minimization
- **#updateQueenAndBrood()**: Brood lifecycle (4 stages, food-limited, crowding penalty)

**Key insight documented**: Reproduction is food-limited, not quota-driven; crowding penalty creates self-balancing population.

#### world.js (350+ lines)
- **File header**: Pheromone fields, terrain, spatial queries
- **updatePheromones()**: Discrete diffusion equation, stability constraints
- **Distinction**: isBelowSurface vs. isUndergroundTile (spatial vs. structural)

**Key insight documented**: Entrance mouth classification prevents incorrect state transitions at the surface/nest boundary.

#### DigSystem.js (500+ lines)
- **File header**: Excavation front progression, upward shafts, chamber carving
- **Front mechanics**: Progress accumulation, worker assignment, branching strategy

**Key insight documented**: Fronts naturally follow easier paths; chamber spacing prevents overlap; new entrances provide redundancy.

#### SimulationCore.js (orchestrator)
- **File header**: Tick pipeline, serialization boundaries, determinism contract
- **reset()**: Deterministic initialization from seed
- **runTick()**: Macro → Micro → Food respawn → Stats

#### MacroEngine.js (strategy layer)
- **File header**: Placeholder for future strategic decisions
- **Constraints**: Must preserve determinism, never mutate mid-tick

#### MicroPatchEngine.js (local rules)
- **File header**: Three-phase orchestration, immutable phase order
- **Phases**: Colony update → Dig update → Pheromone update
- **Warning**: Phase order changes break emergence without breaking code

#### SimulationTypes.js (config validation)
- **File header**: Purpose of config sanitization, safety constraints
- **sanitizeTickConfig()**: Guards against invalid values, prevents crashes

### Systems (src/sim/systems/)

#### FoodEconomySystem.js
- **File header**: Respawn strategy, spatial distribution (near vs. far)
- **Critical shortage**: Immediate respawn to prevent starvation death spiral
- **Regular interval**: Slower respawn when stable, creates exploration pressure

#### Food.js
- **File header**: Pellet ownership contract, first-come-first-served semantics
- **Race condition prevention**: takenByAntId field avoids double-pickup

### RNG (src/sim/rng.js)
- **File header**: Determinism requirement, xorshift32 algorithm
- **Critical**: Why seeded RNG is mandatory, never Math.random()
- **Usage**: next/range/int/chance distributions

### Rendering (src/render/)

#### SurfaceRenderer.js
- **File header**: Top-down view, camera system, terrain normalization
- **Key invariant**: Underground tiles shown as ground for visual clarity
- **Off-screen canvas**: ImageData rendering avoids per-pixel fills

### UI (src/ui/)

#### controls.js
- **File header**: Input routing, state mutation pattern, UI/simulation boundary
- **Key contract**: Controls mutate state, actions trigger logic

## Key Architectural Insights Documented

### Determinism
- Same seed → same sequence (used by Reset, Save/Load)
- Seeded RNG mandatory everywhere (never Math.random())
- Phase ordering immutable (macro → micro → respawn → stats)

### Emergence Without Central Planning
- Ant behavior is purely local (sense → decide → act)
- Queen reproduction is food-limited (no quota system)
- Worker allocation uses deficit minimization (no central dispatcher)
- Food respawn scales colony size (no hard caps until antCap)
- Brood crowding naturally limits population (negative feedback)

### Conflict Resolution Rules
- Movement arbitration: stable array order (first ant claims)
- Food pickup: takenByAntId marks ownership
- Hazard effects: local to tile
- Pheromone decay: decay then optional diffusion

### State Machine Invariants
- Health/hunger drive behavior (low health → return to nest, starving → eat)
- Work specialization (forage/dig/nurse) switches based on colony needs
- Entrance transit states prevent incorrect routing in chokepoints
- Role-specific behavior (soldier patrol vs. worker foraging)

## Files NOT Requiring Heavy Documentation

The following files already have adequate documentation in existing code:

- `ViewManager.js` — well-commented view toggle architecture
- `NestRenderer.js` — detailed side-view architecture explanation
- `InputRouter.js` — clear input handling with coordinate mapping
- `ColonyStats.js` — straightforward telemetry collection
- `NestState.js` — trivial spatial classification function

## Documentation Style

All comments follow these rules:

- **JSDoc-style blocks** for major functions and systems
- **Inline comments** only for WHY (not WHAT)
- **No docstrings** — single-line headers with context
- **Technical terms explained** for junior devs (e.g., "diffusion coefficient")
- **Code doesn't repeat in comments** — focus on intent
- **Cross-references** to related systems (e.g., ant.js references colony.js)

## How to Use This Documentation

### For New Contributors

1. **Start with CLAUDE.md** — project rules and entry points
2. **Read core-simulation-architecture.md** — tick contract and boundaries
3. **Explore this document** — understand system responsibilities
4. **Dive into ant.js** — the state machine is the heart of behavior
5. **Understand world.js** — how pheromones create trail networks
6. **Study colony.js** — how reproduction balances workforce

### For Debugging

- **Wrong ant behavior?** → Check ant.js state transitions and movement decisions
- **Food trails not working?** → Check world.js pheromone diffusion and ant deposits
- **Ants starving?** → Check colony.js food store management and FoodEconomySystem respawn
- **Population exploding?** → Check brood gestation rates and larva starvation

### For Feature Addition

- **New worker behavior?** → Add role to ant.js #decideAndMove
- **New pheromone channel?** → Add field to world.js and update deposit logic
- **Population pressure?** → Tune config values in main.js (broodGestationSeconds, healthDrainRate, etc.)

## Future Documentation Needs

These would be valuable additions if someone wants to extend:

- **Detailed pheromone steering math** — current comment is high-level
- **Obstacle avoidance algorithm** — referenced but not detailed
- **Nurse brood-tending strategy** — complex spatial allocation
- **Dig front topology decisions** — why fronts branch the way they do
- **Performance profiles** — which systems are CPU-bound

## Maintenance Notes

When maintaining this documentation:

1. Update comments when behavior changes (not implementation style changes)
2. Don't add comments that describe code line-by-line
3. If a comment becomes stale, delete it rather than leaving contradictory info
4. Use this document as a reference for what's been documented
5. Add to DOCUMENTATION_IMPROVEMENTS.md when adding major new comments

---

**Version**: 0.13.11
**Date**: 2026-05-09
**Scope**: File headers, system architecture, complex algorithms, state transitions
