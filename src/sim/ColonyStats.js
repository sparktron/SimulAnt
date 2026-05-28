/**
 * Tracks rolling colony statistics for population health monitoring.
 *
 * Samples are recorded periodically by SimulationCore.update (default every
 * 30 ticks). At 30 ticks/sec the default 1800-sample buffer covers ~30 real
 * minutes of play. The user can scroll back through a session and download a
 * JSONL/CSV trace for post-hoc analysis.
 *
 * Snapshot fields cover four dimensions that have to be cross-referenced
 * to diagnose colony collapse:
 *   - Population: total, by role, by job, surface vs underground
 *   - Vitals:     hunger/health min/avg/max, queen health and hunger
 *   - Economy:    foodStored, bootstrap food remaining, larvae count
 *   - Mortality:  births, deaths, deathsByCause breakdown
 *
 * Use toJSONL() for grep/jq inspection and toCSV() for spreadsheet/pandas
 * analysis.
 */
export class ColonyStats {
  constructor(maxSamples = 1800) {
    this.maxSamples = maxSamples;
    this.samples = [];
    this.peakPopulation = 0;
    this.totalFoodCollected = 0;
    this.totalFoodConsumed = 0;
  }

  record(tick, colony, world = null) {
    const population = colony.ants.length;
    let workers = 0;
    let soldiers = 0;
    let breeders = 0;
    let forageJobs = 0;
    let digJobs = 0;
    let nurseJobs = 0;
    let surface = 0;
    let underground = 0;
    let hungerSum = 0;
    let healthSum = 0;
    let ageSum = 0;
    let hungerMin = population > 0 ? Infinity : 0;
    let hungerMax = 0;
    let healthMin = population > 0 ? Infinity : 0;
    let healthMax = 0;
    let carryingFood = 0;
    let aliveCount = 0;

    const nestY = world?.nestY ?? colony.world?.nestY;
    for (let i = 0; i < colony.ants.length; i += 1) {
      const ant = colony.ants[i];
      if (!ant.alive) continue;
      aliveCount += 1;
      hungerSum += ant.hunger;
      healthSum += ant.health;
      ageSum += ant.age;
      if (ant.hunger < hungerMin) hungerMin = ant.hunger;
      if (ant.hunger > hungerMax) hungerMax = ant.hunger;
      if (ant.health < healthMin) healthMin = ant.health;
      if (ant.health > healthMax) healthMax = ant.health;
      if (ant.carrying?.type === 'food') carryingFood += 1;
      if (typeof nestY === 'number') {
        if (ant.y > nestY) underground += 1;
        else surface += 1;
      }
      if (ant.role === 'worker') {
        workers += 1;
        if (ant.workFocus === 'dig') digJobs += 1;
        else if (ant.workFocus === 'nurse') nurseJobs += 1;
        else forageJobs += 1;
      } else if (ant.role === 'soldier') {
        soldiers += 1;
      } else if (ant.role === 'breeder') {
        breeders += 1;
      }
    }

    if (population > this.peakPopulation) {
      this.peakPopulation = population;
    }

    const pher = world?.getPheromoneStats ? world.getPheromoneStats() : null;
    const byCause = colony.deathsByCause || { starvation: 0, oldAge: 0, hazard: 0, other: 0 };

    this.samples.push({
      tick,
      population,
      workers,
      soldiers,
      breeders,
      forageJobs,
      digJobs,
      nurseJobs,
      surface,
      underground,
      carryingFood,
      foodStored: round1(colony.foodStored),
      bootstrapRemaining: round1(colony._virtualFoodStored ?? 0),
      bootstrapInitial: round1(colony._virtualFoodInitial ?? 0),
      larvae: colony.larvae?.length || 0,
      births: colony.births,
      deaths: colony.deaths,
      deathStarv: byCause.starvation || 0,
      deathAge: byCause.oldAge || 0,
      deathHazard: byCause.hazard || 0,
      deathOther: byCause.other || 0,
      avgHunger: round1(aliveCount > 0 ? hungerSum / aliveCount : 0),
      avgHealth: round1(aliveCount > 0 ? healthSum / aliveCount : 0),
      avgAge: Math.round(aliveCount > 0 ? ageSum / aliveCount : 0),
      minHunger: round1(aliveCount > 0 ? hungerMin : 0),
      maxHunger: round1(aliveCount > 0 ? hungerMax : 0),
      minHealth: round1(aliveCount > 0 ? healthMin : 0),
      maxHealth: round1(aliveCount > 0 ? healthMax : 0),
      queenAlive: colony.queen.alive,
      queenHealth: round1(colony.queen.health),
      queenHunger: round1(colony.queen.hunger),
      queenEggsLaid: colony.queen.eggsLaid || 0,
      pherMaxFood: pher ? round1(pher.maxFood) : 0,
      pherAvgFood: pher ? round1(pher.avgFood) : 0,
      pherMaxHome: pher ? round1(pher.maxHome) : 0,
      pherAvgHome: pher ? round1(pher.avgHome) : 0,
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
      queenHealth: latest.queenHealth,
      deathStarv: latest.deathStarv,
      deathAge: latest.deathAge,
      deathHazard: latest.deathHazard,
      deathOther: latest.deathOther,
    };
  }

  /** Serializes the rolling buffer as JSONL (one snapshot per line). */
  toJSONL() {
    return this.samples.map((row) => JSON.stringify(row)).join('\n');
  }

  /** Serializes the rolling buffer as CSV with a header row. */
  toCSV() {
    if (this.samples.length === 0) return '';
    const headers = Object.keys(this.samples[0]);
    const lines = [headers.join(',')];
    for (let i = 0; i < this.samples.length; i += 1) {
      const row = this.samples[i];
      lines.push(headers.map((h) => formatCSVCell(row[h])).join(','));
    }
    return lines.join('\n');
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

function round1(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function formatCSVCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}
