# Performance Profile — 2026-06-02

Measured profiling of the per-tick simulation under a grown colony, addressing
`open-items-todo.md` #6 ("profile pheromone updates and food-pellet scans under
large colonies") and KNOWN_ISSUES #5. Harness: `bench/tick-profile.mjs`
(fixed seed `tick-profile`, deterministic).

## How to reproduce

```
node bench/tick-profile.mjs 2000 200        # whole-tick timing + attribution at colony peak
node --prof bench/tick-profile.mjs 2000 600 && node --prof-process isolate-*.log | head -40
```

## Headline finding: the documented hypothesis is wrong

KNOWN_ISSUES #5 and the todo flagged **food-pellet scans** as a per-tick hotspot
candidate. Measured, they are **~0.7%** of tick time. The real cost is the
**full-grid pheromone update (~33%)**, which is a *fixed* cost independent of ant
count, followed by **per-ant steering (~12%)**.

## Colony dynamics (the confound)

The colony never sustains a "large" size. From a 40-ant start it peaks at
**~129 ants around tick 2000–2500, then starves to zero by tick ~6000**
(`foodStored` reaches 0 at ~tick 2500). So:
- "Large colony" profiling must measure at the **peak window** (~grow 2000 ticks).
- O(ants × pellets) scan cost can never bite at scale because the colony
  collapses long before ant counts get large enough to matter.

| grow tick | ants | surface pellets | foodStored |
|--:|--:|--:|--:|
| 500 | 51 | 375 | 2019 |
| 2000 | 121 | 279 | 299 |
| 2500 | 129 | 249 | 0 |
| 4000 | 34 | 217 | 0 |
| 6000 | 0 | 215 | 0 |

> The starvation collapse is a **bigger product issue than per-tick perf** — large
> colonies don't persist, so perf-at-scale is partly moot. Tracked separately in
> the ant-starvation docs.

## Measured breakdown (peak, ~127 ants, 1.93 ms/tick total)

V8 `--prof` JavaScript samples (relative ranking; ~47% "unaccounted" is optimized
native/GC the sampler can't attribute):

| function | % JS samples | notes |
|---|--:|---|
| `World.#updatePheromonesField` | **28.9%** | 3 channels × full 256×256 grid; the dominant cost |
| `steering.moveByPheromone` (+callees) | **~12%** | per-ant gradient sampling; scales with ant count |
| `World.#computePassabilityMask` | 3.3% | rebuilt every tick |
| `Ant.#decideAndMove` | 1.7% | dispatcher |
| `MicroPatchEngine.update` | 1.4% | per-ant loop |
| `findVisiblePellet` + `findAvailablePelletAt` | **0.7%** | the suspected hotspot — negligible |

Per-tick attribution (instrumented, 500 ticks @ ~127 ants):
`updatePheromones` 28.4% · pellet scans (all three) 3.4%.

## Recommendations (ranked, all behavior-preserving)

1. ✅ **Cache the passability mask with a dirty flag** (v0.32.0). `#computePassabilityMask`
   rebuilt a 65k-cell `Uint8Array` every tick, but terrain only changes on
   dig/tool actions. Now cached behind `_passabilityDirty`; terrain writes route
   through `World.setTerrain()`/`markTerrainDirty()` to invalidate. Field output
   byte-identical.
2. ✅ **Double-buffer the pheromone fields** (v0.32.0). Removed the
   `srcField.set(dstField)` full-grid copy (×3/tick); `updatePheromones` now
   swaps the live ↔ `_*Next` references each tick. Every cell of the scratch
   buffer is unconditionally written each pass, so no stale data leaks; verified
   no reader caches the array across ticks.

   **Measured (1+2 together, same harness/seed):** `updatePheromones`
   556,325 → 457,314 ns/call (−17.8%); whole tick 1.83 → 1.68 ms/tick
   (547 → 594 ticks/sec, +7.8%). `toFood field hash` unchanged (`4225428468`);
   all 294 tests pass.
3. ✅ **Active-cell tracking (v0.37.0).** The fields are ~3–9% non-zero (danger
   usually 0%), so the update now processes only non-zero cells and their
   4-neighbors instead of sweeping all 65k cells × 3 channels. Each channel keeps
   a live/scratch non-zero index list; deposits route through
   `World.deposit{ToFood,ToHome,Danger}` so freshly-deposited cells register.
   Double-buffer invariant (each buffer is 0 outside its list) is held by
   clearing the scratch's stale cells before writing candidates.

   **Measured (grow 4000, ~233 ants):** `updatePheromones` 473,402 → 140,314
   ns/call (**3.4×**, 23.5% → 8.1% of tick); whole tick 1.82 → 1.53 ms
   (551 → 655 ticks/sec). `toFood field hash` unchanged (`1308838676`); 298 tests
   pass. The empty danger channel is now nearly free (no full sweep).

`moveByPheromone` (#2 cost) is inherent per-ant work; the main lever there is ant
count, which the starvation collapse already caps.

## Regression guard

`bench/tick-profile.mjs` prints a `toFood field hash` and the colony size /
pellet count. Any behavior-preserving optimization (1 or 2 above) must leave the
hash unchanged. `pheromone-bench.mjs` covers the isolated `updatePheromones`
path with its own hash.
