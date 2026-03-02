import { World, TERRAIN } from './world.js';
import { Colony } from './colony.js';
import { SeededRng } from './rng.js';
import { DigSystem } from './DigSystem.js';

const SURFACE_DEPOSIT_RATIO = 0.7;

export class SimulationCore {
  constructor(seed = 'simant-default') {
    this.tick = 0;
    this.nestEntrances = [];
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
    this.digSystem = new DigSystem(this.world, this.rng);
    this.colony.onExcavate = (volume, worldX, depthY) => this.onExcavate(volume, worldX, depthY);
    this.nestEntrances = [
      {
        id: 'entrance-main',
        x: this.world.nestX,
        y: this.world.nestY,
        excavatedSoilTotal: 0,
        soilOnSurface: 0,
      },
    ];
    this.tick = 0;
  }

  update(config) {
    this.tick += 1;
    this.colony.update(config);
    this.digSystem.update(this.colony);
    if (this.tick % config.pheromoneUpdateTicks === 0) {
      this.world.diffuseAndEvaporate(config.diffusionRate, config.evaporationRate, true);
    }
  }

  onExcavate(volume, worldX, _depthY) {
    const entrance = this.#nearestEntrance(worldX);
    if (!entrance) return;
    entrance.excavatedSoilTotal += volume;
    entrance.soilOnSurface += volume * SURFACE_DEPOSIT_RATIO;
  }

  #nearestEntrance(worldX) {
    if (this.nestEntrances.length === 0) return null;
    let nearest = this.nestEntrances[0];
    let bestDistance = Math.abs(worldX - nearest.x);

    for (let i = 1; i < this.nestEntrances.length; i += 1) {
      const candidate = this.nestEntrances[i];
      const distance = Math.abs(worldX - candidate.x);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = candidate;
      }
    }

    return nearest;
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
      case 'carve':
        this.world.paintCircle(worldX, worldY, Math.max(1, radius), (idx, x, y) => {
          if (y > this.world.nestY && this.world.terrain[idx] === TERRAIN.SOIL) {
            this.world.terrain[idx] = TERRAIN.TUNNEL;
            this.colony.recordExcavation(1, x, y);
          }
        });
        break;
      case 'nest':
        this.world.setNest(worldX, worldY);
        if (this.nestEntrances.length === 0) {
          this.nestEntrances.push({
            id: 'entrance-main',
            x: worldX,
            y: worldY,
            excavatedSoilTotal: 0,
            soilOnSurface: 0,
          });
        } else {
          this.nestEntrances[0].x = worldX;
          this.nestEntrances[0].y = worldY;
        }
        break;
      default:
        break;
    }
  }


  toggleAutoDig() {
    return this.digSystem.toggleAutoDig();
  }

  forceChamber() {
    return this.digSystem.forceChamber();
  }

  clearWorld() {
    this.world.initializeTerrain();
    this.world.food.fill(0);
    this.world.toFood.fill(0);
    this.world.toHome.fill(0);
    this.world.danger.fill(0);
    this.digSystem.setWorld(this.world, this.rng);
  }

  serialize(state) {
    return {
      seed: this.seed,
      world: this.world.serialize(),
      colony: this.colony.serialize(),
      tick: this.tick,
      nestEntrances: this.nestEntrances,
      digSystem: { autoDig: this.digSystem.autoDig },
      state,
    };
  }

  loadFromSerialized(data) {
    this.seed = data.seed || this.seed;
    this.rng = new SeededRng(this.seed);
    this.world = World.fromSerialized(data.world);
    this.colony = Colony.fromSerialized(this.world, this.rng, data.colony);
    this.digSystem = new DigSystem(this.world, this.rng);
    this.colony.onExcavate = (volume, worldX, depthY) => this.onExcavate(volume, worldX, depthY);
    this.tick = data.tick || 0;

    if (data.digSystem) {
      this.digSystem.autoDig = !!data.digSystem.autoDig;
    }

    if (Array.isArray(data.nestEntrances) && data.nestEntrances.length > 0) {
      this.nestEntrances = data.nestEntrances.map((entry, index) => ({
        id: entry.id || `entrance-${index}`,
        x: entry.x,
        y: entry.y,
        excavatedSoilTotal: entry.excavatedSoilTotal || 0,
        soilOnSurface: entry.soilOnSurface || 0,
      }));
    } else {
      this.nestEntrances = [
        {
          id: 'entrance-main',
          x: this.world.nestX,
          y: this.world.nestY,
          excavatedSoilTotal: 0,
          soilOnSurface: 0,
        },
      ];
    }
  }
}
