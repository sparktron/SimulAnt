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

1. **Cache the passability mask with a dirty flag** (~3.3%). `#computePassabilityMask`
   rebuilds a 65k-cell `Uint8Array` every tick, but terrain only changes on
   dig/tool actions. Invalidate on terrain mutation; otherwise reuse. Field
   output is byte-identical.
2. **Double-buffer the pheromone fields** (cuts the `srcField.set(dstField)`
   full-grid copy, ×3/tick). The `_toFoodNext` scratch buffers already exist —
   swap references each tick instead of copying back. Behavior-identical;
   touches every reader of `this.toFood/toHome/danger` (ants, renderers,
   serialize), so verify those go through the live reference.
3. **(Larger) Active-cell tracking for evaporation.** Most of the 256×256 grid is
   zero; walking it every tick to evaporate near-zero cells is wasteful. Tracking
   a sparse set of non-zero cells would shrink the dominant pass, but it's a
   real algorithmic change (higher risk to determinism) — only worth it if 1+2
   prove insufficient.

`moveByPheromone` (#2 cost) is inherent per-ant work; the main lever there is ant
count, which the starvation collapse already caps.

## Regression guard

`bench/tick-profile.mjs` prints a `toFood field hash` and the colony size /
pellet count. Any behavior-preserving optimization (1 or 2 above) must leave the
hash unchanged. `pheromone-bench.mjs` covers the isolated `updatePheromones`
path with its own hash.
