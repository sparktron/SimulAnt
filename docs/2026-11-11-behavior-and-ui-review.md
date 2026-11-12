# Ant behavior and UI review — 2026-11-11 (v0.65.1)

Scope: the ant state machine and colony logic in `src/sim/`, and the page layout
in `index.html` / `styles.css` / `themes/`. No simulation or UI code was changed.
This file is the fix plan, in the order the work should be done.

## How this was checked

- Read `ant.js`, `ant/decisions.js`, `ant/steering.js`, `ant/vitals.js`,
  `ant/roles.js`, `ant/navigation.js`, `colony.js`, `CombatSystem.js`,
  `AntLionSystem.js`, `FoodEconomySystem.js`, the pheromone update in `world.js`,
  and the top of `DigSystem.js`. `DigSystem` internals, the renderers and the
  skins were not read in full.
- Ran four read-only probes (saved in `bench/behavior-audit/`) against the real
  `SimulationCore` with `getDefaultConfig()`. Run one with
  `node bench/behavior-audit/probe3.mjs "$PWD" probe-a 12000`.
- Looked at the running page at 1024×768 in Classic and Modern, both views, the
  PARAMS tab and the Colony Status dialog.

Limits: the detailed numbers come from **one seed** (`probe-a`, 9,000–16,000
ticks); only the work-allocation comparison used three seeds. Treat the numbers
as evidence that a mechanism exists, not as tuned measurements. The Browser pane
was hidden, so frame rate and animation were not assessed. Retro, 90s and
Realistic themes were not opened.

## Summary

The foraging loop is in good shape and well documented. The problems are
elsewhere:

1. **Two vitals bugs distort the whole economy.** Aged ants retreat into the nest
   and eat at least 1 nutrition per tick each, and hungry foragers walk home to
   eat but are refused the meal. The first one empties the food store and causes
   the population crash.
2. **Reproduction, queen care and brood care are not connected to ant behavior.**
   The queen lays on a fixed clock, she and the brood feed themselves from the
   store, and nurses mostly wander. A quarter of the black colony's workers in
   the browser are assigned to a job that does nothing.
3. **The browser runs a different game from the benches.** The UI gives only the
   black colony a 55/20/25 work split; red and every headless bench use 90/5/5.
4. **The UI hides things.** The nest view opens on empty soil, the left palette
   overflows, the stats panel covers only the black colony, and nine features
   exist only as keyboard shortcuts.

## Fix order

| # | Item | Kind | Size |
|---|---|---|---|
| 1 | Aged ants drain the food store | Bug | S |
| 2 | "Go home to eat" trips that end without a meal | Bug | S |
| 3 | Ant-lion deaths miscounted, and ants never learn to avoid pits | Bug | S |
| 4 | Work allocation applies to black only; benches differ from the browser | Bug | S |
| 5 | Pursuit flicker (`SEEK_FIGHT` re-rolled every tick) | Bug | S |
| 6 | JOBS legend shows the wrong soldier color, no duel entry | UI bug | XS |
| 7 | Nest view opens on empty soil | UI bug | S |
| 8 | Small logic leaks (free food on deposit, dead branch, mouth bounce) | Bug | XS |
| 9 | UI quick wins (pan/zoom hint, clipped labels, naming, version label) | UI | S |
| 10 | Brood costs almost nothing; laying is a metronome | Realism | M |
| 11 | Queen and brood feed themselves; nurses are idle | Realism | M |
| 12 | Food is dropped in tunnels; no storage chamber | Realism | M |
| 13 | Underground movement is straight-line greedy | Realism | M |
| 14 | Job assignment is a central rebalance, not age-based | Realism | M |
| 15 | Stats panel and left palette restructure | UI | M |
| 16 | PARAMS tab usability | UI | M |
| 17 | Remote digging, queen parked at a dig front | Realism | M |
| 18 | Shared pheromone fields, alarm recruitment, corpses | Realism | L |

Items 1–9 are independent of each other and safe to land one at a time. Do 1 and
2 before any balance work: every population number measured today includes their
distortion. Items 10–14 change colony balance, so each needs a 12-seed A/B in the
style of `docs/pheromone-strategy.md`.

---

## Phase 1 — bugs

### 1. Aged ants drain the food store

**What happens.** Once an ant passes 80% of `maxAge`, age damage pushes its
health under 50%. `shouldHealInNest` (`src/sim/ant/decisions.js:317`) then keeps
it in the nest. Under 40% health it counts as critical, and
`tryEatFromNest` (`src/sim/ant/vitals.js:140`) lets critical ants skip the meal
cooldown and take `Math.max(1, Math.min(requested, hungerCapacity))` — at least
1 nutrition **every tick**, even when hunger is nearly full. Each bite also
restores `consumed × 0.45` health, so the ant buys its way past its lifespan
with colony food.

