import { TERRAIN } from '../world.js';
import { SeededRng } from '../rng.js';

export const ANT_LION_LIMIT = 4;
export const ANT_LION_DEFAULTS = Object.freeze({
  antLionStarvationTicks: 900,
  antLionStarvationDamage: 0.25,
  antLionSpawnInterval: 900,
  antLionFeedingCooldown: 30,
});

// A separate seeded stream keeps predator placement independent of ant AI.
export class AntLionSystem {
  constructor(world, seed) {
    this.world = world;
    this.rng = new SeededRng(`${seed}:ant-lions`);
    this.lions = [];
    this.spawnClock = 0;
    this.nextId = 1;
    world.antLions = this.lions;
  }

  populate() {
    while (this.lions.length < ANT_LION_LIMIT && this.spawn()) { /* bounded by cap */ }
  }

  spawn() {
    if (this.lions.length >= ANT_LION_LIMIT) return false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = 4 + Math.floor(this.rng.next() * (this.world.width - 8));
      const y = 4 + Math.floor(this.rng.next() * (this.world.nestY - 12));
      // Keep funnels off walls, water, nest mouths, and other funnels.
      if (!this.isGround(x, y)) continue;
      if (this.lions.some((lion) => Math.hypot(lion.x - x, lion.y - y) < 10)) continue;
      this.lions.push({ id: this.nextId++, x, y, health: 100, hungryTicks: 0, cooldown: 0 });
      return true;
    }
    return false;
  }

  isGround(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)
      || x < 3 || x >= this.world.width - 3 || y < 3 || y >= this.world.nestY - 5) return false;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (this.world.terrain[(y + dy) * this.world.width + x + dx] !== TERRAIN.GROUND) return false;
      }
    }
    return true;
  }

  update(colonies, config = {}) {
    const settings = { ...ANT_LION_DEFAULTS, ...config };
    const affected = new Set();
    for (const lion of this.lions) {
      lion.hungryTicks += 1;
      lion.cooldown = Math.max(0, lion.cooldown - 1);
      if (!this.isGround(lion.x, lion.y)) {
        lion.health = 0;
        continue;
      }
      if (lion.cooldown === 0) {
        let nearest = null;
        let nearestColony = null;
        let nearestDistance = Infinity;
        for (const colony of colonies) {
          for (const ant of colony.ants) {
            if (!ant.alive || Math.abs(ant.x - lion.x) > 2 || Math.abs(ant.y - lion.y) > 2) continue;
            const distance = (ant.x - lion.x) ** 2 + (ant.y - lion.y) ** 2;
            if (distance > 2.5 ** 2 || distance >= nearestDistance) continue;
            if (this.world.terrain[this.world.index(ant.x, ant.y)] !== TERRAIN.GROUND) continue;
            nearest = ant;
            nearestColony = colony;
            nearestDistance = distance;
          }
        }
        if (nearest) {
          nearest.health = 0;
          nearest.alive = false;
          nearestColony.recordDeath('predation');
          affected.add(nearestColony);
          lion.hungryTicks = 0;
          lion.health = 100;
          lion.cooldown = settings.antLionFeedingCooldown;
          this.#markPitDanger(lion, settings);
          continue;
        }
      }
      if (lion.hungryTicks > settings.antLionStarvationTicks) {
        lion.health = Math.max(0, lion.health - settings.antLionStarvationDamage);
      }
    }
    for (const colony of affected) colony.removeDeadAnts();
    // Mutate in place: renderers retain the world array across updates.
    for (let i = this.lions.length - 1; i >= 0; i -= 1) {
      if (this.lions[i].health <= 0) this.lions.splice(i, 1);
    }
    this.spawnClock += 1;
    if (this.spawnClock >= settings.antLionSpawnInterval) {
      this.spawnClock = 0;
      this.spawn();
    }
  }

  #markPitDanger(lion, config) {
    if (config.enablePheromones === false) return;
    const radius = 4;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const distance = Math.hypot(dx, dy);
        if (distance > radius || !this.isGround(lion.x + dx, lion.y + dy)) continue;
        const amount = (config.dangerDeposit ?? 0.3) * (radius + 1 - distance);
        this.world.depositDanger(this.world.index(lion.x + dx, lion.y + dy), amount, config.pheromoneMaxClamp);
      }
    }
  }

  clear() {
    this.lions.length = 0;
    this.spawnClock = 0;
  }

  serialize() {
    return {
      lions: this.lions.map((lion) => ({ ...lion })),
      spawnClock: this.spawnClock,
      nextId: this.nextId,
      rng: this.rng.snapshot(),
    };
  }

  load(data) {
    this.clear();
    for (const lion of Array.isArray(data.lions) ? data.lions : []) {
      if (this.lions.length >= ANT_LION_LIMIT) break;
      if (!this.isGround(lion?.x, lion?.y)
        || !Number.isFinite(lion.health) || lion.health <= 0) continue;
      this.lions.push({
        id: this.nextId++, x: lion.x, y: lion.y,
        health: Math.min(100, lion.health),
        hungryTicks: Number.isFinite(lion.hungryTicks) ? Math.max(0, lion.hungryTicks) : 0,
        cooldown: Number.isFinite(lion.cooldown) ? Math.max(0, lion.cooldown) : 0,
      });
      this.lions[this.lions.length - 1].id = Number.isInteger(lion.id) ? lion.id : this.nextId - 1;
    }
    this.nextId = Math.max(this.nextId, ...this.lions.map((lion) => lion.id + 1),
      Number.isInteger(data.nextId) ? data.nextId : 1);
    this.spawnClock = Number.isFinite(data.spawnClock) ? Math.max(0, data.spawnClock) : 0;
    if (data.rng) this.rng.restore(data.rng);
  }
}
