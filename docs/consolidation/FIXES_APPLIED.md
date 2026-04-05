# Fixes Applied During Consolidation

## Fix 1: Missing closing brace in ant.js (pre-existing on master)

- **File**: `src/sim/ant.js`, line 130
- **Root cause**: Pre-existing bug on master. The `if (this.#isQueenFoodCourier(colony))` block at line 129 was missing its closing `}` after the `return` on line 130. This caused all subsequent code in `#decideAndMove` to be nested inside the courier check, and more critically, `#resolveHazard` (line 320) was parsed at brace depth 3 instead of 2, making Node.js reject it as a syntax error when importing as an ES module.
- **Impact**: All tests importing `ant.js` (via `SimulationCore`) would fail with `SyntaxError: Unexpected identifier '#resolveHazard'`.
- **Fix**: Added missing `}` after line 130.
- **Category**: Pre-existing master bug (not caused by PR merge).

## Fix 2: PR #34 tests assume instant brood hatching (merge incompatibility)

- **File**: `test/core-simulation-architecture.test.mjs`, tests "brood hatching follows caste allocation including breeders" and "newly spawned workers receive workFocus assignments from work allocation"
- **Root cause**: PR #34 was written against a codebase where brood hatched in a single tick. Master now uses `broodGestationSeconds` (default 8 seconds), so a single `sim.update()` call produces zero hatched ants.
- **Impact**: Both tests expected ants to exist after one update tick but got zero.
- **Fix**: Added `config.broodGestationSeconds = 0.001` and replaced single `sim.update()` with multi-tick loops (`120` and `60` iterations respectively), matching the pattern already used by other hatch tests in the same file.
- **Category**: PR merge incompatibility (PR #34 stale relative to master's gestation feature).
