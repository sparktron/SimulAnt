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

## Implemented (v0.36.0): direction #1 — demand-tracking respawn (the structural fix)

`FoodEconomySystem` now gates on the colony's stored food relative to population
instead of raw uncollected-pellet count:

- **Trigger:** `foodStored < max(minReserve, ants × reservePerAnt)` — supply
  tracks demand and fires more as the colony grows (the old metric never fired:
  0 times in 7000 ticks).
- **Reachable drops:** clusters land 12–30 tiles from the nest (was 20–50) so
  foragers actually collect them.
- **Cooldown:** `dropCooldownTicks` bounds the supply *rate* — a famine backstop,
  not a free tap.

Defaults `reservePerAnt=40, minReserve=300, dropCooldownTicks=60`, tuned via a
25k-tick × 4-seed sweep (rpa40/cd60 → 4/4 survival; rpa25/cd90 also 4/4 but
leaner; rpa30/cd45 only 3/4 — more aggressive is not strictly safer).

**Result:** the collapse is closed. All four test seeds now survive to 25k+
ticks; the default seed holds **~380–392 ants at tick 15000** with `foodStored`
never crashing to zero, and deaths balance between starvation and old age (ants
live full lives). Guarded by a survival regression test in
`test/simulation-core.test.mjs` (6000-tick run on production defaults, asserts
queen alive + >50 ants).

### Residual / future

- Ground-food pellets accumulate somewhat at very large colonies (supply
  occasionally outpaces collection); self-limiting since drops stop once
  `foodStored` rises above the floor, but worth watching.
- `_lastDropTick` is transient (not serialized): a save/load during famine may
  permit one extra immediate drop. Negligible.
- Directions #2/#3 (throughput, sink) remain in place and complementary.

## Overshoot-collapse (2026-06-30) and the growth-brake fix (v0.52.0)

The v0.50.0 respawn-safety-net fix (dual-trigger: surface-low OR colony-hunger)
reversed the income-saturation pathology above and let colonies grow much
larger (peak ~360 vs ~129 pre-fix) — but that raised a NEW failure mode instead
of preventing collapse: the colony overshoots to ~340-360 ants around tick
8000-9000, then crashes to near-zero by tick 16000-18000, with the death-cause
ratio inverted (mostly old-age, not starvation) — a synchronized founding-cohort
die-off compounding a food deficit the larger population can't sustain.
**Measure at ≥16000 ticks, not 8000** — at 8000 the colony is at its pre-collapse
peak, so every food-lever sweep at that horizon looks like a flat "equilibrium."
Food-supply levers (more surface food, vision radius, drop-distance band,
respawn rate) were all swept and none fix it — the bottleneck isn't food supply,
it's that nothing throttles population growth to match steady-state income.

**Root cause:** `#updateQueenAndBrood`'s `foodLayMultiplier` only reacts to the
current stockpile level (`foodStored / foodStoreTarget`), which reads "full"
throughout the overshoot — it's a lagging signal that only drops once the
buffer is already draining, by which point brood/adult population momentum is
already past what income can sustain.

**Fix:** added `config.queenLayingIncomeBrake` — an EMA of net `foodStored`
delta per tick (`Colony#_foodIncomeTrend`, normalized by `foodStoreTarget`,
smoothing `queenLayingTrendAlpha=0.01`) that throttles egg laying further when
income is trending negative, via `queenLayingTrendSensitivity` (default 40).
This is a leading signal — it reacts to the trajectory, not just the level.

**A/B result (`bench/growth-brake-ab.mjs`, 6 seeds × 18000 ticks):**

| | avg peak | avg final @18000 | extinctions |
|---|---|---|---|
| brake OFF (baseline) | 327 | 22.2 | 1/6 |
| brake ON (sensitivity=40) | 350 | 46.5 | **0/6** |

Brake ON more than doubles average final population and eliminates extinction
entirely across the seed set. Single-seed comparisons are NOT reliable for this
lever — sensitivity=40 beat baseline on seed `growth-brake-ab` but lost to it on
`growth-brake-seed2`; only the 6-seed average settled it. Sensitivity is also
dose-sensitive and non-monotonic: 20/30/40/60 all avoided single-seed extinction
but 80 caused it — has not yet been swept across the full 6-seed set, so 40
(the tested default) stands until a wider sweep says otherwise.

