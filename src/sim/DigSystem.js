import { TERRAIN } from './world.js';

const CARDINAL_DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const TURN_OPTIONS = [0, -1, 1];

export class DigSystem {
  constructor(world, colony, rng) {
    this.world = world;
    this.colony = colony;
    this.rng = rng;
    this.autoDig = false;
    this.fronts = [];
    this.maxFronts = 10;

    this.#seedInitialFronts();
  }

  setWorld(world) {
    this.world = world;
    this.#clampFrontsToWorld();
  }

  update(config) {
    const workerCount = this.colony.ants.filter((ant) => ant.role === 'worker' && ant.alive).length;
    if (!this.autoDig && workerCount === 0) return;
    if (this.fronts.length === 0) this.#seedInitialFronts();

    const activeWorkers = this.autoDig ? Math.max(workerCount, 30) : workerCount;
    const assignedFronts = Math.min(this.fronts.length, Math.max(1, Math.floor(activeWorkers / 24)));

    for (let i = 0; i < assignedFronts; i += 1) {
      const front = this.fronts[i];
      const work = this.autoDig ? 1.4 : 0.7 + this.rng.range(0, 0.5);
      front.progress += work;

      let safetySteps = 0;
      while (front.progress >= 1 && safetySteps < 8) {
        front.progress -= 1;
        this.#advanceFront(front, config, false);
        safetySteps += 1;
      }

      if (!Number.isFinite(front.progress) || front.progress < 0 || safetySteps >= 8) {
        front.progress = 0;
      }
    }

    if (this.fronts.length < this.maxFronts && this.rng.chance(0.005 + activeWorkers / 90000)) {
      this.#spawnBranchFront();
    }

    this.fronts.sort((a, b) => b.lastAdvanceTick - a.lastAdvanceTick);
  }

  toggleAutoDig() {
    this.autoDig = !this.autoDig;
    return this.autoDig;
  }

  forceChamberAtActiveFront(config) {
    const front = this.fronts[0];
    if (!front) return false;
    return this.#createChamber(front, config);
  }

  serialize() {
    return {
      autoDig: this.autoDig,
      fronts: this.fronts,
    };
  }

  loadFromSerialized(data) {
    this.autoDig = Boolean(data?.autoDig);
    this.fronts = Array.isArray(data?.fronts)
      ? data.fronts
          .filter((front) => this.world.inBounds(front.x, front.y))
          .map((front) => ({
            x: Math.max(0, Math.min(this.world.width - 1, Number(front.x) || 0)),
            y: Math.max(this.world.nestY + 2, Math.min(this.world.height - 1, Number(front.y) || 0)),
            dir: this.#sanitizeDir(front.dir),
            progress: this.#sanitizeProgress(front.progress),
            age: this.#sanitizeCounter(front.age),
            stepsSinceChamber: this.#sanitizeCounter(front.stepsSinceChamber),
            lastAdvanceTick: this.#sanitizeCounter(front.lastAdvanceTick),
          }))
      : [];
    if (this.fronts.length === 0) this.#seedInitialFronts();
  }

