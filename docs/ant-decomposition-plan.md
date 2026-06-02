# Ant Class Decomposition Plan

Decompose the 1,820-line `src/sim/ant.js` `Ant` class into smaller, focused
behavior units. Tracks KNOWN_ISSUES #1 and `open-items-todo.md` item #5.

## Constraints (read before touching anything)

1. **Determinism is a hard contract.** Per `docs/core-simulation-architecture.md`,
   the per-tick sequence of `rng.*` calls must stay byte-identical. The replay-hash
   regression test (in the suite) is the oracle: if RNG ordering drifts, it fails.
2. **No behavior change.** This is a pure structural refactor. Every phase must
   leave all 294 tests green, including the replay hash.
3. **No new dependencies.** `node:test` + `node:assert/strict` only; no bundler.
4. Commit + version-bump (PATCH) per phase per the project rules; push to local branch.

## Mechanism: free-function modules

Extracted behavior becomes pure functions taking `ant` as the first argument,
grouped into modules under `src/sim/ant/`. Bodies move **verbatim** with `this`
rewritten to `ant`. This works cleanly here because the dependency flow is
one-directional: the methods staying in `Ant` (`update`, `#sense`,
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
| `src/sim/ant.js` | `Ant` class: constructor, `update`, `#sense`, `#applyPreMoveDecisions`, `#decideAndMove`, `#resolveHazard`, `#applyFallbackMovement`, static color getters | ~500 |
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

### Phase 2 — Entrance / Nest navigation
Extract to `src/sim/ant/navigation.js`:
`#getNestEntryTargetY`, `#moveThroughEntranceShaft`, `#isEntranceTransitState`,
`#violatesEntranceCorridor`, `#distanceToEntrance`, `#aimThetaAtEntrance`,
`#entranceColumnOffset`.

### Phase 3 — Role behaviors
Extract to `src/sim/ant/roles.js`:
`#isQueenFoodCourier`, `#runQueenCourierBehavior`, `#runNurseBehavior`,
`#runDiggerBehavior`. (These call steering + navigation functions — import them.)

### Phase 4 — Steering / movement primitives  (heaviest RNG)
Extract to `src/sim/ant/steering.js`:
`#moveByPheromone`, `#moveToward`, `#thetaToDir`, `#computeDangerTurn`,
`#computeObstacleTurn`, `#updateWanderHeading`, `#pickDirectionalCandidate`,
`#getCrowdingPenalty`, `#getHomeScentWeight`, plus the module-level `DIRS` and
`gaussianRandom` helpers if only used here.

## Per-phase verification checklist

Run after **every** phase, before committing:

```
node --test test/*.mjs        # all 294 must pass, replay-hash included
```

- [ ] All tests green (count unchanged or higher).
- [ ] Replay-hash test green (determinism intact).
- [ ] Browser preview sanity check (canvas renders, ants move) — sim is canvas-rendered.
- [ ] Version bumped (PATCH), committed, pushed to local branch.

## Rollback

Each phase is one self-contained commit. If the replay hash breaks and the cause
isn't an obvious `this`→`ant` typo, revert that single commit — earlier phases
remain valid.
