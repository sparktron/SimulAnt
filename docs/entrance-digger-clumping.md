# Entrance and digger clumping follow-up

Baseline commit `f4c9787`. Twenty headless runs used production defaults
with instant or lagged exit routing, ten paired seeds, and 7,500 ticks per run.
The seeds were a–h, q, and simant-default. Each run records its full config.

A persistent cluster sample required an ant to remain within one tile of an
anchor for 60 ticks, with at least two same-colony neighbors in a 3×3 square.
Entrance samples were within five tiles of an owned mouth. Underground digger
samples counted dig-focus ants, with two dig-focus neighbors required for a
cluster. Positions were sampled every five ticks after warm-up. Percentages
are shares of eligible ant-samples. An ant can contribute many samples. Short
queues, looser groups, and movement between sample ticks can escape this metric.

## Observed

- Entrance clump rates for instant and scent were 3.16% and 1.49% for black,
  and 2.70% and 2.54% for red. Red in simant-default reached 15.85% and 15.86%.
  The pooled entrance samples were dominated by `RETURN_NEST_TO_EAT` just
  underground and `EXIT_NEST` at the surface.
- In simant-default, one red worker made 2,200 and 2,202 transitions between
  those two states over the same 2,300-tick span. It oscillated across the
  surface boundary with roughly 45% hunger at the start and positive food
  stores. Eleven ants occupied its 3×3 neighborhood at the endpoint.
- In three isolated probes, a healthy worker at 45% hunger crossed the mouth
  120 times in 120 ticks when the failed-search trigger was shortened to one
  tick. Holding that trigger fixed and aligning the return threshold to the
  35% meal threshold reduced crossings to 1, 1, and 3. The shorter trigger
  isolates the loop. The full default-seed trace uses production defaults.
- A separate injured, hungry worker crossed 120 times in 120 ticks with an
  empty store in each of three probes. With food available, the same setups
  crossed 1, 1, and 3 times.
- Black underground digger clump rates were 0.76% and 0.84%. Seed f reached
  6.96% and 7.96%. Red had zero instant samples and one scent sample. Across
  both modes 735 of 1,093 digger cluster samples were marked `DIG_AT_FRONT`.
  In seed f the front at (75,130) stayed at advance counter zero over both
  201-tick traces. Other fronts excavated during those intervals. Up to seven
  diggers occupied a sampled 3×3 neighborhood.
- In a controlled U-shaped tunnel, zero of three diggers reached the front
  in 120 ticks on each of three seeds. Carving a direct connection let all
  three reach it on every seed.

## Interpretation

The fed entrance loop follows from the mismatch between the surface return
threshold (65% after failed searches) and meal eligibility (below 35% for a
healthy ant). The inside-nest exit decision can undo the return before the
ant reaches the meal threshold. Famine triggers a second loop through the
low-health return rule. The scent experiment failed to halve both colonies'
entrance clump rates and leaves both state-machine loops possible.

The hypothesis that most digger clumping is approach failure was refuted.
Digger steering chooses the closest exposed front by straight-line distance,
while the dig system staffs only a subset of fronts. The traces suggest that
a stationary front can keep attracting workers even when excavation is
progressing elsewhere. The controlled detour establishes a separate
approach failure. The traces alone do not establish why the stationary front
was never advanced.

A fix should first unify the food return and meal decision, and prevent
hungry injured workers from being sent back to an empty store. For digging,
distinguish working fronts from stagnant targets and test local detour
recovery independently. Compare soil excavated and dirt deliveries as well
as clumping so fewer diggers working cannot masquerade as improvement.

## Reproduction

Raw runs, traces, isolated probe outputs, and the original plan are in
`bench/results/entrance-digger-clumping/`. From the repository root, run
`node bench/results/entrance-digger-clumping/run.mjs "$PWD" simant-default scent /tmp/scent-default.json`.
Replace the seed and use `instant` to select the baseline.
