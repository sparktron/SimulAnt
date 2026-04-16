export const TERRAIN = {
  GROUND: 0,
  WALL: 1,
  WATER: 2,
  HAZARD: 3,
  SOIL: 4,
  TUNNEL: 5,
  CHAMBER: 6,
};

export class World {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.size = width * height;

    this.terrain = new Uint8Array(this.size);
    this.food = new Float32Array(this.size);
    this.nestFood = new Float32Array(this.size);

    this.toFood = new Float32Array(this.size);
    this.toHome = new Float32Array(this.size);
    this.danger = new Float32Array(this.size);

    this._toFoodNext = new Float32Array(this.size);
    this._toHomeNext = new Float32Array(this.size);
    this._dangerNext = new Float32Array(this.size);

    this.nestX = Math.floor(width * 0.5);
    this.nestY = Math.floor(height * 0.5);
    this.nestRadius = 8;
    this.nestInfluence = new Float32Array(this.size);

    this.initializeTerrain();
    this.recomputeNestInfluence();
  }

  index(x, y) {
    return y * this.width + x;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  isPassable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const terrain = this.terrain[this.index(x, y)];
    // Food pellets are not obstacles—ants can walk freely over them
    return (
      terrain !== TERRAIN.WALL &&
      terrain !== TERRAIN.WATER &&
      terrain !== TERRAIN.SOIL
    );
  }

  isUnderground(x, y) {
    if (!this.inBounds(x, y)) return false;
    const terrain = this.terrain[this.index(x, y)];
    return terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER;
  }

  initializeTerrain() {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const idx = this.index(x, y);
        this.terrain[idx] = y > this.nestY ? TERRAIN.SOIL : TERRAIN.GROUND;
      }
    }

    this.#carveStarterNest();
  }

  setNest(x, y) {
    this.nestX = Math.max(0, Math.min(this.width - 1, x));
    this.nestY = Math.max(0, Math.min(this.height - 1, y));
    this.recomputeNestInfluence();
    this.#carveStarterNest();
  }

  recomputeNestInfluence() {
    const maxDist = Math.hypot(this.width, this.height);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const idx = this.index(x, y);
        const d = Math.hypot(x - this.nestX, y - this.nestY);
        this.nestInfluence[idx] = Math.max(0, 1 - d / maxDist);
      }
    }
  }

  paintCircle(cx, cy, radius, fn) {
    const r2 = radius * radius;
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(this.width - 1, cx + radius);
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(this.height - 1, cy + radius);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          fn(this.index(x, y), x, y);
        }
      }
    }
  }

  #carveStarterNest() {
    // Larger starter chamber so brood/queen/nurses have room to spread out
    this.paintCircle(this.nestX, this.nestY + 4, 6, (idx, _x, y) => {
      if (y >= this.nestY) this.terrain[idx] = TERRAIN.CHAMBER;
    });

    // Widen the entrance shaft to 3 tiles so multiple ants can flow in parallel.
    // Single-tile entrance caused severe stacking bottlenecks at the surface transition.
    for (let y = this.nestY; y <= this.nestY + 14; y += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const tx = this.nestX + dx;
        if (!this.inBounds(tx, y)) continue;
        this.terrain[this.index(tx, y)] = TERRAIN.TUNNEL;
      }
      // Extra flaring near the surface for smoother entry/exit
      if (y <= this.nestY + 2) {
        for (const dx of [-2, 2]) {
          const tx = this.nestX + dx;
          if (this.inBounds(tx, y)) this.terrain[this.index(tx, y)] = TERRAIN.TUNNEL;
        }
      }
    }
  }

  updatePheromones(config, tick) {
    const dt = config.tickSeconds || 1 / 30;
    // Use discrete diffusion equation: P_i^{t+1} = (1 - λ - 4D) * P_i^t + D * (neighbors sum)
    // where λ is evaporation per tick and D is diffusion coefficient
    this.#updatePheromonesField(this.toFood, this._toFoodNext, config.evapFood, config.diffFood, config.pheromoneMaxClamp, dt);
    this.#updatePheromonesField(this.toHome, this._toHomeNext, config.evapHome, config.diffHome, config.pheromoneMaxClamp, dt);
    this.#updatePheromonesField(this.danger, this._dangerNext, config.evapDanger, config.diffDanger, config.pheromoneMaxClamp, dt);
  }

  #updatePheromonesField(srcField, dstField, evaporationLambda, diffusionRate, clampMax, dt) {
    const w = this.width;
    const h = this.height;

    // Combined evaporation + diffusion using discrete diffusion equation
    const lambda = Math.max(0, evaporationLambda) * dt;  // evaporation per tick
    const D = Math.max(0, diffusionRate) / 4;            // diffusion coefficient (normalized for 4-neighbor)

    // Stability check: 4D should be < 1
    if (4 * D >= 1) {
      console.warn(`Pheromone diffusion instability: 4D = ${(4 * D).toFixed(3)} >= 1. Keep diffusion < 0.25.`);
    }

    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      for (let x = 0; x < w; x += 1) {
        const idx = row + x;

        if (!this.isPassable(x, y)) {
          dstField[idx] = 0;
          continue;
        }

        const center = srcField[idx];
        let neighborSum = 0;

        // Sum 4-neighbors (up, down, left, right)
        if (x > 0 && this.isPassable(x - 1, y)) {
          neighborSum += srcField[idx - 1];
        }
        if (x < w - 1 && this.isPassable(x + 1, y)) {
          neighborSum += srcField[idx + 1];
        }
        if (y > 0 && this.isPassable(x, y - 1)) {
          neighborSum += srcField[idx - w];
        }
        if (y < h - 1 && this.isPassable(x, y + 1)) {
          neighborSum += srcField[idx + w];
        }

        // Discrete diffusion: P_i^{t+1} = (1 - λ - 4D) * P_i^t + D * neighborSum
        // Source term (ant deposits) is already in center from this tick's updates
        const decayFactor = Math.max(0, 1 - lambda - 4 * D);
        const newValue = decayFactor * center + D * neighborSum;

        const clampedValue = Math.max(0, Math.min(clampMax, newValue));
        dstField[idx] = clampedValue < 1e-5 ? 0 : clampedValue;
      }
    }

    // Copy result back to source field
    srcField.set(dstField);
  }

  getPheromoneStats() {
    let maxFood = 0;
    let maxHome = 0;
    let sumFood = 0;
    let sumHome = 0;
    let passable = 0;

    for (let i = 0; i < this.size; i += 1) {
      if (this.terrain[i] === TERRAIN.WALL || this.terrain[i] === TERRAIN.WATER || this.terrain[i] === TERRAIN.SOIL) continue;
      passable += 1;
      const food = this.toFood[i];
      const home = this.toHome[i];
      if (food > maxFood) maxFood = food;
      if (home > maxHome) maxHome = home;
      sumFood += food;
      sumHome += home;
    }

    const denom = Math.max(1, passable);
    return {
      maxFood,
      maxHome,
      avgFood: sumFood / denom,
      avgHome: sumHome / denom,
    };
  }

  serialize() {
    return {
      width: this.width,
      height: this.height,
      nestX: this.nestX,
      nestY: this.nestY,
      nestRadius: this.nestRadius,
      terrain: Array.from(this.terrain),
      food: Array.from(this.food),
      nestFood: Array.from(this.nestFood),
      toFood: Array.from(this.toFood),
      toHome: Array.from(this.toHome),
      danger: Array.from(this.danger),
    };
  }

  static fromSerialized(data) {
    const world = new World(data.width, data.height);
    world.nestX = data.nestX;
    world.nestY = data.nestY;
    world.nestRadius = data.nestRadius;
    world.terrain.set(data.terrain);
    world.food.set(data.food);
    if (Array.isArray(data.nestFood)) world.nestFood.set(data.nestFood);
    world.toFood.set(data.toFood);
    world.toHome.set(data.toHome);
    world.danger.set(data.danger);
    world.recomputeNestInfluence();
    return world;
  }
}
