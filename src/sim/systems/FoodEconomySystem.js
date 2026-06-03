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
    - Drop CLOSE to the nest (12–30 tiles, was 20–50) so foragers can actually
      convert the cluster into stored food. Distant clusters strand.
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
    dropCooldownTicks = 60,
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

    // Concentrated drop CLOSE to the nest so it is collectible (distant clusters
    // strand). Random angle, on the surface band.
    const angle = this.rng.range(0, Math.PI * 2);
    const dist = 12 + this.rng.range(0, 18); // 12–30 tiles from the nest
    const x = Math.round(this.world.nestX + Math.cos(angle) * dist);
    const y = Math.round(this.world.nestY - Math.abs(Math.sin(angle)) * dist);
    const count = Math.round(this.bootFoodTotal / 2);
    this.spawnFoodCluster(x, Math.min(y, this.world.nestY - 2), 8, count);
  }
}