**Shipped ON by default in v0.52.1 — then RETRACTED in v0.52.3.** A follow-up
multi-seed sensitivity sweep (`bench/growth-brake-sensitivity-sweep.mjs`, 5
seeds `sens-sweep-0..4`, 16000 ticks) tested sensitivity ∈ {0(off),20,40,60,80,
100,140} and found baseline (off) beating EVERY brake setting, including the
sensitivity=40 shipped in v0.52.1:

| sensitivity | avg final | extinctions |
|---|---|---|
| 0 (off) | **102.6** | 0/5 |
| 20 | 61.4 | 0/5 |
| 40 (shipped) | 48.0 | 1/5 |
| 60 | 47.0 | 0/5 |
| 80 | 43.0 | 0/5 |
| 100 | 61.0 | 1/5 |
| 140 | 81.2 | 0/5 |

This directly contradicts the original A/B (avg final 22.2→46.5 favoring
brake ON). Reconciling both as PAIRED comparisons (same seeds, off vs on@40):
original A/B mean diff +24.3 (SE≈20.4, ~1.2 SE from zero); sweep mean diff
**-54.6** (SE≈62, opposite sign). Per-seed final-population variance is large
(SD on the order of 100 ants — single-condition results ranged 0 to 291 across
just 5 seeds), so neither n=5-6 experiment reaches significance, and getting
opposite-signed results from two underpowered runs is exactly what pure noise
looks like. **Neither experiment is trustworthy at this sample size.**

**Confirmed NULL RESULT (n=20, 18000 ticks, same seed set as the original A/B):**

```
Paired diff (on - off) per seed, sensitivity=40:
mean diff +7.7   SD 67.9   SE 15.2   |diff/SE| 0.51
extinctions: 1/20 -> 1/20 (identical)
```

At n=20 the standard error tightened from ~20-62 (the two n=5-6 runs) down to
15.2, and the mean diff landed close to zero — this is not "still unresolved,"
it's a settled null: **`queenLayingIncomeBrake` at sensitivity=40 has no
detectable effect** on final population or extinction rate. The apparent win
(+24.3, n=6) and apparent loss (-54.6, n=5) were both sampling noise from
underpowered runs, now resolved by more data rather than either one panning
out.

**Superseded v0.53.0 — the whole colony-wide-aggregate approach was retired,
not just this one lever.** `queenLayingIncomeBrake` (EMA of net foodStored
delta) does not fix overshoot-collapse and was a confirmed null at n=20.
Rather than keep hunting for a working global-stock signal, the design pivoted
away from that whole FAMILY of mechanism: no real ant queen has any awareness
of colony-wide reserves — she only responds to her own fed condition. The
`bench/growth-brake-ab.mjs` and `bench/growth-brake-sensitivity-sweep.mjs`
harnesses (and the `queenLayingIncomeBrake`/`queenLayingTrendAlpha`/
`queenLayingTrendSensitivity` config keys and `Colony#_foodIncomeTrend`
tracker) were removed entirely rather than kept as an inert toggle — this
family of approach is retired, not paused.

**Replacement (v0.53.0), two locally-grounded mechanisms instead:**

1. **Queen laying depends ONLY on her own health**, not on
   `foodStored/foodStoreTarget` at all (`#updateQueenAndBrood` in
   `src/sim/colony.js`). Food scarcity still reaches her — indirectly, through
   the existing courier/trophallaxis feeding chain degrading her health when
   foraging fails — but nothing reads a colony-wide statistic directly.
2. **Oophagy**: nurses actively cull freshly-laid eggs/stage-1 larvae
   (`config.oophagyDelayTicks`, default 120 ticks of sustained
   `broodFeedRatio<0.3`) and recycle `config.oophagyRecycleNutrition`
   (default 5) back into the store, rather than losing that investment to a
   slow, non-recycling starvation death (`broodStarvationTicks`, unchanged,
   still applies to later-stage larvae with more sunk cost). This reacts to
   the brood chamber's actual per-tick feed ratio — a local signal — not a
   colony-wide stockpile level.

