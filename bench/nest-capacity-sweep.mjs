/*
 * Nest-space capacity sweep: multi-seed comparison across several
 * nestSpaceBaseCapacity values (see v0.54.0's single-seed sanity check,
 * which showed cap=120 flattening the peak vs cap=300 on ONE seed --
 * per this session's statistical-power lesson (growth-brake saga:
 * docs/starvation-collapse-rca-2026-06-02.md), that is not enough to
 * validate a default. This sweeps at n=20 seeds, paired against the
 * shipped default (300), reporting peak/final mean, SD, SE, and the
 * 2-SE significance rule.
 *
 * Usage:
 *   node bench/nest-capacity-sweep.mjs [ticks=18000] [seeds=20] [values=80,150,300,450,600]
 */
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

const END_TICK = Number(process.argv[2]) || 18000;
const SEED_COUNT = Number(process.argv[3]) || 20;
const VALUES = (process.argv[4] || '80,150,300,450,600').split(',').map(Number);
const BASELINE = 300; // currently shipped default

function runOne(seed, capacity) {
  const config = sanitizeTickConfig({ ...getDefaultConfig(), nestSpaceBaseCapacity: capacity });
  const sim = new SimulationCore(seed);
  const colony = sim.colony;
  let peakAnts = 0;
  for (let tick = 0; tick <= END_TICK; tick += 1) {
    sim.update(config);
    const n = colony.ants.length;
    if (n > peakAnts) peakAnts = n;
  }
  return { peakAnts, finalAnts: colony.ants.length, extinct: colony.ants.length === 0 };
}

function pairedStats(diffs) {
  const n = diffs.length;
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  const t = se > 0 ? mean / se : 0;
  return { mean, sd, se, t, significant: se > 0 && Math.abs(t) >= 2 };
}

const seeds = Array.from({ length: SEED_COUNT }, (_, i) => `growth-brake-ab-${i}`);

console.log(`Nest-capacity sweep — endTick=${END_TICK} seeds=${SEED_COUNT} values=${VALUES.join(',')} baseline=${BASELINE}`);

const baselineRows = seeds.map((seed) => ({ seed, ...runOne(seed, BASELINE) }));
const baselineAvgPeak = baselineRows.reduce((s, r) => s + r.peakAnts, 0) / SEED_COUNT;
const baselineAvgFinal = baselineRows.reduce((s, r) => s + r.finalAnts, 0) / SEED_COUNT;
console.log(`\nBASELINE (cap=${BASELINE}): avgPeak ${baselineAvgPeak.toFixed(1)}  avgFinal ${baselineAvgFinal.toFixed(1)}`
  + `  extinctions ${baselineRows.filter((r) => r.extinct).length}/${SEED_COUNT}`);

for (const capacity of VALUES) {
  if (capacity === BASELINE) continue;
  const rows = seeds.map((seed) => ({ seed, ...runOne(seed, capacity) }));
  const avgPeak = rows.reduce((s, r) => s + r.peakAnts, 0) / SEED_COUNT;
  const avgFinal = rows.reduce((s, r) => s + r.finalAnts, 0) / SEED_COUNT;
  const extinctions = rows.filter((r) => r.extinct).length;

  const peakDiffs = seeds.map((_, i) => rows[i].peakAnts - baselineRows[i].peakAnts);
  const finalDiffs = seeds.map((_, i) => rows[i].finalAnts - baselineRows[i].finalAnts);
  const peakStats = pairedStats(peakDiffs);
  const finalStats = pairedStats(finalDiffs);

  console.log(`\ncap=${capacity}: avgPeak ${avgPeak.toFixed(1)} (diff ${peakStats.mean >= 0 ? '+' : ''}${peakStats.mean.toFixed(1)}, `
    + `SE ${peakStats.se.toFixed(1)}, |t| ${Math.abs(peakStats.t).toFixed(2)}${peakStats.significant ? ' SIG' : ''})`
    + `  avgFinal ${avgFinal.toFixed(1)} (diff ${finalStats.mean >= 0 ? '+' : ''}${finalStats.mean.toFixed(1)}, `
    + `SE ${finalStats.se.toFixed(1)}, |t| ${Math.abs(finalStats.t).toFixed(2)}${finalStats.significant ? ' SIG' : ''})`
    + `  extinctions ${extinctions}/${SEED_COUNT}`);
}
