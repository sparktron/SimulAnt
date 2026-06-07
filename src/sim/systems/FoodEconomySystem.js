/*
    Food respawn economy: demand-tracking, concentrated, reachable drops.

    Strategy (v0.36.0 — see docs/starvation-collapse-rca-2026-06-02.md):
    - Trigger on the colony's STORED FOOD relative to population, not on raw
      uncollected surface-pellet count. The old pellet-count metric decoupled
      from actual starvation: pellets stranded out of forager reach kept the
      count "healthy" (never < 97) while the larder hit zero, so the safety net
      fired 0 times in 7000 ticks and the colony starved with ~215 pellets on
      the ground. Gating on `foodStored < ants * reservePerAnt` makes supply
      track demand — it fires more often as the colony grows.
    - Drop away from the nest (60–100 tiles) so food never spawns on the doorstep.
      Foragers still reach it via pheromone trails; distant-strand risk is
      bounded by the cluster radius (8 tiles) and the surface-band clamping.
    - A cooldown bounds the supply RATE so the colony still has to forage for its
      food instead of being fed for free — this is a famine backstop, not a tap.

    This keeps the "feast or famine" foraging feel (fewer, larger sources → clear
    pheromone trails) while ensuring the backstop actually deploys under famine.
*/
export class FoodEconomySystem {
  constructor({
    world,
    colony,
    rng,
    spawnFoodCluster,
    bootFoodTotal = 390,
    reservePerAnt = 40,
    minReserve = 300,
    dropCooldownTicks = 250,
  }) {
    this.world = world;
    this.colony = colony;
    this.rng = rng;
    this.spawnFoodCluster = spawnFoodCluster;
    this.bootFoodTotal = bootFoodTotal;
    // Target stored-food buffer per ant; below it the colony is trending toward
    // famine and needs a fresh, reachable source.
    this.reservePerAnt = reservePerAnt;
    // Floor so a tiny early colony still gets a backstop before its reserve
    // target (ants * reservePerAnt) exceeds the bootstrap ration.
    this.minReserve = minReserve;
    // Minimum ticks between drops — bounds the supply rate.
    this.dropCooldownTicks = dropCooldownTicks;
    this._lastDropTick = -Infinity;
  }

  update({ tick = 0, config }) {
    const ants = this.colony.ants.length;
    if (ants === 0) return;

    // Live-tunable from the parameter editor; fall back to the constructor
    // defaults when no config is supplied (e.g. unit tests).
    const reservePerAnt = config?.foodReservePerAnt ?? this.reservePerAnt;
    const minReserve = config?.foodMinReserve ?? this.minReserve;
    const cooldown = config?.foodRespawnCooldownTicks ?? this.dropCooldownTicks;

    // Demand signal: stored food below a population-scaled reserve floor.
    const reserveFloor = Math.max(minReserve, ants * reservePerAnt);
    if (this.colony.foodStored >= reserveFloor) return;

    // Rate limit: forage, don't get fed for free.
    if (tick - this._lastDropTick < cooldown) return;
    this._lastDropTick = tick;

    // Drop well away from the nest — never on the doorstep. Random angle,
    // surface band only. 60–100 tiles forces real foraging; world-edge and
    // surface-band guards in spawnFoodCluster clamp out-of-bounds placements.
    const angle = this.rng.range(0, Math.PI * 2);
    const dist = 60 + this.rng.range(0, 40); // 60–100 tiles from the nest
    const x = Math.round(this.world.nestX + Math.cos(angle) * dist);
    const y = Math.round(this.world.nestY - Math.abs(Math.sin(angle)) * dist);
    const count = Math.round(this.bootFoodTotal / 4); // smaller clusters, less map clutter
    this.spawnFoodCluster(x, Math.min(y, this.world.nestY - 2), 8, count);
  }
}
