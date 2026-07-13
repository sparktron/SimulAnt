# SimulAnt — Systematic Code Review Plan (2026-05-30)

This document is the historical review plan from 2026-05-30. It was reconciled
against landed `master` at **v0.56.3** on 2026-07-12; the uncommitted worktree
changes were excluded. Current source is 36 JavaScript files under `src/`, and
the test suite is **359/359 passing**.

The original v0.27.6 baseline and its failing-test counts below are retained as
review history, not as current repository status.

## Current disposition

The review plan's implementation work has landed through the current baseline:

| Area | Disposition in landed code |
|---|---|
| §0 pre-flight | Complete; the two renderer failures were resolved in v0.27.7 |
| §1 determinism / RNG | Complete; RNG cursor persistence and replay-hash coverage landed in v0.28.0+ |
| §2 tick orchestration | Complete; explicit phase order, sanitizer, lifecycle rebuild, and macro sync are covered |
| §3 ant behavior | Complete; modules landed in v0.31.1–v0.31.5 and explicit sense → choose → apply orchestration in v0.56.1 |
| §4–§5 colony and food economy | Core accounting, respawn, non-pellet ledger balancing, and a 30–60-tile long-run-tested drop band landed through v0.56.3 |
| §6–§8 world, digging, rendering | Cadence, boundary, saved-front, and renderer-purity coverage landed |
| §9 config / main wiring | Range sanitization and config-integrity coverage landed, including optional-chained fallbacks |
| §10 UI / input | Save validation, view/input coverage, canonical caste allocation, and a single external stylesheet landed |
| §11 infra | Server path traversal hardening landed in v0.30.1 |

Remaining actionable items are tracked in
[`docs/open-items-todo.md`](open-items-todo.md). This disposition is a landed-code
reconciliation, not a claim that every historical review bullet received a new
line-by-line audit.

This plan partitions the codebase into logical sections, orders them by **risk**
(size × churn × invariant-criticality), and for each defines *what to look for*,
*likely bug classes*, and *candidate refactors/features*. Work top-to-bottom; each
section is a self-contained review unit that ends in a committed fix or a logged finding.

---

## 0. Pre-flight findings (already surfaced — fix or triage first)

These were found while building this plan and are concrete, not hypothetical:

| # | Finding | Evidence | Action |
|---|---------|----------|--------|
| 0.1 | **2 failing tests** in the original `test/nest-renderer.test.mjs` run | `not ok 163` (`2 !== 0`), `not ok 164` (`8 !== 6`) | Resolved in v0.27.7; current suite is 359/359 green |
| 0.2 | Test 163 expected no default queen marker although the renderer intentionally always shows it | `git log NestRenderer.js` = "always show queen with distinctive marker" | Assertion updated in v0.27.7 |
| 0.3 | Test 164 brood-larvae count drift | renderer/test contract mismatch | Resolved in v0.27.7 |
| 0.4 | Audit docs were partially stale | `exhaustive-audit-2026-04-22.md` listed already-fixed symbols | Superseded; retained as historical audit material |

**Historical gate:** this gate was satisfied before the later review phases;
the current full suite is 359/359 green.

---

## Risk-ranked section order

Priority = blends file size, recent churn (last 40 commits), and how many core
invariants the section can violate. Determinism and food-accounting are the two
invariants most likely to be silently broken.

| Phase | Section | Files | LOC | Churn | Why this rank |
|------|---------|-------|-----|-------|---------------|
| 1 | Determinism & RNG | `rng.js` | 65 | low | Load-bearing invariant; cheap to audit; gates everything else |
| 2 | Tick orchestration | `core/*`, `SimulationCore.js` | ~820 | high | The contract every other system relies on |
| 3 | Ant behavior | `ant.js`, `behavior/NestState.js` | 1840 | high | Largest file; densest logic; top of KNOWN_ISSUES |
| 4 | Colony & population | `colony.js`, `ColonyStats.js` | 1534 | high | 2nd largest; owns food accounting tangle |
| 5 | Food economy | `Food.js`, `systems/FoodEconomySystem.js` | 68 | med | Known multi-representation defect; cross-cuts §3–4 |
| 6 | World & pheromones | `world.js` | 361 | low | Perf hotspot candidate; diffusion cadence correctness |
| 7 | Digging | `DigSystem.js` | 531 | low | Bounded-loop safety; seeded front iteration |
| 8 | Rendering | `render/*` | 724 | med | 2 live test failures live here; canvas correctness |
| 9 | Config & main wiring | `main.js`, `ui/params.js` | 1504 | highest | Most-churned; config-drift & range-guard gaps |
| 10 | UI & input | `ui/*` (rest), `input/InputRouter.js` | ~900 | med | Legacy duplication; agent-parity of controls |
| 11 | Infra | `server.js`, test suite | — | low | Path-traversal hardening; coverage gaps |

