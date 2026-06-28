/*
 * Depletion-reactive decay parameter sweep.
 *
 * Companion to forage-ab.mjs. Where that harness compares ONE config (trails ON
 * vs OFF), this sweeps MANY depletion-reactive configs against a SHARED trails-OFF
 * baseline. The OFF condition is identical for every harvest-param config, so it
 * is computed ONCE per seed and reused — every candidate is scored against a
 * byte-identical baseline on the same world/food.
 *
 * Metric instrumentation mirrors forage-ab.mjs exactly (nutrition wrap, pickups,
 * circling window, PR) so results are directly comparable. trailGain = (ON.nut -
 * OFF.nut)/OFF.nut; the win condition is pickups ON >= OFF (see Phase 2).
 *
 * Usage:
 *   node bench/forage-sweep.mjs [ticks=5000] [seeds=6]
 *
 * Edit CONFIGS below to define the sweep. Shipped defaults (v0.48.x):
 *   depletionDecayBoost 0.3, harvestProtectRef 0.2, harvestRadius 10,
 *   evapHarvest 0.5, harvestDeposit 1.0, harvestMaxClamp 2.0.
 */
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

const TICKS = Number(process.argv[2]) || 5000;
const SEED_COUNT = Number(process.argv[3]) || 6;

// Dual-mode shorthand (depletion-reactive route channel stays ON via defaults;
// dualPheromone adds the recruitment channel on top).
const DUAL = (o) => ({ dualPheromone: true, ...o });

const CONFIGS = [
  { name: 'OFF',                ov: { enablePheromones: false } },
  { name: 'single(shipped)',    ov: {} },                                   // the bar to beat
  { name: 'dual-rich',          ov: DUAL({}) },                             // rich-only (new default gate)
  { name: 'dual-rich,follow2',  ov: DUAL({ recruitFollowWeight: 2.0 }) },   // rich → stronger pull may be safe now
  { name: 'dual-rich,follow4',  ov: DUAL({ recruitFollowWeight: 4.0 }) },
  { name: 'dual-rich,deposit4', ov: DUAL({ depositRecruit: 4.0 }) },
  { name: 'dual-rich,diff0.15', ov: DUAL({ diffRecruit: 0.15 }) },
  { name: 'dual-allpickups',    ov: DUAL({ recruitRichOnly: false }) },     // old un-gated behavior (control)
];

const CIRCLE_WINDOW = 30;
const CIRCLE_MAX_DISP = 5;
const CIRCLE_MIN_NEST_DIST = 15;
const PR_SAMPLE_EVERY = 100;

