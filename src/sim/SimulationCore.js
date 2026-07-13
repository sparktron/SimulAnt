/*
    Simulation orchestrator: owns all mutable state and tick pipeline.

    Responsibilities:
    - Maintains world (terrain, pheromones), colony (ants, queen), and food pellets
    - Seeds deterministic RNG from user-provided seed string
    - Orchestrates tick pipeline: macro → micro → food respawn → stats collection
    - Exposes serialization (save/load) and reset (new seed/reload)
    - Handles food cluster spawning and initial surface-level obstacles

    Tick flow (runTick):
    1. TickScheduler: calls macro → micro engines in order (deterministic)
    2. FoodEconomySystem: respawns food pellets if shortage detected
    3. ColonyStats: collects telemetry for HUD/monitoring
    4. Tick counter increments

    Save/load contract:
    - serialize() captures world/colony/dig state as JSON-safe objects
    - fromSerialized() reconstructs from JSON without re-running initialization
    - Determinism: same seed + same config always produces same tick sequence
*/

import { World, TERRAIN } from './world.js';
import { Colony } from './colony.js';
import { SeededRng } from './rng.js';
import { DigSystem } from './DigSystem.js';
import { FoodPellet, DEFAULT_PELLET_NUTRITION } from './Food.js';
import { MacroEngine } from './core/MacroEngine.js';
import { MicroPatchEngine } from './core/MicroPatchEngine.js';
import { TickScheduler } from './core/TickScheduler.js';
import { ColonyStats } from './ColonyStats.js';
import { FoodEconomySystem } from './systems/FoodEconomySystem.js';

const SURFACE_DEPOSIT_RATIO = 0.7;

