# Open Items / TODO Plan

Status checked against landed `master` at **v0.56.9** on 2026-07-12. The
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
14. ✅ Made restore validation atomic: malformed world, nest, and ant data is
    rejected before it can replace the live simulation (v0.54.12).
15. ✅ Removed the duplicate soldier-allocation parameter control and obsolete
    `casteTargets` save state; the caste triangle is canonical (v0.54.13).
16. ✅ Removed stale test fixture keys for retired configuration parameters.
17. ✅ Consolidated styling in `styles.css`; `index.html` no longer carries an
    inline duplicate stylesheet (v0.54.14).
18. ✅ Added fixed-seed performance baselines and opt-in budget checks for
    whole ticks and pheromone updates.
19. ✅ Added named, sequential save migrations through schema v3 (v0.55.0–v0.56.0).
20. ✅ Balanced the canonical food ledger with signed non-pellet adjustments,
    preserving physical nest-marker placement and determinism (v0.56.0).
21. ✅ Split `Ant.update` into explicit sense → choose → apply phases without
    changing RNG ordering, protected by a captured fixed-seed replay baseline
    (v0.56.1).
22. ✅ Added a 16,000-tick multi-seed environmental-foraging sweep and selected
    30–60-tile food drops: its 12-seed validation averaged 261.3 final ants,
    bottomed at 217, and retained every queen and the ≥150-ant target
    (v0.56.2–v0.56.3).
23. ✅ Validated the 300-ant nest-capacity baseline over 20 seeds × 18,000 ticks:
    tighter caps significantly reduce final population, while 450/600 raise the
    peak without a detectable final-population gain.
24. ✅ Extended environmental-foraging reports with deposited nutrition, store
    consumption, net flow, and death-cause summaries per seed (v0.56.4).
25. ✅ Completed the GUI control review: save/load now reconciles visible
    controls, Food Economy parameters render, preset load/delete actions work,
    toggle buttons report state, and health/allocation visualizations are
    labeled and keyboard-accessible (v0.56.9).

## Active work

No general maintenance fixes are currently queued. The remaining planned work is
the experiment-driven environmental foraging program below.

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

14. **Environmental foraging tests** (`docs/environmental-foraging-tests.md`) — ✅ INITIAL FIX LANDED
    - Target: every fixed seed retains at least 150 ants at tick 16,000; retain the
      300-ant nest-capacity ceiling.
    - `bench/environmental-foraging-sweep.mjs` characterizes supply, vision, and
      drop-distance changes without retracing failed pheromone work.
    - Initial results: supply-800 186.3 final; vision-24 164.3; baseline 199.3;
      close 30–60 drops 236.0 and 3/3 target hits. The close band ships in v0.56.3.
    - Follow-up 12-seed validation: close drops average 261.3 final ants, with a
      217 minimum, queens alive 12/12, and target hits 12/12.
