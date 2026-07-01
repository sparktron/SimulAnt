/*
 * Growth-brake sensitivity sweep: multi-seed comparison across several
 * queenLayingTrendSensitivity values (see bench/growth-brake-ab.mjs, which
 * validated sensitivity=40 as a WIN vs baseline — 6 seeds x 18000 ticks,
 * avg final pop 22.2->46.5, extinctions 1/6->0/6). Single-seed sensitivity
 * checks during that work were misleading (20/30/40/60 looked safe, 80
 * looked fatal, on ONE seed) — this sweep re-checks that ranking across
 * multiple seeds before trusting it.
 *
 * Usage:
 *   node bench/growth-brake-sensitivity-sweep.mjs [ticks=16000] [seeds=5] [sensitivities=20,40,60,80,100,140]
 */
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

const END_TICK = Number(process.argv[2]) || 16000;
const SEED_COUNT = Number(process.argv[3]) || 5;
const SENSITIVITIES = (process.argv[4] || '20,40,60,80,100,140').split(',').map(Number);

function runOne(seed, sensitivity) {
  const config = sanitizeTickConfig({
    ...getDefaultConfig(),
    queenLayingIncomeBrake: sensitivity > 0,
    queenLayingTrendSensitivity: sensitivity,
  });
  const sim = new SimulationCore(seed);
  const colony = sim.colony;

  let peakAnts = 0;
  let peakTick = 0;
  for (let tick = 0; tick <= END_TICK; tick += 1) {
    sim.update(config);
    const n = colony.ants.length;
    if (n > peakAnts) { peakAnts = n; peakTick = tick; }
  }

  return {
    peakAnts,
    peakTick,
    finalAnts: colony.ants.length,
    extinct: colony.ants.length === 0,
  };
}

const seeds = Array.from({ length: SEED_COUNT }, (_, i) => `sens-sweep-${i}`);

console.log(`Sensitivity sweep — endTick=${END_TICK} seeds=${SEED_COUNT} values=${SENSITIVITIES.join(',')}`);
console.log('(sensitivity=0 means brake OFF, i.e. baseline)\n');

const results = [];
for (const sensitivity of [0, ...SENSITIVITIES]) {
  const rows = seeds.map((seed) => ({ seed, ...runOne(seed, sensitivity) }));
  const n = rows.length;
  const avgFinal = rows.reduce((s, r) => s + r.finalAnts, 0) / n;
  const avgPeak = rows.reduce((s, r) => s + r.peakAnts, 0) / n;
  const extinctions = rows.filter((r) => r.extinct).length;
  results.push({ sensitivity, avgFinal, avgPeak, extinctions });
  console.log(`sensitivity=${String(sensitivity).padStart(4)}  avgPeak ${avgPeak.toFixed(0).padStart(4)}`
    + `  avgFinal ${avgFinal.toFixed(1).padStart(6)}  extinctions ${extinctions}/${n}`
    + `  [${rows.map((r) => r.finalAnts).join(',')}]`);
}

const best = results.slice(1).reduce((a, b) => {
  if (b.extinctions !== a.extinctions) return b.extinctions < a.extinctions ? b : a;
  return b.avgFinal > a.avgFinal ? b : a;
});
console.log(`\nBEST: sensitivity=${best.sensitivity} (avgFinal ${best.avgFinal.toFixed(1)}, extinctions ${best.extinctions}/${SEED_COUNT})`);
