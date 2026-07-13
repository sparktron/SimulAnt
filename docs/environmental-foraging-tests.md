# Environmental Foraging Tests — Design Scope

> ## ⚠️ KEY FINDINGS (2026-06-30, after the v0.50.0 safety-net fix)
>
> 1. **Confound fixed (v0.50.0):** the respawn net now fires on surface-low OR
>    colony-hunger. Verified to reverse the RCA's "income saturates" pathology over
>    8000 ticks.
> 2. **MEASUREMENT HORIZON MATTERS:** E1/E2/E4/E5 first run at 8000 ticks all looked
>    like a flat ~333 "equilibrium" — because 8000 is the PEAK, *before* the collapse.
>    Survival must be measured at **≥16000 ticks**. 8000-tick numbers measure overshoot,
>    not sustainability. (`antCap` is 2000, so ~333 is NOT a cap.)
> 3. **The colony still COLLAPSES — overshoot-collapse, not pure starvation.** At
>    16000 ticks (3 seeds): peak ~360–376 @~9000, then decline to final ~70–122. The
>    larder exhausts ~tick 9000 (net −3198), triggering a die-off that is then SUSTAINED
>    by an old-age wave (the synchronized boom cohort ages out: ~290 oldAge vs ~110
>    starvation, inverting the RCA's ratio). The v0.50.0 fix RAISED the overshoot
>    (peak 360 vs RCA's 129) rather than preventing the bust.
> 4. **The 16,000-tick logistics sweep selected closer drops (v0.56.3).** Three
>    fixed seeds show that higher standing supply (mean final 186.3) and wider
>    vision (164.3) underperform the 60–100-tile baseline (199.3). Moving drops
>    to **30–60 tiles** is the only tested change that improves every seed. The
>    follow-up 12-seed validation finished at 261.3 final ants on average, with
>    a 217-ant minimum, queens alive 12/12, and target hits 12/12. It remains the
>    default. Pheromone recruitment and dispersion remain retired failures.
>
> ---

**Status:** initial long-run characterization landed in v0.56.3. **Topic:** raising
foraging *income* by changing the ENVIRONMENT, now that pheromone-behavior tuning is
exhausted.
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

> **Target agreed for this simulation:** retain at least **150 ants at tick 16,000**
> in every fixed seed, while keeping the existing 300-ant nest-capacity ceiling.
> Every lever changes difficulty, so wider confirmation should keep using this
> explicit target rather than optimizing for pickups alone.

---

## Objective & metrics (NOT "vs OFF")

Pheromone A/Bs compared ON vs OFF on an identical environment. **Here the environment
IS the variable, so there is no shared baseline** — we measure ABSOLUTE colony
outcomes and trends across each sweep. Primary metrics:

- **Survival** — does the colony reach the end of a LONG run (≥ 8000–10000 ticks)
  without collapsing to ~0? (Collapse tick if it does.)
- **Peak & final population** — overshoot vs sustained size.
- **Income vs consumption** — deposited nutrition, canonical store consumption, and
  net flow per seed. This distinguishes a sustainable flow from a temporarily
  large buffer.
- **Death causes** — starvation, old age, hazard, and other deaths per seed. These
  distinguish an economy failure from population turnover or terrain risk.
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
| **Drop distance** | respawn 30–60 tiles from nest (in `FoodEconomySystem`) | closer food → shorter carry + easier discovery → higher income | selected in the v0.56.3 long-run sweep |
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
- **E4 — Drop distance (completed, v0.56.3).** Three fixed seeds × 16,000 ticks:
  30–60 drops finished at 230, 251, and 227 ants (mean 236.0), versus baseline
  219, 183, and 196 (mean 199.3). All close-drop runs retained their queen and
  met the 150-ant target, so 30–60 is now the default band. The follow-up
  12-seed validation confirmed 261.3 mean final ants, 217 minimum, 12/12 queens
  alive, and 12/12 target hits.
- **E5 — Pure income dials (nutrition / cluster size).** Confirm they scale income
  linearly (sanity / difficulty-dial calibration), not a discovery change.

---

## Harness

`bench/environmental-foraging-sweep.mjs` now runs the real `SimulationCore`
with supply, vision, and drop-distance scenarios. It defaults to 16,000 ticks
and three fixed seeds, reports final/peak populations, target hits, deposited
nutrition, consumption, net food flow, and death causes per seed. It can run a
named scenario or a wider seed set without editing source:

```
node bench/environmental-foraging-sweep.mjs 16000 12
node bench/environmental-foraging-sweep.mjs 16000 12 near-30-60
```

The harness disables HUD-history collection only; that observer has no simulation
feedback and is not part of the measured outcome.

Discipline: ≥8000 ticks, multiple seeds, report trends. No "vs OFF" — absolute
outcomes. A lever "wins" if income tracks consumption and the colony sustains a
target population the user sets.

---

## Risks / caveats

- ✅ **RESOLVED (v0.50.0): the respawn-safety-net confound is fixed.** The net now fires
  on surface-low OR colony-hunger (`docs/starvation-collapse-rca-2026-06-02.md` cause #2).
  Verified via `bench/starvation-trace.mjs` (8000 ticks, seed tick-profile): with the
  hunger trigger OFF (old behavior) the colony reaches final 241; with it ON, final 340
  and — critically — **income now scales with population (1.2k→25k/window) instead of
  saturating**, with `net` oscillating around 0. So the RCA's central pathology is gone
  and E1 measures against a HEALTHY food supply. NOTE this also reframes E1: income rose
  when supply was unthrottled, so the colony was partly SUPPLY-throttled by the broken
  net — E1 now characterizes the new baseline rather than the starved one.
- The shipped 30–60 band passed its 12-seed validation. Use the same 12-seed
  command before changing another environmental default.
- Long runs (≥8000 × multiple seeds) are slower than the foraging A/Bs; budget for it.
