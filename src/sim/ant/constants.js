/*
    Shared ant primitives — extracted from ant.js (Phase 3 of the decomposition
    plan, see docs/ant-decomposition-plan.md).

    DIRS and gaussianRandom live here because they are used by BOTH the Ant
    constructor (which stays in ant.js) and the steering cluster. Housing them
    in a dependency-free leaf module avoids an ant.js <-> steering.js import
    cycle.
*/

/*
    Box-Muller transform: produces Gaussian random samples from uniform distribution.

    Critical: Must use seeded RNG, never Math.random(), to preserve determinism.
    Used for ant heading/steering noise and behavior variance.
*/
export function gaussianRandom(rng) {
  const u = Math.max(1e-10, rng.range(0, 1));
  const v = rng.range(0, 1);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// dir is an index into DIRS (0-7 for 8 cardinal+diagonal directions)
export const DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
