# Starvation Collapse — Root Cause Analysis (2026-06-02)

Investigates why the default colony peaks at ~129 ants then starves to **zero by
~tick 6000**, with ~215 food pellets left **uncollected** on the surface
(flagged in docs/perf-profile-2026-06-02.md). Deterministic, seed `tick-profile`.

Reproduce: `node bench/starvation-trace.mjs 7000 250`

## Verdict

The colony does **not** run out of food in the world — it runs out of food *in
the larder*. Two compounding structural causes:

1. **Foraging income saturates while consumption scales with population.** Food
   discovery — not forager headcount — is the bottleneck, so adding ants adds
   mouths but not income. The economy is net-negative even at 72 healthy ants.
2. **The respawn safety net measures the wrong signal and never fires.** It gates
   on *available surface-pellet count*, which decouples from the colony's actual
   *foodStored* once foraging can't reach distant pellets.

Deaths: **132 starvation vs 2 old age.** This is a food-economy failure, not a
lifespan (S3) or queen-succession (S7) problem.

## Evidence

### The food economy is net-negative from the start (income vs consumption per 250-tick window)

| tick | ants | foodStored | virtRem | in/win | out/win | net | pelletsUp |
|--:|--:|--:|--:|--:|--:|--:|--:|
| 250 | 40 | 2060 | 1700 | 360 | 300 | **+60** | 381 |
| 1000 | 72 | 1807 | 447 | 520 | 551 | **−31** | 350 |
| 1250 | 83 | 1431 | **0** | 600 | 976 | **−376** | 335 |
| 2000 | 121 | 299 | 0 | 640 | 1126 | **−486** | 279 |
| 2250 | 128 | **0** | 0 | 760 | 1059 | −299 | 262 |
| 3500 | 97↓ | 0 | 0 | 120 | 120 | 0 | 223 |

- **Consumption scales with population** (300 → 976 → 1126), but **income
  saturates** (~600–760) and never tracks colony size.
- The **bootstrap virtual ration (2000)** masks the deficit until ~tick 1250,
  letting the colony overshoot to a size its real economy cannot feed — so the
  bootstrap actually makes the eventual crash *harder*.
- Once `foodStored` hits 0 (~tick 2250), income collapses (760 → 120) as starving
  ants stop foraging — a positive-feedback death spiral. avgHealth 0.96 → 0.51,
  deaths/window 2 → 24 → 46.

### Income is bottlenecked on *discovery*, not forager count (state distribution)

| @tick | FORAGE_SEARCH | PATROL (soldiers) | actually carrying/delivering* |
|--:|--:|--:|--:|
| 1000 | 28 | 18 | ~6 |
| 2000 | 61 | 30 | ~9 |
| 2500 | 81 | 32 | ~7 |

\* PICKUP + GO_TO_FOOD + RETURN_HOME + STORE_FOOD_IN_NEST

- **~10 searchers for every 1 ant actually moving food.** Searchers balloon with
  colony size (28 → 81) but the delivery pipeline stays flat (~6–9). More ants =
  more searching, **not** more food.
- **~25% of the colony is soldiers on PATROL** — they eat from the store and
  forage nothing. In the default scenario there is no enemy to fight, so the
  caste is pure consumption (already flagged in ant-health-system-review S-notes).

### Why discovery saturates

- `foodVisionRadius: 10` on a 256×256 world — a wandering ant only detects a
  pellet within 10 tiles. Discovery otherwise depends entirely on `toFood`
  trails, which only form between the nest and *already-discovered* food.
- Food spawns as **two fixed clusters** at ±60–70 tiles from the nest
  (`SimulationCore` init). Ants deplete the trail-reachable rim; the rest
  (~215 pellets) is never trailed, so never found. Chicken-and-egg: no trail →
  no discovery → no trail.

### The respawn safety net is dead code in practice (instrumented)

`FoodEconomySystem` is supposed to "respawn food if shortage detected":

```
bootFoodTotal = 390
threshold = floor(390 * 0.25) = 97        // fires when AVAILABLE pellets < 97
```

Measured over 7000 ticks: **respawn fires 0 times**; the available-pellet count
**never drops below 215**. The system reads *uncollected surface pellets* (215 —
looks abundant) as its shortage proxy, while the colony starves with
`foodStored = 0`. The two metrics decouple precisely because foraging can't
convert ground pellets into stored food. The safety net is keyed to the wrong
signal and never deploys.

## Fix directions (ranked, not yet implemented)

The right fix depends on intended behavior, but the highest-leverage, lowest-risk
change addresses the dead safety net directly:

1. **Re-key the respawn trigger to colony food balance, and drop closer.** Gate on
   `foodStored` / starvation pressure (or "available pellets *within trail
   range*") instead of raw surface-pellet count, and drop the fresh cluster near
   the nest / on an existing trail so it's actually collectible. This makes the
   existing safety net do its job. Smallest change, directly unblocks the famine.
2. **Lift foraging throughput** so income scales: larger `foodVisionRadius`,
   denser/closer initial food, or a recruitment signal that concentrates
   searchers onto known sources (reduce the 10:1 search:deliver ratio).
3. **Reduce the consumption sink:** drop or shrink the soldier caste in the
   default `casteAllocation` (no combat → 25% pure overhead), or give soldiers a
   threat that justifies them.
4. **Right-size the bootstrap ration** so the colony doesn't overshoot a size its
   steady-state economy can't sustain (treats the symptom, not the cause).

Determinism note: any change must hold the seed contract; validate with
`bench/starvation-trace.mjs` and the full test suite. A survival regression test
(run 3000+ ticks, assert `ants.length > 0` and `queen.alive`) is now cheap given
the S9 cause-of-death telemetry and should land alongside the fix.

## Implemented (v0.33.0–v0.35.0): throughput lift + sink cut

Directions #2 and #3 were implemented (direction #1, re-keying the respawn, was
deferred):

- **#2 Lift throughput** — `foodVisionRadius` 10 → **24** (v0.33.0 set 16, v0.35.0
  raised to 24 after long-horizon analysis showed 16 only *delayed* collapse to
  ~tick 14000).
- **#3 Cut sink** — default `casteAllocation` soldiers 25% → **10%** and founding
  cohort 15% → 10% (v0.34.0); UI default unified to `{85,10,5}`.

**Result (seed `tick-profile`):** the colony flips from peak-129-then-dead-by-6000
to a **stable equilibrium ~207 ants** (peaks ~397), running a large food surplus
through its growth phase. Deaths shift from 132 starvation / 2 old-age to a
healthy mix dominated by old age. The improved foraging also *revives the dead
respawn safety net* — efficient collection finally drops available pellets below
the trigger, so respawns fire.

**Honest caveat — not a complete fix.** These two levers raise the ceiling and
extend lifespan dramatically but do not change the economy's *shape*: income
still **saturates** (bounded by food *supply* / respawn rate) while consumption
scales **linearly** with population. Long-horizon (25k-tick) multi-seed testing:

| foodVisionRadius | seeds surviving to 25k |
|--:|--|
| 20 | 1 / 4 |
| **24** | **3 / 4** |
| 28 | 2 / 4 |

At the larger colonies these settings enable, the same income-saturation dynamic
can still tip a colony into collapse depending on seed-specific timing (e.g. a
founding-cohort old-age die-off landing in a food trough). **Fully closing the
collapse requires direction #1** — re-key `FoodEconomySystem` to gate on colony
food balance (so supply tracks demand) instead of raw surface-pellet count.
