# Current Status

**Updated:** 2026-11-08 · **Branch:** `master` · **Release:** `v0.64.1`

## Themes: 90s Retro + Realistic — 2026-11-08, v0.62.2 → v0.64.1

- Added two live themes, now five in total: **90s Retro** (`nineties`) and
  **Realistic** (`realistic`). Each is a stylesheet in `themes/` (verbatim
  `styles.css` base plus overrides, like Retro and Modern) and a renderer skin
  in `src/render/skins/`. No DOM IDs were added or renamed, and no sim code changed.
- Refactor (v0.62.2): the `skin.name === 'modern'/'classic'` checks in
  `MiniMap`, `SurfaceRenderer` and `NestRenderer` are now skin properties:
  `minimapAntColor`, `minimapViewport`, `fieldsInTerrain`, `usesHeading`.
  `test/theme-regression.test.mjs` locks Classic, Retro and Modern
  surface/scent/jobs/nest/minimap output to golden digests recorded before the
  refactor. They still match.
- 90s Retro (v0.63.0, perf v0.63.1): silver bevelled chrome, navy title bar,
  sunken status wells, segmented bars, and no webfonts. VGA palette, Bayer
  dither, pixel ant atlas (4 directions × 2 walk frames, zoom ≥ 4; classic dot
  below), pixel queen, and dithered mound. Static ground colours come from a
  per-world `tileTableCache()` table.
- Realistic (v0.64.0): a full-viewport canvas with glass panels. Scrims are
  `.playfield` pseudo-elements. Seeded-noise terrain and prebaked ant, queen,
  seed, larva and mound sprites. The new optional `skin.composeTerrain()` hook
  bakes a smooth 4× upscale plus grain once per terrain rebuild, so each frame
  is a single nearest-neighbour blit.
- Fix (v0.64.1): after a theme switch the canvas was measured while the
  previous, retained sheet was still applied, so it relied on `ResizeObserver`
  to correct the size. `main.js` now re-measures after that sheet is removed.
  This affected all themes.
- Render cost per frame (1000×700 offscreen, real default world, hidden browser
  pane, so read these as relative): classic 0.8 ms (2.1 with scent), retro 4.0
  (6.2), modern 8.6 (15.6), 90s 1.0 (3.3), realistic 4.6 (9.3). Terrain
  rebuild: 90s ~3 ms and realistic ~1 ms, against ~1.6 ms for classic.
  `bench/tick-profile.mjs` is sim-only and unaffected.
- Validation: `node --test test/*.mjs` 468/468, `scripts/check-determinism.mjs`
  OK. New tests cover registration, persistence and fallback; the full skin
  interface; RGB range and purity; purple reserved for duels; rendering every
  theme leaving the sim RNG and state untouched; and the theme sheets,
  pre-paint map and `<option>`s staying in sync. Browser checks cover all five
  live switches with correct canvas backing size, both views, low and high
  zoom, scent and jobs overlays, minimaps, queen, larvae, mounds and selection.
  No console errors were seen.
- Limits: the Browser pane was hidden during most checks, so FPS readouts were
  throttled. Render timing used direct offscreen draws, and visuals were
  checked through exported canvas images. 2,000-ant populations and real GPU
  frame times were not measured. The design mockups' extra status strip
  (BLK/SEL/RED bars under the canvas) was not added, because it would need new
  DOM and JS; the existing `.canvas-footer` is styled as the status bar instead.

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

## Food replenishment cap — v0.59.0 (2026-11-08)

- Added `maxSurfacePellets`, default **500**, exposed as **Max Surface Food**
  in Params → Food Economy. Both surface-low and hunger-triggered drops obey
  this ceiling and fit the remaining capacity. Carried pellets do not count.
- At or above the cap, replenishment pauses until collection creates room;
  zero disables replenishment. Existing and manually placed food is preserved.
- Validation: `node --test test/*.mjs` passed all 35 test files in a clean
  snapshot containing only this change; the focused food-economy suite passed
  24 tests. `node scripts/check-determinism.mjs` passed.
- Review follow-up: added a seeded `SimulationCore` integration test using real
  tick updates, real cluster spawning, and an actual ant pickup. It verifies
  that drops pause across ticks at capacity and resume after collection.
- Browser: the new control and v0.59.0 were visually checked before the final
  default changed from 1,000 to 500. Rechecking the final default was blocked
  by browser unavailability. Long-run colony balance was not measured.
- Active work: food cap complete; review and merge the PR. Concurrent rival
  behavior edits in the original checkout are excluded from this change.

The sections below record the previous v0.58.1 baseline.

## Session update — 2026-11-08, v0.60.0

- Added seeded, stationary surface ant lions: up to four alive, clear-ground
  placement, one replacement per 900 ticks when capacity is available.
- Nearby ants from either colony are eaten, with a 30-tick feeding cooldown.
  Feeding restores 100 health and resets hunger. After 900 unfed ticks,
  health falls by 0.25 per tick (death after another 400 ticks).
- Surface pits and health bars are visible; lifecycle, spawn timer, and predator
  RNG state survive save/load. Older saves receive an initial population.
- Validation after merging current master: `node --test test/*.mjs` passed
  all 37 test files;
  `node scripts/check-determinism.mjs` passed; `git diff --check` passed.
  Chrome at a loopback dev server showed the pits, health bars, and v0.60.0.
- PR branch includes master through `849a6a8`, including the merged food cap
  and rival-behavior changes. Resolved the replay-baseline conflict using
  the combined deterministic state; all simulation tests pass.
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
