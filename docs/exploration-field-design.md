# Exploration / Dispersion Field — Design Scope

**Status:** scoped, not implemented. **Topic:** pheromone foraging future-direction
(supersedes the failed two-pheromone *recruitment* direction #3).
**Read first:** `docs/pheromone-strategy.md` (esp. the FAILED table) and
`docs/2026-06-27-depletion-reactive-and-config-cleanup.md`.

---

## Why this, and why now

Every pheromone experiment in this project converges on one truth: **the foraging
bottleneck is EXPLORATION — discovering food that depletes and respawns elsewhere —
not EXPLOITATION of known sources.** The depletion-reactive decay win (v0.47.0)
worked by making trails *less* committal; the two-pheromone *recruitment* attempt
(v0.49.x) failed because it pulled searchers onto known clusters, trading
exploration for exploitation at a net loss (12-seed: −3.8%…−6.1% vs single).

So the next idea must do the opposite of recruitment: **spread searchers onto
ground the colony has NOT recently covered**, so relocating food is found sooner.
This is a known swarm technique — a *negative* / *anti-* pheromone for area coverage.

It also **reuses the scaffold we just built**: the v0.49.0 work added a 4th
double-buffered field (`world.recruit`) and proved the pattern (deposit method,
update/swap/clear, config toggle, transient/no-serialize). This direction adds a
5th field the same way — low plumbing risk, the mechanism is the only new part.

---

## Hypothesis (falsifiable)

> Searchers that are softly **repelled from recently-visited tiles** will cover
> more unique ground per tick, discover relocating food clusters sooner, and raise
> pickups ABOVE single mode's +9 vs OFF — without the death-spiral / over-commit
> failure modes, because the field steers *exploration*, never pulls ants off food.

**Win condition:** pickups ON ≥ single mode (beat +9 vs OFF), trailGain ≥ single
(≥ +0.5%), at 12 seeds × 5000 — AND a direct coverage metric (below) goes UP.
**Kill condition:** if it can't beat single after a focused param sweep, it joins
the FAILED table next to recruitment, and we conclude the single path is at the
environment's ceiling.

---

## Mechanism

A new transient field `world.explored` — a decaying "the colony has recently been
here" map, laid by SEARCHERS and used as a mild **repulsion** in steering.

1. **Deposit (searchers only).** Each step a foraging searcher (state
   `FORAGE_SEARCH`, not carrying) adds a small amount to `explored` at its tile.
   Carriers and in-nest ants do NOT deposit (returning is not exploration).
2. **Evolve.** Evaporates each tick (`evapExplored`) so "recently visited" decays
   back to explorable over tens–hundreds of ticks; low/no diffusion (keep it local
   — it marks where ants *were*, not a gradient to smear).
3. **Read (searchers only, soft).** In `moveByPheromone` (food channel,
   not carrying), SUBTRACT a contribution proportional to `explored[neighbor]` from
   the per-direction steer signal — a bias toward LESS-visited neighbors. Weak and
   additive, exactly mirroring how `recruitContribution` was added (but negative).

### The two hard constraints (where this dies if done wrong)
- **Must never pull ants off food.** The repulsion is weak relative to food
  pheromone + the food-vision pickup logic, and is a soft steering bias, not a hard
  block. An ant that *sees* a pellet still goes for it (pickup logic is upstream of
  steering weights). If `exploreAvoidWeight` is too high, ants flee their own
  freshly-laid explored scent and jitter — the symmetric twin of the recruitment
  death spiral. Expect a narrow safe dose, like every other lever here.
- **Must self-clear.** `evapExplored` has to let an area become re-explorable, or
  searchers get pushed to the map edges and stick there. Too slow → ants run out of
  "new" ground and pile at boundaries; too fast → no memory, no coverage benefit.

---

## Integration points (mirror the v0.49.0 recruit work)

| File | Change |
|---|---|
| `src/sim/world.js` | add `explored` + `_exploredNext` + active lists; `depositExplored`; wire into `updatePheromones` (update/swap), the `enablePheromones:false` clear, and `#rebuildActiveLists`. NOT serialized (transient, like `harvest`/`recruit`). |
| `src/sim/ant/decisions.js` | in `forageSearch`, deposit `explored` at the ant's tile each search step (gated by `config.explorationField`). |
| `src/sim/ant/steering.js` | in `moveByPheromone` (food channel, not carrying), subtract `explored[nidx] * exploreAvoidWeight` from the steer signal (gated). |
| `src/ui/params.js`, `src/main.js`, `SimulationTypes.js` | toggle `explorationField` (default off) + params `evapExplored`, `diffExplored`, `depositExplored`, `exploreAvoidWeight`; sanitizer clamps mirroring the recruit params. |
| `test/exploration-field.test.mjs` | deposit/evap/clear/defaults characterization, like `dual-pheromone.test.mjs`. |

Single mode (toggle off) stays byte-identical: deposit + read gated, field-update
loops over an empty active list (no rng calls, no effect on other fields).

---

## Measurement — needs a coverage metric (new)

The existing metrics (nutrition, pickups, PR, circling) don't directly show
coverage, which is the whole point. Add to `bench/forage-sweep.mjs`:

- **`coverage`** — count of UNIQUE surface tiles entered by searching ants over the
  run (a `Uint8Array` visited mask, summed at the end). The direct test of the
  hypothesis: does the mechanism actually spread searchers wider?
- Keep **pickups** as the outcome metric (discovery rate) and **nutrition** as the
  headline. Coverage going up while pickups don't = the mechanism spreads ants but
  not usefully (e.g. into dead map corners) → a tuning or constraint problem.

Same discipline as always: 6 seeds to rank, **12 to decide**, shared-OFF baseline,
single mode as the bar to beat.

---

## Increments

1. **Coverage metric first.** Add `coverage` to the sweep harness and baseline
   single vs OFF, so we can see coverage *before* changing behavior. (Cheap, and it
   validates the metric.)
2. **Field plumbing (inert)** in `world.js` + config toggle/params + test — same
   shape as v0.49.0; single mode byte-identical.
3. **Wire deposit + read** (decisions.js / steering.js) behind `explorationField`.
4. **A/B + sweep** `exploreAvoidWeight` (the dose), `evapExplored` (memory length),
   `depositExplored`. Expect a narrow safe band for the avoid weight.
5. **Verdict** → ship if it beats single (win condition), else FAILED-table it.

---

## Risks & open questions

- **It may also fail.** It's plausible the correlated random walk + outward
  `headingBias` already cover ground near-optimally, leaving little headroom. If so,
  that's a strong "single path is at the ceiling" conclusion — still worth knowing.
- **Interaction with the home field.** Searchers already lay `toHome` near the
  entrance; the explored field is a *different* signal (where searchers *roamed*,
  not a gradient to the nest). Keep them independent.
- **Reuse vs new field.** Could repurpose the now-idle `recruit` field instead of
  adding `explored`. Recommendation: **add `explored`** — clearer semantics, and it
  leaves the recruit scaffold intact for a future *exploration-preserving
  recruitment* idea (e.g. recruit only to NET-NEW sources). Costs one more
  Float32Array per world (~256KB at 256×256); negligible.
- **Edge-sticking.** Watch for searchers piling at map boundaries (over-repulsion /
  too-slow evap). The coverage metric + a circling-style check will catch it.
