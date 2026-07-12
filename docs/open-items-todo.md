# Open Items / TODO Plan

Status checked against landed `master` at **v0.54.11** on 2026-07-12. The
uncommitted worktree changes were excluded from this reconciliation.

## Completed

1. ✅ Implemented `diffIntervalTicks` cadence gating for diffusion while keeping evaporation active each tick.
2. ✅ Added simulation module smoke-import test coverage.
3. ✅ Sanitized loaded runtime config before applying it to active state.
4. ✅ Routed legacy caste sliders through colony-status allocation state updates.
5. ✅ Added deterministic replay hash regression test.
6. ✅ Added save schema versioning, legacy-save handling, forward-version
   diagnostics, and round-trip tests (v0.30.0).
7. ✅ Completed the `Ant` decomposition into vitals, navigation, steering,
   roles, and decision modules (v0.31.1–v0.31.5).
8. ✅ Established `foodStored` as the canonical spendable nest-food total
   (v0.40.0).
9. ✅ Hardened the dev server against raw and encoded path traversal
   (v0.30.1).
10. ✅ Added deterministic long-run survival coverage and corrected the
    surface-count respawn safety net (v0.50.0 onward).
11. ✅ Added biological growth controls and nest-space carrying capacity,
    including serialized crowding state (v0.52.0–v0.54.4).
12. ✅ Hardened the config-integrity scan to detect optional-chained inline
    fallbacks such as `config?.foo ?? fallback` (v0.54.6).
13. ✅ Made saves resilient to local-storage failures, preserved ant
    id-derived behavior across reloads, and added exact Float32 field
    round-trips (v0.54.7–v0.54.11).

## Active near-term

1. **Optimize hot loops with measured profiling**
   - Profile pheromone updates and food-pellet scans under large colonies.
   - Add benchmark scenarios with fixed seeds.

## Medium-term

1. **Consolidate style source of truth**
   - Reduce duplication between inline `<style>` in `index.html` and `styles.css`.

## Low-priority / cleanup

3. **Remove stale fixture keys for swept config params**
    - Several `test/*.mjs` config fixtures still list removed params (`digChance`,
      `foodPickupRate`, `randomTurnChance`, etc.) as inert extra keys. Harmless; churn to remove.

## Pheromone roadmap (next forward lever)

12. **Two-pheromone recruitment** (`docs/pheromone-strategy.md` future-direction #3) — ❌ TESTED, NET-NEGATIVE
    - Scaffold shipped v0.49.0 (`config.dualPheromone`, default off); A/B'd v0.49.1.
    - Loses to single mode at every tuning (12-seed: single +0.5%/+9 vs best dual
      −3.8%…−6.1%/−26…−51). Rich-only gating (`recruitRichOnly`) didn't help.
    - Root cause: recruitment amplifies EXPLOITATION; this sim's bottleneck is
      EXPLORATION of relocating food. Moved to the FAILED table. Toggle kept (off) as
      a scaffold for a future exploration-PRESERVING recruitment idea only.
    - A real #3 would push searchers toward NET-NEW territory, not onto known food.

13. **Exploration / dispersion field** (`docs/exploration-field-design.md`) — ❌ TESTED, FAILED (v0.49.3)
    - Built increments 1–4. Role B (searcher dispersion) net-negative at every dose
      (12-seed: single +9 pickups vs best exploration −19; circling spikes to ~9–14%).
      Role C (dead-source repulsion) almost never fires (ants pick in abundance).
    - CONCLUSION: the single path is at the environment's DISCOVERY CEILING. Both attract
      (recruitment) and repel (dispersion) searcher interventions lose to doing nothing →
      searcher steering is not the binding constraint. In the FAILED table.
    - To raise discovery, change the ENVIRONMENT (food respawn rate, foodVisionRadius,
      ant count), not the pheromones. Pheromone-behavior tuning is exhausted.

14. **Environmental foraging tests** (`docs/environmental-foraging-tests.md`) — ⏭️ SCOPED, heir to #12/#13
    - Heir to the discovery-ceiling finding: raise foraging *income* via the environment,
      objective = stop the starvation collapse (`docs/starvation-collapse-rca-2026-06-02.md`).
    - Levers: foodVisionRadius, minSurfacePellets, bootFoodTotal, drop distance, antCap,
      pellet nutrition. Harness: `bench/starvation-trace.mjs` (long runs ≥8000, abs outcomes).
    - E1 (pivotal): sweep minSurfacePellets UP → supply-bound vs search-bound. Then E2 vision.
    - ⚠️ CONFOUND FIRST: the respawn safety net (RCA cause #2) gates on surface count, never
      fires — a MECHANISM bug that may dominate any environment sweep. Fix/characterize up front.
    - Difficulty decision, not an optimization: pick a target population before declaring a win.
