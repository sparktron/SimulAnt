# Ant Health System — Review & Resilience Report

**Reviewer:** Claude Code
**Date:** 2026-05-24
**Scope:** `src/sim/ant.js` (#applyVitals, #tryEatFromNest, #consumePelletFor*),
`src/sim/colony.js` (queen survival, brood, food store), `src/main.js` config
defaults.

## TL;DR

Three concrete bugs were fixed in this pass. They are sufficient — by
themselves — to explain "the nest dies even with abundant food":

| # | Bug | Severity | Fix shipped |
|---|---|---|---|
| 1 | `healthWorkIdleDrainRate` (0.10/sec) > `healthWorkMoveDrainRate` (0.08/sec). Idle ants — i.e. anything jammed at the entrance — lost health faster than ants doing work. | Compounding | v0.15.1 — lowered idle to 0.03/sec |
| 2 | Passive health regen required hunger > 65%, but workers eat at 35% and gain 25 → reach 60%. The regen branch could **never fire** during the normal feed cycle. | Critical (constant attrition) | v0.16.0 — lowered regen threshold to 50% |
| 3 | Soldiers were excluded from `#tryEatFromNest`. They have *higher* hunger drain than workers, no foraging loop, and made up 15% of births. Every soldier starved in ~25–40 sec. | Critical (births wasted) | v0.17.0 — soldiers now eat from store underground |

A regression test pins the eat/regen coherence so future config tuning can't
re-open the gap.

The report below documents the rest of the audit and forward-looking
suggestions for making the colony more resilient.

---

## How the health system is supposed to work

### Ant per-tick vitals pipeline (`Ant#applyVitals`)

```
age += 1
hunger -= (move_or_idle_rate + carrying + fighting) * dt
if hunger == 0: health -= healthDrainRate * dt          # starvation
health -= work_drain * dt                                # work damage
if hunger > regen_threshold and age < 0.8 * maxAge:
    health += healthRegenRate * dt                       # passive regen
if age > 0.8 * maxAge:
    health -= age_factor * 2 * dt                        # senescence
if health == 0: alive = false
```

### Ant eat-from-nest (`Ant#tryEatFromNest`)

```
require inside nest, role is worker or soldier
require ticksSinceLastEat >= cooldown (30) OR critical health (<25%)
require hunger < 35% OR critical health
intake = min(workerEatNutrition, hungerMax - hunger)
hunger += intake
health += intake * healthEatRecoveryRate (+ bonus if starving+critical)
```

### Queen survival (`Colony#updateQueenSurvival`)

```
hunger -= queenHungerDrain * dt
if hunger < 40%: eat queenEatNutrition from store, gain hunger + health
if hunger == 0: health -= queenHealthDrainRate * dt
if health == 0: queen.alive = false (terminal — no respawn)
```

### Brood lifecycle (`Colony#updateQueenAndBrood`)

* Queen lays one egg every `queenEggTicks` (default 20) if food > cost.
* Each larva passes through 4 stages of `broodGestationSeconds/4`.
* Gestation rate scales with food availability AND `larvaeCrowding`
  (up to 40% slowdown when count > 8 and nurses aren't tending).
* Larva dies after `broodStarvationTicks` (600) of severe underfeeding.

---

## Detailed bug analysis (fixed)

### Bug 1 — inverted idle/move health drain

**Files:** `src/main.js` config defaults.

```js
healthWorkIdleDrainRate: 0.1,    // ← idle was higher!
healthWorkMoveDrainRate: 0.08,
```

**Impact:** Any ant blocked in an entrance traffic jam, waiting on
`_nestDepartureDelay`, or stuck against a wall lost ~25% *more* health per
second than an ant actively walking. Entrance congestion is a normal
operating condition (every forager exits and re-enters the same shaft), so
this drain hit a large fraction of the colony for a meaningful fraction of
every cycle. Compounded with bug 2, it pushed average ant lifespan well
below `maxAge`.

**Fix shipped (v0.15.1):** `healthWorkIdleDrainRate: 0.03` — idle now
costs ~⅓ of moving.

### Bug 2 — eat/regen threshold gap (root cause)

**Files:** `src/sim/ant.js` `#applyVitals`.

The numbers from defaults:

| Event | Hunger after |
|---|---|
| Eat trigger (`hungry`) | < 35% |
| `workerEatNutrition` | 25 |
| **Post-meal hunger** | **~60%** |
| Passive regen needed | **> 65%** ← never reached |

The arithmetic is the bug. Workers could never passively regenerate health
during the normal eat cycle. They still gained a small amount of health
*per meal* via `healthEatRecoveryRate * intake = 0.45 × 25 = 11.25`
health/meal, which approximately balanced work drain in steady state — but
left zero margin for senescence drain (age > 0.8 × maxAge adds up to 2
health/sec) or for the inverted idle drain (Bug 1).

**Fix shipped (v0.16.0):** lowered passive regen threshold to 50%, which
sits below the post-meal hunger level. A freshly-fed worker now
heals passively between trips. Same change applied to the soldier vitals
branch for consistency.

### Bug 3 — soldiers starved by design

**Files:** `src/sim/ant.js` `#tryEatFromNest`.

The old code returned early for non-workers, with the comment "Master
design: only workers eat from nest stores." Soldiers have:

* `hungerDrainRates.idle = 2.2`, `move = 4.5` (vs worker's 1.8, 2.0).
* No foraging behavior — they patrol the entrance perimeter, never pick
  up pellets.
* 15% of all births, by default `casteAllocation`.

A soldier's hunger drained from 100 → 0 in roughly 22–45 seconds of sim
time. Then `healthDrainRate: 5/sec` killed it in 20 more seconds. Every
soldier born was a guaranteed death — paid for in colony food and queen egg
production, returned in zero work.

**Fix shipped (v0.17.0):** soldiers can now call `#tryEatFromNest` when
underground. Updated the test that pinned the old policy.

---

## Suggestions for further resilience improvements

These are not bugs; they are design tensions worth resolving for a colony
that survives long simulation runs at scale.

### S1 — Birth rate doesn't scale with colony size *(highest leverage)*

Egg laying is gated by a fixed timer:

```js
queenEggTicks: 20    // one egg per 20 ticks ≈ 1.5 eggs/sec
```

This is independent of `ants.length`. Death rate, in contrast, scales
**linearly** with colony size (each ant has the same per-tick chance of
dying). At ~135 ants, deaths/sec exceeds births/sec and the colony
plateaus or collapses.

**Suggested change:** make egg laying a *rate* proportional to live
queen-health, not a fixed timer. For example, lay 1 egg every
`max(8, queenEggTicks * (1 - colonyHealthMultiplier))` ticks. Real ant
queens lay thousands per day at colony maturity.

Practical implementation: add a colony-size scaling factor with a
configurable maximum lay rate. Cap the multiplier so the queen can't
exceed brood-chamber throughput. A first cut:

```js
const sizeScale = Math.min(4, 1 + colony.ants.length / 200);
const effectiveLayTicks = Math.max(5, Math.round(queenEggTicks / sizeScale));
```

### S2 — Trophallaxis between ants

Real ant colonies move food between individuals via mouth-to-mouth
trophallaxis. Currently every ant has to physically descend to a
food-store tile to eat. Nurses and soldiers loiter near the entrance
and may not reach storage.

**Suggested change:** when ant A is adjacent to ant B and A is hungry and
B is well-fed, A can take a small bite from B's hunger. Limit the
transfer rate so it's a survival pressure release, not the primary feeding
channel. This solves several edge cases:

* Soldiers far from storage stay alive.
* Brood couriers can drop a partial pellet and the queen courier loops
  fed without round-tripping through the store every time.
* Surface foragers stuck in traffic can survive an extra trip.

### S3 — Worker lifespan is short relative to colony scale

```js
this.maxAge = role === 'soldier' ? 1800 + rng.int(600) : 2400 + rng.int(800);
```

At sim-tick = 1/30 sec, workers live 80–107 sim-seconds; with the
0.4× BASE_SIM_SPEED_SCALE that's 200–267 real seconds (~3–4.5 min).
This forces *very* high birth rates to maintain any sizeable colony.

**Suggested change:** raise `maxAge` to ~8000-12000 ticks (workers) and
the senescence window may need to widen too. Real workers can live for
months; even doubling the simulated lifespan dramatically reduces the
required birth rate to sustain a large colony.

### S4 — Critical-health override only fires at 25% health

`#tryEatFromNest` lets a critical-health ant bypass cooldown and the
hunger gate. But "critical" = `health < 25%`, which an ant only reaches
after sustained damage. By then it's seconds from death.

**Suggested change:** raise the critical override to ~40% so an ant in
trouble can re-feed promptly. Pair with a shorter cooldown
(e.g. 10 ticks) when critical so they can eat multiple times in a row
to recover.

### S5 — Senescence drain is absolute, not health-state-aware

```js
if (this.age > this.maxAge * 0.8) {
    const ageFactor = (this.age - this.maxAge * 0.8) / (this.maxAge * 0.2);
    this.health = Math.max(0, this.health - ageFactor * 2 * dt);
}
```

This drains health regardless of whether the ant is well-fed. Combined
with disabled passive regen (`age <= maxAge * 0.8` clause), an aging ant
has *no* mechanism to recover any health, even if hunger is full and they
are sitting in the chamber.

**Suggested change:** allow weak passive regen during senescence
(e.g. half rate) so an old, well-fed ant fades over the full 20% window
rather than dying mid-window. This also smooths the death rate over time
instead of clustering deaths around the maxAge boundary.

### S6 — `larvaeCrowdingThreshold` has no main-config entry

`Colony#updateQueenAndBrood` reads `config.larvaeCrowdingThreshold ?? 8`,
but this key is not declared in `state.config` in `main.js` and is not
sanitized in `SimulationTypes.js`. It silently falls back to 8 forever.

**Suggested change:** add to `state.config` and `sanitizeTickConfig` so
it's tunable from the parameter editor and survives save/load.

### S7 — Queen has a single point of failure with no inheritance

The queen's `alive` flag is terminal. Once she dies the colony cannot
produce new ants. There is no successor queen and no way to recover.

**Suggested change:** when the queen dies, promote a `breeder`-role ant
(or convert a healthy worker) into a successor queen after a delay.
Combine with a small "royal jelly" cost so colonies need to invest in
succession.

### S8 — Carry-trip hunger accounting double-counts in some states

`carryingHungerDrainRate = 0.5` adds extra hunger drain whenever
`this.carrying?.type` is truthy. This includes states like
`STORE_FOOD_IN_NEST` where the ant is *already inside* the nest moving a
few tiles to drop food. The extra drain is small in practice but
inconsistent: hauling dirt and queen-food also incur it.

**Suggested change:** limit the carry-drain to surface transit or to
states explicitly marked as "in transit," and remove it once the ant has
reached the nest interior.

### S9 — No telemetry for cause-of-death

`colony.deaths` increments on each death but doesn't categorize them
(starvation, age, hazard, drowning, combat). Without this it's hard to
distinguish "balance issue" from "edge case in a specific state."

**Suggested change:** add `colony.deathsByCause = { starvation: 0,
oldAge: 0, hazard: 0, ... }` and a small HUD readout. A 30-second sample
that shows "80% starvation" vs "80% old age" tells you which lever to
tune.

### S10 — Bootstrap food masks early-game balance

`Colony` constructor sets `_virtualFoodStored = bootstrapFood` (up to
2400 nutrition for a 300-ant start). This bootstrap drains over time but
makes the first few minutes of any seed look stable even when steady-state
balance is broken. Once the virtual stores are gone, the real economy is
exposed — often after the user has stopped paying attention.

**Suggested change:** add a HUD readout showing
`virtualFoodRemaining / virtualFoodAtStart` so it's visible when the
training wheels come off. Optionally taper the virtual store more
aggressively so the steady-state economy starts being tested sooner.

---

## What I'd test next

A scenario test that runs the simulation for ~2000 ticks with default
config, asserts `colony.ants.length > 0`, and prints
`colony.deathsByCause` would catch the next class of collapse failure
without anyone having to eyeball the browser preview. The current
`test/simulation-core.test.mjs` checks `runs 100 ticks without crashing`
but doesn't measure survival.

---

## Versioning

* `v0.15.1` — fix idle-vs-move drain inversion
* `v0.16.0` — fix regen-threshold gap (behavior change → MINOR)
* `v0.17.0` — soldiers can eat from nest store (behavior change → MINOR)
