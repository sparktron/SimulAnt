# Ant Health System — Review & Resilience Report

**Reviewer:** Claude Code
**Date:** 2026-05-24 *(updated through v0.24.0)*
**Scope:** `src/sim/ant.js` (#applyVitals, #tryEatFromNest, #consumePelletFor*),
`src/sim/colony.js` (queen survival, brood, food store, trophallaxis),
`src/main.js` config defaults.

## TL;DR

Three concrete bugs were fixed in the first pass. They are sufficient — by
themselves — to explain "the nest dies even with abundant food." A second
pass implemented eight of the ten forward-looking suggestions to make the
colony more resilient at scale.

### Bug fixes shipped

| # | Bug | Severity | Fix shipped |
|---|---|---|---|
| 1 | `healthWorkIdleDrainRate` (0.10/sec) > `healthWorkMoveDrainRate` (0.08/sec). Idle ants — i.e. anything jammed at the entrance — lost health faster than ants moving. | Compounding | v0.15.1 — lowered idle to 0.03/sec |
| 2 | Passive health regen required hunger > 65%, but workers eat at 35% and gain 25 → reach 60%. The regen branch could **never fire** during the normal feed cycle. | Critical | v0.16.0 — lowered threshold to 50% |
| 3 | Soldiers were excluded from `#tryEatFromNest`. Higher hunger drain than workers, no foraging loop, made up 15% of births. Every soldier starved in ~25–40 sec. | Critical | v0.17.0 — soldiers now eat from store underground |

### Resilience suggestions

| # | Subject | Status |
|---|---|---|
| S1 | Birth rate doesn't scale with queen health | ✅ Shipped — v0.18.0 |
| S2 | Trophallaxis between adjacent ants | ✅ Shipped — v0.19.0 |
| S3 | Worker lifespan is short relative to colony scale | ⏸ Deferred (intentionally skipped by user) |
| S4 | Critical-health override only fires at 25% | ✅ Shipped — v0.20.0 (raised to 40%) |
| S5 | Senescence drain is absolute, blocks regen | ✅ Shipped — v0.21.0 (half-rate regen during senescence) |
| S6 | `larvaeCrowdingThreshold` not a real config key | ✅ Shipped — v0.21.1 |
| S7 | Queen has no successor | ⏸ Deferred (intentionally skipped by user) |
| S8 | Carry-trip hunger drain fires inside nest | ✅ Shipped — v0.22.0 |
| S9 | No cause-of-death telemetry | ✅ Shipped — v0.23.0 |
| S10 | Bootstrap food masks early-game balance | ✅ Shipped — v0.24.0 |

---

## How the health system is supposed to work

### Ant per-tick vitals pipeline (`Ant#applyVitals`)

```
age += 1
hunger -= (move_or_idle_rate + carrying_if_in_transit + fighting) * dt
if hunger == 0: health -= healthDrainRate * dt          # starvation
health -= work_drain * dt                                # work damage
if hunger > regen_threshold:
    health += healthRegenRate * (senescence ? 0.5 : 1) * dt   # passive regen
if age > 0.8 * maxAge:
    health -= age_factor * 2 * dt                        # senescence
if health == 0: alive = false; colony.recordDeath(cause)
```

### Ant eat-from-nest (`Ant#tryEatFromNest`)

```
require inside nest, role is worker or soldier
require ticksSinceLastEat >= cooldown (30) OR critical health (<40%)
require hunger < 35% OR critical health
intake = min(workerEatNutrition, hungerMax - hunger)
hunger += intake
health += intake * healthEatRecoveryRate (+ bonus if starving+critical)
```

### Trophallaxis pass (`Colony#runTrophallaxis`, post-update)

```
for each hungry recipient (hunger < 40% of max):
    find adjacent fed donor (hunger > 60% of max)
    transfer min(trophallaxisRate * dt, donor_spare, recipient_capacity)
```

### Queen survival (`Colony#updateQueenSurvival`)

```
hunger -= queenHungerDrain * dt
if hunger < 40%: eat queenEatNutrition from store; hunger & health up
if hunger == 0: health -= queenHealthDrainRate * dt
if health == 0: queen.alive = false (terminal — no successor)
```

### Brood lifecycle (`Colony#updateQueenAndBrood`)

```
healthFraction = queen.health / queen.healthMax
canLay = healthFraction >= queenLayingMinHealth and foodStored >= cost
if canLay:
    eggProgress += healthFraction              # health-scaled cadence
    if eggProgress >= queenEggTicks:
        lay 1 egg (consume food, queen.health -= queenEggHealthCost)
each larva: progress *= broodFeedRatio * (1 - larvaeCrowding * 0.4)
            die after broodStarvationTicks of severe underfeeding
            hatch at stage > 4
```

---

## Detailed bug analysis (fixed in v0.15.1 – v0.17.0)

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
every cycle. Compounded with Bug 2, it pushed average ant lifespan well
below `maxAge`.

**Fix shipped (v0.15.1):** `healthWorkIdleDrainRate: 0.03` — idle now
costs ~⅓ of moving.

### Bug 2 — eat/regen threshold gap (root cause)

**Files:** `src/sim/ant.js` `#applyVitals`.

| Event | Hunger after |
|---|---|
| Eat trigger (`hungry`) | < 35% |
| `workerEatNutrition` | 25 |
| **Post-meal hunger** | **~60%** |
| Passive regen needed (old) | **> 65%** ← never reached |

Workers could never passively regenerate health during the normal eat cycle.
They still gained a small amount of health per meal via
`healthEatRecoveryRate * intake = 0.45 × 25 = 11.25` health/meal, which
approximately balanced work drain in steady state — but left zero margin for
senescence drain (up to 2 health/sec at end of lifespan) or the inverted
idle drain (Bug 1).

**Fix shipped (v0.16.0):** lowered passive regen threshold to 50%. A
freshly-fed worker now heals passively between trips. Same change applied
to the soldier vitals branch.

### Bug 3 — soldiers starved by design

**Files:** `src/sim/ant.js` `#tryEatFromNest`.

The old code returned early for non-workers, with the comment
"Master design: only workers eat from nest stores." Soldiers have:

* `hungerDrainRates.idle = 2.2`, `move = 4.5` (vs worker's 1.8, 2.0).
* No foraging behavior — they patrol the entrance perimeter, never pick up pellets.
* 15% of all births, by default `casteAllocation`.

A soldier's hunger drained from 100 → 0 in roughly 22–45 sec of sim time.
Then `healthDrainRate: 5/sec` killed it in 20 more seconds. Every soldier
born was a guaranteed death — paid for in colony food and queen egg
production, returned in zero work.

**Fix shipped (v0.17.0):** soldiers can now call `#tryEatFromNest` when
underground. Updated the test that pinned the old policy.

---

## Resilience suggestions — status & details

### S1 — Birth rate doesn't scale with queen condition ✅ *Shipped — v0.18.0*

**Original concern:** egg laying ran at a fixed `1.5/sec` regardless of
queen health, food supply, or stress. Death rate scales linearly with
colony size, so above ~135 ants the colony plateaued.

**Shipped behavior:**

```js
healthFraction = queen.health / queen.healthMax
if healthFraction >= queenLayingMinHealth (0.2) AND foodStored >= cost:
    eggProgress += healthFraction         // health-scaled cadence
    on lay: queen.health -= queenEggHealthCost (0.05)
```

Three new config keys, all sanitized and editable in the parameter editor:
`queenEggHealthCost`, `queenLayingMinHealth`. The queen self-throttles
(health → fewer eggs → less drain → recovery), and birth rate now
visibly tracks queen condition. Tests in `test/colony.test.mjs` cover
all three properties (rate scales, hard stop, health cost).

### S2 — Trophallaxis between adjacent ants ✅ *Shipped — v0.19.0*

**Original concern:** every ant must descend to a food-store tile to eat.
Soldiers, nurses, and stuck foragers couldn't survive small access gaps.

**Shipped behavior:** new `Colony#runTrophallaxis` pass runs after ant
updates. For each ant whose hunger sits below
`trophallaxisRecipientMaxHungerFraction` (40%), search the 8 neighboring
tiles for a donor above `trophallaxisDonorMinHungerFraction` (60%) and
transfer up to `trophallaxisRate * dt` (2 hunger/sec by default) per
recipient per tick. Recipients drive the search so the iteration order is
the only ordering decision and the result is deterministic.

Rates are intentionally small — this is a survival-pressure release, not
the primary feeding channel. Three new sanitized config keys.

### S3 — Worker lifespan is short relative to colony scale ⏸ *Deferred*

**User decision:** explicitly skipped this round.

The numbers still stand: workers live 2400–3200 ticks (~3–4.5 real minutes
at the current sim speed scale). Doubling `maxAge` would substantially
reduce the birth rate required to sustain a large colony. Senescence
window would likely need to widen alongside any maxAge bump so that the
"natural fade" window stays a usable fraction of total life.

### S4 — Critical-health override only fires at 25% ✅ *Shipped — v0.20.0*

**Shipped behavior:** `#isCriticalHealth()` returns `health < 40%` (was
25%). Critical ants:

* Immediately switch to `RETURN_TO_NEST_HEAL` if outside the nest.
* Bypass the nest-eat cooldown (so they can eat every tick until stable).
* Eat `workerEmergencyEatNutrition` (35) instead of the regular 25.

The report also suggested shortening the cooldown when critical, but the
existing code already bypasses it entirely — that's stricter than what was
suggested, so no further change was needed.

### S5 — Weak regen during senescence ✅ *Shipped — v0.21.0*

**Original concern:** the regen guard `age <= maxAge * 0.8` shut healing
off entirely once an ant entered senescence, causing abrupt mid-window
deaths.

**Shipped behavior:** removed the absolute guard. Senescent ants still
heal, but at half rate (controlled by a `senescenceFactor` of `0.5`
in `#applyVitals`). Age drain still wins overall, so they fade out across
the whole senescence window instead of collapsing mid-window. Same
treatment applied to the soldier vitals branch.

### S6 — `larvaeCrowdingThreshold` exposed as a real config key ✅ *Shipped — v0.21.1*

The value was being read as `config.larvaeCrowdingThreshold ?? 8`, but the
key was not declared in `main.js`, not sanitized, and not in the editor
defaults. Silently fell back to 8 forever; was not persisted through
save/load. Added in all three locations so it's tunable and durable.

### S7 — Queen succession ⏸ *Deferred*

**User decision:** explicitly skipped this round.

The queen remains a terminal single point of failure. Recovery from queen
death is impossible: she stops laying, the brood pipeline empties, the
last ants die of old age. A future pass should promote a healthy worker
or `breeder` to successor queen after a delay (with a royal-jelly cost so
colonies have to invest in succession rather than getting it for free).

### S8 — Carry-trip hunger/health drain only on surface transit ✅ *Shipped — v0.22.0*

The carry-trip surcharge (`carryingHungerDrainRate`,
`healthWorkCarryDrainRate`) used to fire whenever `ant.carrying` was
truthy — including `STORE_FOOD_IN_NEST`, `PICKUP_QUEEN_FOOD`,
`DELIVER_QUEEN_FOOD`, situations where the ant is moving a couple tiles
inside the nest.

**Shipped behavior:** surcharge only applies when state is `HAUL_DIRT`
(still meant to be costly) or when the ant is *not* in the nest interior
post-movement. `#applyVitals` now takes an `inNest` parameter computed
from the ant's post-movement position so queen-couriers and in-chamber
food-droppers don't pay long-haul tax for short moves.

### S9 — Cause-of-death telemetry ✅ *Shipped — v0.23.0*

**Shipped behavior:** new `colony.deathsByCause` tracks
`{ starvation, oldAge, hazard, other }`. All death sites
(`#resolveHazard`, both worker/soldier `#applyVitals` branches) route
through `Colony#recordDeath(cause)`. Worker/soldier death cause is
inferred via `#deathCause()`:

* `hunger <= 0` → `starvation`
* `age > 0.8 * maxAge` → `oldAge`
* Otherwise → `other`

HUD now shows `DEATHS: N` and `BY CAUSE: S:N A:N H:N O:N`. A 30-second
sample tells you whether the colony is failing from food balance,
lifespan vs birth rate, terrain, or generic attrition.

### S10 — Bootstrap food readout ✅ *Shipped — v0.24.0*

The colony starts with a virtual bootstrap ration (`max(500, initialAnts * 8)`)
that drains silently into nest meals before any forager-deposited pellets
are touched. Once it's depleted the colony is exposed to its real
steady-state economy — but there was no signal that the transition had
happened.

**Shipped behavior:** track `_virtualFoodInitial` alongside
`_virtualFoodStored`, persist both via serialize/load, and surface
`BOOTSTRAP: N% (remaining / initial)` in the HUD. Reads as "depleted"
once it's drained.

---

## Forward-looking items still open

### Skipped this round (waiting on user decision)

* **S3 — extend worker lifespan.** Largest single lever still on the table.
  Until this changes, colony size remains constrained by the queen lay rate
  divided by the death rate, which is itself dominated by short lifespans.
  S1's health-scaled laying gives the queen more headroom but doesn't move
  the lifespan ceiling.
* **S7 — queen succession.** Colony still dies permanently when the queen
  dies. With S1 in place the queen's health can drop temporarily without
  permanent damage (she pauses laying and recovers), but a hazard or
  terminal starvation event still ends the run.

### Suggestions worth considering as a third pass

* **Survival regression test.** Run the simulation 2000+ ticks with default
  config, assert `colony.ants.length > 0` and `queen.alive`, print
  `deathsByCause`. The current `test/simulation-core.test.mjs` only
  checks `runs 100 ticks without crashing`. Now that S9 telemetry exists
  this is straightforward.
* **Brood UI controls.** `broodFoodDrainRate`, `broodGestationSeconds`,
  `broodStarvationTicks`, and the newly-exposed `larvaeCrowdingThreshold`
  exist in `main.js` defaults and in `getDefaultConfig()` but have no UI
  entries in `params.js`. Adding a "Brood" group would make the brood
  pipeline as tunable as the queen group already is.
* **Soldier behavior beyond patrol.** Soldiers can now eat (Bug 3 fix) and
  defend (FIGHT state exists), but they have no enemy to fight in default
  scenarios. Either remove the soldier caste from defaults or wire up a
  combat-eligible threat so the caste pays for itself.
* **Pre-existing test failures unrelated to this work.**
  `test/config-defaults.test.mjs` fails on `evapFood` mismatch (params.js
  has 0.02, main.js has 0.3 — neither matches the other; pre-existed all
  of this work). Two `test/nest-renderer.test.mjs` cases were already
  failing on queen-marker default visibility and brood rendering. Worth a
  separate sweep.

---

## Versioning

### Bug fix series

* `v0.15.1` — fix idle-vs-move drain inversion
* `v0.16.0` — fix regen-threshold gap (behavior change → MINOR)
* `v0.17.0` — soldiers can eat from nest store (behavior change → MINOR)

### Resilience series

* `v0.18.0` — S1: queen egg laying scales with health, costs health to lay
* `v0.19.0` — S2: trophallaxis between adjacent ants
* `v0.20.0` — S4: critical-health override raised 25% → 40%
* `v0.21.0` — S5: senescent ants still passively regen at half rate
* `v0.21.1` — S6: expose `larvaeCrowdingThreshold` as a real config key
* `v0.22.0` — S8: carry hunger/health drain only on surface transit
* `v0.23.0` — S9: cause-of-death telemetry + HUD readout
* `v0.24.0` — S10: bootstrap food remaining as HUD percentage
