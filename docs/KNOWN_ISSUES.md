# Known Issues

## Active

1. **Food accounting — canonical model established (v0.56.0)**
   - `foodStored` is now the documented single canonical nest-food total, with two
     sub-ledgers (`_virtualFoodStored` bootstrap reserve + `nestFoodPellets`
     physical markers) that `consumeFromStore` keeps summing to it. The
     `getTotalStoredFood()` getter returns canonical `foodStored` directly (the old
     `max(foodStored, pelletTotal)` reconciliation just surfaced cosmetic pellet
     drift in the HUD). Guarded by an invariant test.
   - A signed non-pellet adjustment records egg investment and oophagy recycling,
     so `foodStored` exactly reconstructs from virtual food, pellet markers, and
     the adjustment without changing deterministic marker placement.

2. **Future save-schema migration work**
   - Saves carry schema version 3; v0→v1, v1→v2, and v2→v3 are named,
     non-mutating migration steps. Malformed structure is rejected atomically and
     newer saves emit a diagnostic. Future incompatible formats need another
     named migration and test.

3. **Performance risk at high entity counts** (partially mitigated)
   - Profiled (docs/perf-profile-2026-06-02.md): the full-grid pheromone update
     dominates (~28% of tick), not the suspected food-pellet scans (~0.7%).
   - Mitigated: passability-mask caching + pheromone double-buffering cut the
     pheromone path ~18% and whole-tick time ~8%; active-cell pheromone updates
     landed in v0.37.0, and surface terrain rendering is cached in v0.54.9.
   - Note: the colony starves to zero before reaching truly large ant counts, so
     per-tick perf-at-scale is partly moot until starvation is addressed.

## Suggested next actions

- Use the fixed-seed performance budgets before optimizing a hot path.
