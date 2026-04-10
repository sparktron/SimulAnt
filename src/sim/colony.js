import { Ant } from './ant.js';
import { TERRAIN } from './world.js';

const QUEEN_SPEED_RATIO = 0.1;
const BASE_TICK_SECONDS = 1 / 30;
const DEBUG_NEST_FOOD_LOGS = false;

export class Colony {
  constructor(world, rng, initialAnts = 300) {
    this.world = world;
    this.rng = rng;
    this.ants = [];
    this.foodStored = 0;
    this.foodStoreTarget = 100;
    this.births = initialAnts;
    this.deaths = 0;
    this.spawnCost = 12;
    this.surfaceFoodPellets = [];
    this.nestEntrances = [];
    this.nestFoodPellets = [];

    this.workAllocation = { forage: 85, dig: 10, nurse: 5 };
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
      broodGestationProgress: 0,
      foodCourierAntId: null,
    };

    this.excavatedTiles = 0;
    this.onExcavate = null;
    this.onDepositDirt = null;
    this._updateCounter = 0;
    this._antGrid = new Map();  // spatial hash: "x,y" → count
    this._nestFoodTiles = new Set();  // occupied nest food tile keys: "x,y"
    this._virtualFoodStored = 0;  // bootstrap food not backed by physical pellets

    // Spawn initial ants with some soldiers for visual distinction
    const soldierCount = Math.round(initialAnts * 0.15);  // 15% soldiers
    for (let i = 0; i < initialAnts; i += 1) {
      const role = i < soldierCount ? 'soldier' : 'worker';
      this.ants.push(this.#spawnNearNest(role));
    }

    // Bootstrap colony with starter food so specialized work can begin
    // Need enough to support all ants + queen egg production + brood development
    // while foragers ramp up gathering (takes time to find food and return)
    // With food respawning every 300 ticks when < 8 pellets, this gives stability
    this.foodStored = 5000;
    this._virtualFoodStored = 5000;  // consumed before physical pellets so deposits accumulate visibly

    this.syncQueenPositionToNest(world.nestX, world.nestY);
  }

  #spawnNearNest(role) {
    // Spawn in the tunnel/chamber, not in surrounding soil
    let spawnX = this.world.nestX;
    let spawnY = this.world.nestY + (this.rng.int(6) + 2);  // 2-8 tiles below nest center

