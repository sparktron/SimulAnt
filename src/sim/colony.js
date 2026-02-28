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

    for (let i = 0; i < initialAnts; i += 1) {
      this.ants.push(this.#spawnNearNest());
    }
  }

  #spawnNearNest() {
    const jitterX = this.rng.int(7) - 3;
    const jitterY = this.rng.int(7) - 3;
    return new Ant(
      Math.max(0, Math.min(this.world.width - 1, this.world.nestX + jitterX)),
      Math.max(0, Math.min(this.world.height - 1, this.world.nestY + jitterY)),
      this.rng,
    );
  }

  update(config) {
    for (let i = 0; i < this.ants.length; i += 1) {
      this.ants[i].update(this.world, this, this.rng, config);
    }

    // Compact dead ants in-place with minimal allocations.
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
      this.ants.push(this.#spawnNearNest());
      this.births += 1;
    }
  }

  storeFood(amount) {
    this.foodStored += amount;
  }

  serialize() {
    return {
      foodStored: this.foodStored,
      births: this.births,
      deaths: this.deaths,
      ants: this.ants.map((ant) => ({
        x: ant.x,
        y: ant.y,
        dir: ant.dir,
        energy: ant.energy,
        carrying: ant.carrying,
      })),
    };
  }

  static fromSerialized(world, rng, data) {
    const colony = new Colony(world, rng, 0);
    colony.foodStored = data.foodStored;
    colony.births = data.births;
    colony.deaths = data.deaths;
    colony.ants = data.ants.map((a) => {
      const ant = new Ant(a.x, a.y, rng);
      ant.dir = a.dir;
      ant.energy = a.energy;
      ant.carrying = a.carrying;
      return ant;
    });
    return colony;
  }
}
