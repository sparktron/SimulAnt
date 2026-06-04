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

2. **Food accounting — canonical model established (v0.40.0)**
   - `foodStored` is now the documented single canonical nest-food total, with two
     sub-ledgers (`_virtualFoodStored` bootstrap reserve + `nestFoodPellets`
     physical markers) that `consumeFromStore` keeps summing to it. The
     `getTotalStoredFood()` getter returns canonical `foodStored` directly (the old
     `max(foodStored, pelletTotal)` reconciliation just surfaced cosmetic pellet
     drift in the HUD). Guarded by an invariant test.
   - Remaining (minor): egg-laying deducts from `foodStored`+virtual but not
     `nestFoodPellets` (draining them would perturb deposit placement and break
     determinism), so the pellet ledger can drift slightly above `foodStored`.
     This is cosmetic (render/HUD only) and documented at `getTotalStoredFood`.

3. **Save/load schema migration is minimal**
   - Load path now sanitizes config, but versioned schema migration/repair is still limited.

4. **UI control duplication remains partially legacy-driven**
   - Legacy sliders are wired into canonical state, but old UI affordances still exist and can confuse future maintainers.

5. **Performance risk at high entity counts** (partially mitigated, v0.32.0)
   - Profiled (docs/perf-profile-2026-06-02.md): the full-grid pheromone update
     dominates (~28% of tick), not the suspected food-pellet scans (~0.7%).
   - Mitigated: passability-mask caching + pheromone double-buffering cut the
     pheromone path ~18% and whole-tick time ~8% (behavior-preserving, hash
     verified). Remaining lever is active-cell tracking for evaporation (rec #3),
     deferred as a riskier algorithmic change.
   - Note: the colony starves to zero before reaching truly large ant counts, so
     per-tick perf-at-scale is partly moot until starvation is addressed.

## Suggested next actions
- Continue Option B decomposition by extracting ant role handlers and shared state-machine utilities.
- Introduce explicit save schema versions with migration tests.
- Add profiling harness for large-ant scenarios and set performance budgets.
