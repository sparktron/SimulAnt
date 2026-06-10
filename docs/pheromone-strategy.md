# Pheromone Foraging Strategy & Experiment Log

**Maintained by:** Claude Code
**Last updated:** 2026-06-08 (through v0.45.1)
**Scope:** food/recruitment pheromone trails — `src/sim/ant/steering.js`
(`moveByPheromone`), `src/sim/ant/decisions.js` (trail deposit + pickup),
`src/sim/world.js` (`updatePheromones` evap/diffusion), config in
`src/ui/params.js` (`getDefaultConfig`) + `src/main.js`.

> **Purpose of this file:** record what has been *tried and measured* so we do
> not re-run experiments that already failed. Before proposing a pheromone
> change, check the "What FAILED" table first. Current status: **better than it
> was, but still needs work** — at the shipped vision radius (18) trails are only
> roughly break-even vs no-trails, and convergence is partial.

---

## TL;DR current state

- Trails were historically **net-negative** for foraging (a bug, not a feature).
- They are now roughly **break-even-to-slightly-positive**, converge into visible
  corridors, and no longer trap carriers in death spirals.
- The biggest remaining lever is **`foodVisionRadius`**: trails only *beat*
  no-trails at vision ≥ ~22; the current default is 18 (a user preference), where
  trails are ~7% below no-trails but visually converged and stable.

---

## How to measure (methodology — reuse this, don't reinvent)

All findings below come from **headless A/B** runs: instantiate `SimulationCore`,
override `config` (from `getDefaultConfig()`), step `sim.update(config)` for
N ticks across several fixed seeds, and compare a metric **trails-ON vs
trails-OFF** (`enablePheromones:false`) on the *same seed* (identical world/food).
Standard run: **6–12 seeds × 5000 ticks**.

Key instrumentation tricks (each was necessary — naive metrics misled us):

| Metric | How | What it isolates |
|---|---|---|
| **Nutrition gathered** | wrap `colony.depositFoodFromAnt`, sum `pelletNutrition` on success | food *gathering*, free of consumption/respawn noise |
| **Pickups** | count distinct ants entering `carrying==='food'` | discovery rate (the real bottleneck) |
| **PR (participation ratio)** | `(Σv)² / Σv²` over `world.toFood` | trail **convergence**: low = few strong corridors, high = fragmented fan |
| **Circling** | net displacement < 5 tiles over a 30-tick window while carrying | **death spirals** (carry-duration is USELESS for this — see below) |

Experiment harnesses lived in `/tmp/pheromone_*.mjs` during the investigation
(ephemeral). If we revisit this, **persist them under `scripts/` or `test/`** so
the methodology survives. Their shapes are documented in the table above.

---

## What WORKS (shipped, with evidence)

### 1. Adaptive recruitment decay — `adaptiveTrail` (v0.44.0)
A carrier's trail-laying strength is seeded at pickup (`recruitRichBudget` 1.6 for
rich sources, 1.0 otherwise) and decays per tick (`recruitDecayPerStep` 0.97) on
the way home. Straight returns from live rich clusters lay strong corridors;
wandering carriers and returns from depleted/marginal sources lay almost nothing.
- **Effect:** halved smeared trail tiles (`strongN` 604→266); first mechanism to
  make trails beat no-trails (+9% nutrition alone). Code: `decisions.js` deposit
  scaling + recruitment seeding at both pickup sites.

### 2. Carrier consolidation — boosted return trail-following (v0.44.0)
Returners prefer existing food-trail tiles (`returnTrailBoostScale` 0.15→0.6,
`returnTrailBoostMax` 3→6) and meander less (`returnCarryNoiseScale` 0.3→0.1).
- **Effect:** +10% nutrition combined with adaptive decay. **Order matters:**
  consolidation *alone* (without adaptive decay) was −13% — it herds ants onto
  stale trails. Only safe once adaptive decay removes dead corridors first.

### 3. Carrier trail-gravitation — `trailGravitation` (v0.45.0, fixed v0.45.1)
A returning carrier scans for the strongest `toFood` tile within
`trailGravitationRadius` (3) and biases its step toward it, merging separate
return lines laterally into shared corridors. **Acts only on carriers**, so
searchers keep exploring (convergence at no discovery cost).
- **Effect:** PR 1067 → ~726, peak trail strength 5 → ~18 (thin fans become thick
  corridors), nutrition held.
