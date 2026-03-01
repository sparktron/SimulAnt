import { World, TERRAIN } from './world.js';
import { Colony } from './colony.js';
import { SeededRng } from './rng.js';

export class SimulationCore {
  constructor(seed = 'simant-default') {
    this.tick = 0;
    this.reset(seed);
  }

  reset(seed = 'simant-default') {
    this.seed = seed;
    this.rng = new SeededRng(this.seed);
    this.world = new World(256, 256);

    this.world.paintCircle(this.world.nestX + 45, this.world.nestY, 10, (idx) => {
      this.world.food[idx] = 10;
    });
    this.world.paintCircle(this.world.nestX - 60, this.world.nestY + 30, 15, (idx) => {
      this.world.food[idx] = 8;
    });
    this.world.paintCircle(this.world.nestX + 70, this.world.nestY - 50, 14, (idx) => {
      this.world.terrain[idx] = TERRAIN.HAZARD;
    });

    this.world.setNest(this.world.nestX, this.world.nestY);
    this.colony = new Colony(this.world, this.rng, 320);
    this.tick = 0;
  }

  update(config) {
    this.tick += 1;
    this.colony.update(config);
    if (this.tick % config.pheromoneUpdateTicks === 0) {
      this.world.diffuseAndEvaporate(config.diffusionRate, config.evaporationRate, true);
    }
  }

  applyTool(tool, worldX, worldY, radius) {
    switch (tool) {
      case 'food':
        this.world.paintCircle(worldX, worldY, radius, (idx) => {
          this.world.food[idx] = Math.min(this.world.food[idx] + 4, 20);
          if (this.world.terrain[idx] !== TERRAIN.GROUND) this.world.terrain[idx] = TERRAIN.GROUND;
        });
        break;
      case 'wall':
        this.world.paintCircle(worldX, worldY, radius, (idx) => {
          this.world.terrain[idx] = TERRAIN.WALL;
        });
        break;
      case 'water':
        this.world.paintCircle(worldX, worldY, radius, (idx) => {
          this.world.terrain[idx] = TERRAIN.WATER;
        });
        break;
      case 'hazard':
        this.world.paintCircle(worldX, worldY, radius, (idx) => {
          this.world.terrain[idx] = TERRAIN.HAZARD;
        });
        break;
      case 'erase':
        this.world.paintCircle(worldX, worldY, radius, (idx) => {
          this.world.terrain[idx] = TERRAIN.GROUND;
          this.world.food[idx] = 0;
          this.world.toFood[idx] = 0;
          this.world.toHome[idx] = 0;
          this.world.danger[idx] = 0;
        });
        break;
      case 'nest':
        this.world.setNest(worldX, worldY);
        break;
      default:
        break;
    }
  }

  clearWorld() {
    this.world.initializeTerrain();
    this.world.food.fill(0);
    this.world.toFood.fill(0);
    this.world.toHome.fill(0);
    this.world.danger.fill(0);
  }

  serialize(state) {
    return {
      seed: this.seed,
      world: this.world.serialize(),
      colony: this.colony.serialize(),
      tick: this.tick,
      state,
    };
  }

  loadFromSerialized(data) {
    this.seed = data.seed || this.seed;
    this.rng = new SeededRng(this.seed);
    this.world = World.fromSerialized(data.world);
    this.colony = Colony.fromSerialized(this.world, this.rng, data.colony);
    this.tick = data.tick || 0;
  }
}