function runOne(seed, overrides) {
  const config = sanitizeTickConfig({ ...getDefaultConfig(), ...overrides });
  const sim = new SimulationCore(seed);
  const colony = sim.colony;
  const world = sim.world;

  let nutrition = 0;
  const origDeposit = colony.depositFoodFromAnt.bind(colony);
  colony.depositFoodFromAnt = (ant, entrance = null, dropPoint = null) => {
    const pending = ant?.carrying?.type === 'food' ? (ant.carrying.pelletNutrition || 0) : 0;
    const ok = origDeposit(ant, entrance, dropPoint);
    if (ok) nutrition += pending;
    return ok;
  };

  let pickups = 0;
  let circlingTicks = 0;
  let carryTicks = 0;
  let prSum = 0;
  let prSamples = 0;
  const halfTicks = TICKS / 2;
  const wasCarrying = new Map();
  const carryTrack = new Map();

  for (let tick = 1; tick <= TICKS; tick += 1) {
    sim.update(config);
    const alive = new Set();
    for (const ant of colony.ants) {
      alive.add(ant.id);
      const carrying = ant.carrying?.type === 'food';
      const prev = wasCarrying.get(ant.id) || false;
      if (carrying && !prev) pickups += 1;
      wasCarrying.set(ant.id, carrying);
      if (carrying) {
        carryTicks += 1;
        let buf = carryTrack.get(ant.id);
        if (!buf) { buf = []; carryTrack.set(ant.id, buf); }
        buf.push(ant.x, ant.y);
        if (buf.length > (CIRCLE_WINDOW + 1) * 2) buf.splice(0, 2);
        if (buf.length >= (CIRCLE_WINDOW + 1) * 2) {
          const dx = buf[buf.length - 2] - buf[0];
          const dy = buf[buf.length - 1] - buf[1];
          const entrance = colony.nearestEntrance(ant.x, ant.y);
          const nestDist = entrance ? Math.hypot(ant.x - entrance.x, ant.y - entrance.y) : Infinity;
          if (Math.hypot(dx, dy) < CIRCLE_MAX_DISP && nestDist > CIRCLE_MIN_NEST_DIST) circlingTicks += 1;
        }
      } else if (carryTrack.has(ant.id)) {
        carryTrack.delete(ant.id);
      }
    }
    if (tick % 500 === 0) {
      for (const id of wasCarrying.keys()) if (!alive.has(id)) wasCarrying.delete(id);
      for (const id of carryTrack.keys()) if (!alive.has(id)) carryTrack.delete(id);
    }
    if (tick > halfTicks && tick % PR_SAMPLE_EVERY === 0) {
      let s = 0; let s2 = 0;
      const f = world.toFood;
      for (let i = 0; i < f.length; i += 1) { const v = f[i]; s += v; s2 += v * v; }
      if (s2 > 0) { prSum += (s * s) / s2; prSamples += 1; }
    }
  }
  return { nutrition, pickups, circling: circlingTicks, carryTicks, pr: prSamples ? prSum / prSamples : 0, finalAnts: colony.ants.length };
}

function pad(s, n) { return String(s).padStart(n); }
function padE(s, n) { return String(s).padEnd(n); }
function pct(x) { return `${(x * 100 >= 0 ? '+' : '')}${(x * 100).toFixed(1)}%`; }

console.log(`Depletion-reactive sweep — ${SEED_COUNT} seeds x ${TICKS} ticks (shared OFF baseline)\n`);

const agg = CONFIGS.map(() => ({ nut: 0, pick: 0, circ: 0, carry: 0, pr: 0, ants: 0 }));
for (let s = 0; s < SEED_COUNT; s += 1) {
  const seed = `ab-${s}`;
  for (let c = 0; c < CONFIGS.length; c += 1) {
    const r = runOne(seed, CONFIGS[c].ov);
    agg[c].nut += r.nutrition; agg[c].pick += r.pickups; agg[c].circ += r.circling;
    agg[c].carry += r.carryTicks; agg[c].pr += r.pr; agg[c].ants += r.finalAnts;
  }
  process.stderr.write(`  seed ${seed} done\n`);
}

const offNut = agg[0].nut;
const offPick = agg[0].pick / SEED_COUNT;
console.log(`${padE('config', 20)} ${pad('nut', 8)} ${pad('trailGain', 10)} ${pad('pickups', 8)} `
  + `${pad('vsOFF', 7)} ${pad('PR', 7)} ${pad('circ%', 7)} ${pad('ants', 6)}`);
CONFIGS.forEach((cfg, c) => {
  const a = agg[c];
  const nut = a.nut / SEED_COUNT;
  const gain = offNut > 0 ? (a.nut - offNut) / offNut : 0;
  const pick = a.pick / SEED_COUNT;
  const circRate = a.carry > 0 ? a.circ / a.carry : 0;
  const pickDelta = pick - offPick;
  console.log(`${padE(cfg.name, 20)} ${pad(nut.toFixed(0), 8)} ${pad(c === 0 ? '—' : pct(gain), 10)} `
    + `${pad(pick.toFixed(0), 8)} ${pad(c === 0 ? '—' : (pickDelta >= 0 ? `+${pickDelta.toFixed(0)}` : pickDelta.toFixed(0)), 7)} `
    + `${pad((a.pr / SEED_COUNT).toFixed(0), 7)} ${pad((circRate * 100).toFixed(1), 7)} ${pad((a.ants / SEED_COUNT).toFixed(0), 6)}`);
});
