/*
 * Growth-brake A/B harness: queenLayingIncomeBrake OFF vs ON, multi-seed.
 *
 * Single-seed runs of this lever flip rank between seeds (v0.52.0: sensitivity
 * 40 beat baseline on seed "growth-brake-ab" but LOST to it on "growth-brake-
 * seed2"), so any verdict needs averaging across seeds — same lesson as
 * bench/forage-ab.mjs. Reports, per condition: peak population, final
 * population at endTick, extinction rate (fraction of seeds that hit 0
 * ants), and cause-of-death totals. Per project convention (see project
 * memory "overshoot-collapse"), endTick must be >=16000 — the colony is
 * still at its pre-collapse peak at 8000.
 *
 * Usage:
 *   node bench/growth-brake-ab.mjs [endTick=18000] [seeds=6] [sensitivity=40]
 */
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

const END_TICK = Number(process.argv[2]) || 18000;
const SEED_COUNT = Number(process.argv[3]) || 6;
const SENSITIVITY = Number(process.argv[4]) || 40;

function runOne(seed, brakeOn) {
  const config = sanitizeTickConfig({
    ...getDefaultConfig(),
    queenLayingIncomeBrake: brakeOn,
    queenLayingTrendSensitivity: SENSITIVITY,
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
    starvation: colony.deathsByCause.starvation,
    oldAge: colony.deathsByCause.oldAge,
  };
}

function summarize(label, rows) {
  const n = rows.length;
  const avg = (key) => rows.reduce((s, r) => s + r[key], 0) / n;
  const extinctions = rows.filter((r) => r.extinct).length;
  console.log(`\n${label}`);
  for (const r of rows) {
    console.log(`  seed ${r.seed.padEnd(24)} peak ${String(r.peakAnts).padStart(4)}@${r.peakTick}`
      + `  final ${String(r.finalAnts).padStart(4)}${r.extinct ? ' (EXTINCT)' : ''}`
      + `  starv ${r.starvation}  oldAge ${r.oldAge}`);
  }
  console.log(`  AVG peak ${avg('peakAnts').toFixed(0)}  AVG final ${avg('finalAnts').toFixed(1)}`
    + `  extinctions ${extinctions}/${n}`);
  return { avgPeak: avg('peakAnts'), avgFinal: avg('finalAnts'), extinctions };
}

const seeds = Array.from({ length: SEED_COUNT }, (_, i) => `growth-brake-ab-${i}`);

const offRows = seeds.map((seed) => ({ seed, ...runOne(seed, false) }));
const onRows = seeds.map((seed) => ({ seed, ...runOne(seed, true) }));

console.log(`Growth brake A/B — endTick=${END_TICK} seeds=${SEED_COUNT} sensitivity=${SENSITIVITY}`);
const off = summarize('BRAKE OFF (baseline)', offRows);
const on = summarize('BRAKE ON', onRows);

// Paired-diff stats (same seed, on - off), not just the two means in isolation.
// A point-estimate diff alone is not a verdict — v0.52.1 shipped on a 6-seed
// diff that didn't hold up (see project memory "overshoot-collapse" /
// feedback "statistical-power-ab"). Report mean, SD, and standard error so a
// diff under ~2 SE from zero reads as "unresolved," not a win or loss.
const diffs = seeds.map((_, i) => onRows[i].finalAnts - offRows[i].finalAnts);
const n = diffs.length;
const meanDiff = diffs.reduce((s, d) => s + d, 0) / n;
const variance = diffs.reduce((s, d) => s + (d - meanDiff) ** 2, 0) / n;
const sd = Math.sqrt(variance);
const se = sd / Math.sqrt(n);
const tStat = se > 0 ? meanDiff / se : 0; // se=0 means zero variance across seeds, i.e. no measurable effect
const significant = se > 0 && Math.abs(tStat) >= 2; // rough 2-SE rule of thumb, not a formal p-value

console.log(`\nPaired diff (on - off) per seed: [${diffs.join(', ')}]`);
console.log(`mean diff ${meanDiff.toFixed(1)}  SD ${sd.toFixed(1)}  SE ${se.toFixed(1)}`
  + `  |diff/SE| ${Math.abs(tStat).toFixed(2)}`);
console.log(`\nVERDICT: avgFinal ${off.avgFinal.toFixed(1)} -> ${on.avgFinal.toFixed(1)}`
  + ` (${meanDiff >= 0 ? '+' : ''}${meanDiff.toFixed(1)}, ${significant ? 'SIGNIFICANT' : 'NOT significant — unresolved at this n'})`
  + `, extinctions ${off.extinctions}/${SEED_COUNT} -> ${on.extinctions}/${SEED_COUNT}`);