---

## Phase 1 — Determinism & RNG (`src/sim/rng.js`)

**Invariant:** identical seed ⇒ identical replay hash, forever. This is the spine.

Look for:
- Every stochastic decision routes through the seeded generator — grep `Math.random`,
  `Date.now`, `performance.now`, `new Date`, `Set`/`Map` iteration order in sim paths.
- RNG state is **per-stream and serialized** in save/load (an unserialized RNG cursor
  silently breaks replay after reload).
- No floating-point order-of-operation drift across platforms (associativity in sums).
- Test `rng.test.mjs` + the replay-hash regression test actually assert *cross-reload* equality, not just intra-run.

Refactor candidates: none expected unless multiple ad-hoc RNG instances exist.
Feature candidate: **"seed + hash" badge in the HUD** so determinism breaks are visible at a glance.

---

## Phase 2 — Tick orchestration (`core/TickScheduler`, `MacroEngine`, `MicroPatchEngine`, `SimulationTypes`, `SimulationCore`)

Read `docs/core-simulation-architecture.md` first (the tick contract). Then verify
**code matches the documented contract**, phase by phase.

Look for:
- Strict phase order Macro → (colony → dig → pheromones) is enforced in code, not just docs.
- `MicroPatchEngine` evaporates **every** tick but diffuses only on `tick % diffIntervalTicks === 0` — verify the modulo guard and that `diffIntervalTicks` is range-guarded (`>= 1`, no div-by-zero).
- **Engine lifecycle duplication** (`post-refactor-improvement-plan.md` flags repeated rebuild wiring in multiple `SimulationCore` paths) — confirm the "centralize engine rebuild" helper actually removed the drift, or finish it.
- Macro **home-territory sync on nest move** — flagged as a drift bug; confirm `setNest` propagates to macro home coords (there is a test "setNest updates nest position and recomputes influence" — check it covers macro sync, not just influence).
- `SimulationTypes` config sanitization: does every consumed knob pass through it, or do some read raw config?

Refactor candidate: extract the repeated engine-rebuild into one lifecycle helper (if not already).
Bug class to hunt: **off-by-one in tick counter** vs. modulo cadence; partial-tick state if an exception throws mid-phase (no rollback).

---

## Phase 3 — Ant behavior (`src/sim/ant.js`, `behavior/NestState.js`) — heaviest

The original 1,836-line class was decomposed; `ant.js` is now 450 LOC, with
behavior modules under `src/sim/ant/`. Review the state machine across those
modules rather than treating the old class size as current.
(`get_symbol_outline` / call hierarchy), then review per state.

Look for:
- **Food/health double-counting** across `#consumePelletForHealth` vs `#consumePelletForHealthThenCarry` (lines ~1497/1534) — both cap "never eat more than half"; verify the cap math and that a pellet can't be consumed *and* carried for full value.
- Hunger/health/aging interactions: per-ant aging jitter (v0.27.2) — confirm jitter is seeded and bounded; no NaN/negative health.
- State-transition completeness: every state has a defined exit; no ant can wedge (dead-but-iterated, carrying-but-no-target).
- Movement arbitration: "earlier ants claim pellets first" — verify `takenByAntId` claim is atomic within the tick and cleared on death/drop.
- Departure delay determinism (was the old `Math.random` bug — confirm fully seeded now).

Completed refactor: `Ant.update` uses explicit `sense → choose → apply` phases;
the focused behavior modules remain extracted. The change is behavior-preserving
and guarded by a replay baseline captured before the refactor (v0.56.1).

Feature candidates: per-ant debug inspector (click an ant → state, target, hunger, RNG draws); role-distribution telemetry.

---

## Phase 4 — Colony & population (`src/sim/colony.js`, `ColonyStats.js`)

1,495 LOC; owns food accounting and population dynamics. The original food
accounting concern has a canonical `foodStored` balance and regression coverage.

Look for:
- **Canonical food source of truth**: `foodStored` vs virtual reserve vs pellet records vs world-tile cache. Map all writers/readers; prove the canonical getter can't disagree with the sum of parts. This is THE known correctness risk.
- Brood/birth/death bookkeeping: cohort death-wave smearing (v0.27.2) and threshold respawn (v0.27.3–0.27.6) — verify population can't go negative or grow unbounded; conservation of ants across save/load.
- `ColonyStats` derived numbers match live state (no stale cached aggregates).
- Per-tick scans over all ants — flag O(n²) patterns for Phase 6 perf work.

Refactor candidate: introduce a single `FoodLedger` abstraction with one authoritative balance and typed deposit/withdraw ops; make the other representations *views*, not stores.
Feature candidate: food-flow sankey/over-time chart in the status panel.

---

## Phase 5 — Food economy (`Food.js`, `systems/FoodEconomySystem.js`)

