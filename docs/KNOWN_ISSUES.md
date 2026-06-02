# Known Issues

## Active

1. **Ant behavior class — decomposed (v0.31.1–v0.31.5) ✅**
   - `src/sim/ant.js` reduced from 1820 → 441 lines. Vitals/feeding, navigation,
     steering, role behaviors, and the worker/soldier decision handlers now live
     in `src/sim/ant/{vitals,navigation,steering,roles,decisions,constants}.js`
     as pure free functions. The class retains construction, the tick
     orchestrator (`update`/`#sense`), the `#decideAndMove` guard ladder (a slim
     dispatcher delegating to `decisions.js`), hazard/fallback handling, and
     static color getters.
   - `#decideAndMove` was split (v0.31.5): ~390-line dispatcher → ~130-line guard
     ladder + 7 terminal handlers in `decisions.js`. Determinism preserved.
     This issue is resolved; see docs/ant-decomposition-plan.md.

2. **Food accounting still has multiple physical representations**
   - Canonical getters exist, but storage remains distributed across `foodStored`, virtual reserve, and pellet records.

3. **Save/load schema migration is minimal**
   - Load path now sanitizes config, but versioned schema migration/repair is still limited.

4. **UI control duplication remains partially legacy-driven**
   - Legacy sliders are wired into canonical state, but old UI affordances still exist and can confuse future maintainers.

5. **Performance risk at high entity counts**
   - World-scale pheromone updates and some per-tick scans remain hotspot candidates.

## Suggested next actions
- Continue Option B decomposition by extracting ant role handlers and shared state-machine utilities.
- Introduce explicit save schema versions with migration tests.
- Add profiling harness for large-ant scenarios and set performance budgets.