- **Critical constraint (the v0.45.1 fix):** gravitation targets must be strictly
  **closer to the entrance** than the ant. Without it, carriers (which deposit
  `toFood` every tick) gravitate back onto their own fresh deposit and orbit →
  **death spiral**. The homeward filter drops circling *below* the no-gravitation
  baseline. Gain **0.4** is the measured sweet spot (0.3 wavers, ≥0.5 and/or
  radius 4 re-introduce circling).

### Other settled facts that help
- **Wider vision helps trails, narrow vision hurts them.** trailGain (ON vs OFF)
  rose monotonically with `foodVisionRadius`: 8→−16%, 12→−7%, 16→−4%, 24→+9%.
  Rich-source recruitment needs ≥3 pellets visible at once, which low vision
  rarely provides. (Default is 18 by user choice; ~break-even.)

---

## What FAILED — do NOT retry these

| Tactic | Result | Why it failed |
|---|---|---|
| **Lower `foodVisionRadius` to give trails "a job"** | −16% to −56% nutrition; colony starves at v8–12 | Trails are *built from* finds; less vision = fewer finds AND the rich-source bonus rarely fires. Trails multiply discovery, they don't replace it. |
| **Make trails stronger/stickier to force one corridor** (raise `depositFood`, lower `evapFood`, raise `followBeta`) | monotonically WORSE; "converge combo" −62%, near-extinction | Food depletes & respawns elsewhere; a strong *persistent* trail points at an eaten-out spot and commits more ants to a dead location. Stronger = more misallocation. |
| **`followAlpha` sharpening for convergence** | only −8% PR, costs −11% nutrition | Acts on searchers too → over-commits them to one trail → kills exploration. |
| **Diffusion bump (`diffFood` ↑) to merge parallel trails** | PR went UP (more fragmented), nutrition flat/down | Diffusion *spreads* mass outward; it does not focus it into a corridor. |
| **High gravitation gain (≥0.5, or radius 4) to maximize convergence** | re-introduces death spirals (circling > baseline) | Aggressive lateral pull recreates the backward-orbit pathology. |
| **Anti-stall escape hatch** (suppress gravitation for carriers making no homeward progress) | redundant — no measurable benefit over the homeward filter alone | The homeward filter already prevents the orbit mechanism; the stall code was deleted. |
| **Lower `headingBias` to free up trail recruitment** (sweep 0.40→0.10, 6 seeds×5000 via `bench/forage-ab.mjs`) | tiny relative gain, real absolute loss. trailGain best near 0.20 (−8.6% vs −10.2% @ 0.40) but inside seed noise; absolute pickups fell 832→764→609 and nutrition 30937→23254 as bias dropped, colony shrank 238→194. 0.10 is clearly worst (−19.8%). | headingBias's main job is keeping searchers committed to a heading so they COVER GROUND and discover food — not anti-recruitment. Lowering it just makes searchers wander and discover less in BOTH conditions. The −10% trailGain is structural (the gait multiplier blocks turns onto a crossed trail), not a headingBias artifact. Shipped 0.40 gives the best absolute throughput. |
| **Carry-duration as a spiral metric** | could not distinguish spirals from unlucky long routes (identical with gravitation off) | A spiral is *moving without displacing*; measure net displacement over a window instead. |

---

## Known limitations / why it "still needs work"

1. **Net-negative at the shipped vision (18).** Trails (even converged) gather
   ~7% less than no-trails at vision 18. They beat no-trails only at vision ≥ ~22.
   So today trails are mostly a *visual/behavioral* feature at the cost of a few %
   throughput. Raising vision back toward 22–24 would make them net-positive —
   untested *in combination with* gravitation.
2. **Convergence is partial.** Spiral-safe gravitation lands at PR ~726, not the
   PR ~343 of the (spiral-prone) unconstrained version. Maximum convergence and
   spiral-safety are in tension because tight merging needs backward pulls.
3. **The environment fights persistent trails.** Depleting + relocating food
   clusters mean any long-lived corridor decays into a pointer at a dead source.
   Everything that works does so by making trails *transient and discovery-led*.

## Phase 2 finding (characterized) — "stronger recruitment" is the wrong lever

