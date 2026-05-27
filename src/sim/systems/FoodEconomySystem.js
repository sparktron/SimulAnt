/*
    Food respawn economy: maintains availability without infinite supply.

    Strategy:
    - Maintains a target pellet count (ant-scaled: max(20, antCount))
    - Critical shortage check: if total food (surface + stored) < 0.5 * antCount,
      respawn immediately (prevents starvation death spiral)
    - Regular respawn: every 60-120 ticks if available < target
    - Spatial distribution: 40% near nest (10-25 tiles), 60% far (40-60 tiles)
      to create foraging zones and prevent clustering

    This creates emergent foraging behavior:
    - Ants must establish trails to distant food sources
    - Near-food makes early colony survival easy
    - Far-food drives exploration and trail-following capability
    - Starvation pressure forces rapid response to shortages

    Important: Respawn is randomized angle/distance via seeded RNG so repeated
    playthroughs with same seed produce identical food locations.
*/
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
    // Bumped from max(20, antCount) so the steady-state pellet pool scales
    // ahead of the colony's appetite — a 200-ant colony now sees 300 pellets
    // on the map instead of 200, giving foragers more parallel sources to
    // exploit and shifting the supply curve up.
    const pelletTarget = Math.max(40, Math.ceil(antCount * 1.5));
    const totalFoodAvailable = availableFoodCount + this.colony.getTotalStoredFood();
    const criticalShortage = totalFoodAvailable < Math.max(10, antCount * 0.5);
    // Tightened from 60/120 → 40/80. With v0.26.9 trail tuning, foragers
    // can drain a near-cluster in ~5 sim sec; the old 120-tick respawn
    // interval (4 sim sec) left them searching empty terrain for too long.
    const regularInterval = antCount > 100 ? 40 : 80;

    if (!criticalShortage && tick % regularInterval !== 0) return;
    if (availableFoodCount >= pelletTarget) return;

    const deficit = pelletTarget - availableFoodCount;

    // Near-field food: random angle from nest, fixed radius band (10-25 tiles)
    const angleNear = this.rng.range(0, Math.PI * 2);
    const distNear = 10 + this.rng.range(0, 15);
    const xNear = Math.round(this.world.nestX + Math.cos(angleNear) * distNear);
    const yNear = Math.round(this.world.nestY - Math.abs(Math.sin(angleNear) * distNear));
    const nearCount = Math.ceil(deficit * 0.4);
    this.spawnFoodCluster(xNear, Math.min(yNear, this.world.nestY - 2), 8, nearCount);

    // Far-field food: perpendicular angle (90-270°), longer radius (30-60 tiles)
    const angleFar = angleNear + Math.PI * (0.5 + this.rng.range(0, 1));
    const distFar = 30 + this.rng.range(0, 30);
    const xFar = Math.round(this.world.nestX + Math.cos(angleFar) * distFar);
    const yFar = Math.round(this.world.nestY - Math.abs(Math.sin(angleFar) * distFar));
    const farCount = Math.ceil(deficit * 0.6);
    this.spawnFoodCluster(xFar, Math.min(yFar, this.world.nestY - 2), 12, farCount);
  }
}
