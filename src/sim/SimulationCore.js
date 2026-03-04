import { World, TERRAIN } from './world.js';
import { Colony } from './colony.js';
import { SeededRng } from './rng.js';
import { DigSystem } from './DigSystem.js';
import { FoodPellet, DEFAULT_PELLET_NUTRITION } from './Food.js';
import { MacroEngine } from './core/MacroEngine.js';
import { MicroPatchEngine } from './core/MicroPatchEngine.js';
import { TickScheduler } from './core/TickScheduler.js';

const SURFACE_DEPOSIT_RATIO = 0.7;

export class SimulationCore {
  /**
   * Creates simulation orchestrator and initializes world state.
   *
   * Called once at app startup and again indirectly via reset/load actions.
   * Owns world/colony engines and serialization boundaries.
   */
  constructor(seed = 'simant-default') {
    this.tick = 0;
    this.nestEntrances = [];
    this.foodPellets = [];
    this.nextPelletId = 1;
    this.reset(seed);
  }

  /**
   * Rebuilds deterministic world state from a seed.
   *
   * Used by startup and Reset control. Side effects: replaces world/colony,
   * resets tick counters, and repopulates initial entrances/food clusters.
   */
  reset(seed = 'simant-default') {
    this.seed = seed;
    this.rng = new SeededRng(this.seed);
    this.world = new World(256, 256);

    this.world.paintCircle(this.world.nestX + 70, this.world.nestY - 50, 14, (idx) => {
      this.world.terrain[idx] = TERRAIN.HAZARD;
    });

    this.world.setNest(this.world.nestX, this.world.nestY);
    this.colony = new Colony(this.world, this.rng, 320);
    this.colony.syncQueenPositionToNest(this.world.nestX, this.world.nestY);
    this.colony.onExcavate = (volume, worldX, depthY) => this.onExcavate(volume, worldX, depthY);
    this.colony.onDepositDirt = (volume, worldX, depthY) => this.onDepositDirt(volume, worldX, depthY);
    this.digSystem = new DigSystem(this.world, this.colony, this.rng);
    this.macroEngine = new MacroEngine(this.world);
    this.macroEngine.reset();
    this.#rebuildTickPipeline();

    this.nestEntrances = [
      {
        id: 'entrance-main',
        x: this.world.nestX,
        y: this.world.nestY,
        excavatedSoilTotal: 0,
        soilOnSurface: 0,
        radius: 2,
      },
    ];
    this.foodPellets = [];
    this.nextPelletId = 1;
    this.spawnFoodCluster(this.world.nestX + 45, this.world.nestY - 10, 12, 8);
    this.spawnFoodCluster(this.world.nestX - 60, this.world.nestY - 20, 14, 10);
    this.tick = 0;
  }

  /**
   * Advances one fixed simulation tick.
   *
   * Called by main loop and Step button; delegates to tick scheduler with
   * current config and shared mutable simulation arrays.
   */
  update(config) {
    this.tick += 1;
    this.tickScheduler.runTick({
      tick: this.tick,
      config,
      foodPellets: this.foodPellets,
      nestEntrances: this.nestEntrances,
    });
  }

  getPatchState(x, y) {
    return this.microEngine.getPatchState(x, y, this.foodPellets);
  }

  spawnFoodCluster(centerX, centerY, radius = 8, count = 8) {
    for (let i = 0; i < count; i += 1) {
      const theta = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(0, radius);
      const x = Math.max(0, Math.min(this.world.width - 1, Math.round(centerX + Math.cos(theta) * r)));
      const y = Math.max(0, Math.min(this.world.nestY, Math.round(centerY + Math.sin(theta) * r)));
      if (!this.world.inBounds(x, y)) continue;
      this.foodPellets.push(new FoodPellet(`pellet-${this.nextPelletId++}`, x, y, DEFAULT_PELLET_NUTRITION));
    }
  }

  addFoodToStore(amount) {
    this.colony.depositPellet(amount);
  }

  findAntById(antId) {
    return this.colony.ants.find((ant) => ant.id === antId) || null;
  }

  findAntNear(x, y, maxDistance = 2) {
    let nearest = null;
    let bestDistance = maxDistance;
    for (const ant of this.colony.ants) {
      const d = Math.hypot(ant.x - x, ant.y - y);
      if (d <= bestDistance) {
        bestDistance = d;
        nearest = ant;
      }
    }
    return nearest;
  }

  toggleAutoDig() {
    return this.digSystem.toggleAutoDig();
  }

  forceChamberAtDigFront(config) {
    return this.digSystem.forceChamberAtActiveFront(config);
  }

  onExcavate(volume, worldX, _depthY) {
    const entrance = this.#nearestEntrance(worldX);
    if (!entrance) return;
    entrance.excavatedSoilTotal += volume;
  }

