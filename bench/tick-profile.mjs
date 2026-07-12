/*
 * Whole-tick performance profile (fixed seed, large colony).
 *
 * Complements pheromone-bench.mjs (which isolates updatePheromones) by timing a
 * full sim.update() under a grown colony and attributing time to the suspected
 * per-tick hotspots: the full-grid pheromone update and the linear food-pellet
 * scans (findVisiblePellet / countVisiblePellets / findAvailablePelletAt), which
 * each foraging ant runs every tick against the surfaceFoodPellets array.
 *
 *   node bench/tick-profile.mjs            # default 4000 grow + 1500 measure
 *   node bench/tick-profile.mjs 6000 2000  # grow / measure tick counts
 *   PERF_CHECK_BUDGET=1 node bench/tick-profile.mjs
 *
 * For a function-level breakdown, run under the V8 profiler:
 *   node --prof bench/tick-profile.mjs && node --prof-process isolate-*.log | head -60
 *
 * Determinism: same seed + config always yields the same tick sequence, so the
 * reported colony size / pellet count / field hash are stable across
 * behavior-preserving changes. A moved hash means behavior changed.
 */
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

const GROW_TICKS = Number(process.argv[2]) || 4000;
const MEASURE_TICKS = Number(process.argv[3]) || 1500;
const SEED = 'tick-profile';
const TICK_BUDGET_MS = Number(process.env.PERF_TICK_BUDGET_MS || 2.0);
const CHECK_BUDGET = process.env.PERF_CHECK_BUDGET === '1';

const config = sanitizeTickConfig(getDefaultConfig());

const sim = new SimulationCore(SEED);

// --- Phase 1: grow a realistic large colony -------------------------------
for (let i = 0; i < GROW_TICKS; i += 1) sim.update(config);
const ants = sim.colony.ants.length;
const surfacePellets = sim.colony.surfaceFoodPellets.length;
const totalPellets = sim.foodPellets.length;
console.log(`after ${GROW_TICKS} grow ticks: ${ants} ants, `
  + `${surfacePellets} surface pellets (${totalPellets} total)`);

// --- Phase 2: headline raw ms/tick (no instrumentation) -------------------
const t0 = process.hrtime.bigint();
for (let i = 0; i < MEASURE_TICKS; i += 1) sim.update(config);
const t1 = process.hrtime.bigint();
const msPerTick = Number(t1 - t0) / 1e6 / MEASURE_TICKS;
console.log(`\nfull tick: ${msPerTick.toFixed(4)} ms/tick over ${MEASURE_TICKS} ticks `
  + `(${(1000 / msPerTick).toFixed(0)} ticks/sec, ${sim.colony.ants.length} ants)`);
if (CHECK_BUDGET) {
  const status = msPerTick <= TICK_BUDGET_MS ? 'PASS' : 'FAIL';
  console.log(`tick budget: ${status} (${msPerTick.toFixed(4)} <= ${TICK_BUDGET_MS.toFixed(4)} ms/tick)`);
  if (status === 'FAIL') process.exitCode = 1;
}

// --- Phase 3: attribute time to suspected hotspots ------------------------
// Lightweight monkeypatch timing. hrtime per call adds overhead, so these
// numbers are for *relative attribution*, not the headline ms/tick above.
function instrument(obj, method, bucket) {
  const orig = obj[method].bind(obj);
  bucket.calls = 0;
  bucket.ns = 0n;
  obj[method] = (...args) => {
    const s = process.hrtime.bigint();
    const r = orig(...args);
    bucket.ns += process.hrtime.bigint() - s;
    bucket.calls += 1;
    return r;
  };
}

const buckets = {
  updatePheromones: {},
  findVisiblePellet: {},
  countVisiblePellets: {},
  findAvailablePelletAt: {},
};
instrument(sim.world, 'updatePheromones', buckets.updatePheromones);
instrument(sim.colony, 'findVisiblePellet', buckets.findVisiblePellet);
instrument(sim.colony, 'countVisiblePellets', buckets.countVisiblePellets);
instrument(sim.colony, 'findAvailablePelletAt', buckets.findAvailablePelletAt);

const ATTR_TICKS = 500;
const a0 = process.hrtime.bigint();
for (let i = 0; i < ATTR_TICKS; i += 1) sim.update(config);
const a1 = process.hrtime.bigint();
const attrTotalMs = Number(a1 - a0) / 1e6;

console.log(`\nattribution over ${ATTR_TICKS} ticks (instrumented total ${attrTotalMs.toFixed(0)} ms):`);
const pelletScanNs = buckets.findVisiblePellet.ns + buckets.countVisiblePellets.ns + buckets.findAvailablePelletAt.ns;
for (const [name, b] of Object.entries(buckets)) {
  const ms = Number(b.ns) / 1e6;
  const pct = (ms / attrTotalMs) * 100;
  const perCall = b.calls ? (Number(b.ns) / b.calls).toFixed(0) : '0';
  console.log(`  ${name.padEnd(22)} ${ms.toFixed(1).padStart(8)} ms  ${pct.toFixed(1).padStart(5)}%  `
    + `${String(b.calls).padStart(9)} calls  ${perCall.padStart(6)} ns/call`);
}
console.log(`  ${'→ pellet scans (sum)'.padEnd(22)} ${(Number(pelletScanNs) / 1e6).toFixed(1).padStart(8)} ms  `
  + `${((Number(pelletScanNs) / 1e6 / attrTotalMs) * 100).toFixed(1).padStart(5)}%`);

// --- determinism hash -----------------------------------------------------
let hash = 5381;
const field = sim.world.toFood;
for (let i = 0; i < field.length; i += 1) hash = ((hash << 5) + hash) ^ Math.round(field[i] * 1000);
console.log(`\ntoFood field hash: ${hash >>> 0} | ants: ${sim.colony.ants.length} `
  + `| surface pellets: ${sim.colony.surfaceFoodPellets.length}`);
