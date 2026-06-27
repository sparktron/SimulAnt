# Depletion-Reactive Decay + Config-Integrity Cleanup — Session Report (2026-06-27)

Covers versions **v0.47.0 → v0.48.1**. Read this before touching pheromone
foraging tuning, the FoodEconomySystem, or the config-default/sanitizer plumbing —
it records what was measured and decided so the experiments below are **not re-run**.

Canonical detail lives in:
- `docs/pheromone-strategy.md` — the pheromone experiment log (WORKS / FAILED tables).
- `test/config-integrity.test.mjs` — the live dead-param registry (`KNOWN_UNWIRED`).
- Harnesses: `bench/forage-ab.mjs` (one config, ON vs OFF), `bench/forage-sweep.mjs`
  (many configs vs a shared OFF baseline).

---

## Verdict (TL;DR)

1. **Depletion-reactive decay (v0.47.0) is the first foraging win at the shipped
   vision radius (18).** Food trails were net-negative for years; they are now
   **net-positive** (+0.5% trailGain, 12 seeds) and beat no-trails on *discovery*
   (pickups ON ≥ OFF) for the first time — the Phase 2 win condition.
2. **Its shipped tuning is optimal.** A 12-config parameter sweep found nothing
   better; the optimum is a narrow basin around `boost 0.3 / protectRef 0.2`.
   **Do not re-sweep.**
3. **The FoodEconomySystem test failures were test drift, not bugs.** 8 tests
   asserted the dead v0.36.0 reserve-floor model; rewritten to the live v0.43.3
   surface-count model. Suite is now **323/323 green**.
4. **Config hygiene:** the dead reserve params were removed, the live respawn knob
   (`minSurfacePellets`) was promoted from an invisible hardcoded value to a real
   tunable, and 5 fully-dead params were swept. 4 intentional keepers remain.

---

## Part 1 — Depletion-reactive decay (v0.47.0)

### The problem it solves
Food depletes and respawns elsewhere, so any *persistent* trail decays into a
pointer at an eaten-out source. Every prior tactic that made trails stronger or
stickier made foraging worse (see the FAILED table in `pheromone-strategy.md`).
The Phase 2 characterization showed trails actively **suppress discovery**
(pickups ON < OFF) because recruited searchers get pulled off exploration onto
stale corridors. The named fix: make trail strength track **live** harvest
success, not persistence.

### The mechanism
A successful pickup paints a decaying **harvest disk** into a new field
(`world.harvest`) at the food source. Each tick, `toFood` gets **extra evaporation
scaled by the *absence* of nearby harvest**:

```
extra = depletionDecayBoost · (1 − min(1, harvest[idx] / harvestProtectRef))
toFood[idx] *= (1 − extra)
```

A live source is re-painted every pickup → its corridor stays protected **and** is
reinforced by carrier deposits, so it outruns the decay. An exhausted source's
harvest zone fades (`evapHarvest`) → its corridor, no longer reinforced, collapses
several times faster than baseline, retracting from the dead tip inward.

Code: `world.js` `paintHarvest` + `#applyDepletionDecay`; deposit hook in
`decisions.js` (`pickUpVisiblePellet`); config in `params.js`/`main.js`; sanitizer
in `SimulationTypes.js`. Opt-in flag `depletionReactive` (default **true**).

> **Subtlety worth remembering:** protection is *spatial-local* (only within
> `harvestRadius` of a pickup), so the long corridor back to the nest is NOT
> protected — it gets full extra decay. What actually keeps a live corridor alive
> is **carrier re-deposit every tick outrunning the decay**, not spatial
> protection. The harvest disk mainly shields the freshly-laid trail right around
> an active source. Reinforcement asymmetry is the engine; protection is a guard.

### Measured result (12 seeds × 5000, vision 18, same-seed ON vs OFF)
| Metric | trails-OFF | trails-ON (depletion) | vs prior trail tune |
|---|---|---|---|
| nutrition | 33208 | **33370** (+0.5% trailGain) | was −3.6% |
| pickups | 880 | **890** (ON ≥ OFF ✅) | first crossing ever |
| PR (convergence) | — | **692** | was ~1006 |
| circling | — | 9.6% of carry-ticks | was 6.7% (the cost) |

Because OFF is byte-identical across runs, the +4.3% absolute ON-nutrition lift on
the same seeds is **signal, not seed luck**.

### Dose is everything — the trap
The SAME mechanism at `depletionDecayBoost 1.0` (the original default before
shipping) is **−8.6%** and **triples circling** — it shreds even live corridors
into fragmented stubs faster than carriers reinforce them, recreating the
death-spiral pathology. Recorded in the FAILED table. At 0.3, reinforcement wins
the race and only genuinely-dead trails retract. **If asked to "strengthen" it,
don't.**

### Parameter sweep — shipped config is optimal (v0.48.x)
Reproduce: `node bench/forage-sweep.mjs 5000 12`

12-config OFAT at 6 seeds, top contenders confirmed at 12 seeds, shared-OFF
baseline. Shipped (`boost 0.3, protectRef 0.2, radius 10, evapHarvest 0.5`) is the
**only** config both net-positive AND pickups ON ≥ OFF at 12 seeds.

- **More-aggressive decay is worse:** boost 0.4 (−7.7%), protectRef 0.1 (−9.5%),
  evapHarvest 1.0 (−9.3%) — all spike circling to ~12%.