The economy is split between `Food.js` (36 LOC) and
`systems/FoodEconomySystem.js` (95 LOC); review it with the §4 accounting model.

Look for: pellet lifecycle (spawn → claimed → consumed → removed) has no leak/double-free;
boot-cluster placement (v0.27.4–0.27.6) is seeded; `depositFood` threshold (0.7) is config-guarded.

---

## Phase 6 — World & pheromones (`src/sim/world.js`)

Look for: evaporation/diffusion clamp to `pheromoneMaxClamp` both directions; no negative
pheromone; grid-boundary handling (no wrap-around bleed unless intended); the diffusion kernel
conserves or intentionally loses mass consistently.

Perf: this is the named hotspot at high entity counts. Measure before changing — add the
Benchmark harnesses now exist (`bench/tick-profile.mjs`, `bench/pheromone-bench.mjs`,
and the foraging/starvation sweeps). Further baseline work remains in the roadmap.

Feature candidate: pheromone-field debug heatmap toggle.

---

## Phase 7 — Digging (`src/sim/DigSystem.js`)

531 LOC. Look for: bounded safety loops can't infinite-loop on degenerate fronts; saved
front values are clamped/sanitized on load (documented); seeded randomness in front iteration;
dig conflicts resolved deterministically.

---

## Phase 8 — Rendering (`render/SurfaceRenderer`, `NestRenderer`, `soilMound`)

Start by resolving §0.2/§0.3 test failures. Canvas correctness can't be type-checked —
**verify in browser preview** (`preview_screenshot`) per project rule.

Look for: render reads are pure (no sim mutation from a renderer); coordinate transforms
consistent with `ViewManager`; brood/queen rendering matches the v0.13.10 "always show queen"
intent; no per-frame allocation churn in hot draw loops.

---

## Phase 9 — Config & main wiring (`src/main.js` 38–108 config, `src/ui/params.js`)

**Most-churned files** ⇒ highest regression risk. 60+ params.

Look for:
- Range guards are present for the shipped config surface and are exercised by
  config-integrity tests, including optional-chained inline fallbacks.
- `getDefaultConfig` consistency (v0.27.6 fixed a *stale* default — audit the rest for the same class of bug: a default that no longer matches its consumer).
- Preset load = config sanitize path is the same one save/load uses (no second, weaker validator).

Refactor candidate: a single declarative param schema (`{name, min, max, default, step, group}`)
that drives sliders, sanitization, AND save migration — collapses today's duplication.

---

## Phase 10 — UI & input (`ui/controls`, `hud`, `ColonyStatusPanel`, `ParameterEditor`, `PresetManager`, `TriangleControl`, `triangleMath`, `ViewManager`, `runtimeErrorGate`, `input/InputRouter`)

Look for: **legacy control duplication** (KNOWN_ISSUES #4) — find sliders wired to canonical
state *and* a dead legacy path; delete the dead one. `triangleMath` (caste allocation) —
unit-test the barycentric math edge cases (corners, degenerate). `runtimeErrorGate` — confirm
it actually halts/flags on sim exceptions rather than swallowing them.

Save/load schema versioning, legacy handling, forward-version diagnostics,
atomic malformed-save rejection, and explicit migrations through schema v3 have
landed (v0.30.0–v0.56.0). Future schema changes should add a tested migration
step rather than relying only on defensive field restoration.

Feature candidate (agent-native): expose every user control as a programmatic command so an
agent can drive the sim headless — pairs with the benchmark harness.

---

## Phase 11 — Infra (`server.js`, test suite)

- `server.js` path traversal hardening landed in v0.30.1 and has regression tests.
- Coverage gaps: cross-reference §1–10 with existing `test/*.mjs`; the suite is broad (359 tests)
  but check for the *untested* hot symbols (use jcodemunch `get_untested_symbols`).
- Stylesheet source-of-truth consolidation landed in v0.54.14.

---

## Execution protocol (per project rules)

- **One section = one or more small commits.** Bump `VERSION` (SemVer) on every code change;
  put the version in the commit message; announce expected browser version after each.
- **Capture a replay-hash baseline before any behavior-preserving refactor** (§3, §4) and assert
  it after — that is the safety net for determinism.
- **Browser-verify rendering/UI changes** (§8, §10) with a preview screenshot.
- Use jcodemunch for navigation (`get_symbol_complexity`, `get_call_hierarchy`,
  `get_untested_symbols`, `get_hotspots`) to drive each deep-dive; `Read` only files being edited.

## Suggested sequencing

Do **§0 → §1 → §2** first (green suite + invariant spine + contract), because every later
finding is only trustworthy once determinism and the tick contract are verified. Then the two
big behavior files (§3, §4) with food economy (§5) folded in. Then world/dig/render (§6–8),
then the config/UI/infra cleanup tail (§9–11).
