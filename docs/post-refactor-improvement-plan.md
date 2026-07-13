# Post-refactor Improvement Plan

Status checked against landed `master` at **v0.56.1** on 2026-07-12. The
uncommitted worktree changes were excluded from this reconciliation.

## Current assessment

- Core boundaries are explicit (`TickScheduler`, `MicroPatchEngine`, `MacroEngine`),
  and `SimulationCore` now centralizes engine rebuild wiring.
- Macro home-territory synchronization and defensive macro deserialization are
  implemented and covered by deterministic tests.
- The `Ant` class has since been decomposed into focused behavior modules
  (`src/sim/ant/`), and `Ant.update` has explicit sense → choose → apply
  orchestration without changing the replay contract.
- Config sanitization covers the shipped runtime surface, and the
  config-integrity scan now recognizes optional-chained fallbacks.
- Save restoration validates its structural boundary before mutating live
  state, while legacy saves retain compatible defaults where possible.
- The caste-allocation triangle is the sole user-facing soldier-allocation
  control; obsolete duplicate state has been removed.
- The save boundary has named migrations through schema v3, and the food
  ledger balances physical, virtual, and signed non-pellet adjustments.

## Recommended next improvements (small-step roadmap)

1. **SimulationCore lifecycle cleanup** (done): centralize engine rebuild in one helper to reduce drift bugs.
2. **Macro boundary hardening** (done): sanitize macro deserialization and keep home territory synchronized to nest moves.
3. **Deterministic contract tests** (done): add coverage for nest-tool macro sync and malformed macro save recovery.
4. **Pure phase extraction** (done): `Ant.update` now has explicit `sense`,
   `choose`, and `apply` phases, protected by a pre-extraction fixed-seed
   replay baseline (v0.56.1). The lower-risk module decomposition landed in
   v0.31.1–v0.31.5.
5. **Config-integrity hardening** (done): the invisible-knob check detects
   optional-chained reads such as `config?.foo ?? fallback` (v0.54.6).
6. **Performance baselining** (done): fixed-seed whole-tick and pheromone
   benchmark budgets are documented in `docs/perf-profile-2026-06-02.md`.
