/*
    Deterministic seeded random number generator using xorshift32.

    Critical for reproducibility:
    - Same seed string ALWAYS produces same sequence (no timestamps, navigator data)
    - Every random call (direction selection, food spawning, movement variance) uses this
    - Never use Math.random() in simulation code — it breaks determinism
    - All RNG calls happen in a fixed order each tick

    Usage:
    - Create once per simulation with a seed
    - Call next()/range()/int()/chance() for different distributions
    - Reseed to reset sequence (used for Reset button)

    Why determinism matters:
    - Players can replay their colony with the same seed
    - Saves include seed so loading restores exact game state
    - Same initial config + same seed = identical tick sequence forever
*/
export class SeededRng {
  constructor(seed = 'simant-default') {
    this.reseed(seed);
  }

  reseed(seed) {
    this.seed = String(seed);
    this.state = hashSeed(this.seed) || 0x12345678;
  }

  // xorshift32: fast, passes many statistical tests, deterministic
  next() {
    // xorshift32
    let x = this.state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  // Uniform random in [min, max)
  range(min, max) {
    return min + (max - min) * this.next();
  }

  // Uniform random integer in [0, maxExclusive)
  int(maxExclusive) {
    return Math.floor(this.next() * maxExclusive);
  }

  // Bernoulli trial: return true with given probability
  chance(probability) {
    return this.next() < probability;
  }
}

// FNV-1a hash for seed string → 32-bit state
function hashSeed(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
