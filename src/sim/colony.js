import { Ant, ROLE } from './ant.js';

const BROOD_STAGE_TICKS = {
  egg: 180,
  larva: 220,
  pupa: 260,
};

export class Colony {
  constructor(world, rng, initialWorkers = 24) {
    this.world = world;
    this.rng = rng;
    this.ants = [];

    this.foodStored = 40;
    this.births = initialWorkers;
    this.deaths = 0;
    this.dugTiles = 0;

    this.queen = {
      x: world.nestX,
      y: world.nestY,
      health: 1000,
      eggTimer: 0,
      alive: true,
    };

    this.brood = [];

    for (let i = 0; i < initialWorkers; i += 1) {
      this.ants.push(this.#spawnNearNest(ROLE.WORKER));
    }
  }

  #spawnNearNest(role) {
    const jitterX = this.rng.int(7) - 3;
    const jitterY = this.rng.int(7) - 3;
    const ant = new Ant(
      Math.max(0, Math.min(this.world.width - 1, this.world.nestX + jitterX)),
      Math.max(0, Math.min(this.world.height - 1, this.world.nestY + jitterY)),
      role,
      this.rng,
    );
    ant.underground = true;
    return ant;
  }

  update(config) {
    if (!this.queen.alive) return;

    for (let i = 0; i < this.ants.length; i += 1) {
      this.ants[i].update(this.world, this, this.rng, config);
    }

    this.#compactDeadAnts();
    this.#updateQueenAndBrood(config);
  }

  #compactDeadAnts() {
    let write = 0;
    for (let read = 0; read < this.ants.length; read += 1) {
      if (this.ants[read].alive) {
        this.ants[write] = this.ants[read];
        write += 1;
      }
    }
    this.ants.length = write;
  }

  #updateQueenAndBrood(config) {
    this.queen.eggTimer += 1;
    if (this.queen.eggTimer >= config.queenLayTicks && this.foodStored >= config.eggCost) {
      this.queen.eggTimer = 0;
      this.foodStored -= config.eggCost;
      this.brood.push({
        stage: 'egg',
        ticks: 0,
        role: this.#rollRole(),
      });
    }

    for (let i = 0; i < this.brood.length; i += 1) {
      const brood = this.brood[i];
      brood.ticks += 1;

      if (brood.stage === 'egg' && brood.ticks >= BROOD_STAGE_TICKS.egg) {
        brood.stage = 'larva';
        brood.ticks = 0;
      } else if (brood.stage === 'larva' && brood.ticks >= BROOD_STAGE_TICKS.larva) {
        if (this.foodStored > 0.2) this.foodStored -= 0.2;
        brood.stage = 'pupa';
        brood.ticks = 0;
      } else if (brood.stage === 'pupa' && brood.ticks >= BROOD_STAGE_TICKS.pupa) {
        if (this.ants.length < config.antCap) {
          this.ants.push(this.#spawnNearNest(brood.role));
          this.births += 1;
        }
        this.brood[i] = this.brood[this.brood.length - 1];
        this.brood.pop();
        i -= 1;
      }
    }
  }

  #rollRole() {
    const r = this.rng.next();
    if (r < 0.72) return ROLE.WORKER;
    if (r < 0.9) return ROLE.SOLDIER;
    if (r < 0.97) return ROLE.MALE;
    return ROLE.BREEDER;
  }

  countRoles() {
    const counts = {
      worker: 0,
      soldier: 0,
      male: 0,
      breeder: 0,
    };
    for (let i = 0; i < this.ants.length; i += 1) {
      counts[this.ants[i].role] += 1;
    }
    return counts;
  }

  broodCounts() {
    const counts = { egg: 0, larva: 0, pupa: 0 };
    for (let i = 0; i < this.brood.length; i += 1) {
      counts[this.brood[i].stage] += 1;
    }
    return counts;
  }

  storeFood(amount) {
    this.foodStored += amount;
  }

  serialize() {
    return {
      foodStored: this.foodStored,
      births: this.births,
      deaths: this.deaths,
      dugTiles: this.dugTiles,
      queen: this.queen,
      brood: this.brood,
      ants: this.ants.map((ant) => ({
        x: ant.x,
        y: ant.y,
        dir: ant.dir,
        role: ant.role,
        energy: ant.energy,
        health: ant.health,
        hunger: ant.hunger,
        carrying: ant.carrying,
        underground: ant.underground,
      })),
    };
  }

  static fromSerialized(world, rng, data) {
    const colony = new Colony(world, rng, 0);
    colony.foodStored = data.foodStored;
    colony.births = data.births;
    colony.deaths = data.deaths;
    colony.dugTiles = data.dugTiles || 0;
    colony.queen = data.queen || colony.queen;
    colony.brood = data.brood || [];

    colony.ants = (data.ants || []).map((a) => {
      const ant = new Ant(a.x, a.y, a.role || ROLE.WORKER, rng);
      ant.dir = a.dir;
      ant.energy = a.energy;
      ant.health = a.health ?? 100;
      ant.hunger = a.hunger ?? 0;
      ant.carrying = a.carrying;
      ant.underground = a.underground ?? false;
      return ant;
    });

    return colony;
  }
}