**Evidence** (red colony, seed `probe-a`):

| Ticks | Ants | Aged (>80%) | Eaten by aged | Eaten by others | Deposited | Store at end |
|---|---|---|---|---|---|---|
| 5,000–6,000 | 204 | 42 | 6,923 | 6,360 | 14,060 | 9,473 |
| 7,000–8,000 | 227 | 84 | 15,600 | 5,340 | 14,280 | 2,392 |
| 8,000–9,000 | 249 | 107 | 22,614 | 4,985 | 25,255 | 40 |

In the last window the aged 43% of the colony ate 82% of the food. The store
went from 9,965 to 0 and the colony fell from 249 to 64 ants by tick 16,000.
The 90th-percentile age at death was 1.47 × `maxAge`, and 69 living ants were
past `maxAge` at tick 9,000.

**Fix.**
- Remove the `Math.max(1, …)` floor: intake is `min(requested, hungerCapacity)`,
  and no meal when capacity is below a small epsilon.
- Eating must not repair age damage. Skip `healthEatRecoveryRate` and passive
  regen when `age > maxAge × 0.8`.
- Aged ants should not enter `HEAL_IN_NEST`. Real colonies put their oldest
  workers on the riskiest outside work, so let them keep foraging until they die.

**Test.** A senescent ant standing in a stocked nest for 300 ticks consumes no
more than its hunger drain. Re-run `probe3.mjs`: "eaten by aged" should scale
with head count, and no ant should outlive ~1.1 × `maxAge`.

**Expect.** Old-age deaths will rise and peak population will change. Re-baseline
the survival tests and `bench/environmental-foraging-sweep.mjs` afterwards.

### 2. "Go home to eat" trips that end without a meal

**What happens.** A forager turns for home when hunger is under
`surfaceReturnToNestHungerThreshold` (0.6) — `src/sim/ant.js` in the
`shouldReturnToNestForFood` block, and `foragerExitNest`
(`decisions.js:342`). But `tryEatFromNest` only feeds ants under a hard-coded
0.35 (`vitals.js:158`). An ant between 35% and 60% walks down, is refused, turns
to `EXIT_NEST`, reaches the mouth row, and is sent down again.

**Evidence.** Black colony, 12,000 ticks: 1,619 eat trips, **20%** ended with a
meal (red: 41%). Black foragers spent 10.8% of their time in
`RETURN_NEST_TO_EAT` and 6.3% in `EXIT_NEST`. The stuck-ant log is dominated by
foragers at one or two tiles below the mouth with hunger 40–60 and full health;
one ant changed direction 3,028 times.

**Fix.** Use one config value for both decisions (add `nestEatHungerFraction`,
default 0.35, and derive the return rule from it), or let an ant that arrived in
`RETURN_NEST_TO_EAT` eat regardless of the 0.35 gate. The first is simpler and
removes a magic number.

**Test.** An ant at 50% hunger with a stocked store either stays out, or goes in
and its hunger rises. Assert it never alternates `RETURN_NEST_TO_EAT` ↔
`EXIT_NEST` more than once.

### 3. Ant-lion deaths miscounted, and ants never learn to avoid pits

**What happens.** `AntLionSystem.js:71` records `'predation'`, which is not a
key of `deathsByCause`, so it lands in "other". Ants also get no signal from a
kill: nothing is deposited, so the next ant walks into the same pit.

**Evidence.** Black colony, 16,000 ticks: 316 predation, 238 combat, 17 old age.
Predation was the largest cause of death and the HUD showed it as `O:316`.
Median age at death was 0.17 × `maxAge`.

**Fix.** Add `predation` to `deathsByCause` (and to save/load defaults and the
HUD). On a kill, deposit danger pheromone on the tiles around the pit
(`world.depositDanger`); steering already avoids that channel, and it is a local
signal, so it fits the "no central director" rule.

**Test.** `recordDeath('predation')` increments its own bucket. After N kills at
one pit, the rate of ants entering its radius drops.

### 4. Work allocation applies to black only; benches differ from the browser

**What happens.** `src/main.js:326` sets 55/20/25 (forage/dig/nurse) and calls
`simCore.colony.setWorkAllocation` at lines 381, 485 and 1061. The rival colony
is never set, so it keeps the constructor default of 90/5/5
(`src/sim/colony.js:67`). Headless benches and tests never call it either.
`docs/STATUS.md` says red has the same work allocation as black; in the browser
it does not.

