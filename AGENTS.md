# AGENTS.md — SimulAnt

Vanilla JavaScript ant colony simulation. No build step, no package manager, no framework.

## Key Commands

```bash
# Dev server (pick one)
python3 -m http.server 8000
node server.js

# Run all tests
node --test test/*.mjs

# Run a single test file
node --test test/ant.test.mjs

# Run tests matching a name pattern
node --test --test-name-pattern="forage" test/*.mjs
```

Open at http://localhost:8000 after starting the server.

## Non-Obvious Patterns

**No package.json, no npm.** Never run `npm install`, `npm test`, or any npm command. Tests use Node's built-in `node:test` runner directly.

**Determinism is a hard contract.** All randomness must go through `SeededRng` in `src/sim/rng.js`. Never use `Math.random()` in simulation code — it breaks reproducibility and test isolation.

**Tick order is fixed.** `TickScheduler` enforces: `MacroEngine → MicroPatchEngine`. Inside Micro: `colony.update() → digSystem.update() → world.updatePheromones()`. Changing this order produces different simulation outcomes — treat it as immutable.

**Typed arrays for world state.** `world.terrain` is `Uint8Array`, pheromone fields are `Float32Array`. Don't replace with plain arrays — performance and memory layout depend on this.

**Spatial hash for ants.** `_antGrid` is a `Map<"x,y", count>` updated on every move. Always maintain it when writing ant movement code; skipping it breaks occupancy checks silently.

**Ant AI is purely local.** Each ant decides using only its immediate state and pheromone readings — there is no central director. Colony-level behavior is emergent. Don't add global coordination; work through pheromone channels and state machine transitions in `src/sim/ant.js`.

**Two independent cameras.** Surface and Nest views each have their own pan/zoom state. `InputRouter` routes pointer events to the active view's handler. Don't bypass InputRouter for view-specific interactions.

## Code Conventions

```js
// ES6 modules throughout — always use named exports
export class Colony { ... }
export { TERRAIN };

// Terrain constants from world.js — use the named constant, never a raw integer
import { TERRAIN } from '../sim/world.js';
world.terrain[idx] = TERRAIN.WALL;  // not: world.terrain[idx] = 2;

// Config values live in state.config (set in main.js)
// Read them from the config object; never hardcode magic numbers
const evap = state.config.pheromoneEvapRate;
```

## Testing Rules

- Every new simulation behavior needs a test in `test/`.
- Tests must be deterministic: initialize `SeededRng` with a fixed seed, never rely on wall-clock time or `Math.random()`.
- No mocking the simulation core — tests import real classes and run real ticks.
- Don't add external test libraries; `node:test` and `node:assert/strict` are the only test dependencies.

## Boundaries

**Always:**
- Commit changes immediately after completing any code edit (project rule).
- Use `SeededRng` for all in-simulation randomness.
- Run `node --test test/*.mjs` before committing simulation or world changes.

**Ask first:**
- Changing tick order in `TickScheduler`.
- Modifying world dimensions (currently hardcoded 256×256 in several places).
- Adding new external dependencies.

**Never:**
- Run npm or any Node package manager commands (no package.json exists).
- Use `Math.random()` inside `src/sim/`.
- Commit `localStorage` data, `.env` files, or secrets.
- Auto-generate AGENTS.md content (statistically degrades agent performance per ETH Zurich research).
