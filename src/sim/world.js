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
    return terrain !== TERRAIN.WALL && terrain !== TERRAIN.WATER && terrain !== TERRAIN.SOIL;
  }

  isUnderground(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrain[this.index(x, y)];
    return t === TERRAIN.TUNNEL || t === TERRAIN.CHAMBER;
  }

  initializeTerrain() {
    // Surface (top half) is open ground, lower half is compact soil to dig through.
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const idx = this.index(x, y);
        this.terrain[idx] = y > this.nestY ? TERRAIN.SOIL : TERRAIN.GROUND;
      }
    }

    // Starter nest chamber around queen spawn point.
    this.paintCircle(this.nestX, this.nestY + 2, this.nestRadius, (idx, _x, y) => {
      if (y >= this.nestY - 1) this.terrain[idx] = TERRAIN.TUNNEL;
    });
  }

  setNest(x, y) {
    this.nestX = Math.max(0, Math.min(this.width - 1, x));
    this.nestY = Math.max(0, Math.min(this.height - 1, y));
    this.recomputeNestInfluence();
    this.paintCircle(this.nestX, this.nestY + 2, this.nestRadius, (idx, _cx, cy) => {
      if (cy >= this.nestY - 1) this.terrain[idx] = TERRAIN.CHAMBER;
    });
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

  diffuseAndEvaporate(diffusionRate, evaporationRate, includeDanger = true) {
    this.#diffuseOne(this.toFood, this._toFoodNext, diffusionRate, evaporationRate);
    this.#diffuseOne(this.toHome, this._toHomeNext, diffusionRate, evaporationRate);
    if (includeDanger) {
      this.#diffuseOne(this.danger, this._dangerNext, diffusionRate * 0.8, evaporationRate * 0.7);
    }
  }

  #diffuseOne(src, dst, diffusionRate, evaporationRate) {
    const w = this.width;
    const h = this.height;

    for (let y = 1; y < h - 1; y += 1) {
      const row = y * w;
      for (let x = 1; x < w - 1; x += 1) {
        const idx = row + x;
        const center = src[idx];
        const neighborAvg = (src[idx - 1] + src[idx + 1] + src[idx - w] + src[idx + w]) * 0.25;
        const mixed = center + (neighborAvg - center) * diffusionRate;
        dst[idx] = mixed * (1 - evaporationRate);
      }
    }

    // Borders evaporate in place for stability.
    for (let x = 0; x < w; x += 1) {
      const top = x;
      const bot = (h - 1) * w + x;
      dst[top] = src[top] * (1 - evaporationRate);
      dst[bot] = src[bot] * (1 - evaporationRate);
    }
    for (let y = 0; y < h; y += 1) {
      const left = y * w;
      const right = y * w + (w - 1);
      dst[left] = src[left] * (1 - evaporationRate);
      dst[right] = src[right] * (1 - evaporationRate);
    }

    src.set(dst);
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
    world.toFood.set(data.toFood);
    world.toHome.set(data.toHome);
    world.danger.set(data.danger);
    world.recomputeNestInfluence();
    return world;
  }
}