**Evidence** (ants / food at tick 9,000, black then red):

| Seed | Black 90/5/5 (headless) | Black 55/20/25 (browser) |
|---|---|---|
| probe-a | 83 / 2,031 · 249 / 40 | 133 / 0 · 190 / 0 |
| probe-b | 79 / 1,427 · 178 / 4,788 | 205 / 0 · 155 / 0 |
| probe-c | 228 / 4,109 · 94 / 4,451 | 200 / 1,711 · 129 / 3,317 |

The split changes which colony wins and whether stores hit zero, so bench
results do not describe what the user sees.

**Fix.** Put the default in one place (`getDefaultConfig()` or a shared
constant) and have `Colony` read it. Decide whether the triangle controls both
colonies or only black; if only black, give red an explicit default and label
the dialog "Black colony".

### 5. Pursuit flicker

**What happens.** `seekFight` (`decisions.js:77`) rolls
`combatEngageChance × aggression` every tick for a forager with an enemy in
range. A black forager passes 25% of the time, so it steps toward the enemy one
tick and resumes foraging the next.

**Evidence.** Black: 901 pursuits, 693 lasted two ticks or less.

**Fix.** Roll once per sighting. Store the target id and a commit timer on the
ant (and in the save), keep `SEEK_FIGHT` until the target is lost, dead or the
timer ends, and do not re-roll for the same target for a cooldown.

### 6. JOBS legend

`index.html:95` shows "Patrol" as `#9a5aff` (purple). `Ant.getJobColor`
(`src/sim/ant.js:64`) draws soldiers as `#8b1a1a`, and purple is reserved for
duels. Change the swatch to `#8b1a1a` labelled "Soldier", add a "Duel" entry in
`#b44cff`, and add "Leaving nest" (`#d3d3d3`). Better: build the legend from
`getJobColor` so it cannot drift again.

### 7. Nest view opens on empty soil

Pressing Q on a fresh world shows a screen of plain dirt in Classic and a black
screen in Modern. The nest camera starts between the two nests; black's nest is
off the left edge. On the first switch, center the nest camera on the black
queen. Add a "home" key and a minimap click to jump there.

### 8. Small logic leaks

- `depositFoodFromAnt` (`colony.js:1237`) adds `nutrition × 0.15` to the
  carrier's hunger and still stores the full pellet. Take the snack out of the
  stored amount.
- `ant.js`: `if (!needsForage && workFocus !== 'forage') return STAY_ACTION` is
  unreachable; nurses and diggers were handled above it. Delete it.
- `ant.js`: the `isCriticalHealth` branch after it sends a starving nurse or
  digger up to the mouth, where the low-health rule sends it back down. This is
  the same family as the "famine bounce" already listed in
  `docs/open-items-todo.md`; fix them together.
- `AntLionSystem.update` always checks the black colony first, so black is
  eaten first when both are in range. Pick the nearest ant across colonies.

### 9. UI quick wins

- Classic hides `.canvas-footer`, so the "pan: right drag · zoom: scroll" hint
  is never shown in the default theme. Show it.
- "DANGER" is clipped to "DANGE" in the 140px tool grid. Tools that only work in
  one view are greyed out with no explanation; add a tooltip.
- The page title is "SimAnt Web App" and the Classic header says "SimAnt - Rival
  Colonies"; other themes and the repo say SimulAnt. Use one name.
- The version label sits on top of the right panel's bottom-right corner.
- The BREEDERS row is always 0 because the caste is disabled. Hide it.
- In Modern, the PAUSE button label was unreadable in my capture (only the
  "Space" key chip showed). The pane was hidden and the theme had just switched,
  so confirm this with the pane visible before fixing.

---

## Phase 2 — make the colony's inner life real

These are the gaps between this sim and a real colony. Each one changes balance.

### 10. Brood costs almost nothing; laying is a metronome

Both colonies laid exactly 397 eggs in 9,000 ticks despite one being three times
the size of the other. `#updateQueenReproduction` (`colony.js:523`) advances
`eggProgress` by queen health, which stays near 85–98, so she lays every ~22
ticks forever. An egg costs 0.02 nutrition and a larva about 0.04 over its life.
Queen plus brood consumed 2–12 nutrition per 1,000 ticks; workers consumed
thousands. Population is therefore `birth rate × lifespan`, with no link to food
income.

