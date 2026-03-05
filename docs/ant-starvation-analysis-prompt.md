# Ant starvation RCA prompt

You are debugging a deterministic ant-colony simulation.

## Goal
Determine why workers die while nest food is available, then propose the smallest safe fix.

## What to inspect
1. Worker decision order in `src/sim/ant.js` (`#decideAndMove`, `#tryEatFromNest`, `#needsForage`, low-health/critical-health branches).
2. Nest food consumption path in `src/sim/colony.js` (`consumeFromStore`, `#consumeNestFoodPellets`).
3. Config sanitization/defaults affecting hunger/health and forage behavior in:
   - `src/main.js`
   - `src/sim/core/SimulationTypes.js`
4. Existing regression tests in `test/core-simulation-architecture.test.mjs`.

## Required RCA output
- Exact branch/order condition that prevents nest feeding.
- Why that condition is reachable in normal gameplay.
- Minimal code change that preserves current behavior while unblocking nest feeding.
- At least one regression test scenario that would have failed before and passes after.

## Constraints
- Prefer reordering or small guards over large rewrites.
- Keep behavior deterministic.
- Do not add dependencies.
- Validate with focused test + full suite.