  #seedInitialFronts() {
    const baseY = this.world.nestY + 3;
    this.fronts = [
      { x: this.world.nestX, y: baseY, dir: 1, progress: 0, age: 0, stepsSinceChamber: 0, lastAdvanceTick: 0 },
      { x: this.world.nestX - 2, y: baseY + 1, dir: 2, progress: 0, age: 0, stepsSinceChamber: 0, lastAdvanceTick: 0 },
      { x: this.world.nestX + 2, y: baseY + 1, dir: 0, progress: 0, age: 0, stepsSinceChamber: 0, lastAdvanceTick: 0 },
    ].filter((front) => this.world.inBounds(front.x, front.y));
  }

  #clampFrontsToWorld() {
    this.fronts = this.fronts.filter((front) => this.world.inBounds(front.x, front.y));
    if (this.fronts.length === 0) this.#seedInitialFronts();
  }

  #advanceFront(front, config, forcedChamber) {
    const next = this.#pickNextTile(front);
    if (!next) return;

    if (forcedChamber || this.#shouldCreateChamber(front)) {
      const created = this.#createChamber(front, config);
      if (created) return;
    }

    const terrain = this.world.terrain[this.world.index(next.x, next.y)];
    if (terrain === TERRAIN.SOIL) {
      this.#carveTunnel(next.x, next.y, config, front);
      if (this.rng.chance(0.12)) {
        this.#carveTunnel(next.x + CARDINAL_DIRS[front.dir][1], next.y + CARDINAL_DIRS[front.dir][0], config, front, false);
      }
    } else if (terrain !== TERRAIN.TUNNEL && terrain !== TERRAIN.CHAMBER) {
      return;
    }

    front.x = next.x;
    front.y = next.y;
    front.dir = next.dir;
    front.age += 1;
    front.stepsSinceChamber += 1;
    front.lastAdvanceTick += 1;
  }

  #pickNextTile(front) {
    let best = null;

    for (let i = 0; i < TURN_OPTIONS.length; i += 1) {
      const turn = TURN_OPTIONS[(i + this.rng.int(TURN_OPTIONS.length)) % TURN_OPTIONS.length];
      const dir = (front.dir + turn + CARDINAL_DIRS.length) % CARDINAL_DIRS.length;
      const nx = front.x + CARDINAL_DIRS[dir][0];
      const ny = front.y + CARDINAL_DIRS[dir][1];
      if (!this.world.inBounds(nx, ny) || ny <= this.world.nestY + 1) continue;

      const terrain = this.world.terrain[this.world.index(nx, ny)];
      if (terrain === TERRAIN.WALL || terrain === TERRAIN.WATER || terrain === TERRAIN.HAZARD) continue;

      best = { x: nx, y: ny, dir };
      if (turn === 0) break;
    }

    if (best) return best;

    for (let d = 0; d < CARDINAL_DIRS.length; d += 1) {
      const nx = front.x + CARDINAL_DIRS[d][0];
      const ny = front.y + CARDINAL_DIRS[d][1];
      if (!this.world.inBounds(nx, ny) || ny <= this.world.nestY + 1) continue;
      return { x: nx, y: ny, dir: d };
    }

    return null;
  }

  #shouldCreateChamber(front) {
    if (front.stepsSinceChamber < 10) return false;
    const chance = front.stepsSinceChamber > 28 ? 0.08 : 0.035;
    return this.rng.chance(chance);
  }

  #createChamber(front, config) {
    const chamberW = 4 + this.rng.int(4);
    const chamberH = 3 + this.rng.int(3);
    const rx = Math.floor(chamberW / 2);
    const ry = Math.floor(chamberH / 2);
    let carved = 0;

    for (let oy = -ry; oy <= ry; oy += 1) {
      for (let ox = -rx; ox <= rx; ox += 1) {
        const x = front.x + ox;
        const y = front.y + oy;
        if (!this.world.inBounds(x, y) || y <= this.world.nestY + 1) continue;

        const ellipse = (ox * ox) / (rx * rx + 0.01) + (oy * oy) / (ry * ry + 0.01);
        if (ellipse > 1.15) continue;

        const idx = this.world.index(x, y);
        if (this.world.terrain[idx] === TERRAIN.SOIL) {
          this.world.terrain[idx] = TERRAIN.CHAMBER;
          this.colony.recordExcavation(1, x, y);
          this.world.toHome[idx] += config.digHomeBoost;
          carved += 1;
        } else if (this.world.terrain[idx] === TERRAIN.TUNNEL) {
          this.world.terrain[idx] = TERRAIN.CHAMBER;
        }
      }
    }

    if (carved === 0) return false;

    front.stepsSinceChamber = 0;
    for (let i = 0; i < 2; i += 1) {
      if (this.fronts.length >= this.maxFronts) break;
      const dir = this.rng.int(CARDINAL_DIRS.length);
      const bx = front.x + CARDINAL_DIRS[dir][0] * (rx + 1);
      const by = front.y + CARDINAL_DIRS[dir][1] * (ry + 1);
      if (!this.world.inBounds(bx, by) || by <= this.world.nestY + 1) continue;
      this.fronts.push({ x: bx, y: by, dir, progress: 0, age: 0, stepsSinceChamber: 0, lastAdvanceTick: 0 });
    }

    return true;
  }

  #carveTunnel(x, y, config, front, countExcavation = true) {
    if (!this.world.inBounds(x, y) || y <= this.world.nestY + 1) return;
    const idx = this.world.index(x, y);
    const terrain = this.world.terrain[idx];
    if (terrain === TERRAIN.WALL || terrain === TERRAIN.WATER || terrain === TERRAIN.HAZARD) return;

    if (terrain === TERRAIN.SOIL) {
      this.world.terrain[idx] = TERRAIN.TUNNEL;
      if (countExcavation) this.colony.recordExcavation(1, x, y);
      this.world.toHome[idx] += config.digHomeBoost;
    }

    if (front) {
      front.lastAdvanceTick += 1;
    }
  }

  #spawnBranchFront() {
    if (this.fronts.length >= this.maxFronts) return;
    for (let tries = 0; tries < 24; tries += 1) {
      const x = this.rng.int(this.world.width);
      const y = this.rng.int(this.world.height - this.world.nestY - 3) + this.world.nestY + 3;
      const idx = this.world.index(x, y);
      const terrain = this.world.terrain[idx];
      if (terrain !== TERRAIN.TUNNEL && terrain !== TERRAIN.CHAMBER) continue;
      if (Math.abs(x - this.world.nestX) < 8 && y < this.world.nestY + 12) continue;

      this.fronts.push({
        x,
        y,
        dir: this.rng.int(CARDINAL_DIRS.length),
        progress: 0,
        age: 0,
        stepsSinceChamber: 0,
        lastAdvanceTick: 0,
      });
      return;
    }
  }

  #sanitizeDir(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return ((Math.floor(num) % CARDINAL_DIRS.length) + CARDINAL_DIRS.length) % CARDINAL_DIRS.length;
  }

  #sanitizeProgress(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.min(num, 4);
  }

  #sanitizeCounter(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.floor(num);
  }
}
