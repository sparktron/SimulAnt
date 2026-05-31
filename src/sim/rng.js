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
    // next() can return exactly 1.0 in the rare case state === 0xffffffff,
    // which would make floor(next() * maxExclusive) === maxExclusive — an
    // out-of-range index (e.g. int(4) → 4). Always consume a draw so the
    // stream is preserved, then clamp the overflow case to maxExclusive - 1.
    const n = Math.floor(this.next() * maxExclusive);
    if (maxExclusive <= 0) return 0;
    return n < maxExclusive ? n : maxExclusive - 1;
  }

  // Bernoulli trial: return true with given probability
  chance(probability) {
    return this.next() < probability;
  }

  // Capture the full generator cursor (seed + position in the sequence) so
  // save/load can resume the exact same stream. Saving only the seed would
  // restart the sequence from its first draw, diverging any reloaded run from
  // an uninterrupted one.
  snapshot() {
    return { seed: this.seed, state: this.state >>> 0 };
  }

  // Restore a cursor produced by snapshot(). Tolerates missing/corrupt input
  // (legacy saves predate the cursor): a zero state is the dead fixed point of
  // xorshift32, so fall back to a reseed-derived state if one sneaks in.
  restore(snap) {
    if (!snap || typeof snap !== 'object') return;
    if (snap.seed !== undefined) this.seed = String(snap.seed);
    const restored = snap.state >>> 0;
    this.state = restored || hashSeed(this.seed) || 0x12345678;
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
