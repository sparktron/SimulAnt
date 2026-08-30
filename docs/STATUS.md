# Current Status

**Updated:** 2026-08-30 · **Branch:** `master` · **Commit:** `3ab7e56`

## Objective

A browser-playable ant colony simulation with dual surface/nest views, purely
local ant AI producing emergent colony behaviour, pheromone-driven foraging, and
two competing queen-led colonies. It ships as static files: no build step, no
package manager, and a deterministic seeded tick contract that tests replay
exactly.

## Current state

- `master` is at `3ab7e56` — `fix(ui): enlarge core controls — v0.58.1`.
  `git status --porcelain` is empty: the working tree is clean.
- `VERSION` reads `0.58.1`, matching the version suffix on the HEAD commit.
- 116 tracked files, 35 test files under `test/`, 7 benchmark harnesses under
  `bench/`.
- The no-package-manager rule holds in the tree, not just in `AGENTS.md`:
  `git ls-files 'package.json' 'package-lock.json' 'yarn.lock' 'pnpm-lock.yaml'`
  returns nothing.
- Shipped behaviour includes two colonies (black and red) with combat, the brood
  and queen-succession lifecycle, the dig system with chamber carving, and
  save-schema v4 with named forward migrations.

## Active work

Nothing is in progress in the working tree — it is clean at `3ab7e56`.

`docs/open-items-todo.md`, reconciled against landed `master` at v0.58.1 on
2026-08-23, lists 45 completed items and states that no general maintenance
fixes are queued; the remaining planned work is the environmental-foraging
experiment programme.

The repository carries 44 local branches besides `master` (23 `ccode/*`, 18
`codex/*`, plus `code-review/bug-fixes-and-enhancements`,
`consolidate/pr-review-merge`, and `pr55-resolve`). None is checked out; whether
any holds unmerged work was not examined.

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

Run on this machine on 2026-08-30, against `3ab7e56` with a clean working tree,
on Node v22.23.2:

- `node --test test/*.mjs` → `# tests 402`, `# pass 402`, `# fail 0`,
  `# cancelled 0`, `# skipped 0`, `# todo 0`, `duration_ms 22391`. Exit 0.
- `node scripts/check-determinism.mjs` →
  `Determinism OK: no Math.random() call sites in src/`. Exit 0.
- `git ls-files 'package.json' 'package-lock.json' 'yarn.lock' 'pnpm-lock.yaml'`
  → empty, satisfying CI's "No package manager files" gate.
- `VERSION` → `0.58.1`, valid `MAJOR.MINOR.PATCH`, satisfying CI's semver gate.

`.github/workflows/ci.yml` gates the same test suite on Node 20 and Node 22 for
pushes to `master`, pull requests, and manual dispatch, plus the three contract
checks above. That the gates exist is separate from the local run recorded here.

## Unverified

- **Node 20.** CI's matrix covers it; only Node 22.23.2 is installed on this
  machine, so that leg was not exercised.
- **Browser and UI behaviour.** No browser was launched. The simulation is
  canvas-rendered, so rendering, the two independent cameras, the HUD, the
  save/load controls, and the accessibility and type-scale work in v0.58.0–
  v0.58.1 are untested here. `CLAUDE.md` requires visual proof for UI changes;
  none was obtained.
- **Benchmarks.** Nothing under `bench/` was run. The performance budgets are
  opt-in, and the foraging sweep is a 16,000-tick multi-seed job. The population
  figures quoted above come from `docs/open-items-todo.md`, not from a run on
  this commit.
- **CI result for `3ab7e56` on GitHub.** Not checked; no network calls were made.
- **The 44 non-`master` local branches.** Not diffed against `master`, so
  whether any carries unmerged work is unknown.

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
