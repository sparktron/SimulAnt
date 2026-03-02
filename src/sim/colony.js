import { Ant } from './ant.js';

export class Colony {
  constructor(world, rng, initialAnts = 300) {
    this.world = world;
    this.rng = rng;
    this.ants = [];
    this.foodStored = 0;
    this.births = initialAnts;
    this.deaths = 0;
    this.spawnCost = 4;

    this.queen = {
      alive: true,
      eggProgress: 0,
      eggsLaid: 0,
      brood: 0,
    };

    this.excavatedTiles = 0;
    this.onExcavate = null;

    for (let i = 0; i < initialAnts; i += 1) {
      this.ants.push(this.#spawnNearNest('worker'));
    }
  }

  #spawnNearNest(role) {
    const jitterX = this.rng.int(7) - 3;
    const jitterY = this.rng.int(7) - 3;
    return new Ant(
      Math.max(0, Math.min(this.world.width - 1, this.world.nestX + jitterX)),
      Math.max(0, Math.min(this.world.height - 1, this.world.nestY + jitterY)),
      this.rng,
      role,
    );
  }

  update(config) {
    if (this.queen.alive) {
      this.#updateQueenAndBrood(config);
    }

    for (let i = 0; i < this.ants.length; i += 1) {
      this.ants[i].update(this.world, this, this.rng, config);
    }

    let write = 0;
    for (let read = 0; read < this.ants.length; read += 1) {
      if (this.ants[read].alive) {
        this.ants[write] = this.ants[read];
        write += 1;
      }
    }
    this.ants.length = write;

    while (this.foodStored >= this.spawnCost && this.ants.length < config.antCap) {
      this.foodStored -= this.spawnCost;
      this.queen.brood += 1;
    }

    while (this.queen.brood >= 1 && this.ants.length < config.antCap) {
      this.queen.brood -= 1;
      const role = this.rng.chance(config.soldierSpawnChance) ? 'soldier' : 'worker';
      this.ants.push(this.#spawnNearNest(role));
      this.births += 1;
    }
  }

  #updateQueenAndBrood(config) {
    if (this.foodStored < config.queenEggFoodCost) return;

    this.queen.eggProgress += 1;
    if (this.queen.eggProgress < config.queenEggTicks) return;

    this.queen.eggProgress = 0;
    this.foodStored -= config.queenEggFoodCost;
    this.queen.eggsLaid += 1;
    this.queen.brood += 1;
  }

  storeFood(amount) {
    this.foodStored += amount;
  }

  recordExcavation(volume, worldX, depthY) {
    this.excavatedTiles += volume;
    if (this.onExcavate) this.onExcavate(volume, worldX, depthY);
  }

  serialize() {
    return {
      foodStored: this.foodStored,
      births: this.births,
      deaths: this.deaths,
      queen: this.queen,
      excavatedTiles: this.excavatedTiles,
      ants: this.ants.map((ant) => ({
        x: ant.x,
        y: ant.y,
        dir: ant.dir,
        energy: ant.energy,
        carrying: ant.carrying,
        role: ant.role,
      })),
    };
  }

  static fromSerialized(world, rng, data) {
    const colony = new Colony(world, rng, 0);
    colony.foodStored = data.foodStored;
    colony.births = data.births;
    colony.deaths = data.deaths;
    colony.queen = { ...colony.queen, ...(data.queen || {}) };
    colony.excavatedTiles = data.excavatedTiles || 0;
    colony.ants = data.ants.map((a) => {
      const ant = new Ant(a.x, a.y, rng, a.role || 'worker');
      ant.dir = a.dir;
      ant.energy = a.energy;
      ant.carrying = a.carrying;
      return ant;
    });
    return colony;
  }
}
