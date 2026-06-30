/*
 * Starvation collapse trace (fixed seed, deterministic).
 *
 * Profiling (docs/perf-profile-2026-06-02.md) showed the colony peaks ~129 ants
 * then starves to zero by ~tick 6000, with ~215 pellets left UNCOLLECTED on the
 * surface. That points at a food-logistics collapse, not food scarcity. This
 * trace logs the food economy over time to find where income stops covering
 * consumption and where the death spiral begins.
 *
 *   node bench/starvation-trace.mjs [endTick=7000] [sample=250]
 */
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

const END_TICK = Number(process.argv[2]) || 7000;
const SAMPLE = Number(process.argv[3]) || 250;
const SEED = process.env.TRACE_SEED || 'tick-profile';

// Config overrides via env TRACE_OV (JSON), e.g.
//   TRACE_OV='{"foodReservePerAnt":0,"foodMinReserve":0}'  → hunger trigger OFF (old behavior)
const OVERRIDES = process.env.TRACE_OV ? JSON.parse(process.env.TRACE_OV) : {};
const config = sanitizeTickConfig({ ...getDefaultConfig(), ...OVERRIDES });
if (Object.keys(OVERRIDES).length) console.log(`# overrides: ${JSON.stringify(OVERRIDES)}`);
const sim = new SimulationCore(SEED);
const colony = sim.colony;

// Instrument food income (deposits) and consumption (store draws).
let depositedNutrition = 0;
let depositEvents = 0;
const origDeposit = colony.depositPellet.bind(colony);
colony.depositPellet = (nutrition, x, y, entrance = null) => {
  const got = origDeposit(nutrition, x, y, entrance);
  if (got > 0) { depositedNutrition += got; depositEvents += 1; }
  return got;
};
let consumedNutrition = 0;
const origConsume = colony.consumeFromStore.bind(colony);
colony.consumeFromStore = (amount) => {
  const got = origConsume(amount);
  consumedNutrition += got;
  return got;
};

function roleCounts() {
  const c = {};
  for (const a of colony.ants) c[a.role] = (c[a.role] || 0) + 1;
  return c;
}
function stateCounts() {
  const c = {};
  for (const a of colony.ants) c[a.state] = (c[a.state] || 0) + 1;
  return c;
}
function avgHunger() {
  if (!colony.ants.length) return 0;
  let s = 0; for (const a of colony.ants) s += a.hunger / (a.hungerMax || 100);
  return s / colony.ants.length;
}
function avgHealth() {
  if (!colony.ants.length) return 0;
  let s = 0; for (const a of colony.ants) s += a.health / (a.healthMax || 100);
  return s / colony.ants.length;
}

const hdr = ['tick', 'ants', 'queenHP', 'foodStrd', 'virtRem', 'realFood',
  'in/win', 'out/win', 'net', 'pelletsUp', 'dDeaths', 'S/A/H/O', 'avgHun', 'avgHlth'];
console.log(hdr.map((h) => h.padStart(8)).join(' '));

let prevDeaths = 0;
let prevCause = { starvation: 0, oldAge: 0, hazard: 0, other: 0 };

// Survival summary accumulators.
let peakAnts = 0;
let peakTick = 0;
let collapseTick = -1; // first tick the colony hits 0 after having had ants

for (let tick = 0; tick <= END_TICK; tick += 1) {
  if (tick % SAMPLE === 0) {
    const dDeaths = colony.deaths - prevDeaths;
    const dc = colony.deathsByCause;
    const ds = `${dc.starvation - prevCause.starvation}/${dc.oldAge - prevCause.oldAge}/${dc.hazard - prevCause.hazard}/${dc.other - prevCause.other}`;
    const real = colony.foodStored - colony._virtualFoodStored;
    const net = depositedNutrition - consumedNutrition;
    const row = [
      tick,
      colony.ants.length,
      colony.queen ? (colony.queen.health / (colony.queen.healthMax || 100)).toFixed(2) : '-',
      colony.foodStored.toFixed(0),
      colony._virtualFoodStored.toFixed(0),
      real.toFixed(0),
      depositedNutrition.toFixed(0),
      consumedNutrition.toFixed(0),
      net.toFixed(0),
      colony.surfaceFoodPellets.length,
      dDeaths,
      ds,
      avgHunger().toFixed(2),
      avgHealth().toFixed(2),
    ];
    console.log(row.map((c) => String(c).padStart(8)).join(' '));
    if ([1000, 2000, 2500, 3500].includes(tick)) {
      const sc = stateCounts();
      const compact = Object.entries(sc).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`).join('  ');
      console.log(`   @${tick} states: ${compact}`);
    }
    prevDeaths = colony.deaths;
    prevCause = { ...dc };
    depositedNutrition = 0; consumedNutrition = 0; depositEvents = 0;
  }
  sim.update(config);

  const n = colony.ants.length;
  if (n > peakAnts) { peakAnts = n; peakTick = tick; }
  if (n === 0 && peakAnts > 0 && collapseTick < 0) collapseTick = tick;
}

console.log('\nfinal role counts:', roleCounts());
console.log('final state counts:', stateCounts());
console.log('cumulative deathsByCause:', colony.deathsByCause);
console.log(`\nSURVIVAL: peak ${peakAnts} @${peakTick} | final ${colony.ants.length} `
  + `| collapse ${collapseTick < 0 ? 'NONE' : `@${collapseTick}`} `
  + `| starved ${colony.deathsByCause.starvation} oldAge ${colony.deathsByCause.oldAge}`);
