export class SeededRng {
  constructor(seed = 'simant-default') {
    this.reseed(seed);
  }

  reseed(seed) {
    this.seed = String(seed);
    this.state = hashSeed(this.seed) || 0x12345678;
  }

  next() {
    // xorshift32
    let x = this.state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(maxExclusive) {
    return Math.floor(this.next() * maxExclusive);
  }

  chance(probability) {
    return this.next() < probability;
  }
}

function hashSeed(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