  onDepositDirt(volume, worldX, _depthY) {
    const entrance = this.#nearestEntrance(worldX);
    if (!entrance) return;
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

  /**
   * Applies editor tool effects to world state.
   *
   * Called by input paint handlers from both views. Side effects vary by tool
   * (terrain mutation, pellet mutation, dig-system rebuilds, queen reposition).
   */
  applyTool(tool, worldX, worldY, radius) {
    switch (tool) {
      case 'food':
        this.spawnFoodCluster(worldX, worldY, Math.max(2, radius * 2), Math.max(3, radius * 2));
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
        this.world.paintCircle(worldX, worldY, radius, (idx, x, y) => {
          this.world.terrain[idx] = TERRAIN.GROUND;
          this.world.food[idx] = 0;
          this.world.toFood[idx] = 0;
          this.world.toHome[idx] = 0;
          this.world.danger[idx] = 0;
          this.foodPellets = this.foodPellets.filter((pellet) => !(pellet.x === x && pellet.y === y));
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
            radius: 2,
          });
        } else {
          this.nestEntrances[0].x = worldX;
          this.nestEntrances[0].y = worldY;
          this.nestEntrances[0].radius = this.nestEntrances[0].radius || 2;
        }
        this.colony.syncQueenPositionToNest(worldX, worldY);
        this.digSystem = new DigSystem(this.world, this.colony, this.rng);
        this.#syncMacroHomeTerritory();
        this.#rebuildTickPipeline();
        break;
      default:
        break;
    }
  }

  clearWorld() {
    this.world.initializeTerrain();
    this.digSystem = new DigSystem(this.world, this.colony, this.rng);
    this.#syncMacroHomeTerritory();
    this.#rebuildTickPipeline();
    this.world.food.fill(0);
    this.world.nestFood.fill(0);
    this.world.toFood.fill(0);
    this.world.toHome.fill(0);
    this.world.danger.fill(0);
    this.colony.nestFoodPellets = [];
    this.foodPellets = [];
  }

  /**
   * Serializes full sim runtime snapshot for save/load.
   */
  serialize(state) {
    return {
      seed: this.seed,
      world: this.world.serialize(),
      colony: this.colony.serialize(),
      tick: this.tick,
      nestEntrances: this.nestEntrances,
      foodPellets: this.foodPellets,
      nextPelletId: this.nextPelletId,
      digSystem: this.digSystem.serialize(),
      macro: this.macroEngine.serialize(),
      state,
    };
  }

  /**
   * Restores simulation from serialized snapshot.
   *
   * Assumes input schema matches serialize() output. Rebuilds engines to keep
   * scheduler dependencies synced to restored world and colony instances.
   */
  loadFromSerialized(data) {
    this.seed = data.seed || this.seed;
    this.rng = new SeededRng(this.seed);
    this.world = World.fromSerialized(data.world);
    this.colony = Colony.fromSerialized(this.world, this.rng, data.colony);
    this.colony.onExcavate = (volume, worldX, depthY) => this.onExcavate(volume, worldX, depthY);
    this.colony.onDepositDirt = (volume, worldX, depthY) => this.onDepositDirt(volume, worldX, depthY);
    this.digSystem = new DigSystem(this.world, this.colony, this.rng);
    this.digSystem.loadFromSerialized(data.digSystem);
    this.macroEngine = new MacroEngine(this.world);
    this.macroEngine.loadFromSerialized(data.macro);
    this.#syncMacroHomeTerritory();
    this.#rebuildTickPipeline();
    this.tick = data.tick || 0;
    this.foodPellets = Array.isArray(data.foodPellets)
      ? data.foodPellets.map((pellet) => new FoodPellet(pellet.id, pellet.x, pellet.y, pellet.nutrition))
      : [];
    this.nextPelletId = data.nextPelletId || 1;

    if (Array.isArray(data.nestEntrances) && data.nestEntrances.length > 0) {
      this.nestEntrances = data.nestEntrances.map((entry, index) => ({
        id: entry.id || `entrance-${index}`,
        x: entry.x,
        y: entry.y,
        excavatedSoilTotal: entry.excavatedSoilTotal || 0,
        soilOnSurface: entry.soilOnSurface || 0,
        radius: entry.radius || 2,
      }));
    } else {
      this.nestEntrances = [
        {
          id: 'entrance-main',
          x: this.world.nestX,
          y: this.world.nestY,
          excavatedSoilTotal: 0,
          soilOnSurface: 0,
          radius: 2,
        },
      ];
    }
  }

  #syncMacroHomeTerritory() {
    this.macroEngine.syncHomeTerritory(this.world.nestX, this.world.nestY);
  }

  #rebuildTickPipeline() {
    this.microEngine = new MicroPatchEngine(this.world, this.colony, this.digSystem);
    this.tickScheduler = new TickScheduler({ macroEngine: this.macroEngine, microEngine: this.microEngine });
  }
}
