/*
 * Foraging A/B harness: trails-ON vs trails-OFF on identical seeds.
 *
 * Persists the headless methodology from docs/pheromone-strategy.md (its overdue
 * item #6) so pheromone experiments stop living in /tmp and can be re-run. For
 * each fixed seed it runs the real SimulationCore twice — once with pheromones
 * enabled, once with enablePheromones:false — on the SAME seed (identical world
 * and food spawns) and reports the four metrics the strategy doc settled on:
 *
 *   nutrition  food actually delivered to the nest (wraps colony.depositFoodFromAnt) —
 *              the headline gathering metric, free of consumption/respawn noise
 *   pickups    distinct none->food carry transitions — discovery rate (the real bottleneck)
 *   PR         (Σv)²/Σv² over world.toFood, averaged over the back half — trail convergence
 *              (LOW = few strong corridors, HIGH = fragmented fan)
 *   circling   carry-ticks with <5 tiles net displacement over a 30-tick window — death spirals
 *
 * Usage:
 *   node bench/forage-ab.mjs [ticks=5000] [seeds=6]
 *   node bench/forage-ab.mjs 1500 2          # fast smoke
 *
 * trailGain = (ON.nutrition - OFF.nutrition) / OFF.nutrition. Positive means
 * trails beat no-trails. Per docs/pheromone-strategy.md this is roughly
 * break-even (~-7%) at foodVisionRadius 18. Edit CONFIG_OVERRIDES below to sweep
 * a parameter; the harness always starts from a full getDefaultConfig() so the
 * sanitizer's inert fallbacks never silently alter physics (see Phase 0).
 */
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

const TICKS = Number(process.argv[2]) || 5000;
const SEED_COUNT = Number(process.argv[3]) || 6;

// Extra overrides applied to BOTH conditions (e.g. { foodVisionRadius: 24 }).
// Set via the AB_OVERRIDES env var as JSON for ergonomic sweeps, e.g.
//   AB_OVERRIDES='{"headingBias":0.2}' node bench/forage-ab.mjs 5000 6
// Falls back to empty (baseline) when unset.
const CONFIG_OVERRIDES = process.env.AB_OVERRIDES ? JSON.parse(process.env.AB_OVERRIDES) : {};

const CIRCLE_WINDOW = 30;       // ticks
const CIRCLE_MAX_DISP = 5;      // tiles of net displacement to count as circling
const CIRCLE_MIN_NEST_DIST = 15; // only count circling out on the open return path,
                                 // not nest drop-off logistics / entrance congestion
const PR_SAMPLE_EVERY = 100;    // ticks between participation-ratio samples

function runOne(seed, ticks, pheromonesEnabled) {
  const config = sanitizeTickConfig({
    ...getDefaultConfig(),
    ...CONFIG_OVERRIDES,
    enablePheromones: pheromonesEnabled,
  });

  const sim = new SimulationCore(seed);
  const colony = sim.colony;
  const world = sim.world;

  // --- Nutrition gathered: wrap the canonical deposit, sum on success. ---
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
  const halfTicks = ticks / 2;

  const wasCarrying = new Map();   // ant.id -> bool (food carry last tick)
  const carryTrack = new Map();    // ant.id -> ring buffer of {x,y} while carrying

  for (let tick = 1; tick <= ticks; tick += 1) {
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

    // Prune dead ants so the maps don't grow unbounded over a long run.
    if (tick % 500 === 0) {
      for (const id of wasCarrying.keys()) if (!alive.has(id)) wasCarrying.delete(id);
      for (const id of carryTrack.keys()) if (!alive.has(id)) carryTrack.delete(id);
    }

    // Participation ratio over the steady-state back half.
    if (tick > halfTicks && tick % PR_SAMPLE_EVERY === 0) {
      let s = 0; let s2 = 0;
      const f = world.toFood;
      for (let i = 0; i < f.length; i += 1) { const v = f[i]; s += v; s2 += v * v; }
      if (s2 > 0) { prSum += (s * s) / s2; prSamples += 1; }
    }
  }

  return {
    nutrition,
    pickups,
    circling: circlingTicks,
    carryTicks,
    pr: prSamples ? prSum / prSamples : 0,
    finalAnts: colony.ants.length,
  };
}

function pad(s, n) { return String(s).padStart(n); }
function pct(x) { return `${(x * 100 >= 0 ? '+' : '')}${(x * 100).toFixed(1)}%`; }

console.log(`Foraging A/B — ${SEED_COUNT} seeds x ${TICKS} ticks (ON vs OFF, same seed)`);
if (Object.keys(CONFIG_OVERRIDES).length) {
  console.log(`overrides: ${JSON.stringify(CONFIG_OVERRIDES)}`);
}
console.log('');
console.log(`${pad('seed', 8)} ${pad('ON nut', 9)} ${pad('OFF nut', 9)} ${pad('gain', 8)} `
  + `${pad('ON pick', 8)} ${pad('OFF pick', 9)} ${pad('ON PR', 8)} ${pad('ON circ', 8)} ${pad('ON ants', 8)}`);

const agg = { onNut: 0, offNut: 0, onPick: 0, offPick: 0, onPr: 0, onCirc: 0, onCarry: 0, onAnts: 0, offAnts: 0 };

for (let s = 0; s < SEED_COUNT; s += 1) {
  const seed = `ab-${s}`;
  const on = runOne(seed, TICKS, true);
  const off = runOne(seed, TICKS, false);
  const gain = off.nutrition > 0 ? (on.nutrition - off.nutrition) / off.nutrition : 0;

  agg.onNut += on.nutrition; agg.offNut += off.nutrition;
  agg.onPick += on.pickups; agg.offPick += off.pickups;
  agg.onPr += on.pr; agg.onCirc += on.circling; agg.onCarry += on.carryTicks;
  agg.onAnts += on.finalAnts; agg.offAnts += off.finalAnts;

  console.log(`${pad(seed, 8)} ${pad(on.nutrition.toFixed(0), 9)} ${pad(off.nutrition.toFixed(0), 9)} `
    + `${pad(pct(gain), 8)} ${pad(on.pickups, 8)} ${pad(off.pickups, 9)} `
    + `${pad(on.pr.toFixed(0), 8)} ${pad(on.circling, 8)} ${pad(on.finalAnts, 8)}`);
}

const meanGain = agg.offNut > 0 ? (agg.onNut - agg.offNut) / agg.offNut : 0;
const circRate = agg.onCarry > 0 ? agg.onCirc / agg.onCarry : 0;
console.log('');
console.log(`MEAN  trailGain ${pct(meanGain)}  |  nutrition ON ${(agg.onNut / SEED_COUNT).toFixed(0)} `
  + `vs OFF ${(agg.offNut / SEED_COUNT).toFixed(0)}  |  pickups ON ${(agg.onPick / SEED_COUNT).toFixed(0)} `
  + `vs OFF ${(agg.offPick / SEED_COUNT).toFixed(0)}`);
console.log(`      PR(ON) ${(agg.onPr / SEED_COUNT).toFixed(0)}  |  circling ${(circRate * 100).toFixed(2)}% of carry-ticks  `
  + `|  final ants ON ${(agg.onAnts / SEED_COUNT).toFixed(0)} vs OFF ${(agg.offAnts / SEED_COUNT).toFixed(0)}`);
