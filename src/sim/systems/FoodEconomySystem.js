/*
    Food respawn economy: surface-count-gated drops.

    Strategy (v0.43.3):
    - Trigger when free (unclaimed) surface pellets fall below minSurfacePellets.
      "Free" means takenByAntId === null — pellets being carried are already
      spoken for and shouldn't count toward available supply.
    - Drop well away from the nest (60–100 tiles) so ants must forage rather
      than collect off the doorstep.
    - Cluster size is kept small (bootFoodTotal/4) to avoid flooding the map.
      Adjust minSurfacePellets to control how sparse the surface gets before a
      top-up fires.
*/
export class FoodEconomySystem {
  constructor({
    world,
    colony,
    rng,
    spawnFoodCluster,
    bootFoodTotal = 390,
    minSurfacePellets = 200,
  }) {
    this.world = world;
    this.colony = colony;
    this.rng = rng;
    this.spawnFoodCluster = spawnFoodCluster;
    this.bootFoodTotal = bootFoodTotal;
    // Drop fires when free surface pellets fall below this floor.
    this.minSurfacePellets = minSurfacePellets;
  }

  update({ foodPellets = [], config }) {
    if (this.colony.ants.length === 0) return;

    const threshold = config?.minSurfacePellets ?? this.minSurfacePellets;
    const freePellets = foodPellets.filter((p) => !p.takenByAntId).length;
    if (freePellets >= threshold) return;

    // Drop well away from the nest — never on the doorstep. Random angle,
    // surface band only. 60–100 tiles forces real foraging; world-edge and
    // surface-band guards in spawnFoodCluster clamp out-of-bounds placements.
    const angle = this.rng.range(0, Math.PI * 2);
    const dist = 60 + this.rng.range(0, 40); // 60–100 tiles from the nest
    const x = Math.round(this.world.nestX + Math.cos(angle) * dist);
    const y = Math.round(this.world.nestY - Math.abs(Math.sin(angle)) * dist);
    const count = Math.round(this.bootFoodTotal / 4);
    this.spawnFoodCluster(x, Math.min(y, this.world.nestY - 2), 8, count);
  }
}
