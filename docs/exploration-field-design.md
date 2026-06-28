# Exploration / Dispersion Field — Design Scope

**Status:** scoped, not implemented. **Topic:** the two-pheromone design space
beyond the failed *recruitment* role — a repulsion field for exploration. Scopes
the lead candidate (dispersion, role B) with dead-source repulsion (role C) folded
in; see "The two-pheromone design space" for the full role taxonomy (A–E).
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

## The two-pheromone design space (what's tested vs open)

The v0.49.x failure falsified ONE *role* for a second field — attractive
recruitment — NOT the two-pheromone architecture. The architecture is a tool; what
matters is what the field DOES. The discriminator that predicts success in this sim:

> **Attraction fields amplify EXPLOITATION of known food → fail here.
> Repulsion fields and role-segregation preserve EXPLORATION → open.**

Recruitment failed because it was on the wrong side of that line, not from bad
tuning (the `recruitRichOnly` control proved gating *which* clusters you attract to
doesn't help — attracting to clusters at all is the problem). The remaining roles:

| # | Second-field role | Serves | Status / odds |
|---|---|---|---|
| A | **Recruitment** — attract searchers to finds | exploitation | ❌ TESTED, net-negative (FAILED table) |
| B | **Dispersion / "explored"** — repel searchers from recently-VISITED tiles | exploration | ⏭️ scoped below — **lead candidate** |
| C | **Dead-source repulsion** — repel searchers from recently-EXHAUSTED clusters | exploration | ⏭️ novel; cheap; shares all plumbing with B (see below) |
| D | **Scout/forager role-segregated trails** — scouts explore one field, foragers exploit `toFood` | both (division of labor) | 🔭 highest ceiling, heaviest lift (touches role assignment, not just a field) — defer |
| E | Quality-weighted / net-new-only recruitment | exploitation | ❌ low odds — same wrong side of the line as A; only if B–D all fail |

**B and C are siblings**, not alternatives: both are short-lived *repulsive* fields
read by searchers, differing only in WHERE scent is laid — B at every searcher
step (avoid re-covering ground), C at the moment/place a cluster depletes (avoid
re-checking dead spots). C is the searcher-side complement to depletion-reactive
decay, which only fixed the *route* half of "trails point at dead sources"; the
*searcher re-checking a dead spot via vision/wander* half is still open. They can
be built and A/B'd in the same experiment (one repulsion field, two deposit
sources, each behind its own sub-flag) so we learn which source — or both — helps.

**D (role segregation)** is the only idea that doesn't have to *choose* exploration
over exploitation — it runs a dedicated scout force alongside trail-following
foragers. Highest potential, but it reaches into caste/role logic rather than just
adding a field, so it's deferred until the cheap repulsion experiments (B/C)
resolve. If B/C win, D may be unnecessary; if they fail, D is the fallback.

The rest of this doc scopes **B (dispersion)** as the lead, with **C (dead-source
repulsion)** folded in as a second deposit source on the same field.

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

One repulsion field, **two deposit sources** (each behind its own sub-flag so the
A/B can attribute the effect):

1. **Deposit B — searcher coverage (`exploreDepositVisited`).** Each step a foraging
   searcher (state `FORAGE_SEARCH`, not carrying) adds a small amount to `explored`
   at its tile. Carriers and in-nest ants do NOT deposit (returning is not
   exploration). Marks "the colony has swept here recently."
1b. **Deposit C — dead-source repulsion (`exploreDepositDepleted`).** When a food
   source depletes (last pellet of a cluster taken / a pickup empties the local
   area), paint a `explored` disk at that spot. Marks "this cluster is eaten out —
   don't re-converge." This is the searcher-side complement to depletion-reactive
   decay (which only retracts the *route*; searchers can still wander back to a dead
   spot via vision/memory). Natural hook: the same pickup site in `decisions.js`,
   firing when `colony.countVisiblePellets(...)` at the pickup has dropped to ~0.
2. **Evolve.** Evaporates each tick (`evapExplored`) so "recently visited/dead"
   decays back to explorable over tens–hundreds of ticks; low/no diffusion (keep it
   local — it marks places, not a gradient to smear). C may want a slower decay than
   B (a dead cluster stays dead longer than a footprint is stale) — a candidate
   second evap constant if a single one proves too coarse.
3. **Read (searchers only, soft).** In `moveByPheromone` (food channel,
   not carrying), SUBTRACT a contribution proportional to `explored[neighbor]` from
   the per-direction steer signal — a bias toward LESS-visited neighbors. Weak and
   additive, exactly mirroring how `recruitContribution` was added (but negative).
   Both deposit sources feed the SAME field, so the read path is shared.

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
| `src/sim/ant/decisions.js` | **(B)** in `forageSearch`, deposit `explored` at the ant's tile each search step. **(C)** at the pickup site, when the local area is now empty, paint a `explored` disk. Both gated by `config.explorationField` + their sub-flags. |
| `src/sim/ant/steering.js` | in `moveByPheromone` (food channel, not carrying), subtract `explored[nidx] * exploreAvoidWeight` from the steer signal (gated). Shared by both deposit sources. |
| `src/ui/params.js`, `src/main.js`, `SimulationTypes.js` | toggle `explorationField` (default off) + sub-flags `exploreDepositVisited` / `exploreDepositDepleted` + params `evapExplored`, `diffExplored`, `depositExplored` (B), `depletedRepulseDeposit`/`depletedRepulseRadius` (C), `exploreAvoidWeight`; sanitizer clamps mirroring the recruit params. |
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
3. **Wire deposit + read** behind `explorationField`. Start with deposit source B
   (searcher coverage) only — it's the purest test of the hypothesis.
4. **A/B + sweep B** `exploreAvoidWeight` (the dose), `evapExplored` (memory length),
   `depositExplored`. Expect a narrow safe band for the avoid weight.
5. **Add deposit source C** (dead-source repulsion) and A/B B-only vs C-only vs B+C
   on the same shared field, to attribute the effect. C reuses the field + read path,
   so it's a small add once B exists.
6. **Verdict** → ship the winning combination if it beats single (win condition),
   else FAILED-table the whole exploration-field direction (a strong "single path is
   at the environment's ceiling" result).

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
