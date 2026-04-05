/**
 * Tracks rolling colony statistics for population health monitoring.
 * Samples are recorded periodically and old samples age out.
 */
export class ColonyStats {
  constructor(maxSamples = 300) {
    this.maxSamples = maxSamples;
    this.samples = [];
    this.peakPopulation = 0;
    this.totalFoodCollected = 0;
    this.totalFoodConsumed = 0;
  }

  record(tick, colony) {
    const workerCount = colony.ants.filter((a) => a.role === 'worker' && a.alive).length;
    const soldierCount = colony.ants.filter((a) => a.role === 'soldier' && a.alive).length;
    const population = colony.ants.length;

    if (population > this.peakPopulation) {
      this.peakPopulation = population;
    }

    const avgHunger = population > 0
      ? colony.ants.reduce((sum, a) => sum + a.hunger, 0) / population
      : 0;

    const avgHealth = population > 0
      ? colony.ants.reduce((sum, a) => sum + a.health, 0) / population
      : 0;

    const avgAge = population > 0
      ? colony.ants.reduce((sum, a) => sum + a.age, 0) / population
      : 0;

    this.samples.push({
      tick,
      population,
      workers: workerCount,
      soldiers: soldierCount,
      foodStored: colony.foodStored,
      avgHunger: Math.round(avgHunger * 10) / 10,
      avgHealth: Math.round(avgHealth * 10) / 10,
      avgAge: Math.round(avgAge),
      births: colony.births,
      deaths: colony.deaths,
      queenAlive: colony.queen.alive,
    });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  recordFoodCollected(amount) {
    this.totalFoodCollected += amount;
  }

  recordFoodConsumed(amount) {
    this.totalFoodConsumed += amount;
  }

  getLatest() {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
  }

  getPopulationTrend(window = 30) {
    if (this.samples.length < 2) return 0;
    const start = Math.max(0, this.samples.length - window);
    const first = this.samples[start].population;
    const last = this.samples[this.samples.length - 1].population;
    return last - first;
  }

  getSummary() {
    const latest = this.getLatest();
    if (!latest) return null;

    return {
      currentPopulation: latest.population,
      peakPopulation: this.peakPopulation,
      populationTrend: this.getPopulationTrend(),
      totalBirths: latest.births,
      totalDeaths: latest.deaths,
      avgHunger: latest.avgHunger,
      avgHealth: latest.avgHealth,
      avgAge: latest.avgAge,
      foodStored: latest.foodStored,
      totalFoodCollected: Math.round(this.totalFoodCollected),
      totalFoodConsumed: Math.round(this.totalFoodConsumed),
      queenAlive: latest.queenAlive,
    };
  }

  serialize() {
    return {
      peakPopulation: this.peakPopulation,
      totalFoodCollected: this.totalFoodCollected,
      totalFoodConsumed: this.totalFoodConsumed,
    };
  }

  loadFromSerialized(data) {
    if (!data) return;
    this.peakPopulation = data.peakPopulation || 0;
    this.totalFoodCollected = data.totalFoodCollected || 0;
    this.totalFoodConsumed = data.totalFoodConsumed || 0;
  }
}