Both mirror documented real ant/wasp/bee colony behavior (queen fecundity
gated by personal nutrition status; brood cannibalism to reclaim nutrients
under stress) rather than an omniscient global-statistics hack.

**A/B'd at n=20 (same seed set as the growth-brake experiments, 18000 ticks,
NEW=v0.53.0 vs OLD=pre-v0.53.0 baseline via a temporary git worktree at commit
89960e9, since the old formula was deleted rather than left as a toggle):**

```
Paired diff (NEW - OLD) per seed, final population:
mean diff +82.0   SD 61.6   SE 13.8   |diff/SE| 5.95
avg final: 49.9 -> 131.9 (+82.0, >2.6x)
avg peak:  341.3 -> 345.9 (roughly unchanged)
extinctions: 1/20 -> 1/20 (same seed goes extinct either way — a fragile
  seed independent of this mechanism)
```

**This is a real, statistically significant win** — |diff/SE|=5.95 is far past
the ~2 SE threshold that the retired brake failed to clear (0.51). Unlike the
retired brake, this doesn't reduce the peak (which stayed ~341→346) — the
entire effect is in POST-peak survival, i.e. it doesn't prevent the initial
overshoot but substantially improves how many ants make it through the
subsequent bust. Confirms the biological-signal redesign (queen-health-only
laying + oophagy) both realizes the realism goal AND outperforms the old
global-stock-taper mechanism it replaced. Overshoot-collapse (the initial
peak-then-crash shape) is technically still present — this raised the floor
of the crash substantially, not the ceiling of the peak.

## Nest-space carrying capacity (v0.54.0) — targeting the peak itself

v0.53.0 raised the floor of the crash but left the peak (~341-346 ants)
untouched. To flatten the peak itself — not just improve post-crash survival —
added a third biologically-grounded, LOCAL mechanism: nest-space carrying
capacity. Real ant/termite colonies are physically bound by dug nest volume;
growth beyond available space is a literal physical constraint (nowhere to
put new brood/workers), not a colony-wide accounting statistic.

`#updateQueenAndBrood` now computes `nestCapacity = nestSpaceBaseCapacity +
excavatedTiles/nestSpaceTilesPerAnt` (mirroring `larvaeCrowding`'s existing
accumulate/decay shape, applied to population vs. dug space instead of brood
density vs. nurse attention) and gates egg-laying on a `nestCrowding` signal
that ramps when population exceeds capacity. Defaults:
`nestSpaceBaseCapacity=300` (matches the 300-ant founding cohort so early game
isn't penalized before any digging happens), `nestSpaceTilesPerAnt=2`.

**Sanity check (single seed, corrected after an initial testing mistake — see
below):** same-seed comparison of default capacity (300) vs. a much tighter
override (120, tilesPerAnt=4) on seed `nest-cap-check2`:

```
default (cap=300):  peak 361 @10091  final 134
override (cap=120): peak 282 @7815   final 155
```

Confirms the mechanism works as designed — a tighter capacity does flatten the
peak (361→282, ~22%) with comparable-or-better final survival on this seed.
**This is single-seed evidence only** — per this session's statistical-power
lesson, NOT sufficient to tune the default or claim a validated improvement.
The 300 default was chosen conservatively (matches founding population, so it
doesn't regress anything already validated in v0.53.0's n=20 A/B) rather than
tuned for maximum peak-flattening. A proper next step, if pursued: sweep
`nestSpaceBaseCapacity` at n≈20 seeds to find where it actually helps without
starving the colony too early, following the exact methodology this whole doc
has converged on (n=20 minimum, paired diff, report SE, ≥16000 ticks).

**Process note:** an earlier attempt to sanity-check this (running the
override at 18000 ticks and comparing against a *different* trace I'd run in
between, without re-checking the actual adjacent output) produced a false
"no effect at all" result — not a code bug, just sloppy same-seed comparison.
Re-running both conditions explicitly side-by-side in one command caught it.
Worth remembering: always diff two outputs you can see in the same place,
not one fresh run against a remembered number.
