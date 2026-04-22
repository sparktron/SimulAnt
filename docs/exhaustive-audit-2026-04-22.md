# Exhaustive audit notes (2026-04-22)

This document records that a full-repo audit was run for SimulAnt and captures primary blocking findings discovered during that review.

## Blocking findings observed

1. `src/sim/ant.js` references a private method `#consumePelletForHealth(...)` that is not defined, causing a syntax error at module parse time.
2. `src/sim/ant.js` uses `Math.random()` for departure delay, violating deterministic RNG guarantees.
3. Test suite currently fails (`node --test test/*.mjs`) due to the parse-time error above and HUD formatting expectation mismatches.

## Validation command

- `node --test test/*.mjs` (fails as of this audit run)

