# Post-refactor Improvement Plan

## Current assessment

- Core boundaries are now explicit (`TickScheduler`, `MicroPatchEngine`, `MacroEngine`), but engine lifecycle wiring is repeated in multiple `SimulationCore` paths.
- Macro home-territory coordinates can drift when nest location changes unless explicitly synchronized.
- Macro state deserialization accepted raw objects without full validation.
- Determinism coverage exists, but lacked tests for nest relocation + macro sync.

## Recommended next improvements (small-step roadmap)

1. **SimulationCore lifecycle cleanup** (done): centralize engine rebuild in one helper to reduce drift bugs.
2. **Macro boundary hardening** (done): sanitize macro deserialization and keep home territory synchronized to nest moves.
3. **Deterministic contract tests** (done): add coverage for nest-tool macro sync and malformed macro save recovery.
4. **Phase extraction follow-up** (next): split `Ant.update` into pure helper phases (`sense`, `choose`, `apply`) without behavior changes.
5. **Input validation pass** (next): apply explicit range guards for non-pheromone config knobs used by ant and dig systems.
6. **Performance baselining** (later): add a reproducible micro-benchmark before making perf-oriented structural changes.
