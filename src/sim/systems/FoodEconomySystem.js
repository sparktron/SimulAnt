/*
    Food respawn economy: threshold-based, concentrated drops.

    Strategy:
    - Tracks bootFoodTotal (total pellets spawned at simulation start)
    - Threshold: when available surface pellets drop below 25% of bootFoodTotal,
      spawn one large concentrated cluster (matching one boot-cluster size)
    - Drop location: random angle, 20-50 tiles from nest, always on surface
    - No interval-based logic — drops happen exactly when needed, not on a timer

    This creates a "feast or famine" foraging pattern:
    - Ants work a large food source until it's nearly gone
    - A fresh concentrated source appears, giving the colony a new trail target
    - Fewer, larger sources means clearer pheromone trails and stronger foraging
*/
export class FoodEconomySystem {
  constructor({ world, colony, rng, spawnFoodCluster, bootFoodTotal = 390 }) {
    this.world = world;
    this.colony = colony;
    this.rng = rng;
    this.spawnFoodCluster = spawnFoodCluster;
    this.bootFoodTotal = bootFoodTotal;
  }

  update({ foodPellets }) {
    const availableFoodCount = foodPellets.filter((pellet) => !pellet.takenByAntId).length;
    const threshold = Math.floor(this.bootFoodTotal * 0.25);
    if (availableFoodCount >= threshold) return;

    // One concentrated drop matching one boot-cluster in size
    const angle = this.rng.range(0, Math.PI * 2);
    const dist = 20 + this.rng.range(0, 30);
    const x = Math.round(this.world.nestX + Math.cos(angle) * dist);
    const y = Math.round(this.world.nestY - Math.abs(Math.sin(angle)) * dist);
    const count = Math.round(this.bootFoodTotal / 2);
    this.spawnFoodCluster(x, Math.min(y, this.world.nestY - 2), 8, count);
  }
}
