/*
    Food respawn economy: global dual-trigger safety net (surface supply OR colony hunger).

    Strategy (v0.50.0 — fixes the starvation-collapse-rca-2026-06-02 cause #2):
    A drop fires when EITHER signal crosses its threshold:
    - SURFACE LOW: free (unclaimed) surface pellets fall below minSurfacePellets.
      "Free" means takenByAntId === null — carried pellets are already spoken for.
    - COLONY HUNGRY: any living colony's foodStored falls below a population-scaled
      reserve floor max(foodMinReserve, ants * foodReservePerAnt).

    Why both: the old surface-only gate "measured the wrong signal and never fired"
    — distant uncollected pellets keep the surface count high, so respawn stayed
    silent while the colony starved with food on the map (the RCA bug). The hunger
    trigger fires on the larder directly, so it can't be masked by unreachable food.

    A foodRespawnCooldownTicks rate-limit bounds the supply: the hunger trigger is
    NOT self-limiting (a starving colony that can't reach far food stays hungry every
    tick), so without a cooldown it would flood the map. The surface trigger is
    self-limiting (a drop lifts the count), but the cooldown gates both uniformly.

    The living colony with the largest normalized reserve shortfall receives the
    drop. Equal-need ties use the shared seeded RNG, preventing a stable array-order
    bias. Drops land 30–60 tiles from the selected colony's home so both colonies
    receive the same logistics support (see docs/environmental-foraging-tests.md).
    - Cluster size is kept small (bootFoodTotal/4) to avoid flooding the map.
*/
export class FoodEconomySystem {
  constructor({
    world,
    colony,
    colonies,
    rng,
    spawnFoodCluster,
    bootFoodTotal = 390,
    minSurfacePellets = 200,
    foodReservePerAnt = 12,
    foodMinReserve = 150,
    foodRespawnCooldownTicks = 60,
    foodDropDistanceMin = 30,
    foodDropDistanceRange = 30,
  }) {
    this.world = world;
    this.colonies = Array.isArray(colonies) && colonies.length > 0
      ? colonies
      : (colony ? [colony] : []);
    this.rng = rng;
    this.spawnFoodCluster = spawnFoodCluster;
    this.bootFoodTotal = bootFoodTotal;
    // Drop fires when free surface pellets fall below this floor...
    this.minSurfacePellets = minSurfacePellets;
    // ...OR when foodStored falls below max(foodMinReserve, ants * foodReservePerAnt).
    this.foodReservePerAnt = foodReservePerAnt;
    this.foodMinReserve = foodMinReserve;
    // Minimum ticks between drops — bounds the supply rate (the hunger trigger is
    // not self-limiting). Updated only on real ticks so tick-less callers/tests
    // are not throttled.
    this.foodRespawnCooldownTicks = foodRespawnCooldownTicks;
    // Drop placement: distance band from the nest. Closer = shorter haul = a
    // bigger economy (E1/E2 found the colony is logistics/distance-bound) but an
    // easier game. A difficulty lever — see docs/environmental-foraging-tests.md.
    this.foodDropDistanceMin = foodDropDistanceMin;
    this.foodDropDistanceRange = foodDropDistanceRange;
    this._lastDropTick = -Infinity;
  }

  update({ foodPellets = [], config, tick }) {
    const livingColonies = this.colonies.filter((candidate) => candidate?.ants?.length > 0);
    if (livingColonies.length === 0) return;

    // Trigger 1 — surface supply low.
    const threshold = config?.minSurfacePellets ?? this.minSurfacePellets;
    const freePellets = foodPellets.filter((p) => !p.takenByAntId).length;
    const surfaceLow = freePellets < threshold;

    // Trigger 2 — any colony hungry (larder below its population-scaled floor).
    const reservePerAnt = config?.foodReservePerAnt ?? this.foodReservePerAnt;
    const minReserve = config?.foodMinReserve ?? this.foodMinReserve;
    const needs = livingColonies.map((candidate) => {
      const hungerFloor = Math.max(minReserve, candidate.ants.length * reservePerAnt);
      const foodStored = Math.max(0, candidate.foodStored ?? 0);
      return {
        colony: candidate,
        shortfallRatio: hungerFloor > 0
          ? Math.max(0, hungerFloor - foodStored) / hungerFloor
          : 0,
        reserveRatio: hungerFloor > 0 ? foodStored / hungerFloor : foodStored,
      };
    });
    const hungry = needs.some((need) => need.shortfallRatio > 0);

    if (!surfaceLow && !hungry) return;

    // Rate limit (skipped when no real tick is supplied, e.g. unit tests).
    const cooldown = config?.foodRespawnCooldownTicks ?? this.foodRespawnCooldownTicks;
    if (Number.isFinite(tick) && (tick - this._lastDropTick) < cooldown) return;

    // Select the greatest normalized reserve shortfall. When the surface trigger
    // fires but no colony is hungry, the lowest reserve ratio is still neediest.
    // Seeded tie-breaking avoids permanently favoring the first colony.
    const needMetric = hungry ? 'shortfallRatio' : 'reserveRatio';
    const bestValue = hungry
      ? Math.max(...needs.map((need) => need[needMetric]))
      : Math.min(...needs.map((need) => need[needMetric]));
    const tied = needs.filter((need) => Math.abs(need[needMetric] - bestValue) < 1e-12);
    const selected = tied.length === 1 ? tied[0] : tied[this.rng.int(tied.length)];

    // Drop away from the selected home — never on the doorstep. Random angle,
    // surface band only. The distance band forces real foraging; world-edge and
    // surface-band guards in spawnFoodCluster clamp out-of-bounds placements.
    const distMin = config?.foodDropDistanceMin ?? this.foodDropDistanceMin;
    const distRange = config?.foodDropDistanceRange ?? this.foodDropDistanceRange;
    const angle = this.rng.range(0, Math.PI * 2);
    const dist = distMin + this.rng.range(0, distRange);
    const homeX = Number.isFinite(selected.colony.homeX) ? selected.colony.homeX : this.world.nestX;
    const homeY = Number.isFinite(selected.colony.homeY) ? selected.colony.homeY : this.world.nestY;
    const x = Math.round(homeX + Math.cos(angle) * dist);
    const y = Math.round(homeY - Math.abs(Math.sin(angle)) * dist);
    const count = Math.round(this.bootFoodTotal / 4);
    this.spawnFoodCluster(x, Math.min(y, this.world.nestY - 2), 8, count);
    if (Number.isFinite(tick)) this._lastDropTick = tick;
  }
}