// Save-format schema version. Bump when serialize()'s shape changes in a way
// that needs migration on load. Saves written before versioning existed have no
// schemaVersion field and are treated as version 0 (legacy). Every supported
// historical version has a named step in SAVE_MIGRATIONS below.
export const SAVE_SCHEMA_VERSION = 3;

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
    // Fresh stats buffer: without this, a Reset keeps the previous run's
    // samples (tick numbers restart at 0, so downloaded logs interleave two
    // runs) and peakPopulation carries over.
    this.stats = new ColonyStats();
    this.world = new World(256, 256);

    const wallCount = 6 + Math.floor(this.rng.next() * 5);
    const margin = 10;
    const nestClearRadius = 30;
    for (let i = 0; i < wallCount; i++) {
      let wx, wy, attempts = 0;
      do {
        wx = margin + Math.floor(this.rng.next() * (this.world.width - margin * 2));
        wy = margin + Math.floor(this.rng.next() * (this.world.nestY - margin));
        attempts++;
      } while (
        attempts < 20 &&
        Math.hypot(wx - this.world.nestX, wy - this.world.nestY) < nestClearRadius
      );
      const r = 2 + Math.floor(this.rng.next() * 3);
      this.world.paintCircle(wx, wy, r, (idx) => {
        this.world.setTerrain(idx, TERRAIN.WALL);
      });
    }

    this.world.setNest(this.world.nestX, this.world.nestY);
    this.colony = new Colony(this.world, this.rng, 40);
    this.colony.syncQueenPositionToNest(this.world.nestX, this.world.nestY);
    this.colony.onExcavate = (volume, worldX, depthY) => this.onExcavate(volume, worldX, depthY);
    this.colony.onDepositDirt = (volume, worldX, depthY) => this.onDepositDirt(volume, worldX, depthY);
    this.#rebuildDigSystem();
    this.macroEngine = new MacroEngine(this.world);
    this.macroEngine.reset();
    // Two concentrated boot clusters (radius 8, 195 pellets each = 390 total).
    const BOOT_PELLETS = 195;
    const BOOT_RADIUS = 8;
    this.bootFoodTotal = BOOT_PELLETS * 2;
    this.foodEconomySystem = new FoodEconomySystem({
      world: this.world,
      colony: this.colony,
      rng: this.rng,
      spawnFoodCluster: (...args) => this.spawnFoodCluster(...args),
      bootFoodTotal: this.bootFoodTotal,
    });
    this.#rebuildTickPipeline();

    this.nestEntrances = [
      {
        id: 'entrance-main',
        x: this.world.nestX,
        y: this.world.entranceY,
        excavatedSoilTotal: 0,
        soilOnSurface: 0,
        radius: 2,
      },
    ];
    this.foodPellets = [];
    this.nextPelletId = 1;
    this.spawnFoodCluster(this.world.nestX, Math.floor(this.world.nestY / 2), BOOT_RADIUS, BOOT_PELLETS);
    this.spawnFoodCluster(this.world.nestX - 70, this.world.nestY - 25, BOOT_RADIUS, BOOT_PELLETS);
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

    this.foodEconomySystem.update({
      tick: this.tick,
      foodPellets: this.foodPellets,
      config,
    });

    // Record stats every 30 ticks (~1 sim second). Passing the world lets
    // the snapshot include pheromone stats; otherwise the recorder still
    // works but pher fields are zero.
    if (this.tick % 30 === 0) {
      this.stats.record(this.tick, this.colony, this.world);
    }
  }

  getPatchState(x, y) {
    return this.microEngine.getPatchState(x, y, this.foodPellets);
  }

  spawnFoodCluster(centerX, centerY, radius = 8, count = 8) {
    for (let i = 0; i < count; i += 1) {
      const theta = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(0, radius);
      const x = Math.max(0, Math.min(this.world.width - 1, Math.round(centerX + Math.cos(theta) * r)));
      // Clamp strictly above the horizon row (y < nestY) so pellets can only
      // land in the surface band. Surface owns y <= nestY for rendering but
      // ants transiting the boundary row shouldn't stand on pellets that
      // also conceptually live in the nest's horizon strip.
      const y = Math.max(0, Math.min(this.world.nestY - 1, Math.round(centerY + Math.sin(theta) * r)));
      if (!this.world.inBounds(x, y)) continue;
      const idx = this.world.index(x, y);
      if (this.world.terrain[idx] === TERRAIN.WALL) continue;
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
    // Backward compatibility:
    // - single-entrance mode historically surfaced excavated soil directly,
    // - multi-entrance mode tracks excavation totals only until dirt is deposited.
    if (this.nestEntrances.length <= 1) {
      entrance.soilOnSurface += volume * SURFACE_DEPOSIT_RATIO;
    }
  }

  onDepositDirt(volume, worldX, _depthY) {
    const entrance = this.#nearestEntrance(worldX);
    if (!entrance) return;
    entrance.soilOnSurface += volume * SURFACE_DEPOSIT_RATIO;
  }

  /**
   * Registers a new nest entrance when an upward shaft breaches the surface.
   *
   * Called by DigSystem.onNewEntrance callback. Adds the entrance to the
   * shared nestEntrances array so colony pheromone painting and ant
   * navigation immediately recognize the new opening.
   */
  #registerNewEntrance(x, y) {
    const id = `entrance-${this.nestEntrances.length}`;
    this.nestEntrances.push({
      id,
      x,
      y,
      excavatedSoilTotal: 0,
      soilOnSurface: 0,
      radius: 2,
    });
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
      case 'food': {
        // Scale radius by 0.5 for food placement
        const scaledRadius = radius * 0.5;
        this.spawnFoodCluster(worldX, worldY, Math.max(2, scaledRadius * 2), Math.max(3, scaledRadius * 2));
        break;
      }
      case 'wall': {
        // Scale radius by 0.5 for terrain painting
        const scaledRadius = radius * 0.5;
        this.world.paintCircle(worldX, worldY, scaledRadius, (idx) => {
          this.world.setTerrain(idx, TERRAIN.WALL);
        });
        break;
      }
      case 'water': {
        // Scale radius by 0.5 for terrain painting
        const scaledRadius = radius * 0.5;
        this.world.paintCircle(worldX, worldY, scaledRadius, (idx) => {
          this.world.setTerrain(idx, TERRAIN.WATER);
        });
        break;
      }
      case 'hazard': {
        // Scale radius by 0.5 for terrain painting
        const scaledRadius = radius * 0.5;
        this.world.paintCircle(worldX, worldY, scaledRadius, (idx) => {
          this.world.setTerrain(idx, TERRAIN.HAZARD);
        });
        break;
      }
      case 'erase': {
        // Use full radius for erasing to be effective
        const erasedCells = new Set();
        this.world.paintCircle(worldX, worldY, radius, (idx, x, y) => {
          this.world.setTerrain(idx, TERRAIN.GROUND);
          this.world.food[idx] = 0;
          this.world.toFood[idx] = 0;
          this.world.toHome[idx] = 0;
          this.world.danger[idx] = 0;
          erasedCells.add(`${x},${y}`);
        });
        this.world.markFieldsDirty();
        this.foodPellets = this.foodPellets.filter((pellet) => !erasedCells.has(`${pellet.x},${pellet.y}`));
        break;
      }
      case 'dig':
        // Carve TUNNEL terrain in the underground area (y > nestY).
        // Use full radius for effective digging (don't scale down).
        // Lets the user sculpt the colony layout from the nest view.
        this.world.paintCircle(worldX, worldY, radius, (idx, _x, y) => {
          if (y > this.world.nestY && this.world.terrain[idx] === TERRAIN.SOIL) {
            this.world.setTerrain(idx, TERRAIN.TUNNEL);
          }
        });
        this.world.markFieldsDirty();
        break;
      case 'fill':
        // Seal TUNNEL/CHAMBER terrain back to SOIL in the underground area.
        // Use full radius for effective filling (don't scale down).
        // Also clears pheromones from sealed cells so ants stop navigating there.
        this.world.paintCircle(worldX, worldY, radius, (idx, _x, y) => {
          if (y > this.world.nestY) {
            const t = this.world.terrain[idx];
            if (t === TERRAIN.TUNNEL || t === TERRAIN.CHAMBER) {
              this.world.setTerrain(idx, TERRAIN.SOIL);
              this.world.toHome[idx] = 0;
              this.world.toFood[idx] = 0;
              this.world.danger[idx] = 0;
            }
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
            radius: 2,
          });
        } else {
          this.nestEntrances[0].x = worldX;
          this.nestEntrances[0].y = worldY;
          this.nestEntrances[0].radius = this.nestEntrances[0].radius || 2;
        }
        this.colony.syncQueenPositionToNest(worldX, worldY);
        this.#rebuildDigSystem();
        this.#syncMacroHomeTerritory();
        this.#rebuildTickPipeline();
        break;
      default:
        break;
    }
  }

  clearWorld() {
    this.world.initializeTerrain();
    this.#rebuildDigSystem();
    this.#syncMacroHomeTerritory();
    this.#rebuildTickPipeline();
    this.world.food.fill(0);
    this.world.nestFood.fill(0);
    this.world.toFood.fill(0);
    this.world.toHome.fill(0);
    this.world.danger.fill(0);
    this.colony.nestFoodPellets = [];
    this.colony._nestFoodTiles.clear();
    this.foodPellets = [];
  }

  /**
   * Serializes full sim runtime snapshot for save/load.
   */
  serialize(state) {
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      seed: this.seed,
      rng: this.rng.snapshot(),
      world: this.world.serialize(),
      colony: this.colony.serialize(),
      tick: this.tick,
      nestEntrances: this.nestEntrances,
      foodPellets: this.foodPellets,
      nextPelletId: this.nextPelletId,
      digSystem: this.digSystem.serialize(),
      macro: this.macroEngine.serialize(),
      stats: this.stats.serialize(),
      bootFoodTotal: this.bootFoodTotal,
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
    // Saves predating versioning lack schemaVersion → treat as legacy (0). A
    // newer-than-supported version is loaded best-effort but flagged so
    // corruption/forward-compat issues are diagnosable instead of silent.
    const detectedVersion = Number.isInteger(data?.schemaVersion) ? data.schemaVersion : 0;
    if (detectedVersion > SAVE_SCHEMA_VERSION) {
      console.warn(
        `[SimAnt] Save schemaVersion ${detectedVersion} is newer than this build supports `
        + `(${SAVE_SCHEMA_VERSION}). Loading best-effort; some saved state may be ignored.`,
      );
    }

    const restoredData = detectedVersion < SAVE_SCHEMA_VERSION
      ? migrateSaveData(data, detectedVersion)
      : data;

    // Validate the structural requirements before replacing any live state. A
    // malformed localStorage entry must leave the running simulation intact,
    // rather than partially rebuilding it and then throwing midway through
    // World/Colony restoration.
    this.#assertValidSerializedSnapshot(restoredData);
    this.loadedSchemaVersion = detectedVersion;
    this.migratedSchemaVersion = restoredData.schemaVersion;
    data = restoredData;

    this.seed = data.seed || this.seed;
    this.rng = new SeededRng(this.seed);
    this.world = World.fromSerialized(data.world);
    this.colony = Colony.fromSerialized(this.world, this.rng, data.colony);
    this.colony.onExcavate = (volume, worldX, depthY) => this.onExcavate(volume, worldX, depthY);
    this.colony.onDepositDirt = (volume, worldX, depthY) => this.onDepositDirt(volume, worldX, depthY);
    this.#rebuildDigSystem();
    this.digSystem.loadFromSerialized(data.digSystem);
    this.macroEngine = new MacroEngine(this.world);
    this.macroEngine.loadFromSerialized(data.macro);
    this.bootFoodTotal = data.bootFoodTotal || 390;
    this.foodEconomySystem = new FoodEconomySystem({
      world: this.world,
      colony: this.colony,
      rng: this.rng,
      spawnFoodCluster: (...args) => this.spawnFoodCluster(...args),
      bootFoodTotal: this.bootFoodTotal,
    });
    this.stats = new ColonyStats();
    this.stats.loadFromSerialized(data.stats);
    this.#syncMacroHomeTerritory();
    this.#rebuildTickPipeline();
    this.tick = data.tick || 0;
    this.foodPellets = Array.isArray(data.foodPellets)
      ? data.foodPellets
        .filter((pellet) => pellet
          && this.world.inBounds(pellet.x, pellet.y)
          && Number.isFinite(pellet.nutrition))
        .map((pellet) => {
          const restored = new FoodPellet(pellet.id, pellet.x, pellet.y, pellet.nutrition);
          restored.takenByAntId = typeof pellet.takenByAntId === 'string' ? pellet.takenByAntId : null;
          return restored;
        })
      : [];
    this.nextPelletId = data.nextPelletId || 1;

    const restoredEntrances = Array.isArray(data.nestEntrances)
      ? data.nestEntrances
        .filter((entry) => entry && this.world.inBounds(entry.x, entry.y))
        .map((entry, index) => ({
          id: entry.id || `entrance-${index}`,
          x: entry.x,
          y: entry.y,
          excavatedSoilTotal: entry.excavatedSoilTotal || 0,
          soilOnSurface: entry.soilOnSurface || 0,
          radius: entry.radius || 2,
        }))
      : [];
    if (restoredEntrances.length > 0) {
      this.nestEntrances = restoredEntrances;
    } else {
      this.nestEntrances = [
        {
          id: 'entrance-main',
          x: this.world.nestX,
          y: this.world.entranceY,
          excavatedSoilTotal: 0,
          soilOnSurface: 0,
          radius: 2,
        },
      ];
    }

    // Restore the RNG cursor LAST: reconstructing the colony/ants above draws
    // from this.rng (Ant ctor consumes several draws each), so restoring any
    // earlier would be clobbered. Old saves lack data.rng and keep the legacy
    // seed-only behavior (sequence restarts), which is harmless and backward
    // compatible.
    if (data.rng) this.rng.restore(data.rng);
  }

  #syncMacroHomeTerritory() {
    this.macroEngine.syncHomeTerritory(this.world.nestX, this.world.nestY);
  }

  #assertValidSerializedSnapshot(data) {
    if (!isRecord(data)) {
      throw new TypeError('[SimAnt] Saved game must be an object.');
    }
    if (!isRecord(data.world) || !isRecord(data.colony)) {
      throw new TypeError('[SimAnt] Saved game is missing world or colony state.');
    }

    const { world } = data;
    const expectedWidth = this.world.width;
    const expectedHeight = this.world.height;
    const expectedSize = this.world.size;
    if (world.width !== expectedWidth || world.height !== expectedHeight) {
      throw new RangeError(
        `[SimAnt] Saved world dimensions must be ${expectedWidth}×${expectedHeight}.`,
      );
    }

    if (!Number.isInteger(world.nestX) || !Number.isInteger(world.nestY)
      || world.nestX < 0 || world.nestX >= expectedWidth
      || world.nestY < 0 || world.nestY >= expectedHeight
      || (world.entranceY !== undefined && (!Number.isInteger(world.entranceY)
        || world.entranceY < 0 || world.entranceY >= expectedHeight))
      || (world.nestRadius !== undefined
        && (!Number.isFinite(world.nestRadius) || world.nestRadius <= 0))) {
      throw new TypeError('[SimAnt] Saved world has invalid nest coordinates.');
    }

    for (const field of ['terrain', 'food', 'toFood', 'toHome', 'danger']) {
      if (!isGridArray(world[field], expectedSize)) {
        throw new TypeError(`[SimAnt] Saved world field "${field}" has an invalid length.`);
      }
    }
    if (world.nestFood !== undefined && !isGridArray(world.nestFood, expectedSize)) {
      throw new TypeError('[SimAnt] Saved world field "nestFood" has an invalid length.');
    }
    if (!Array.isArray(data.colony.ants) || !data.colony.ants.every((ant) => isRecord(ant)
      && Number.isInteger(ant.x) && Number.isInteger(ant.y)
      && ant.x >= 0 && ant.x < expectedWidth
      && ant.y >= 0 && ant.y < expectedHeight)) {
      throw new TypeError('[SimAnt] Saved colony has an invalid ant list.');
    }
  }

  // Single source of truth for dig-system construction + wiring. Every rebuild
  // path (reset, nest tool, clearWorld, load) must route through here so the
  // onNewEntrance callback can never drift out of sync again — historically the
  // nest tool and clearWorld recreated the dig system without re-attaching it,
  // silently dropping entrance registration after those actions.
  #rebuildDigSystem() {
    this.digSystem = new DigSystem(this.world, this.colony, this.rng);
    this.digSystem.onNewEntrance = (x, y) => this.#registerNewEntrance(x, y);
  }

  #rebuildTickPipeline() {
    this.microEngine = new MicroPatchEngine(this.world, this.colony, this.digSystem);
    this.tickScheduler = new TickScheduler({ macroEngine: this.macroEngine, microEngine: this.microEngine });
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGridArray(value, length) {
  return (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length === length;
}

const SAVE_MIGRATIONS = {
  0: migrateV0ToV1,
  1: migrateV1ToV2,
  2: migrateV2ToV3,
};

function migrateSaveData(data, version) {
  let migrated = data;
  for (let fromVersion = version; fromVersion < SAVE_SCHEMA_VERSION; fromVersion += 1) {
    const migrate = SAVE_MIGRATIONS[fromVersion];
    if (!migrate) {
      throw new Error(`[SimAnt] No migration is defined for save schema ${fromVersion}.`);
    }
    migrated = migrate(migrated);
  }
  return migrated;
}

function migrateV0ToV1(data) {
  return isRecord(data) ? { ...data, schemaVersion: 1 } : data;
}

function migrateV1ToV2(data) {
  if (!isRecord(data)) return data;
  const state = isRecord(data.state) ? { ...data.state } : data.state;
  if (isRecord(state)) delete state.casteTargets;
  return { ...data, schemaVersion: 2, state };
}

function migrateV2ToV3(data) {
  if (!isRecord(data) || !isRecord(data.colony)) {
    return isRecord(data) ? { ...data, schemaVersion: 3 } : data;
  }
  const colony = { ...data.colony };
  const pelletTotal = Array.isArray(colony.nestFoodPellets)
    ? colony.nestFoodPellets.reduce((sum, pellet) => {
      const amount = Number.isFinite(pellet?.amount)
        ? pellet.amount
        : (Number.isFinite(pellet?.nutrition) ? pellet.nutrition : 0);
      return sum + amount;
    }, 0)
    : 0;
  const foodStored = Number.isFinite(colony.foodStored) ? colony.foodStored : 0;
  const virtualFoodStored = Number.isFinite(colony.virtualFoodStored) ? colony.virtualFoodStored : 0;
  colony.foodLedgerAdjustment = foodStored - virtualFoodStored - pelletTotal;
  return { ...data, schemaVersion: 3, colony };
}
