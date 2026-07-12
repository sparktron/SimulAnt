# Known Issues

## Active

1. **Food accounting — canonical model established (v0.40.0)**
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

2. **Save/load schema migration is minimal**
   - Saves carry schema version 1; legacy saves are handled defensively and
     newer saves emit a diagnostic. Future incompatible format changes still
     need explicit migration steps.

3. **UI control duplication remains partially legacy-driven**
   - Legacy sliders are wired into canonical state, but old UI affordances still exist and can confuse future maintainers.

4. **Performance risk at high entity counts** (partially mitigated)
   - Profiled (docs/perf-profile-2026-06-02.md): the full-grid pheromone update
     dominates (~28% of tick), not the suspected food-pellet scans (~0.7%).
   - Mitigated: passability-mask caching + pheromone double-buffering cut the
     pheromone path ~18% and whole-tick time ~8%; active-cell pheromone updates
     landed in v0.37.0, and surface terrain rendering is cached in v0.54.9.
   - Note: the colony starves to zero before reaching truly large ant counts, so
     per-tick perf-at-scale is partly moot until starvation is addressed.

## Suggested next actions
- Add profiling harness for large-ant scenarios and set performance budgets.
