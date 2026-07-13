# Ant Class Decomposition Plan

Decompose the 1,820-line `src/sim/ant.js` `Ant` class into smaller, focused
behavior units. Tracks KNOWN_ISSUES #1 and `open-items-todo.md` item #5.

## Status: COMPLETE (v0.31.1–v0.31.5; phase orchestration finalized in v0.56.1)

All four extraction phases plus the `#decideAndMove` split shipped. `ant.js`
1820 → 441 lines; behavior split across `steering.js` (571), `decisions.js`
(331), `vitals.js` (291), `roles.js` (209), `navigation.js` (85), `constants.js`
(33). Every phase preserved the deterministic replay hash (294 tests green
throughout). Phases 3 and 4 were executed via a comment-aware mechanical
transform; phase 3↔4 were reordered (steering before roles) for dependency
correctness. `#moveThroughEntranceShaft` landed in steering (not navigation) to
avoid a navigation↔steering import cycle.

The `#decideAndMove` split (v0.31.5) turned a ~390-line dispatcher into a
~130-line guard ladder delegating to 7 terminal handlers in `decisions.js`. The
guard conditions and the two non-terminal (fall-through) blocks stayed inline,
so the per-tick `rng.*` order is byte-identical.

The remaining `Ant.update` orchestration split shipped in v0.56.1. It now
invokes explicit `#sensePhase` → `#choosePhase` → `#applyPhase` methods while
keeping the original hazard, local-action, movement, fallback, and vitals order
unchanged. A fixed-seed 360-tick replay baseline (`1910926194`) was captured
immediately before the extraction and is asserted by the suite (359 tests
green at landing).

## Constraints (read before touching anything)

1. **Determinism is a hard contract.** Per `docs/core-simulation-architecture.md`,
   the per-tick sequence of `rng.*` calls must stay byte-identical. The replay-hash
   regression test (in the suite) is the oracle: if RNG ordering drifts, it fails.
2. **No behavior change.** This is a pure structural refactor. Every phase must
   leave all tests green, including the fixed replay baseline.
3. **No new dependencies.** `node:test` + `node:assert/strict` only; no bundler.
4. Commit + version-bump (PATCH) per phase per the project rules; push to local branch.

## Mechanism: free-function modules

Extracted behavior becomes pure functions taking `ant` as the first argument,
grouped into modules under `src/sim/ant/`. Bodies move **verbatim** with `this`
rewritten to `ant`. This works cleanly here because the dependency flow is
one-directional: the methods staying in `Ant` (`update`, `#senseLocalContext`,
`#decideAndMove`, …) are the *callers*; the extracted clusters are *callees* that
read/write the ant's (all-public) instance fields and call each other, never
back into the class's remaining private methods.

```js
// src/sim/ant/steering.js
export function moveByPheromone(ant, world, rng, config, channel, entrance, colony, trailField = null) {
  // body verbatim; every `this.` -> `ant.`
}

// src/sim/ant.js
import * as steering from './ant/steering.js';
didMove = steering.moveByPheromone(this, world, rng, config, 'food', entrance, colony);
```

### Target file layout

| File | Cluster | ~Lines |
|---|---|---|
| `src/sim/ant.js` | `Ant` class: constructor, phased `update`, `#senseLocalContext`, `#applyPreMoveDecisions`, `#decideAndMove`, `#resolveHazard`, `#applyFallbackMovement`, static color getters | ~500 |
| `src/sim/ant/vitals.js` | vitals + feeding | ~250 |
| `src/sim/ant/navigation.js` | entrance/nest geometry | ~120 |
| `src/sim/ant/roles.js` | per-role behaviors | ~250 |
| `src/sim/ant/steering.js` | movement primitives | ~600 |

`#decideAndMove` (390-line dispatcher) is **explicitly out of scope** for this
pass — it is the highest RNG-ordering risk and stays intact.

## Public surface to preserve (verified via find_references)

Only three real importers touch `Ant`:
- `src/sim/colony.js` — constructs `new Ant(...)`, calls `.update()`.
- `src/render/SurfaceRenderer.js`, `src/render/NestRenderer.js` — static color
  getters (`getDefaultBaseColor`, `getJobColor`, …) + plain field reads (`x`, `y`,
  `role`, `state`, `alive`, `carrying`, …).

The constructor signature, `.update()`, the static getters, and all instance
field names must not change.

## Phases (incremental — one cluster per commit)

Ordered low-risk → high-risk so the cheap wins validate the mechanism first.

### Phase 1 — Vitals / Feeding  (lowest RNG risk)
Extract to `src/sim/ant/vitals.js`:
`#applyVitals`, `#applyStarvationRegenAging`, `#deathCause`, `#needsForage`,
`#tryEatFromNest`, `#tryEatNearbyPellet`, `#consumePelletForHealthThenCarry`,
`#consumePelletForHealth`, `#consumeCarriedFoodForHealth`, `#isLowHealth`,
`#isCriticalHealth`.

### Phase 2 — Entrance / Nest navigation (pure helpers only)
Extract to `src/sim/ant/navigation.js`:
`#getNestEntryTargetY`, `#isEntranceTransitState`, `#violatesEntranceCorridor`,
`#distanceToEntrance`, `#aimThetaAtEntrance`, `#entranceColumnOffset`.

**Note:** `#moveThroughEntranceShaft` is deferred to Phase 4. It calls the
steering primitive `#moveToward`, which itself calls the navigation predicates
`#isEntranceTransitState`/`#violatesEntranceCorridor` — a navigation↔steering
cycle. It is really a steering wrapper, so it moves with steering in Phase 4 to
avoid a cyclic import. Also retire the Phase-1 inlined distance calc in
`vitals.js` by importing `navigation.distanceToEntrance`.

### Phase 3 — Steering / movement primitives  (heaviest RNG)
**Reordered ahead of roles:** role behaviors call steering primitives, but
steering never calls roles — steering is the leaf, roles sit above it. Doing
steering first means roles (Phase 4) can import already-extracted functions.

Extract to `src/sim/ant/steering.js`:
`#moveByPheromone`, `#moveToward`, `#moveThroughEntranceShaft` (deferred from
Phase 2), `#thetaToDir`, `#computeDangerTurn`, `#computeObstacleTurn`,
`#updateWanderHeading`, `#pickDirectionalCandidate`, `#getCrowdingPenalty`,
`#getHomeScentWeight`. `steering.js` imports navigation predicates one-way
(no cycle). The shared `DIRS` and `gaussianRandom` (also used by the Ant
constructor) move to `src/sim/ant/constants.js` to avoid an ant<->steering cycle.

### Phase 4 — Role behaviors
Extract to `src/sim/ant/roles.js`:
`#isQueenFoodCourier`, `#runQueenCourierBehavior`, `#runNurseBehavior`,
`#runDiggerBehavior`. These call steering + navigation + vitals functions —
all extracted by now, so they import cleanly.

## Per-phase verification checklist

Run after **every** phase, before committing:

```
node --test test/*.mjs        # all tests must pass, replay baseline included
```

- [ ] All tests green (count unchanged or higher).
- [ ] Replay-hash test green (determinism intact).
- [ ] Browser preview sanity check (canvas renders, ants move) — sim is canvas-rendered.
- [ ] Version bumped (PATCH), committed, pushed to local branch.

## Rollback

Each phase is one self-contained commit. If the replay hash breaks and the cause
isn't an obvious `this`→`ant` typo, revert that single commit — earlier phases
remain valid.
