/*
 * Pheromone update micro-benchmark (fixed seed).
 *
 * Measures World.updatePheromones — the per-tick hotspot that runs three
 * full-grid (256x256) diffusion/evaporation passes. Run with:
 *
 *   node bench/pheromone-bench.mjs
 *
 * It warms the JIT, populates realistic terrain + pheromone fields by running
 * the real simulation, then times N updatePheromones calls with diffusion on
 * every tick (diffIntervalTicks=1 — the worst case). Output also prints a field
 * hash so behavior-preserving changes can be verified (the hash must not move).
 *
 * Reference budget (developer machine, 2026-05): ~1.1 ms/tick after the
 * passability-mask optimization (was ~1.4 ms). Treat a regression above
 * ~1.5 ms/tick, or any change to the field hash, as something to investigate.
 */
import { SimulationCore } from '../src/sim/SimulationCore.js';

const config = {
  tickSeconds: 1 / 30,
  antCap: 200,
  evapFood: 0.1,
  evapHome: 0.55,
  evapDanger: 0.35,
  diffFood: 0.2,
  diffHome: 0.1,
  diffDanger: 0.12,
  diffIntervalTicks: 1,
  depositFood: 1.2,
  depositHome: 0.12,
  dangerDeposit: 0.6,
  hazardDeathChance: 0.02,
  foodPickupRate: 0.7,
  digChance: 0.04,
  digEnergyCost: 8,
  digHomeBoost: 0.9,
  queenEggTicks: 20,
  queenEggFoodCost: 0.8,
  queenHungerDrain: 2.8,
  queenEatNutrition: 8,
  queenHealthDrainRate: 7,
  workerEatNutrition: 25,
  healthDrainRate: 5,
  healthRegenRate: 2,
  pheromoneMaxClamp: 150,
};

const WARMUP = 200;
const ITERATIONS = 2000;

const sim = new SimulationCore('phero-bench');
for (let i = 0; i < 200; i += 1) sim.update(config); // realistic terrain + fields
const world = sim.world;

for (let i = 0; i < WARMUP; i += 1) world.updatePheromones(config, i);

const start = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i += 1) world.updatePheromones(config, i);
const end = process.hrtime.bigint();

const msPerTick = Number(end - start) / 1e6 / ITERATIONS;

let hash = 5381;
const field = world.toFood;
for (let i = 0; i < field.length; i += 1) {
  hash = ((hash << 5) + hash) ^ Math.round(field[i] * 1000);
}

console.log(`updatePheromones: ${msPerTick.toFixed(4)} ms/tick over ${ITERATIONS} iterations`);
console.log(`toFood field hash: ${hash >>> 0} (must be stable across behavior-preserving changes)`);