Suggested change: make a new worker cost roughly what an adult eats in a third
of its life (start around 20–30 nutrition spread over the four larval stages),
and let the laying rate follow how much the queen was actually fed (item 11).
The earlier store-ratio taper was tested and dropped
(`docs/starvation-collapse-rca-2026-06-02.md`); this is a cost, not a taper, so
it is a new experiment.

### 11. Queen and brood feed themselves; nurses are idle

The queen was fed by an ant **0 times** in 9,000 ticks in both colonies.
`#updateQueenSurvival` (`colony.js:717`) lets her eat from the store at 40%
hunger, so the courier request (20% hunger or 50% health) never fires. Larvae
have no position and `#updateBrood` draws their food from the store directly.
Nurses spent 78% of their time in the idle wander and 21% walking to a fixed
offset (`homeX + 4, homeY + 5`, `roles.js:153`) that may not be a dug tile.

Suggested change, in steps: give larvae tile positions in a brood chamber; make
larval feeding happen when a nurse carrying food reaches the pile; remove the
queen's self-feeding so attendants are her only supply. Then nurse count matters
and food shortage reaches the brood through behavior.

### 12. Food is dropped in tunnels

`findNestFoodDropPoint` (`colony.js:1159`) accepts the carrier's own tile if it
is any dug tile 4 or more tiles from the mouth. 28% of black's deposits and 45%
of red's were on tunnel tiles, the nearest 10% within 6 tiles of the mouth. The
random fallback is re-rolled every tick, which is the jitter already described
under "Nest food-storage saturation" in `docs/open-items-todo.md`. Fix both
together: chamber tiles only, a per-tile stack limit, and a drop target chosen
once per trip and kept on the ant.

### 13. Underground movement is straight-line greedy

`moveToward` picks the neighbor closest to the target by straight-line distance.
Only nest exits use a real path (`NestExitField`). Diggers heading to a front,
nurses heading to brood and couriers heading to the queen press against soil
when the tunnel bends. Red diggers logged 180 stuck windows in `DIG_AT_FRONT`
and 72 in `DIG_MOVE_TO_FRONT` in 9,000 ticks. Reuse the exit-field approach for
the other destinations (queen, brood pile, store, each dig front). The lagged
scent variant (`exitScentField`) is the version that satisfies the local-AI rule.

### 14. Job assignment is central

`rebalanceWorkerFocuses` (`colony.js:362`) counts every worker each tick and
reassigns from a colony-wide census. That is the global coordination AGENTS.md
rules out, and it means a forager far from home can become a nurse instantly.
Real workers change jobs with age: brood care first, then nest work, then
foraging. Derive `workFocus` from age with per-ant thresholds, and let the
triangle shift those thresholds. Flip counts are low today (0.07 per 1,000
ant-ticks), so this is about realism and the local-AI rule, not a visible bug.

### 17. Remote digging and the queen's position

- `DigSystem.update` credits a front's progress to the nearest dig worker within
  `digRecruitRadius` (16 tiles) and hands that ant the dirt. Require the ant to
  be next to the front.
- `#findQueenSafeTile` (`colony.js:1004`) picks the deepest passable tile, which
  is usually the newest dig front, so the queen follows the diggers. Keep her in
  a chamber.

### 18. Larger design items

- **Shared pheromone fields.** `world.toFood` and `world.toHome` are single
  arrays used by both colonies, so each colony follows the other's home scent
  and food trails. I did not measure the effect; no ant ended up inside the
  rival nest in the probe. Per-colony fields would double the pheromone update,
  which is already the largest tick cost, so profile first.
- **Alarm recruitment.** Fights recruit nobody. A short-lived alarm deposit at a
  duel would let nearby soldiers converge.
- **Corpses.** Dead ants vanish. After item 1, ants will die inside the nest;
  a corpse item carried to a midden pile would be a visible, real behavior.
- **Food vision.** Ants see pellets at 18 tiles through walls. Lowering it is on
  the "do not retry" list in `docs/pheromone-strategy.md`, so leave the radius
  alone; a line-of-sight check for walls is the only safe change here.

---

## Phase 3 — UI layout

### 15. Stats panel and left palette

Measured at 1024×768:

| Area | Finding |
|---|---|
| Left palette (Classic) | 140px wide, content 882px in a 730px column. SCENT, JOBS, PHERO, HELP and LOG are below the fold. |
| Left palette (Modern) | Content 1,072px in a 684px column. |
| Stats panel | 22 flat lines. Workers, soldiers, jobs, queen HP, health and deaths are black-only; red gets one count. |
| Deaths | `S:0 A:0 H:0 C:0 O:0` with no key. |
| Breakpoints | None apart from `pointer: coarse`. Side columns are fixed at every width. |

