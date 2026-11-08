# Current Status

**Updated:** 2026-11-08 · **Branch:** `master` · **Release:** `v0.61.0`

## GUI update — 2026-11-08, v0.61.0

- Added live Classic / Retro Polished / Modern Sleek themes in the header.
  The preference persists separately from simulation saves. Switching preserves
  simulation state, paused state, active tab, tools, sliders, and selected ant.
- Classic styles.css is byte-for-byte unchanged. Terrain hashes captured before
  refactoring still match in surface, scent/danger, and nest modes.
- Retro adds brass/cream controls, LCD stats, pixel sprites, stepped mounds,
  deterministic terrain dithering, and cached scanlines/vignette. Modern adds
  dark panels, live telemetry, stat cards, distribution bars, vector sprites,
  hex entrances, glow sprites, and a separately cached pheromone heatmap.
- Both minimaps, parameter controls, dialogs, overlays, tool radios, keyboard
  shortcuts, and vertical health fills are retained. Sprite and heading caches
  remain renderer-owned. No simulation source or save-format change is made.
- Reconciled the GUI refactor with concurrent ant-lion commit b0a2fc6 and rival
  behavior commit 5c9230d. Their rendering and behavior are preserved. Existing
  food-replenishment working edits remain outside the GUI commit.
- Validation: full Node test suite and determinism guard passed after integration.
  New tests cover theme defaults/storage/errors/listeners, pre-refactor terrain
  hashes, camera/world identity, original DOM IDs, and render-only state ownership.
  Browser checks cover all three themes, both views, advancing ticks across live
  switches, paused switching, retained PARAMS/JOBS state, theme restoration,
  SCENT/JOBS, help/status dialogs, and successful save/load feedback. No app
  console errors were observed; the default-world FPS readout stayed near 60.
- Limits: the HTML mockup referenced in the design prompt was unavailable, so
  styling follows the written specifications. Full simulation performance with
  2,000 ants per colony and Node 20/22 CI were not benchmarked in this session.
  Google Fonts are optional in the new themes; Classic makes no font requests.
- Next: finish the concurrent food-replenishment work independently, then run
  high-population performance checks on target hardware. GUI implementation is
  complete; README documents themes and required static-deployment files.

## Session update — 2026-11-08, v0.60.0

- Added seeded, stationary surface ant lions: up to four alive, clear-ground
  placement, one replacement per 900 ticks when capacity is available.
- Nearby ants from either colony are eaten, with a 30-tick feeding cooldown.
  Feeding restores 100 health and resets hunger. After 900 unfed ticks,
  health falls by 0.25 per tick (death after another 400 ticks).
- Surface pits and health bars are visible; lifecycle, spawn timer, and predator
  RNG state survive save/load. Older saves receive an initial population.
- Validation: `node --test test/*.mjs` passed 420/420 tests;
  `node scripts/check-determinism.mjs` passed; `git diff --check` passed.
  Chrome at a loopback dev server showed the pits, health bars, and v0.60.0.
- Existing rival-behavior work was committed concurrently as `5c9230d`.
  Food-replenishment changes remain in progress in the shared working tree;
  those files are outside the ant-lion commit. Reconcile their version and
  replay baseline when finishing that work.
- No external dependencies, world dimensions, pheromone tuning, or fixed
  macro/micro tick ordering changed. No cross-repository contracts touched.

The sections below retain the earlier 2026-08-30 baseline for context.

## Objective

A browser-playable ant colony simulation with dual surface/nest views, purely
local ant AI producing emergent colony behaviour, pheromone-driven foraging, and
two competing queen-led colonies. It ships as static files: no build step, no
package manager, and a deterministic seeded tick contract that tests replay
exactly.

## Current state

- v0.59.0 gives red ants the same physical attributes, caste defaults, work
  allocation, and digging support as black ants. Each colony excavates from its
  own home and tracks its own entrances and soil mounds.
- Healthy, fed red surface foragers and soldiers may pursue locally sensed
  opponents within six tiles. Cargo, queen couriers, nest work, and recovery
  retain priority. Red aggression defaults to a 2× engagement multiplier;
  health and combat damage are unchanged.
- Fighting ants appear purple in normal mode in both views. JOBS mode includes
  a red Fight color for fighting/pursuit and now applies to both colonies.
- Rival digging state is optional in existing schema-v4 saves. Reset/load
  initializes both colonies' digging navigation consistently; new saves retain
  rival fronts, progress, shafts, and auto-dig state.
- Static vanilla JavaScript, no build step or package manager. Seeded randomness,
  local ant decisions, typed world arrays, and macro/micro phase order remain
  required contracts.

## Active work

This feature is complete. Concurrent food-replenishment edits were present in
this checkout during validation and were excluded from this feature's commit.
Do not discard or accidentally commit those remaining changes.

## Next

1. Implement a fed, nest-resident breeder lifecycle with an explicit role in
   queen succession, before re-enabling breeder allocation and hatching. Breeder
   hatching is currently disabled and legacy saved breeders migrate to workers
   (v0.57.5; `docs/open-items-todo.md`, "Future features").