- **More-protection is worse on throughput:** protectRef 0.5 (−0.9%, pickups −5),
  evapHarvest 0.25 (−12.3%, colony shrank to 222 ants) — over-protected trails
  drift back toward dead sources. BUT protectRef 0.5 cuts circling to 5.4%, so it
  is the lever **if circling ever looks visually bad** — at the cost of the
  net-positive/pickups win.
- Optimum is a narrow basin; both directions fall off steeply.

**Methodology lesson:** the 6-seed ranking named the WRONG winner (protectRef 0.5
at +0.4%); 12 seeds reversed it (−0.9%). The zigzag (protectRef 0.2 good, 0.3 bad,
0.5 good) was the visible tell. **6-seed gaps under ~1pt are noise; trust 12-seed
same-seed comparisons only.**

---

## Part 2 — FoodEconomySystem test drift (323/323 green)

### What happened
The respawn system was rewritten in **v0.43.3** from a *demand-tracking
reserve-floor* model (v0.36.0: respawn when `foodStored < max(minReserve,
ants×reservePerAnt)`, with `dropCooldownTicks`, cluster = `bootFoodTotal/2`) to a
*surface-count-gated* model (respawn when **free surface pellets** <
`minSurfacePellets`, no cooldown, cluster = `bootFoodTotal/4`, dropped 60–100 tiles
out). The integration path was updated; two isolated unit-test files were not.

8 tests kept asserting the dead reserve-floor contract. They **compiled** because
JS object-destructuring silently swallows constructor options that no longer exist
(`reservePerAnt`, `minReserve`, `dropCooldownTicks`). One `enhancements.test.mjs`
test even passed *by accident* (it set `foodStored` low and passed no pellets, so
the surface model also dropped — a green test against the wrong model).

### Fix
Rewrote both test groups to characterize the real surface-count behavior — including
replacing a **nonexistent-cooldown** test with the model's actual *self-limiting*
property: a drop adds `bootFoodTotal/4` free pellets, lifting the count back over
the floor so no second drop fires. The system is rate-limited by its own **output**,
not a timer — a more robust design that self-tunes to consumption.

**The code was right; the tests were wrong.** Do NOT resurrect the reserve-floor
model — that would regress the live food economy.

---

## Part 3 — Config-integrity cleanup (v0.48.0, v0.48.1)

### v0.48.0 — dead reserve knobs out, live knob promoted
Removed `foodReservePerAnt`, `foodMinReserve`, `foodRespawnCooldownTicks` from
defaults, `main.js`, the sanitizer, the parameter-editor sliders, and the
`KNOWN_UNWIRED` registry. They were the only Food Economy sliders, yet wired to
nothing — a user adjusting "Food Reserve / Ant" was turning a dead knob.

Promoted `minSurfacePellets` (the knob that actually drives respawn) from an
**invisible hardcoded 200** to a real default + slider + sanitizer clamp. Default
value unchanged → behavior-preserving.

### v0.48.1 — sweep the fully-dead params
Removed 5 params read **nowhere** (incl. `main.js`): `digChance`, `digEnergyCost`,
`foodPickupRate` (never implemented), `foodTrailDecayPerStep` (superseded by
`recruitDecayPerStep`), `randomTurnChance` (superseded by the correlated random
walk). Behavior-preserving.

### Intentional keepers (do NOT remove)
These read as "unwired" by the config-integrity scan only because their consumers
live in the UI/debug **declaration layer** (`main.js`/`params.js`), which the scan
excludes. They are NOT dead:
- `soldierSpawnChance` — written by the caste-allocation slider (`main.js`).
- `debugSteeringContributions` / `debugSteeringLogIntervalTicks` — read by
  `maybeLogSteeringDebug` (`main.js`); a live, default-off debug logger.
- `momentumBias` — deliberate steering-experiment stub (stubbed to 0 in steering.js).

### Latent gap flagged (not yet fixed)
The config-integrity "invisible knob" check uses regex `config\.X\s*\?\?`, which
**does not match optional chaining** `config?.X ?? fallback`. That blind spot is
how `minSurfacePellets` stayed invisible. If a new knob is added with `config?.`,
the guard will miss it. **Hardening that regex is a worthwhile Phase-0 follow-up.**

---

## Measurement methodology (reuse, don't reinvent)

- **Two harnesses.** `forage-ab.mjs` for one config ON vs OFF; `forage-sweep.mjs`
  for many configs vs a shared OFF baseline (OFF computed once per seed, reused —
  ~2× cheaper, identical baseline for every candidate).
- **Metrics:** nutrition (headline gathering), pickups (discovery — the real
  bottleneck), PR (convergence), circling (death spirals via net-displacement
  window). See `pheromone-strategy.md` for why each was necessary.
- **Seed discipline:** 6 seeds to rank, **12 seeds to decide.** OFF must be held
  byte-identical across compared conditions (same seed) so deltas are pure signal.
- **Win condition for any foraging change:** pickups ON ≥ OFF (not PR — convergence
  is not a goal in itself; every over-convergence tactic in the FAILED table cost
  throughput).

---

## Open threads / what's next

- **Two-pheromone recruitment** (`pheromone-strategy.md` future-direction #3) — the
  next forward lever. Now de-risked: depletion-reactive decay made trails point at
  live sources, so the previously-unsafe "strengthen recruitment" path may now be
  safe. Build on the confirmed depletion baseline.
- **Harden the invisible-knob regex** for optional chaining (see Part 3).
- **Inert cleanup (optional):** stale fixture keys for the removed params still
  linger in several `test/*.mjs` files; harmless, churn to remove.
- **`protectRef 0.5`** is the documented escape hatch if carrier circling (9.6%)
  ever looks visually objectionable — trades the throughput win for ~5.4% circling.