The recruitment threshold is now measured directly (`test/steering.test.mjs`): a
searcher crossing a single trail tile turns onto it only **~18% at v=0.3, ~34% at
v=0.5** (typical mid-route single-carrier strengths), crossing 50% only above
**v≈0.9**. So a lone discoverer's trail recruits almost nobody — the gait
multiplier (forward ×1.6 vs sideways ×0.5) makes a perpendicular trail expensive
to join. That is review bug #1, quantified.

The tempting fix is "boost recruitment" (raise followBeta/followAlpha, or relax
the gait toward strong trails). **The A/B baseline says do not.** At default
config the harness measures **pickups ON 832 < OFF 903** — trails already *suppress*
discovery, because the searchers that do get recruited are pulled off exploration
onto existing (often depleting) corridors. Strengthening recruitment commits
*more* searchers to those corridors — exactly the regression the "What FAILED"
table already records for followAlpha/followBeta/stronger-deposits.

**Conclusion:** weak recruitment is a *symptom*, not the disease. The disease is
that trails point at sources that are no longer the best place to be, so recruiting
onto them is net-negative. The productive levers are therefore the ones that make a
trail's strength track *live* harvest success — future-directions #2
(depletion-reactive decay) and #3 (two-pheromone recruitment) — after which
*raising* recruitment becomes safe and beneficial. Measure every step with
`bench/forage-ab.mjs`; the win condition is **pickups ON ≥ OFF**.

---

## Future directions (untested ideas worth trying)

Ordered roughly by expected value. None of these have been run — they are NOT in
the "failed" list.

1. **Vision 22–24 + gravitation A/B.** Cheapest high-value test: confirm the
   net-positive *and* converged regime. Likely the single best next experiment.
2. **Depletion-reactive trail decay.** Tie `toFood` evaporation (or a per-corridor
   decay multiplier) to *recent pickup success along that corridor*, so a trail
   to an exhausted cluster collapses within tens of ticks instead of lingering.
   This is the "consensus that tracks a moving target" mechanism the brute-force
   strength sweep couldn't achieve. Needs code (per-region success tracking).
3. **Two-pheromone recruitment** (separate short-lived "recruitment" channel from
   the long-lived "route" channel), à la real ant trail vs. recruitment scents.
   Lets discovery spread fast without polluting the stable corridor field.
4. **Searcher trail-following with a strength threshold** (winner-take-all only
   above a high `trailLockThreshold`), so weak fragments are ignored but a genuine
   dominant corridor recruits — without the global over-commitment `followAlpha`
   caused. Tune carefully; adjacent to a known failure.
5. **Quality-weighted deposits** beyond the current binary rich/poor budget —
   scale `recruitRichBudget` continuously by pellet count/nutrition at the source.
6. **Persist the experiment harnesses** into `scripts/` and add a lightweight
   regression check that trails-ON ≥ trails-OFF at the default config, so future
   tuning can't silently regress foraging.

---

## Relevant config (current defaults, v0.46.0)

```
enablePheromones: true        foodVisionRadius: 18
evapFood: 0.25                 diffFood: 0.02         depositFood: 0.7
followAlpha: 1.5              followBeta: 4.0         pheromoneMaxClamp: 150
adaptiveTrail: true           recruitDecayPerStep: 0.97   recruitRichBudget: 1.6
returnTrailBoostScale: 0.6    returnTrailBoostMax: 6.0    returnCarryNoiseScale: 0.1
trailGravitation: true        trailGravitationGain: 0.4   trailGravitationRadius: 3
trailGravitationMinTrail: 0.5 trailGravitationMax: 4.0  (promoted to real
  tunable defaults in v0.46.0 — previously code-only ?? fallbacks)
foodTrailDistanceScale: 1.0   maxFoodTrailScale: 1.8      foodDepositMinDistance: 8
trailLockThreshold: 1.0
```

## Version history

| Version | Change |
|---|---|
| ≤ v0.43.7 | Trails net-negative (~−20% vs OFF @ vision 24); colony survived on direct vision + food respawn, not trails. |
| v0.44.0 | Adaptive decay + carrier consolidation → first config to beat no-trails (+10% @ vision 24). |
| v0.44.1 | `foodVisionRadius` 24 → 18 (user preference). |
| v0.45.0 | Carrier trail-gravitation → corridor convergence (PR −68%). Introduced rare death spirals. |
| v0.45.1 | Homeward filter on gravitation → kills spirals (circling below baseline); convergence settles at PR ~726. |
