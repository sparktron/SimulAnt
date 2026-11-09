# Experiment: instant exit field vs lagged exit scent (2026-11-08)

Why: PR #80 review (Codex, P1) flagged the instant nest-exit field
(`src/sim/behavior/NestExitField.js`) as breaking the AGENTS.md rule that ant
AI is purely local, because a distant dig changes the gradient immediately. This
run tests whether a locally-propagated, lagged version works as well.

## Arms

- **A `instant`** (shipped, baseline): breadth-first walking distance from the
  colony's mouths, rebuilt the moment terrain or entrances change.
- **B `scent`** (`config.exitScentField: true`): same distance values, but each
  underground tile updates once per tick from its 8 neighbours' previous-tick
  values (mouth = 0, else min neighbour + 1, cap 1000). Changes travel one tile
  per tick; a cut-off pocket's values climb and fade instead of vanishing.
  Seeded at steady state on first use. Ant-side steering is identical.

## Pre-registered hypothesis

B is within noise of A: stuck-underground and stuck-on-surface % within
±0.5 pp, hurt-worker mouth crossings within ±5 per 1,000 hurt-ticks, final
population within ±5%, mean exit latency (consecutive underground ticks in
`EXIT_NEST`) within ±10%. Refuted if B is worse beyond any bound.

## Setup

- Code `39f359a` (branch `fix/nest-exit-and-hurt-healing`, clean tree); default
  config plus the arm flag; 7,500 ticks.
- Run 1: seeds a–h. Run 2 (replication, pre-registered after run 1 showed large
  chaotic per-seed divergence): seeds i–x. 24 seeds × 2 arms in all.
- Node v24.16.0, Linux, 20 cores, one process per (arm, seed); deterministic.
- Harness: `bench/exit-field-ab.mjs`. Per-seed raw numbers:
  `bench/results/exit-field-ab-2026-11-08.csv`.

## Observed (pooled 24 paired seeds; scent minus instant, mean ± 95% CI)

| Metric | Black | Red |
|---|---|---|
| Stuck underground, pp (instant ≈ 2.7 / 2.9%) | −0.35 ± 0.65 | −0.92 ± 0.87 |
| Stuck on surface, pp (instant ≈ 2.8 / 2.9%) | −0.85 ± 0.84 | −1.05 ± 0.74 |
| Hurt mouth crossings per 1k hurt-ticks | −5.5 ± 7.3 | +4.5 ± 12.9 |
| Exit latency, ticks (instant ≈ 14.0 / 11.9) | −0.09 ± 1.00 | +0.03 ± 0.79 |
| Final population, ants (instant ≈ 142 / 109) | +2.7 ± 12.3 | +0.4 ± 13.6 |
| In-nest clump tiles per sample (instant ≈ 8.0 / 7.4) | −0.3 ± 1.5 | +1.9 ± 2.3 |

- The arms diverge chaotically within a few hundred ticks; single seeds swing
  widely (black seed b: 42 vs 101 final ants). Seed a was identical in both.
- Red's run-2 aggregate crossings (48.1 vs 16.3 per 1k) came from one seed (q):
  15,212 crossings in the scent run vs 3,220 instant. Traced: every crossing is
  a hungry, hurt forager during a famine (store empty), bouncing between "go
  forage" in the nest and the surface low-health "go home" rule. The instant
  arm on seed q shows the same signature for a shorter famine. Excluding q,
  red crossings are 3,613 scent vs 3,903 instant.
- Runtime: scent +2–5% total CPU (runs were in parallel, so this is noisy).

## Interpretation (inference)

- Refuted only in B's favour: B is not worse on any metric. Its point estimates
  for stuck rates are lower beyond the ±0.5 pp bounds, but most 95% CIs touch or
  include zero and 12 comparisons were made, so treat "slightly better" as
  weak evidence. "No worse" is the solid result.
- Lag costs almost nothing because terrain near busy exits changes rarely and
  the wavefront crosses a nest in tens of ticks, well under an ant's trip.
- The famine bounce is a separate bug in the low-health rules, independent of
  the exit field.

## Decision / next

- B is the better fit: equal-or-better behaviour, and it satisfies the
  local-AI rule. Adopting it as default still needs (1) the scent array
  serialized in saves (a reload currently re-seeds at steady state, so a scent
  run diverges after load) and (2) a replay-hash re-capture.
- Fix the famine bounce: the surface low-health rule should not send a hungry,
  hurt ant home when the store is empty.
