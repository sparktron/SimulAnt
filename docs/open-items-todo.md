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
