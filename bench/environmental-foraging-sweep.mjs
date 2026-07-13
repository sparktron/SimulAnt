/*
 * Environmental-foraging sweep: compare supply, vision, and food-drop
 * distance across deterministic long multi-seed simulations.
 *
 * The environmental levers are difficulty settings, not A/B conditions. Each
 * row reports absolute colony outcomes against a sustained-population floor,
 * rather than comparing pheromone modes. The sweep deliberately does not
 * change pheromone settings; recruitment and dispersion were both documented
 * negative results in docs/pheromone-strategy.md.
 *
 * Usage:
 *   node bench/environmental-foraging-sweep.mjs [ticks=16000] [seeds=3] [scenario] [seedStart=0]
 *   node bench/environmental-foraging-sweep.mjs 16000 12 vision-24
 *
 * A result is only a candidate for a shipped default when every seed reaches
 * the final tick and its final population meets TARGET_FINAL_POPULATION. Run
 * with more seeds before changing a default, for example:
 *   node bench/environmental-foraging-sweep.mjs 16000 12
 */
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

const END_TICK = Number(process.argv[2]) || 16000;
const SEED_COUNT = Number(process.argv[3]) || 3;
const SCENARIO_FILTER = process.argv[4] || null;
const SEED_START = Number(process.argv[5]) || 0;
const TARGET_FINAL_POPULATION = 150;
const TARGET_CAPACITY = 300;

const SCENARIOS = [
  { label: 'baseline', overrides: {} },
  { label: 'supply-400', overrides: { minSurfacePellets: 400 } },
  { label: 'supply-800', overrides: { minSurfacePellets: 800 } },
  { label: 'vision-12', overrides: { foodVisionRadius: 12 } },
  { label: 'vision-24', overrides: { foodVisionRadius: 24 } },
  { label: 'near-30-60', overrides: { foodDropDistanceMin: 30, foodDropDistanceRange: 30 } },
  { label: 'far-90-120', overrides: { foodDropDistanceMin: 90, foodDropDistanceRange: 30 } },
];
const selectedScenarios = SCENARIO_FILTER
  ? SCENARIOS.filter((scenario) => scenario.label === SCENARIO_FILTER)
  : SCENARIOS;

if (!selectedScenarios.length) {
  throw new Error(`Unknown scenario '${SCENARIO_FILTER}'. Choose one of: ${SCENARIOS.map((scenario) => scenario.label).join(', ')}`);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function runOne(seed, overrides) {
  const config = sanitizeTickConfig({ ...getDefaultConfig(), ...overrides });
  const sim = new SimulationCore(seed);
  const colony = sim.colony;
  // HUD telemetry is observational and has no simulation feedback. Skipping its
  // periodic world scan keeps long headless sweeps focused on the simulation
  // under test rather than on UI-history collection.
  sim.stats.record = () => {};
  let peakAnts = colony.ants.length;
  let peakTick = 0;

  for (let tick = 1; tick <= END_TICK; tick += 1) {
    sim.update(config);
    if (colony.ants.length > peakAnts) {
      peakAnts = colony.ants.length;
      peakTick = tick;
    }
  }

  return {
    finalAnts: colony.ants.length,
    peakAnts,
    peakTick,
    queenAlive: colony.queen.alive,
  };
}

function format(value, width) {
  return String(value).padStart(width);
}

const seeds = Array.from({ length: SEED_COUNT }, (_, index) => `environment-${index + SEED_START}`);

console.log(`Environmental-foraging sweep — ${SEED_COUNT} seeds × ${END_TICK} ticks`
  + (SCENARIO_FILTER ? ` (${SCENARIO_FILTER})` : ''));
console.log(`Target: sustain at least ${TARGET_FINAL_POPULATION} ants at tick ${END_TICK}; `
  + `nest capacity ceiling remains ${TARGET_CAPACITY}.`);
console.log('Pheromone recruitment/dispersion are intentionally unchanged.');
console.log('');
console.log(`${format('scenario', 14)} ${format('avg final', 10)} ${format('min', 6)} ${format('avg peak', 9)} `
  + `${format('avg peak@', 10)} ${format('queen', 7)} ${format('target', 8)}`);

for (const scenario of selectedScenarios) {
  const rows = seeds.map((seed) => runOne(seed, scenario.overrides));
  const finals = rows.map((row) => row.finalAnts);
  const peaks = rows.map((row) => row.peakAnts);
  const peakTicks = rows.map((row) => row.peakTick);
  const queensAlive = rows.filter((row) => row.queenAlive).length;
  const targetHits = rows.filter((row) => row.finalAnts >= TARGET_FINAL_POPULATION).length;

  console.log(`${format(scenario.label, 14)} ${format(mean(finals).toFixed(1), 10)} ${format(Math.min(...finals), 6)} `
    + `${format(mean(peaks).toFixed(1), 9)} ${format(Math.round(mean(peakTicks)), 10)} `
    + `${format(`${queensAlive}/${SEED_COUNT}`, 7)} ${format(`${targetHits}/${SEED_COUNT}`, 8)}`);
}