Suggested layout:

- **Left: actions only.** Run controls, tools, brush. Move Seed, Speed and Ant
  cap into a "Simulation" group in the right panel or a popover; they are set
  once.
- **Canvas toolbar.** Put the overlay toggles (Scent, Jobs, Food trail, Home
  trail, Danger) in a small row on the canvas, with their state visible.
- **Right: two colony cards side by side** (Black | Red) with ants
  (surface / nest), food, queen HP and deaths by named cause. Under them, a
  "Black colony detail" block for castes and jobs. Move TICK, FPS, DIG, PHER
  MAX/AVG and FOLLOW into a collapsed "Debug" section.
- **Selected ant.** Clicking an ant only fills the SEL health bar. Add a small
  inspector: role, job, state, hunger, health, age, cargo.
- **Shortcut-only features.** F (food cluster), G (auto-dig), C (chamber), T, L,
  D (overlays), O, K (cheats) and F3 (debug) have no button. Auto-dig has a HUD
  line and no control. Add buttons or a "More" menu.
- **Narrow screens.** Below ~900px, collapse the right panel into a drawer.

### 16. PARAMS tab

The panel is 172px wide in Classic. The preset selector is clipped
("-- Selec"), Load/Save/Delete wrap onto two rows, and each parameter takes
about 60px of height, so the basic set alone is a 1,324px scroll. Widen the
panel when PARAMS is active (or make it resizable), put label, slider and value
on one row, and add a filter box above the groups.

---

## Notes for whoever implements this

- Items 1, 2, 5, 8 and everything in Phase 2 change simulation outcomes. Run
  `node --test test/*.mjs`, expect the replay-hash and survival baselines to
  need re-capturing, and bump the version per AGENTS.md.
- Item 5 adds ant state that must be serialized.
- For Phase 2, follow the `experiment-run` discipline already used for
  pheromones: same seeds on and off, 12 seeds, and record failures in the
  relevant doc.
- `docs/KNOWN_ISSUES.md` still says the colony "starves to zero before reaching
  truly large ant counts". Item 1 is a concrete cause of late-run starvation;
  update that entry once it is fixed and re-measured.

## Implementation experiment

The paired comparison uses production defaults, 5,000 ticks per seed, and the
same seeds `review-01` through `review-12` in each revision. The baseline is
Phase 1 commit `038de01` on `master`, Node 24.16.0, with at most four independent
simulation processes. The test revision is v0.67.0, including the linked brood, nurse, storage,
navigation and worker-age changes alongside the remaining review items.

**Hypothesis.** Ant-delivered nutrition and age-based work support surviving
queens in at least 22 of 24 colonies at tick 5,000 while leaving a positive
median food reserve. Either a lower survival count or a median reserve of zero
refutes the hypothesis. This comparison measures the integrated effect.

**Observed.** Both revisions finished with 24 living queens. Median colony
population went from 168.5 to 164 ants, median reserves from 4,824.5 to 3,153
nutrition, and the lowest reserve in the candidate was 1,252. Median births
went from 259 to 233.5 and median excavated tiles from 788.5 to 1,344.5. Raw
results are in [v0.66.0](../bench/behavior-audit/review-5000-v0.66.0.jsonl)
and [v0.67.0](../bench/behavior-audit/review-5000-v0.67.0.jsonl).
The elapsed times include process contention.

The [12,000-tick vitals probe](../bench/behavior-audit/probe-a-v0.67.0.txt)
recorded at most one direction flip per completed nest-meal episode in either
colony. At ticks 8,000–9,000, aged red ants ate 75 of 5,845 adult nutrition.
The red store finished at 9,615 with 133 ants. The probe now attributes
attendants' brood and queen rations to their worker age buckets.

**Interpretation.** The paired run supports the integrated survival hypothesis.
The smaller reserves and birth counts are consistent with higher brood costs
and nutrition-dependent laying. The trial estimates the combined effect of
the implementation. Individual balance effects remain unmeasured.

A separate baseline scenario ran to tick 16,000 with 107 ants and a living
queen. It fell short of the sweep's 150-ant target. The fixed-seed tick profile
measured 2.44 ms/tick on v0.66.0 and 2.95 ms/tick on v0.67.0, with 122 and 121
black ants at the end of the timed interval, respectively. The versions
produced different terrain, food counts and trail fields. This comparison
captures the release's overall cost on that seed. [Raw validation output](../bench/behavior-audit/validation-v0.67.0.txt)
