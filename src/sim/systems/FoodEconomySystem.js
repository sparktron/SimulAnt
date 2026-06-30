/*
    Food respawn economy: dual-trigger safety net (surface supply OR colony hunger).

    Strategy (v0.50.0 — fixes the starvation-collapse-rca-2026-06-02 cause #2):
    A drop fires when EITHER signal crosses its threshold:
    - SURFACE LOW: free (unclaimed) surface pellets fall below minSurfacePellets.
      "Free" means takenByAntId === null — carried pellets are already spoken for.
    - COLONY HUNGRY: foodStored falls below a population-scaled reserve floor
      max(foodMinReserve, ants * foodReservePerAnt).

    Why both: the old surface-only gate "measured the wrong signal and never fired"
    — distant uncollected pellets keep the surface count high, so respawn stayed
    silent while the colony starved with food on the map (the RCA bug). The hunger
    trigger fires on the larder directly, so it can't be masked by unreachable food.

    A foodRespawnCooldownTicks rate-limit bounds the supply: the hunger trigger is
    NOT self-limiting (a starving colony that can't reach far food stays hungry every
    tick), so without a cooldown it would flood the map. The surface trigger is
    self-limiting (a drop lifts the count), but the cooldown gates both uniformly.

    - Drop well away from the nest (60–100 tiles) so ants must forage (placement is
      a separate difficulty lever — see docs/environmental-foraging-tests.md).
    - Cluster size is kept small (bootFoodTotal/4) to avoid flooding the map.
*/
export class FoodEconomySystem {
  constructor({
    world,
    colony,
    rng,
    spawnFoodCluster,
    bootFoodTotal = 390,
    minSurfacePellets = 200,
    foodReservePerAnt = 12,
    foodMinReserve = 150,
    foodRespawnCooldownTicks = 60,
    foodDropDistanceMin = 60,
    foodDropDistanceRange = 40,
  }) {
    this.world = world;
    this.colony = colony;
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
    const antCount = this.colony.ants.length;
    if (antCount === 0) return;

    // Trigger 1 — surface supply low.
    const threshold = config?.minSurfacePellets ?? this.minSurfacePellets;
    const freePellets = foodPellets.filter((p) => !p.takenByAntId).length;
    const surfaceLow = freePellets < threshold;

    // Trigger 2 — colony hungry (larder below a population-scaled reserve floor).
    const reservePerAnt = config?.foodReservePerAnt ?? this.foodReservePerAnt;
    const minReserve = config?.foodMinReserve ?? this.foodMinReserve;
    const hungerFloor = Math.max(minReserve, antCount * reservePerAnt);
    const hungry = (this.colony.foodStored ?? 0) < hungerFloor;

    if (!surfaceLow && !hungry) return;

    // Rate limit (skipped when no real tick is supplied, e.g. unit tests).
    const cooldown = config?.foodRespawnCooldownTicks ?? this.foodRespawnCooldownTicks;
    if (Number.isFinite(tick) && (tick - this._lastDropTick) < cooldown) return;

    // Drop away from the nest — never on the doorstep. Random angle, surface band
    // only. The distance band forces real foraging; world-edge and surface-band
    // guards in spawnFoodCluster clamp out-of-bounds placements.
    const distMin = config?.foodDropDistanceMin ?? this.foodDropDistanceMin;
    const distRange = config?.foodDropDistanceRange ?? this.foodDropDistanceRange;
    const angle = this.rng.range(0, Math.PI * 2);
    const dist = distMin + this.rng.range(0, distRange);
    const x = Math.round(this.world.nestX + Math.cos(angle) * dist);
    const y = Math.round(this.world.nestY - Math.abs(Math.sin(angle)) * dist);
    const count = Math.round(this.bootFoodTotal / 4);
    this.spawnFoodCluster(x, Math.min(y, this.world.nestY - 2), 8, count);
    if (Number.isFinite(tick)) this._lastDropTick = tick;
  }
}
