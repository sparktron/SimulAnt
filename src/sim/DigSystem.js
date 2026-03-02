import { TERRAIN } from './world.js';

const CARDINALS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

export class DigSystem {
  constructor(world, rng) {
    this.world = world;
    this.rng = rng;
    this.autoDig = false;
    this.fronts = [];
    this.forceChamberFrontId = null;
    this.#seedFronts();
  }

  setWorld(world, rng) {
    this.world = world;
    this.rng = rng;
    this.fronts = [];
    this.forceChamberFrontId = null;
    this.#seedFronts();
  }

  toggleAutoDig() {
    this.autoDig = !this.autoDig;
    return this.autoDig;
  }

  forceChamber() {
    const front = this.fronts[0];
    if (!front) return false;
    this.forceChamberFrontId = front.id;
    return true;
  }

  update(colony) {
    if (this.fronts.length === 0) this.#seedFronts();

    const workerDiggers = colony.ants.filter(
      (ant) => ant.role === 'worker' && ant.carrying === 0 && ant.y >= this.world.nestY,
    ).length;

    if (!this.autoDig && workerDiggers === 0) return;

    const activeFronts = this.autoDig
      ? Math.min(this.fronts.length, 3)
      : Math.min(this.fronts.length, Math.max(1, Math.floor(workerDiggers / 20)));

    for (let i = 0; i < activeFronts; i += 1) {
      const front = this.fronts[i];
      front.progress += this.autoDig ? 1.6 : 0.9 + Math.min(1.4, workerDiggers / 45);

      while (front.progress >= 1) {
        front.progress -= 1;
        this.#advanceFront(colony, front);
      }
    }

    if (this.fronts.length < 6 && this.rng.chance(this.autoDig ? 0.05 : 0.015)) {
      this.#spawnBranch();
    }
  }

  #advanceFront(colony, front) {
    const nextDir = this.#pickDirection(front);
    const nx = front.x + nextDir.dx;
    const ny = front.y + nextDir.dy;

    if (!this.world.inBounds(nx, ny) || ny <= this.world.nestY + 1 || ny >= this.world.height - 2) {
      front.dx = -front.dx;
      front.dy = Math.max(1, -front.dy);
      return;
    }

    const idx = this.world.index(nx, ny);
    const terrain = this.world.terrain[idx];

    const alreadyOpen = terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER;
    if (!alreadyOpen) {
      this.world.terrain[idx] = TERRAIN.TUNNEL;
      colony.recordExcavation(1, nx, ny);
      if (this.rng.chance(0.15)) {
        const perp = Math.abs(nextDir.dx) > 0 ? { dx: 0, dy: 1 } : { dx: 1, dy: 0 };
        const wx = nx + (this.rng.chance(0.5) ? perp.dx : -perp.dx);
        const wy = ny + (this.rng.chance(0.5) ? perp.dy : -perp.dy);
        if (this.world.inBounds(wx, wy) && wy > this.world.nestY + 1) {
          const widx = this.world.index(wx, wy);
          if (this.world.terrain[widx] === TERRAIN.SOIL) {
            this.world.terrain[widx] = TERRAIN.TUNNEL;
            colony.recordExcavation(1, wx, wy);
          }
        }
      }
    } else if (this.rng.chance(0.7)) {
      return;
    }

    front.x = nx;
    front.y = ny;
    front.dx = nextDir.dx;
    front.dy = nextDir.dy;
    front.steps += 1;

    const shouldForce = this.forceChamberFrontId === front.id;
    const chamberChance = front.steps > 10 ? 0.05 : 0.0;
    if (shouldForce || this.rng.chance(chamberChance)) {
      this.#carveChamber(colony, front);
      if (shouldForce) this.forceChamberFrontId = null;
    }
  }

  #carveChamber(colony, front) {
    const width = 4 + this.rng.int(4);
    const height = 3 + this.rng.int(3);
    const rx = Math.floor(width / 2);
    const ry = Math.floor(height / 2);

    for (let y = front.y - ry; y <= front.y + ry; y += 1) {
      for (let x = front.x - rx; x <= front.x + rx; x += 1) {
        if (!this.world.inBounds(x, y) || y <= this.world.nestY + 1) continue;
        const nx = (x - front.x) / Math.max(1, rx);
        const ny = (y - front.y) / Math.max(1, ry);
        if (nx * nx + ny * ny > 1.05) continue;
        const idx = this.world.index(x, y);
        if (this.world.terrain[idx] === TERRAIN.SOIL) {
          this.world.terrain[idx] = TERRAIN.CHAMBER;
          colony.recordExcavation(1, x, y);
        }
      }
    }

    front.steps = 0;
  }

  #spawnBranch() {
    const open = [];
    for (let y = this.world.nestY + 4; y < this.world.height - 3; y += 1) {
      for (let x = 2; x < this.world.width - 2; x += 1) {
        const terrain = this.world.terrain[this.world.index(x, y)];
        if (terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER) open.push({ x, y });
      }
    }
    if (open.length === 0) return;
    const seed = open[this.rng.int(open.length)];
    const dir = CARDINALS[this.rng.int(CARDINALS.length)];
    this.fronts.push({ id: `f-${Date.now()}-${this.rng.int(9999)}`, x: seed.x, y: seed.y, dx: dir.dx, dy: dir.dy, progress: 0, steps: 0 });
  }

  #pickDirection(front) {
    const options = [
      { dx: front.dx, dy: front.dy, w: 0.7 },
      { dx: front.dy, dy: front.dx, w: 0.1 },
      { dx: -front.dy, dy: -front.dx, w: 0.1 },
      { dx: front.dx, dy: front.dy > 0 ? 1 : 0, w: 0.1 },
    ];
    const roll = this.rng.next();
    let acc = 0;
    for (const opt of options) {
      acc += opt.w;
      if (roll <= acc) return opt;
    }
    return options[0];
  }

  #seedFronts() {
    const sx = this.world.nestX;
    const sy = this.world.nestY + 8;
    this.fronts = [
      { id: 'main', x: sx, y: sy, dx: 1, dy: 1, progress: 0, steps: 0 },
      { id: 'alt', x: sx - 2, y: sy, dx: -1, dy: 1, progress: 0, steps: 0 },
    ];
  }
}
