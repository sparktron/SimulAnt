# Environmental Foraging Tests — Design Scope

**Status:** scoped, not run. **Topic:** raising foraging *income* by changing the
ENVIRONMENT, now that pheromone-behavior tuning is exhausted.
**Read first:** `docs/pheromone-strategy.md` FAILED table + "discovery ceiling"
finding (this is the heir to it) and `docs/starvation-collapse-rca-2026-06-02.md`
(the same bottleneck, seen from the survival side).

---

## Why this — two findings point at the same wall

1. **Discovery ceiling (v0.49.3):** pickups sit at ~900 regardless of how searchers
   are steered — attract (recruitment) and repel (dispersion) both lose to doing
   nothing. Searcher *behavior* is not the binding constraint.
2. **Starvation RCA (2026-06-02):** the colony peaks ~129 ants then starves to zero
   by ~tick 6000. Foraging **income saturates (~600–760/window) while consumption
   scales with population.** "Food discovery — not forager headcount — is the
   bottleneck."

These are the same fact from two angles: **foraging income is capped, and the cap
is environmental, not behavioral.** So the lever is the environment. The objective is
not "more pickups" in the abstract — it is **raise saturating income enough that the
economy can feed the population it grows** (i.e. stop the starvation collapse / lift
the sustainable population).

> **This is a GAME-DESIGN / difficulty decision, not an optimization with one right
> answer.** Every lever below also changes difficulty. The tests CHARACTERIZE the
> levers (sensitivity + cost); the user picks the target difficulty. Flagged
> explicitly so we don't "optimize" the sim into triviality.

---

## Objective & metrics (NOT "vs OFF")

Pheromone A/Bs compared ON vs OFF on an identical environment. **Here the environment
IS the variable, so there is no shared baseline** — we measure ABSOLUTE colony
outcomes and trends across each sweep. Primary metrics (all already in
`bench/starvation-trace.mjs`, which traces income/consumption/population per window):

- **Survival** — does the colony reach the end of a LONG run (≥ 8000–10000 ticks)
  without collapsing to ~0? (Collapse tick if it does.)
- **Peak & final population** — overshoot vs sustained size.
- **Income vs consumption** per 250-tick window — does income track population, or
  saturate (the RCA signature)? The core diagnostic.
- **Nutrition delivered** and **pickups** — discovery/throughput (from forage-sweep).

Runs must be LONG (≥8000): starvation emerges ~tick 6000, so 5000-tick foraging
A/Bs would miss it. Several fixed seeds; report trends, not single points.

---

## Levers (each: param, hypothesis, what we learn)

| Lever | Param(s) | Hypothesis | What it tells us |
|---|---|---|---|
| **Vision** | `foodVisionRadius` (18, user-pinned) | wider vision → each searcher finds food over a larger area → income rises ~quadratically | the most direct discovery lever; how much vision buys survival |
| **Surface supply** | `minSurfacePellets` (200) | more standing food → higher income IF search-bound; flat IF already supply-saturated | distinguishes SEARCH-bound vs SUPPLY-bound (see E2 — the key experiment) |
| **Cluster size** | `bootFoodTotal` (390 → drop = /4) | bigger/richer drops → more per discovered cluster → higher income per find | whether throughput is per-find limited |
| **Drop distance** | respawn 60–100 tiles from nest (in `FoodEconomySystem`) | closer food → shorter carry + easier discovery → higher income | how much the "forage far" rule costs the economy |
| **Searcher count** | `antCap` / forager fraction | RCA says headcount is NOT the bottleneck → MORE ants should NOT raise income (and adds mouths) | confirms/refutes the RCA's central claim directly |
| **Pellet nutrition** | per-pellet nutrition | scales income linearly without changing discovery | a pure income knob — the "difficulty dial" baseline |

---

## Key experiments (ranked by what they resolve)

- **E1 — Supply-bound vs search-bound (the pivotal test).** Sweep `minSurfacePellets`
  UP (200 → 400 → 800) at default vision. If income/pickups RISE → the colony was
  *supply*-bound (not enough standing food); if FLAT → *search*-bound (can't find/
  reach it). This decides whether the discovery ceiling is "not enough food" or "can't
  find the food that's there" — and the RCA's "215 pellets left uncollected" predicts
  SEARCH-bound. Cheapest, most decisive.
- **E2 — Vision sweep vs survival.** `foodVisionRadius` 8→28. Expect income to rise
  with vision (doc already shows trailGain does). Find the vision that makes income
  TRACK consumption (no collapse). Directly tests "wider vision lifts the ceiling."
- **E3 — Searcher count (confirm the RCA).** Vary `antCap` / forager share. RCA
  predicts income saturates regardless → adding ants only adds mouths. If income DOES
  rise with searchers, the RCA was wrong and headcount is a lever after all.
- **E4 — Drop distance.** Pull respawn closer (e.g. 30–60 vs 60–100). Quantifies how
  much the "forage far" design choice costs survival.
- **E5 — Pure income dials (nutrition / cluster size).** Confirm they scale income
  linearly (sanity / difficulty-dial calibration), not a discovery change.

---

## Harness

`bench/starvation-trace.mjs` already traces the right things (income/consumption/
population/pellets per window) and runs long. Plan:
1. Confirm it accepts config overrides (like the `AB_OVERRIDES` pattern in
   `forage-ab.mjs`); if not, add that so each lever can be swept without editing code.
2. Add a one-line SURVIVAL summary per run (peak pop, final pop, collapse tick,
   mean income/consumption over the back half) for easy cross-config comparison.
3. Run E1 first (decisive + cheap), then E2.

Discipline: ≥8000 ticks, multiple seeds, report trends. No "vs OFF" — absolute
outcomes. A lever "wins" if income tracks consumption and the colony sustains a
target population the user sets.

---

## Risks / caveats

- **There is a known confound: the respawn safety net (RCA cause #2) gates on surface
  pellet count, decoupled from `foodStored`, and "never fires."** That is a MECHANISM
  bug, not an environment param. It may dominate any environmental sweep (the colony
  starves with food on the map). **Consider fixing/【characterizing】 it first**, or at
  least logging whether respawn fires during these runs — otherwise we may attribute
  to "environment" what is really the broken safety net. This is the single biggest
  threat to clean results and should be resolved up front.
- Every lever is also a difficulty knob — pick a target population/survival horizon
  before declaring a "win," or the sweep optimizes toward a trivial sim.
- Long runs (≥8000 × multiple seeds) are slower than the foraging A/Bs; budget for it.