    // Try to find a passable location near the nest with wider search
    let found = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const tryX = this.world.nestX + this.rng.int(5) - 2;  // -2 to +2
      const tryY = this.world.nestY + this.rng.int(6) + 2;  // +2 to +7
      if (this.world.isPassable(tryX, tryY)) {
        spawnX = tryX;
        spawnY = tryY;
        found = true;
        break;
      }
    }

    // Fallback: scan immediate area around nest center
    if (!found) {
      for (let dy = 2; dy <= 8; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (this.world.isPassable(this.world.nestX + dx, this.world.nestY + dy)) {
            spawnX = this.world.nestX + dx;
            spawnY = this.world.nestY + dy;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    const ant = new Ant(
      Math.max(0, Math.min(this.world.width - 1, spawnX)),
      Math.max(0, Math.min(this.world.height - 1, spawnY)),
      this.rng,
      role,
    );

    if (role === 'worker') {
      ant.workFocus = this.chooseWorkFocus();
    }

    return ant;
  }

  /**
   * Advances colony-level simulation by one tick.
   *
   * Called from micro simulation engine. Updates queen survival/reproduction,
   * ticks each ant, compacts dead ants, and hatches brood into ant instances.
   */
  update(config) {
    this._updateCounter += 1;
    // Deposit entrance pheromone every 5 ticks to prevent saturation flooding
    if (this._updateCounter % 5 === 0) this.#depositEntrancePheromone(config);
    this.#updateQueenSurvival(config);
    this.#updateQueenFoodRequest(config);
    if (this.queen.alive) {
      this.#updateQueenAndBrood(config);
    }

    this.#rebuildAntGrid();
    this.#rebuildNestFoodTiles();

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

    // Disable instant brood spawning; let queen lay eggs naturally via eggProgress
    // if (this.queen.alive) {
    //   while (this.foodStored >= this.spawnCost && this.ants.length < config.antCap) {
    //     this.foodStored -= this.spawnCost;
    //     this.queen.brood += 1;
    //   }
    // }

    this.rebalanceWorkerFocuses();
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
    const workerCounts = {
      forage: 0,
      dig: 0,
      nurse: 0,
    };

    for (let i = 0; i < this.ants.length; i += 1) {
      const ant = this.ants[i];
      if (!ant.alive || ant.role !== 'worker') continue;
      if (ant.workFocus === 'dig') {
        workerCounts.dig += 1;
      } else if (ant.workFocus === 'nurse') {
        workerCounts.nurse += 1;
      } else {
        workerCounts.forage += 1;
      }
    }

    return this.#chooseWeightedDeficit(
      {
        forage: this.workAllocation.forage,
        dig: this.workAllocation.dig,
        nurse: this.workAllocation.nurse,
      },
      workerCounts,
    );
  }

  selectHatchRole(_config) {
    const roleCounts = {
      worker: 0,
      soldier: 0,
      breeder: 0,
    };

    for (let i = 0; i < this.ants.length; i += 1) {
      const ant = this.ants[i];
      if (!ant.alive) continue;
      if (ant.role === 'soldier') {
        roleCounts.soldier += 1;
      } else if (ant.role === 'breeder') {
        roleCounts.breeder += 1;
      } else {
        roleCounts.worker += 1;
      }
    }

    return this.#chooseWeightedDeficit(
      {
        worker: this.casteAllocation.workers,
        soldier: this.casteAllocation.soldiers,
        breeder: this.casteAllocation.breeders,
      },
      roleCounts,
    );
  }

  rebalanceWorkerFocuses() {
    const workers = [];
    const counts = { forage: 0, dig: 0, nurse: 0 };

    for (let i = 0; i < this.ants.length; i += 1) {
      const ant = this.ants[i];
      if (!ant.alive || ant.role !== 'worker') continue;
      workers.push(ant);
      counts[ant.workFocus] = (counts[ant.workFocus] || 0) + 1;
    }

    if (workers.length === 0) return;

    const forageTarget = Math.round((this.workAllocation.forage / 100) * workers.length);
    const digTarget = Math.round((this.workAllocation.dig / 100) * workers.length);
    const nurseTarget = Math.max(0, workers.length - forageTarget - digTarget);

    const targets = { forage: forageTarget, dig: digTarget, nurse: nurseTarget };

    // Only reassign workers from overstaffed roles to understaffed roles
    const overstaffed = [];
    for (const focus of ['forage', 'dig', 'nurse']) {
      const excess = counts[focus] - targets[focus];
      if (excess > 0) {
        let reassigned = 0;
        for (let i = workers.length - 1; i >= 0 && reassigned < excess; i -= 1) {
          if (workers[i].workFocus === focus && !workers[i].carrying?.type) {
            overstaffed.push(workers[i]);
            counts[focus] -= 1;
            reassigned += 1;
          }
        }
      }
    }

    for (const ant of overstaffed) {
      // Assign to the most understaffed role
      let bestFocus = 'forage';
      let bestDeficit = Number.NEGATIVE_INFINITY;
      for (const focus of ['forage', 'dig', 'nurse']) {
        const deficit = targets[focus] - counts[focus];
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          bestFocus = focus;
        }
      }
      ant.workFocus = bestFocus;
      counts[bestFocus] += 1;
    }
  }

  #chooseWeightedDeficit(targetWeights, currentCounts) {
    const keys = Object.keys(targetWeights);
    const totalCount = keys.reduce((sum, key) => sum + (currentCounts[key] || 0), 0);
    const nextTotal = totalCount + 1;

    let bestKey = keys[0];
    let bestGap = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const targetShare = Math.max(0, Number(targetWeights[key]) || 0) / 100;
      const targetCount = targetShare * nextTotal;
      const currentCount = currentCounts[key] || 0;
      const gap = targetCount - currentCount;
      if (gap > bestGap) {
        bestGap = gap;
        bestKey = key;
      }
    }

    return bestKey;
  }

  #updateQueenAndBrood(config) {
    const dt = config.tickSeconds || BASE_TICK_SECONDS;

    if (this.foodStored >= config.queenEggFoodCost) {
      this.queen.eggProgress += 1;
      if (this.queen.eggProgress >= config.queenEggTicks) {
        this.queen.eggProgress = 0;
        this.foodStored -= config.queenEggFoodCost;
        this._virtualFoodStored = Math.max(0, this._virtualFoodStored - config.queenEggFoodCost);
        this.queen.eggsLaid += 1;
        this.queen.brood += 1;
      }
    }

    if (this.queen.brood <= 0) return;

    const broodFoodRequest = this.queen.brood * (config.broodFoodDrainRate ?? 0) * dt;
    const broodFoodConsumed = this.consumeFromStore(broodFoodRequest);
    const broodFeedRatio = broodFoodRequest > 0 ? broodFoodConsumed / broodFoodRequest : 1;
    const gestationRateScale = Math.max(0.1, Math.min(1, broodFeedRatio));
    this.queen.broodGestationProgress = (this.queen.broodGestationProgress || 0) + dt * gestationRateScale;

    const hatchSeconds = Math.max(
      0.001,
      Number.isFinite(config.broodGestationSeconds) ? config.broodGestationSeconds : dt,
    );
    // Hatch one ant per frame to avoid batch spawning
    if (
      this.queen.brood >= 1
      && this.queen.broodGestationProgress >= hatchSeconds
      && this.ants.length < config.antCap
    ) {
      this.queen.brood -= 1;
      this.queen.broodGestationProgress -= hatchSeconds;
      const role = this.selectHatchRole(config);
      this.ants.push(this.#spawnNearNest(role));
      this.births += 1;
    }
  }

  #updateQueenSurvival(config) {
    if (!this.queen.alive) return;
    const dt = config.tickSeconds || 1 / 30;
    this.queen.hunger = Math.max(0, this.queen.hunger - config.queenHungerDrain * dt);

    // Queen eats from stored food when hunger drops below 40% (before starvation triggers health drain)
    if (this.queen.hunger < this.queen.hungerMax * 0.4 && this.foodStored > 0) {
      const consumed = this.consumeFromStore(config.queenEatNutrition ?? 5);
      this.queen.hunger = Math.min(this.queen.hungerMax, this.queen.hunger + consumed);
      const healthGain = consumed * (config.healthEatRecoveryRate ?? 0);
      this.queen.health = Math.min(this.queen.healthMax, this.queen.health + healthGain);
    }

    if (this.queen.hunger <= 0) {
      this.queen.health = Math.max(0, this.queen.health - config.queenHealthDrainRate * dt);
      if (this.queen.health <= 0) {
        this.queen.alive = false;
      }
    }
  }

  #updateQueenFoodRequest(config) {
    if (!this.queen.alive) return;

    const requestThreshold = this.queen.healthMax * (config.queenFoodRequestHealthThreshold ?? 0.5);
    const clearThreshold = this.queen.healthMax * (config.queenFoodRequestClearThreshold ?? 0.8);
    const assigned = this.ants.find((ant) => ant.id === this.queen.foodCourierAntId && ant.alive);

    if (this.queen.health >= clearThreshold) {
      this.queen.foodCourierAntId = null;
      return;
    }

    if (this.queen.health >= requestThreshold && assigned) return;
    if (assigned) return;

    const nearest = this.findNearestWorkerTo(this.queen.x, this.queen.y);
    this.queen.foodCourierAntId = nearest?.id || null;
  }

  findNearestWorkerTo(x, y) {
    let nearest = null;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.ants.length; i += 1) {
      const ant = this.ants[i];
      if (!ant.alive || ant.role !== 'worker') continue;
      const d = Math.hypot(ant.x - x, ant.y - y);
      if (d < best) {
        best = d;
        nearest = ant;
      }
    }
    return nearest;
  }

  isQueenFoodCourier(antId) {
    return this.queen.foodCourierAntId != null && this.queen.foodCourierAntId === antId;
  }

  pickupQueenFoodRation(amount) {
    const consumed = this.consumeFromStore(amount);
    return Math.max(0, consumed);
  }

  feedQueen(nutrition, config) {
    const safeNutrition = Math.max(0, nutrition || 0);
    if (safeNutrition <= 0 || !this.queen.alive) return 0;
    this.queen.hunger = Math.min(this.queen.hungerMax, this.queen.hunger + safeNutrition);
    const healthGain = safeNutrition * (config.queenHealthRecoveryPerNutrition ?? 0);
    this.queen.health = Math.min(this.queen.healthMax, this.queen.health + healthGain);
    return safeNutrition;
  }

  #updateQueenPosition(config) {
    // Recalculate queen target tile every 60 ticks (~2 seconds) instead of every tick
    if (!this._queenTargetTile || (this._queenTargetRecalcCounter = (this._queenTargetRecalcCounter || 0) + 1) >= 60) {
      this._queenTargetTile = this.#findQueenSafeTile();
      this._queenTargetRecalcCounter = 0;
    }
    const target = this._queenTargetTile;
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
    const SEARCH_RADIUS = 30;
    const lowerHalfStartY = this.#getLowerHalfStartY(SEARCH_RADIUS);
    const { nestX, nestY, width, height } = this.world;
    const minX = Math.max(0, nestX - SEARCH_RADIUS);
    const maxX = Math.min(width - 1, nestX + SEARCH_RADIUS);
    const maxY = Math.min(height - 1, nestY + SEARCH_RADIUS);
    let best = null;
    let bestDepth = Number.NEGATIVE_INFINITY;
    let bestOffset = Number.POSITIVE_INFINITY;

    for (let y = lowerHalfStartY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!this.world.isPassable(x, y)) continue;
        const depth = y;
        const offset = Math.abs(x - nestX);
        if (depth > bestDepth || (depth === bestDepth && offset < bestOffset)) {
          bestDepth = depth;
          bestOffset = offset;
          best = { x, y };
        }
      }
    }

    if (best) return best;

    return {
      x: Math.max(0, Math.min(width - 1, Math.round(nestX))),
      y: Math.max(nestY + 1, Math.min(height - 1, Math.round(nestY + 6))),
    };
  }

  #getLowerHalfStartY(searchRadius) {
    const { nestX, nestY, width, height } = this.world;
    const minX = Math.max(0, nestX - searchRadius);
    const maxX = Math.min(width - 1, nestX + searchRadius);
    const maxScanY = Math.min(height - 1, nestY + searchRadius);
    let minPassableY = Number.POSITIVE_INFINITY;
    let maxPassableY = Number.NEGATIVE_INFINITY;

    for (let y = nestY + 1; y <= maxScanY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!this.world.isPassable(x, y)) continue;
        if (y < minPassableY) minPassableY = y;
        if (y > maxPassableY) maxPassableY = y;
      }
    }

    if (!Number.isFinite(minPassableY) || !Number.isFinite(maxPassableY)) {
      return Math.max(nestY + 1, Math.min(height - 1, nestY + 6));
    }

    return Math.max(
      nestY + 1,
      Math.min(height - 1, minPassableY + Math.floor((maxPassableY - minPassableY + 1) / 2)),
    );
  }

  consumeFromStore(amount) {
    if (amount <= 0 || this.foodStored <= 0) return 0;
    const consumed = Math.min(amount, this.foodStored);
    this.foodStored -= consumed;

    // Drain virtual (bootstrap) food reserve first so that physical pellets deposited
    // by foragers accumulate visibly rather than being immediately consumed.
    const virtualDrain = Math.min(consumed, this._virtualFoodStored);
    this._virtualFoodStored -= virtualDrain;
    const physicalDrain = consumed - virtualDrain;
    if (physicalDrain > 0) {
      this.#consumeNestFoodPellets(physicalDrain);
    }

    return consumed;
  }

  /**
   * Deposits nutrition into nest storage and records a visual pellet marker.
   *
   * Called when workers return food. Side effects update aggregate stored food,
   * nest pellet list, and per-cell `world.nestFood` cache.
   */
  depositPellet(nutrition, x, y, entrance = null) {
    if (nutrition <= 0) return 0;
    const before = this.nestFoodPellets.length;
    const point = this.findNestFoodDropPoint(entrance, x, y);
    if (!point) return 0;
    const pelletX = point.x;
    const pelletY = point.y;
    this.foodStored += nutrition;
    this.nestFoodPellets.push({
      x: pelletX,
      y: pelletY,
      amount: nutrition,
    });
    this._nestFoodTiles.add(`${pelletX},${pelletY}`);
    this.#applyNestCellFoodDelta(nutrition, pelletX, pelletY);
    if (DEBUG_NEST_FOOD_LOGS && this.nestFoodPellets.length !== before) {
      console.log('[nest-food] nestFoodPellets.length changed:', this.nestFoodPellets.length);
    }
    return nutrition;
  }

  getNestFoodDropPoint(entrance = null) {
    return this.findNestFoodDropPoint(entrance) || {
      x: Math.max(0, Math.min(this.world.width - 1, Math.round(entrance ? entrance.x : this.world.nestX))),
      y: Math.max(
        this.world.nestY + 1,
        Math.min(this.world.height - 1, Math.round(entrance ? entrance.y + 3 : this.world.nestY + 3)),
      ),
    };
  }

  #isNestFoodTileClear(x, y) {
    if (!this.world.inBounds(x, y) || y < this.world.nestY + 1) return false;
    const terrain = this.world.terrain[this.world.index(x, y)];
    if (terrain !== TERRAIN.TUNNEL && terrain !== TERRAIN.CHAMBER) return false;
    return !this._nestFoodTiles.has(`${x},${y}`);
  }

  #findDeepNestStorageY(anchorX) {
    const xRadius = 12;
    const minX = Math.max(0, Math.round(anchorX) - xRadius);
    const maxX = Math.min(this.world.width - 1, Math.round(anchorX) + xRadius);

    for (let y = this.world.height - 1; y >= this.world.nestY + 1; y -= 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const terrain = this.world.terrain[this.world.index(x, y)];
        if (terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER) return y;
      }
    }

    return this.world.nestY + 3;
  }

  findNestFoodDropPoint(entrance = null, preferredX = null, preferredY = null) {
    const storageCenterX = entrance ? entrance.x : this.world.nestX;
    const deepestStorageY = this.#findDeepNestStorageY(storageCenterX);
    const storageCenterY = Math.max(this.world.nestY + 3, deepestStorageY - 2);

    const minDistanceFromEntrance = entrance ? Math.max(4, (entrance.radius ?? 2) + 3) : 0;
    const isFarEnoughFromEntrance = (x, y) => {
      if (!entrance) return true;
      return Math.hypot(x - entrance.x, y - entrance.y) >= minDistanceFromEntrance;
    };

    const preferredTileX = Number.isFinite(preferredX)
      ? Math.max(0, Math.min(this.world.width - 1, Math.round(preferredX)))
      : null;
    const preferredTileY = Number.isFinite(preferredY)
      ? Math.max(this.world.nestY + 1, Math.min(this.world.height - 1, Math.round(preferredY)))
      : null;
    if (
      preferredTileX != null
      && preferredTileY != null
      && this.#isNestFoodTileClear(preferredTileX, preferredTileY)
      && isFarEnoughFromEntrance(preferredTileX, preferredTileY)
    ) {
      return { x: preferredTileX, y: preferredTileY };
    }

    const centerX = Math.max(0, Math.min(this.world.width - 1, Math.round(storageCenterX)));
    const centerY = Math.max(this.world.nestY + 1, Math.min(this.world.height - 1, Math.round(storageCenterY)));
    const maxRadius = 8;
    const randomAttempts = 20;
    const isValidCandidate = (x, y) => {
      if (!this.#isNestFoodTileClear(x, y)) return false;
      return isFarEnoughFromEntrance(x, y);
    };

    for (let i = 0; i < randomAttempts; i += 1) {
      const dx = this.rng.int(maxRadius * 2 + 1) - maxRadius;
      const dy = this.rng.int(maxRadius * 2 + 1) - maxRadius;
      const x = centerX + dx;
      const y = centerY + dy;
      if (isValidCandidate(x, y)) return { x, y };
    }

    for (let radius = 0; radius <= maxRadius; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = centerX + dx;
          const y = centerY + dy;
          if (isValidCandidate(x, y)) {
            return { x, y };
          }
        }
      }
    }

    return null;
  }

  depositFoodFromAnt(ant, entrance = null, dropPoint = null) {
    if (!ant?.carrying || ant.carrying.type !== 'food') return false;

    const nutrition = ant.carrying.pelletNutrition || 0;
    const targetDropPoint = dropPoint || this.findNestFoodDropPoint(entrance, ant.x, ant.y);
    if (!targetDropPoint) return false;
    if (dropPoint && (ant.x !== targetDropPoint.x || ant.y !== targetDropPoint.y)) return false;

    this.depositPellet(nutrition, targetDropPoint.x, targetDropPoint.y, entrance);
    ant.carrying = null;
    ant.carryingType = 'none';
    ant.baseColor = ant.originalBaseColor || ant.baseColor;
    ant.state = 'FORAGE_SEARCH';
    ant.hunger = Math.min(ant.hungerMax, ant.hunger + nutrition * 0.15);

    if (this.world.isPassable(targetDropPoint.x, targetDropPoint.y)) {
      ant.x = targetDropPoint.x;
      ant.y = targetDropPoint.y;
    }

    if (DEBUG_NEST_FOOD_LOGS) {
      console.log(`[ant] ${ant.id} deposited food at nest entrance (${entrance?.x ?? this.world.nestX}, ${entrance?.y ?? this.world.nestY})`);
    }
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
      if (pellet.amount <= 0.0001) {
        this._nestFoodTiles.delete(`${Math.round(pellet.x)},${Math.round(pellet.y)}`);
        this.nestFoodPellets.splice(i, 1);
      }
    }

    if (DEBUG_NEST_FOOD_LOGS && this.nestFoodPellets.length !== before) {
      console.log('[nest-food] nestFoodPellets.length changed:', this.nestFoodPellets.length);
    }
  }


  storeFood(amount) {
    const dropPoint = this.getNestFoodDropPoint();
    this.depositPellet(amount, dropPoint.x, dropPoint.y);
  }
  setSurfaceFoodPellets(pellets) {
    this.surfaceFoodPellets = pellets;
  }

  setNestEntrances(nestEntrances) {
    this.nestEntrances = nestEntrances;
  }

  #depositEntrancePheromone(config) {
    for (const entrance of this.nestEntrances) {
      const radius = (entrance.radius ?? 1) + 3;
      this.world.paintCircle(entrance.x, entrance.y, radius, (idx) => {
        this.world.toHome[idx] = Math.min(
          config.pheromoneMaxClamp,
          this.world.toHome[idx] + config.depositHome * 0.8,
        );
      });
    }
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

  countAntsAt(x, y) {
    return this._antGrid.get(`${x},${y}`) || 0;
  }

  #rebuildNestFoodTiles() {
    this._nestFoodTiles.clear();
    for (let i = 0; i < this.nestFoodPellets.length; i += 1) {
      const pellet = this.nestFoodPellets[i];
      if (pellet.amount > 0.0001) {
        this._nestFoodTiles.add(`${Math.round(pellet.x)},${Math.round(pellet.y)}`);
      }
    }
  }

  #rebuildAntGrid() {
    this._antGrid.clear();
    for (let i = 0; i < this.ants.length; i += 1) {
      const ant = this.ants[i];
      if (!ant.alive) continue;
      const key = `${ant.x},${ant.y}`;
      this._antGrid.set(key, (this._antGrid.get(key) || 0) + 1);
    }
  }

  removePelletById(pelletId) {
    const index = this.surfaceFoodPellets.findIndex((pellet) => pellet.id === pelletId);
    if (index >= 0) this.surfaceFoodPellets.splice(index, 1);
  }

  recordExcavation(volume, worldX, depthY) {
    this.excavatedTiles += volume;
    if (this.onExcavate) this.onExcavate(volume, worldX, depthY);
  }

  recordDirtDeposit(volume, worldX, depthY) {
    if (this.onDepositDirt) this.onDepositDirt(volume, worldX, depthY);
  }

  serialize() {
    return {
      foodStored: this.foodStored,
      virtualFoodStored: this._virtualFoodStored,
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
        stepCounter: ant.stepCounter,
        age: ant.age,
        maxAge: ant.maxAge,
        alive: ant.alive,
        workFocus: ant.workFocus,
      })),
    };
  }

  static fromSerialized(world, rng, data) {
    const colony = new Colony(world, rng, 0);
    colony.foodStored = data.foodStored;
    colony._virtualFoodStored = Number.isFinite(data.virtualFoodStored) ? data.virtualFoodStored : 0;
    colony.births = data.births;
    colony.deaths = data.deaths;
    colony.queen = { ...colony.queen, ...(data.queen || {}) };
    if (!Number.isFinite(colony.queen.x) || !Number.isFinite(colony.queen.y)) {
      colony.syncQueenPositionToNest(world.nestX, world.nestY);
    }
    if (!Number.isFinite(colony.queen.moveProgress)) colony.queen.moveProgress = 0;
    if (!Number.isFinite(colony.queen.broodGestationProgress)) colony.queen.broodGestationProgress = 0;
    if (typeof colony.queen.foodCourierAntId !== 'string') colony.queen.foodCourierAntId = null;
    colony.excavatedTiles = data.excavatedTiles || 0;
    colony.nestFoodPellets = Array.isArray(data.nestFoodPellets)
      ? data.nestFoodPellets
        .map((pellet) => {
          const amount = Number.isFinite(pellet?.amount)
            ? pellet.amount
            : (Number.isFinite(pellet?.nutrition) ? pellet.nutrition : NaN);
          return { x: pellet?.x, y: pellet?.y, amount };
        })
        .filter((pellet) => Number.isFinite(pellet.x) && Number.isFinite(pellet.y) && Number.isFinite(pellet.amount) && pellet.amount > 0)
      : [];
    colony.#rebuildNestFoodTiles();
    colony.setWorkAllocation(data.workAllocation || colony.workAllocation);
    colony.setCasteAllocation(data.casteAllocation || colony.casteAllocation);
    colony.ants = (Array.isArray(data.ants) ? data.ants : []).map((a) => {
      const ant = new Ant(a.x, a.y, rng, a.role || 'worker');
      ant.id = a.id || ant.id;
      ant.dir = a.dir;
      ant.hunger = a.hunger ?? ant.hunger;
      ant.health = a.health ?? ant.health;
      ant.carrying = a.carrying;
      ant.carryingType = a.carryingType || (a.carrying?.type === 'food' ? 'food' : 'none');
      const defaultBaseColor = Ant.getDefaultBaseColor(ant.role);
      const soldierBaseColor = Ant.getLegacySoldierBaseColor();
      const serializedBaseColor = typeof a.baseColor === 'string' ? a.baseColor : null;
      const serializedOriginalBaseColor = typeof a.originalBaseColor === 'string' ? a.originalBaseColor : null;

      ant.originalBaseColor = serializedOriginalBaseColor || defaultBaseColor;
      ant.baseColor = serializedBaseColor || ant.originalBaseColor;

      // Migration guard: older saves could persist legacy soldier-red despite canonical colony color.
      if (ant.originalBaseColor === soldierBaseColor) {
        ant.originalBaseColor = defaultBaseColor;
      }
      if (ant.baseColor === soldierBaseColor) {
        ant.baseColor = ant.originalBaseColor;
      }

      ant.state = a.state || ant.state;
      ant.stepCounter = a.stepCounter || 0;
      ant.age = a.age || 0;
      if (a.maxAge) ant.maxAge = a.maxAge;
      ant.alive = typeof a.alive === 'boolean' ? a.alive : ant.alive;
      ant.workFocus = (a.workFocus === 'dig' || a.workFocus === 'nurse' || a.workFocus === 'forage')
        ? a.workFocus
        : ant.workFocus;
      return ant;
    });
    return colony;
  }
}
