import { Ant } from './ant.js';
import { TERRAIN } from './world.js';

const QUEEN_SPEED_RATIO = 0.1;
const BASE_TICK_SECONDS = 1 / 30;

export class Colony {
  constructor(world, rng, initialAnts = 300) {
    this.world = world;
    this.rng = rng;
    this.ants = [];
    this.foodStored = 0;
    this.foodStoreTarget = 200;
    this.births = initialAnts;
    this.deaths = 0;
    this.spawnCost = 12;
    this.surfaceFoodPellets = [];
    this.nestEntrances = [];
    this.nestFoodPellets = [];

    this.workAllocation = { forage: 55, dig: 20, nurse: 25 };
    this.casteAllocation = { workers: 70, soldiers: 25, breeders: 5 };

    this.queen = {
      alive: true,
      eggProgress: 0,
      eggsLaid: 0,
      brood: 0,
      hunger: 100,
      hungerMax: 100,
      health: 100,
      healthMax: 100,
      x: world.nestX,
      y: Math.min(world.height - 1, world.nestY + 6),
      moveProgress: 0,
    };

    this.excavatedTiles = 0;
    this.onExcavate = null;

    for (let i = 0; i < initialAnts; i += 1) {
      this.ants.push(this.#spawnNearNest('worker'));
    }

    this.syncQueenPositionToNest(world.nestX, world.nestY);
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
    this.#updateQueenSurvival(config);
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

    if (this.queen.alive) {
      this.#updateQueenPosition(config);
    }

    if (this.queen.alive) {
      while (this.foodStored >= this.spawnCost && this.ants.length < config.antCap) {
        this.foodStored -= this.spawnCost;
        this.queen.brood += 1;
      }

      while (this.queen.brood >= 1 && this.ants.length < config.antCap) {
        this.queen.brood -= 1;
        const role = this.selectHatchRole(config);
        this.ants.push(this.#spawnNearNest(role));
        this.births += 1;
      }
    }
  }


  setWorkAllocation(allocation = {}) {
    const forage = Number.isFinite(allocation.forage) ? allocation.forage : this.workAllocation.forage;
    const dig = Number.isFinite(allocation.dig) ? allocation.dig : this.workAllocation.dig;
    const nurse = Number.isFinite(allocation.nurse) ? allocation.nurse : this.workAllocation.nurse;
    const total = Math.max(1, forage + dig + nurse);
    this.workAllocation = {
      forage: Math.max(0, (forage / total) * 100),
      dig: Math.max(0, (dig / total) * 100),
      nurse: Math.max(0, (nurse / total) * 100),
    };
  }

  setCasteAllocation(allocation = {}) {
    const workers = Number.isFinite(allocation.workers) ? allocation.workers : this.casteAllocation.workers;
    const soldiers = Number.isFinite(allocation.soldiers) ? allocation.soldiers : this.casteAllocation.soldiers;
    const breeders = Number.isFinite(allocation.breeders) ? allocation.breeders : this.casteAllocation.breeders;
    const total = Math.max(1, workers + soldiers + breeders);
    this.casteAllocation = {
      workers: Math.max(0, (workers / total) * 100),
      soldiers: Math.max(0, (soldiers / total) * 100),
      breeders: Math.max(0, (breeders / total) * 100),
    };
  }

  chooseWorkFocus() {
    const roll = this.rng.range(0, 100);
    if (roll < this.workAllocation.forage) return 'forage';
    if (roll < this.workAllocation.forage + this.workAllocation.dig) return 'dig';
    return 'nurse';
  }

  selectHatchRole(config) {
    const workerSoldierTotal = Math.max(0.0001, this.casteAllocation.workers + this.casteAllocation.soldiers);
    const casteDrivenSoldierChance = this.casteAllocation.soldiers / workerSoldierTotal;
    const soldierChance = Number.isFinite(config.soldierSpawnChance)
      ? Math.max(0, Math.min(1, config.soldierSpawnChance))
      : casteDrivenSoldierChance;
    return this.rng.chance(soldierChance) ? 'soldier' : 'worker';
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

  #updateQueenSurvival(config) {
    if (!this.queen.alive) return;
    const dt = config.tickSeconds || 1 / 30;
    this.queen.hunger = Math.max(0, this.queen.hunger - config.queenHungerDrain * dt);

    if (this.queen.hunger < this.queen.hungerMax * 0.9) {
      const consumed = this.consumeFromStore(config.queenEatNutrition * dt);
      this.queen.hunger = Math.min(this.queen.hungerMax, this.queen.hunger + consumed);
    }

    if (this.queen.hunger <= 0) {
      this.queen.health = Math.max(0, this.queen.health - config.queenHealthDrainRate * dt);
      if (this.queen.health <= 0) {
        this.queen.alive = false;
      }
    }
  }

  #updateQueenPosition(config) {
    const target = this.#findQueenSafeTile();
    if (!target) return;

    const dt = config.tickSeconds || BASE_TICK_SECONDS;
    const normalizedStep = QUEEN_SPEED_RATIO * (dt / BASE_TICK_SECONDS);
    this.queen.moveProgress = Math.min(4, (this.queen.moveProgress || 0) + normalizedStep);

    while (this.queen.moveProgress >= 1) {
      const moved = this.#stepQueenToward(target.x, target.y);
      this.queen.moveProgress -= 1;
      if (!moved) break;
    }
  }

  #stepQueenToward(targetX, targetY) {
    let best = null;
    let bestDistance = Math.hypot(targetX - this.queen.x, targetY - this.queen.y);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = this.queen.x + dx;
        const ny = this.queen.y + dy;
        if (!this.world.isPassable(nx, ny)) continue;
        if (ny <= this.world.nestY) continue;

        const distance = Math.hypot(targetX - nx, targetY - ny);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x: nx, y: ny };
        }
      }
    }

    if (!best) return false;
    this.queen.x = best.x;
    this.queen.y = best.y;
    return true;
  }

  #findQueenSafeTile() {
    const lowerHalfStartY = this.#getLowerHalfStartY();
    let best = null;
    let bestDepth = Number.NEGATIVE_INFINITY;
    let bestOffset = Number.POSITIVE_INFINITY;

    for (let y = lowerHalfStartY; y < this.world.height; y += 1) {
      for (let x = 0; x < this.world.width; x += 1) {
        if (!this.world.isPassable(x, y)) continue;
        const depth = y;
        const offset = Math.abs(x - this.world.nestX);
        if (depth > bestDepth || (depth === bestDepth && offset < bestOffset)) {
          bestDepth = depth;
          bestOffset = offset;
          best = { x, y };
        }
      }
    }

    if (best) return best;

    return {
      x: Math.max(0, Math.min(this.world.width - 1, Math.round(this.world.nestX))),
      y: Math.max(this.world.nestY + 1, Math.min(this.world.height - 1, Math.round(this.world.nestY + 6))),
    };
  }

  #getLowerHalfStartY() {
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let y = this.world.nestY + 1; y < this.world.height; y += 1) {
      for (let x = 0; x < this.world.width; x += 1) {
        if (!this.world.isPassable(x, y)) continue;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return Math.max(this.world.nestY + 1, Math.min(this.world.height - 1, this.world.nestY + 6));
    }

    return Math.max(
      this.world.nestY + 1,
      Math.min(this.world.height - 1, minY + Math.floor((maxY - minY + 1) / 2)),
    );
  }

  consumeFromStore(amount) {
    if (amount <= 0 || this.foodStored <= 0) return 0;
    const consumed = Math.min(amount, this.foodStored);
    this.foodStored -= consumed;
    this.#consumeNestFoodPellets(consumed);
    return consumed;
  }

  depositPellet(nutrition, x, y, entrance = null) {
    if (nutrition <= 0) return 0;
    const before = this.nestFoodPellets.length;
    const point = this.getNestFoodDropPoint(entrance);
    const pelletX = Number.isFinite(x) ? x : point.x;
    const pelletY = Number.isFinite(y) ? y : point.y;
    this.foodStored += nutrition;
    this.nestFoodPellets.push({
      x: pelletX,
      y: pelletY,
      amount: nutrition,
    });
    this.#applyNestCellFoodDelta(nutrition, pelletX, pelletY);
    if (this.nestFoodPellets.length !== before) {
      console.log('[nest-food] nestFoodPellets.length changed:', this.nestFoodPellets.length);
    }
    return nutrition;
  }

  getNestFoodDropPoint(entrance = null) {
    const storageCenterX = entrance ? entrance.x : this.world.nestX;
    const storageCenterY = Math.max(this.world.nestY + 2, entrance ? entrance.y + 3 : this.world.nestY + 3);

    if (!entrance) {
      return {
        x: Math.max(0, Math.min(this.world.width - 1, Math.round(storageCenterX))),
        y: Math.max(this.world.nestY + 1, Math.min(this.world.height - 1, Math.round(storageCenterY))),
      };
    }

    const maxAttempts = 24;
    for (let i = 0; i < maxAttempts; i += 1) {
      const dx = this.rng.int(9) - 4;
      const dy = this.rng.int(7) - 1;
      const x = Math.max(0, Math.min(this.world.width - 1, Math.round(storageCenterX + dx)));
      const y = Math.max(this.world.nestY + 1, Math.min(this.world.height - 1, Math.round(storageCenterY + dy)));
      const terrain = this.world.terrain[this.world.index(x, y)];
      if (terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER) {
        return { x, y };
      }
    }

    return {
      x: Math.max(0, Math.min(this.world.width - 1, Math.round(storageCenterX))),
      y: Math.max(this.world.nestY + 1, Math.min(this.world.height - 1, Math.round(storageCenterY))),
    };
  }

  depositFoodFromAnt(ant, entrance = null) {
    if (!ant?.carrying || ant.carrying.type !== 'food') return false;

    const nutrition = ant.carrying.pelletNutrition || 0;
    const dropPoint = this.getNestFoodDropPoint(entrance);

    this.depositPellet(nutrition, dropPoint.x, dropPoint.y, entrance);
    ant.carrying = null;
    ant.carryingType = 'none';
    ant.baseColor = ant.originalBaseColor || ant.baseColor;
    ant.state = 'FORAGE_SEARCH';
    ant.hunger = Math.min(ant.hungerMax, ant.hunger + nutrition * 0.15);

    if (this.world.isPassable(dropPoint.x, dropPoint.y)) {
      ant.x = dropPoint.x;
      ant.y = dropPoint.y;
    }

    console.log(`[ant] ${ant.id} deposited food at nest entrance (${entrance?.x ?? this.world.nestX}, ${entrance?.y ?? this.world.nestY})`);
    return true;
  }

  #applyNestCellFoodDelta(delta, x, y) {
    const dropPoint = this.getNestFoodDropPoint();
    const tx = Number.isFinite(x) ? Math.round(x) : dropPoint.x;
    const ty = Number.isFinite(y) ? Math.round(y) : dropPoint.y;
    const clampedX = Math.max(0, Math.min(this.world.width - 1, tx));
    const clampedY = Math.max(this.world.nestY + 1, Math.min(this.world.height - 1, ty));
    const idx = this.world.index(clampedX, clampedY);
    this.world.nestFood[idx] = Math.max(0, this.world.nestFood[idx] + delta);
  }

  #consumeNestFoodPellets(amount) {
    if (amount <= 0 || this.nestFoodPellets.length === 0) return;
    const before = this.nestFoodPellets.length;
    let remaining = amount;

    for (let i = this.nestFoodPellets.length - 1; i >= 0 && remaining > 0; i -= 1) {
      const pellet = this.nestFoodPellets[i];
      const consumed = Math.min(remaining, pellet.amount);
      pellet.amount -= consumed;
      remaining -= consumed;
      this.#applyNestCellFoodDelta(-consumed, pellet.x, pellet.y);
      if (pellet.amount <= 0.0001) this.nestFoodPellets.splice(i, 1);
    }

    if (this.nestFoodPellets.length !== before) {
      console.log('[nest-food] nestFoodPellets.length changed:', this.nestFoodPellets.length);
    }
  }


  storeFood(amount) {
    this.depositPellet(amount);
  }
  setSurfaceFoodPellets(pellets) {
    this.surfaceFoodPellets = pellets;
  }

  setNestEntrances(nestEntrances) {
    this.nestEntrances = nestEntrances;
  }

  syncQueenPositionToNest(nestX = this.world.nestX, nestY = this.world.nestY) {
    const safeTile = this.#findQueenSafeTile();
    this.queen.x = Math.max(0, Math.min(this.world.width - 1, Math.round(safeTile?.x ?? nestX)));
    this.queen.y = Math.max(
      this.world.nestY + 1,
      Math.min(this.world.height - 1, Math.round(safeTile?.y ?? (nestY + 6))),
    );
    this.queen.moveProgress = 0;
  }

  nearestEntrance(x, y) {
    if (this.nestEntrances.length === 0) return null;
    let nearest = this.nestEntrances[0];
    let best = Math.hypot(nearest.x - x, nearest.y - y);
    for (let i = 1; i < this.nestEntrances.length; i += 1) {
      const entry = this.nestEntrances[i];
      const d = Math.hypot(entry.x - x, entry.y - y);
      if (d < best) {
        best = d;
        nearest = entry;
      }
    }
    return nearest;
  }

  findVisiblePellet(x, y, radius = 6) {
    const r2 = radius * radius;
    let best = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.surfaceFoodPellets.length; i += 1) {
      const pellet = this.surfaceFoodPellets[i];
      if (pellet.takenByAntId != null) continue;
      const dx = pellet.x - x;
      const dy = pellet.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 >= bestD2) continue;
      bestD2 = d2;
      best = pellet;
    }
    return best;
  }

  findAvailablePelletAt(x, y) {
    for (let i = 0; i < this.surfaceFoodPellets.length; i += 1) {
      const pellet = this.surfaceFoodPellets[i];
      if (pellet.takenByAntId != null) continue;
      if (pellet.x === x && pellet.y === y) return pellet;
    }
    return null;
  }

  removePelletById(pelletId) {
    const index = this.surfaceFoodPellets.findIndex((pellet) => pellet.id === pelletId);
    if (index >= 0) this.surfaceFoodPellets.splice(index, 1);
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
      nestFoodPellets: this.nestFoodPellets,
      workAllocation: this.workAllocation,
      casteAllocation: this.casteAllocation,
      ants: this.ants.map((ant) => ({
        id: ant.id,
        x: ant.x,
        y: ant.y,
        dir: ant.dir,
        hunger: ant.hunger,
        health: ant.health,
        carrying: ant.carrying,
        carryingType: ant.carryingType,
        baseColor: ant.baseColor,
        originalBaseColor: ant.originalBaseColor,
        role: ant.role,
        state: ant.state,
      })),
    };
  }

  static fromSerialized(world, rng, data) {
    const colony = new Colony(world, rng, 0);
    colony.foodStored = data.foodStored;
    colony.births = data.births;
    colony.deaths = data.deaths;
    colony.queen = { ...colony.queen, ...(data.queen || {}) };
    if (!Number.isFinite(colony.queen.x) || !Number.isFinite(colony.queen.y)) {
      colony.syncQueenPositionToNest(world.nestX, world.nestY);
    }
    if (!Number.isFinite(colony.queen.moveProgress)) colony.queen.moveProgress = 0;
    colony.excavatedTiles = data.excavatedTiles || 0;
    colony.nestFoodPellets = Array.isArray(data.nestFoodPellets)
      ? data.nestFoodPellets
        .filter((pellet) => Number.isFinite(pellet?.x) && Number.isFinite(pellet?.y) && Number.isFinite(pellet?.amount) && pellet.amount > 0)
        .map((pellet) => ({ x: pellet.x, y: pellet.y, amount: pellet.amount }))
      : [];
    colony.setWorkAllocation(data.workAllocation || colony.workAllocation);
    colony.setCasteAllocation(data.casteAllocation || colony.casteAllocation);
    colony.ants = data.ants.map((a) => {
      const ant = new Ant(a.x, a.y, rng, a.role || 'worker');
      ant.id = a.id || ant.id;
      ant.dir = a.dir;
      ant.hunger = a.hunger ?? ant.hunger;
      ant.health = a.health ?? ant.health;
      ant.carrying = a.carrying;
      ant.carryingType = a.carryingType || (a.carrying?.type === 'food' ? 'food' : 'none');
      ant.baseColor = a.baseColor || ant.baseColor;
      ant.originalBaseColor = a.originalBaseColor || ant.baseColor;
      ant.state = a.state || ant.state;
      return ant;
    });
    return colony;
  }
}