2. Continue the environmental-foraging programme through
   `bench/environmental-foraging-sweep.mjs` and
   `docs/environmental-foraging-tests.md`. Pheromone-behaviour tuning is
   recorded as exhausted — the forward lever is the environment (respawn rate,
   vision radius, ant count), not searcher steering.
3. Reconcile `docs/KNOWN_ISSUES.md` with the foraging results (see Known
   problems).

## Known problems

- **Performance at high entity counts is only partially mitigated.**
  `docs/KNOWN_ISSUES.md` and `docs/perf-profile-2026-06-02.md` record that the
  full-grid pheromone update dominates the tick (~28%), not the food-pellet
  scans that were suspected (~0.7%). Passability-mask caching, pheromone
  double-buffering, active-cell updates (v0.37.0), and cached surface terrain
  rendering (v0.54.9) are applied; the item is still open.
- **`docs/KNOWN_ISSUES.md` contradicts `docs/open-items-todo.md` on starvation.**
  The performance entry in `KNOWN_ISSUES.md` asserts that "the colony starves to
  zero before reaching truly large ant counts", so perf-at-scale is "partly
  moot". `docs/open-items-todo.md` items 22–23 record the opposite outcome after
  the 30–60-tile food-drop band shipped in v0.56.3: a 12-seed validation
  averaging 261.3 final ants, a 217 minimum, and queens alive 12 of 12. File
  timestamps favour the roadmap — `KNOWN_ISSUES.md` last changed 2026-07-12,
  `open-items-todo.md` 2026-08-23 — but the sweep was not re-run here, so which
  claim currently holds is unverified. The two documents cannot both be current.

## Validation state

Run on 2026-11-08 with Node v24.16.0:

- `node --test --test-reporter=tap test/*.mjs` → 415 passed, zero failures in
  the shared checkout, including concurrent food-replenishment tests.
- The exact staged feature source was exported with `git checkout-index` to
  `/tmp/simulant-staged-check`; its full suite → 410 passed, zero failures.
- `node scripts/check-determinism.mjs` → passed; no `Math.random()` in `src/`.
- `git diff --check` → passed.
- Browser visual verification used the real SurfaceRenderer and NestRenderer
  with fixed combat fixtures: purple fighting black/red workers in normal
  mode, red fighting black/red workers in JOBS mode, normal colony colors for
  non-fighting workers. This is a renderer fixture check, not a full UI audit.
- Regression tests cover attribute/work parity, red worker/soldier pursuit,
  spatial occupancy, cargo/courier/nest-work/healing priorities, disabled combat,
  engagement odds without damage buffs, rival excavation, and save/load replay.
- Both colonies passed the existing 6,000-tick production-default survival test.

## Unverified

- Node 20 and Node 22 CI matrix legs were not run locally in this session.
- Remote CI status and long benchmark sweeps were not checked.
- Full interactive camera, controls, and live fight visibility were not audited.
  Duels still resolve to one survivor within one tick; purple follows `FIGHT`
  state and returns to the base color when ordinary behavior resumes.
- The non-master local branches were not examined.

## Recent decisions

- Pheromone steering is closed as a forward lever — `docs/pheromone-strategy.md`
  ("What FAILED — do NOT retry"), with `docs/open-items-todo.md` items 12 and 13
  recording two-pheromone recruitment (v0.49.1) and the exploration/dispersion
  field (v0.49.3) as measured net-negative across 12 seeds.
- Breeder caste disabled until it has a viable lifecycle — v0.57.5,
  `docs/open-items-todo.md` item 33.
- Tick order fixed as `MacroEngine → MicroPatchEngine`, and inside Micro
  `colony.update() → digSystem.update() → world.updatePheromones()` —
  `docs/core-simulation-architecture.md`.
- `foodStored` established as the single canonical nest-food total, guarded by an
  invariant test — v0.40.0 and v0.56.0, `docs/KNOWN_ISSUES.md` item 1.
- CI added alongside project-contract guards — commit `0bda15f`,
  `.github/workflows/ci.yml`.

## Deep context

| Topic | Document |
|---|---|
| Roadmap and open items | `docs/open-items-todo.md` |
| Deterministic tick contract and module boundaries | `docs/core-simulation-architecture.md` |
| Pheromone experiments, including failed approaches | `docs/pheromone-strategy.md` |
| Environmental foraging programme | `docs/environmental-foraging-tests.md` |
| Exploration/dispersion field design (tested, failed) | `docs/exploration-field-design.md` |
| Known issues | `docs/KNOWN_ISSUES.md` |
| Performance profile and budgets | `docs/perf-profile-2026-06-02.md` |
| Starvation collapse root-cause analysis | `docs/starvation-collapse-rca-2026-06-02.md` |
| Systematic code-review status | `docs/code-review-plan-2026-05-30.md` |
| Ant health system review | `docs/ant-health-system-review.md` |
| Codebase onboarding walkthrough | `docs/onboarding-analysis.md` |
| Post-refactor plan (all items complete) | `docs/post-refactor-improvement-plan.md` |
| Change history | `CHANGE_HISTORY.md` |
