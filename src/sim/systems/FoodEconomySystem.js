export class FoodEconomySystem {
  constructor({ world, colony, rng, spawnFoodCluster }) {
    this.world = world;
    this.colony = colony;
    this.rng = rng;
    this.spawnFoodCluster = spawnFoodCluster;
  }

  update({ tick, foodPellets }) {
    const antCount = this.colony.ants.length;
    const availableFoodCount = foodPellets.filter((pellet) => !pellet.takenByAntId).length;
    const pelletTarget = Math.max(20, antCount);
    const totalFoodAvailable = availableFoodCount + this.colony.getTotalStoredFood();
    const criticalShortage = totalFoodAvailable < Math.max(10, antCount * 0.5);
    const regularInterval = antCount > 100 ? 60 : 120;

    if (!criticalShortage && tick % regularInterval !== 0) return;
    if (availableFoodCount >= pelletTarget) return;

    const deficit = pelletTarget - availableFoodCount;

    const angleNear = this.rng.range(0, Math.PI * 2);
    const distNear = 10 + this.rng.range(0, 15);
    const xNear = Math.round(this.world.nestX + Math.cos(angleNear) * distNear);
    const yNear = Math.round(this.world.nestY - Math.abs(Math.sin(angleNear) * distNear));
    const nearCount = Math.ceil(deficit * 0.4);
    this.spawnFoodCluster(xNear, Math.min(yNear, this.world.nestY - 2), 8, nearCount);

    const angleFar = angleNear + Math.PI * (0.5 + this.rng.range(0, 1));
    const distFar = 30 + this.rng.range(0, 30);
    const xFar = Math.round(this.world.nestX + Math.cos(angleFar) * distFar);
    const yFar = Math.round(this.world.nestY - Math.abs(Math.sin(angleFar) * distFar));
    const farCount = Math.ceil(deficit * 0.6);
    this.spawnFoodCluster(xFar, Math.min(yFar, this.world.nestY - 2), 12, farCount);
  }
}
