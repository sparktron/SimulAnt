# Open Items / TODO Plan

## Completed in this session (Option A)

1. ✅ Implemented `diffIntervalTicks` cadence gating for diffusion while keeping evaporation active each tick.
2. ✅ Added simulation module smoke-import test coverage.
3. ✅ Sanitized loaded runtime config before applying it to active state.
4. ✅ Routed legacy caste sliders through colony-status allocation state updates.
5. ✅ Added deterministic replay hash regression test.

## Near-term (next session)

1. **Harden save/load validation path further**
   - Add schema-version guard with migration fallback and corruption diagnostics.

## Medium-term

5. **Refactor `Ant` class into smaller behavior units**
   - Extract steering, feeding, and role behavior handlers to reduce complexity and regression risk.

6. **Optimize hot loops with measured profiling**
   - Profile pheromone updates and food-pellet scans under large colonies.
   - Add benchmark scenarios with fixed seeds.

7. **Consolidate food accounting model**
   - Clarify canonical source across `foodStored`, virtual reserve, pellet lists, and world tile cache.

## Low-priority / cleanup

8. **Consolidate style source of truth**
   - Reduce duplication between inline `<style>` in `index.html` and `styles.css`.

9. **Improve dev server path safety**
   - Sanitize request paths in `server.js` to prevent accidental path traversal during local hosting.

10. **Harden the config-integrity invisible-knob check for optional chaining**
    - `test/config-integrity.test.mjs` Test 1 regex `config\.X ??` misses `config?.X ??`.
      `minSurfacePellets` stayed invisible because of this (fixed 2026-06-27). A new
      `config?.`-read knob would slip the guard. See
      `docs/2026-06-27-depletion-reactive-and-config-cleanup.md` Part 3.

11. **Remove stale fixture keys for swept config params**
    - Several `test/*.mjs` config fixtures still list removed params (`digChance`,
      `foodPickupRate`, `randomTurnChance`, etc.) as inert extra keys. Harmless; churn to remove.

## Pheromone roadmap (next forward lever)

12. **Two-pheromone recruitment** (`docs/pheromone-strategy.md` future-direction #3)
    - De-risked by depletion-reactive decay (v0.47.0): trails now point at live sources,
      so strengthening recruitment may finally be safe (was a trap — see Phase 2 finding).
    - Gate on `bench/forage-ab.mjs`; win condition is pickups ON ≥ OFF.
