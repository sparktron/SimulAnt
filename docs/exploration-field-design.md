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

- **`coverage`** — unique surface tiles entered by searching ants, measured as a
  **RATE: averaged per `COVERAGE_WINDOW` (500) ticks**, NOT cumulative. The direct
  test of the hypothesis: does the mechanism spread searchers onto more distinct
  ground per unit time? **(Increment-1 finding: cumulative unique coverage SATURATES
  — searchers eventually reach ~100% of the surface regardless of strategy by
  ~1500+ ticks, so a cumulative metric can't discriminate. The visited mask is
  reset each window and the per-window unique count averaged. This is why
  "validate the metric before changing behavior" was increment 1.)**
- Keep **pickups** as the outcome metric (discovery rate) and **nutrition** as the
  headline. Coverage going up while pickups don't = the mechanism spreads ants but
  not usefully (e.g. into dead map corners) → a tuning or constraint problem.

Same discipline as always: 6 seeds to rank, **12 to decide**, shared-OFF baseline,
single mode as the bar to beat.

---

## Increment 1 RESULTS (2026-06-28, `bench/forage-sweep.mjs`, 6 seeds × 5000)

Coverage metric built (windowed) and **validated** — but it surfaced a finding that
**re-weights the whole plan away from role B**.

| config | coverage/window | covΔ% vs OFF | pickups vs OFF |
|---|---|---|---|
| OFF | 16746 | — | (903) |
| single (shipped) | 15722 | −6.1% | +4 |
| dual-recruit | 15431 | −7.9% | −85 |

- **Metric validated:** recruitment lowers coverage (−7.9%) AND pickups (−85) — it
  clumps searchers, exactly as the metric should show.
- **KEY FINDING — coverage does NOT predict pickups.** OFF has the HIGHEST coverage
  (+6% vs single) but FEWER pickups (903 vs 907). Maximum searcher spread (pure
  random walk, no trails) does not beat single mode on discovery. **Raw coverage is
  not the binding constraint on discovery in this sim.**
- **Implication for role B (dispersion):** B's mechanism is "push coverage back up
  toward OFF." But OFF *is* the high-coverage ceiling and it doesn't pay → B is
  predicted to FAIL. Do not build B first (or at all) without a reason this analysis
  misses. Skipping straight to a B A/B would likely just reproduce OFF's profile.
- **Re-weight to role C (dead-source repulsion):** C is about WHERE searchers go
  (avoid re-checking just-depleted spots), not raw spread — the coverage/pickups
  decoupling says "where" matters, "how much" doesn't. C is now the lead.
- **Alternative read:** the single path may simply be near the environment's
  discovery ceiling (food respawn rate / vision / ant count bound pickups, not
  searcher behavior). If C also fails, that is the conclusion.

**Revised plan:** lead with **C**, treat **B** as likely-dead (test only to confirm
the prediction if cheap), keep **D** as the structural fallback.

---

## Increments

1. ✅ **Coverage metric first.** DONE — windowed coverage in `bench/forage-sweep.mjs`,
   validated; baseline above. Outcome redirected the plan (B→C). This is the value
   of a metric-only increment before building anything.
   **(Plan revised after increment 1: lead with C, not B — see results above.)**
2. ✅ **Field plumbing (inert)** — DONE v0.49.2. `world.explored` field + buffers +
   `depositExplored` + update/swap/clear/rebuild; params `evapExplored 0.1` /
   `diffExplored 0.0` wired into the always-on update; `test/exploration-field.test.mjs`;
   single mode byte-identical (replay-hash green). Shared by C and (if tested) B.
3. ✅ **Wire deposit + read** — DONE v0.49.3. Read (steering.js penalty, food channel)
   + deposit B (searcher per-step) + deposit C (pickup, thinning cluster), behind
   `explorationField`. Verified: off→empty (byte-identical), on→23k cells. **KEY
   FINDING: the pickup-triggered role-C signal essentially never fires** —
   instrumentation showed 396/397 pickups happen with 10+ pellets within radius 6.
   Ants pick in ABUNDANCE, not scarcity; depletion is never observed *at a pickup*.
   So **role B (searcher coverage + slow-evap emergent dead-zones) is the
   implementable mechanism** — a heavily-trafficked (recently-rich) area accumulates
   repulsion that lingers as it empties. C is kept but rarely fires. This also
   nuances increment 1: B-as-repulsion changes WHERE searchers forage (off
   recently-worked ground), a different lever than the raw coverage *amount* that
   increment 1 found doesn't pay. B and C are independently disable-able (deposit
   amount → 0) for attribution in the increment-4 A/B.
4. **A/B + sweep C** `exploreAvoidWeight` (dose), `evapExplored` (how long a dead
   spot stays repulsive), `depletedRepulseRadius`. Win = pickups ON > single's +9.
5. **Confirm-or-bury B** only if cheap: a single A/B of deposit source B (searcher
   coverage). Increment 1 predicts it ≈ OFF's profile (no pickup gain); run it once
   to confirm the prediction, then drop it.
6. **Verdict** → ship C (and/or B) if it beats single (win condition), else
   FAILED-table the exploration-field direction — a strong "single path is at the
   environment's discovery ceiling" result (food respawn/vision/ant-count bound,
   not searcher behavior).

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
