// Read-only behaviour probe. Usage: node probe.mjs <repo> [seed] [ticks]
const repo = process.argv[2];
const SEED = process.argv[3] || 'probe-a';
const TICKS = Number(process.argv[4]) || 9000;
const { SimulationCore } = await import(`${repo}/src/sim/SimulationCore.js`);
const { getDefaultConfig } = await import(`${repo}/src/ui/params.js`);
const { sanitizeTickConfig } = await import(`${repo}/src/sim/core/SimulationTypes.js`);
const { TERRAIN } = await import(`${repo}/src/sim/world.js`);

const config = sanitizeTickConfig({ ...getDefaultConfig(), ...(process.env.OV ? JSON.parse(process.env.OV) : {}) });
const sim = new SimulationCore(SEED);
const cols = [sim.colony, sim.rivalColony];
const w = sim.world;

const S = {};
for (const c of cols) {
  const s = S[c.id] = {
    stateTicks: {}, focusStateTicks: {}, focusFlips: 0, antTicks: 0,
    intruderTicks: 0, intruderEat: 0, feedQueen: 0, queenSelfEat: 0, queenSelfEatAmt: 0, feedQueenAmt: 0,
    depTunnel: 0, depChamber: 0, depDist: [], depDepth: [],
    stuck: {}, deathsWhere: { surface: 0, nest: 0 }, seekFlick: 0, seekRuns: 0,
    hungerBonus: 0, deposited: 0, consumed: 0, eatUnderRival: 0,
    soldierUnder: 0, soldierTicks: 0, oldInNest: 0, oldTicks: 0,
    dropRetarget: 0, storeTicks: 0, popSeries: [], dupTiles: 0,
  };
  const od = c.depositPellet.bind(c);
  c.depositPellet = (n, x, y, e = null) => {
    const before = c.nestFoodPellets.length;
    const got = od(n, x, y, e);
    if (got > 0 && c.nestFoodPellets.length > before) {
      const p = c.nestFoodPellets[c.nestFoodPellets.length - 1];
      const t = w.terrain[w.index(p.x, p.y)];
      if (t === TERRAIN.TUNNEL) s.depTunnel += 1; else s.depChamber += 1;
      const en = c.nearestEntrance(p.x, p.y);
      if (en) { s.depDist.push(Math.hypot(p.x - en.x, p.y - en.y)); s.depDepth.push(p.y - en.y); }
      s.deposited += got;
    }
    return got;
  };
  const oc = c.consumeFromStore.bind(c);
  c.consumeFromStore = (a) => { const g = oc(a); s.consumed += g; return g; };
  const of = c.feedQueen.bind(c);
  c.feedQueen = (n, cfg) => { const g = of(n, cfg); if (g > 0) { s.feedQueen += 1; s.feedQueenAmt += g; } return g; };
}

const track = new Map(); // ant -> {x,y,t,focus,seekRun,state}
function census(tick) {
  for (const c of cols) {
    const s = S[c.id];
    const other = cols.find((o) => o !== c);
    for (const a of c.ants) {
      s.antTicks += 1;
      s.stateTicks[a.state] = (s.stateTicks[a.state] || 0) + 1;
      const key = `${a.role === 'soldier' ? 'soldier' : a.workFocus}`;
      (s.focusStateTicks[key] ||= {})[a.state] = (s.focusStateTicks[key][a.state] || 0) + 1;
      const under = w.isBelowSurface(a.x, a.y);
      if (under && Math.abs(a.x - other.homeX) < Math.abs(a.x - c.homeX)) s.intruderTicks += 1;
      if (a.role === 'soldier') { s.soldierTicks += 1; if (under) s.soldierUnder += 1; }
      if (a.age > a.maxAge * 0.8) { s.oldTicks += 1; if (under) s.oldInNest += 1; }
      let tr = track.get(a);
      if (!tr) { tr = { x: a.x, y: a.y, t: tick, focus: a.workFocus, seekRun: 0, drop: null }; track.set(a, tr); }
      if (tr.focus !== a.workFocus) { s.focusFlips += 1; tr.focus = a.workFocus; }
      if (a.state === 'SEEK_FIGHT') tr.seekRun += 1;
      else if (tr.seekRun > 0) { s.seekRuns += 1; if (tr.seekRun <= 2) s.seekFlick += 1; tr.seekRun = 0; }
      if (a.state === 'STORE_FOOD_IN_NEST') s.storeTicks += 1;
      if (tick - tr.t >= 90) {
        const disp = Math.hypot(a.x - tr.x, a.y - tr.y);
        const resting = a.state === 'FIGHT' || a.state === 'HEAL_IN_NEST' || a.state === 'EAT';
        if (disp < 2 && !resting) s.stuck[`${key}:${a.state}`] = (s.stuck[`${key}:${a.state}`] || 0) + 1;
        tr.x = a.x; tr.y = a.y; tr.t = tick;
      }
    }
  }
}

const deathsLog = { black: {}, red: {} };
for (let t = 1; t <= TICKS; t += 1) {
  const before = cols.map((c) => new Map(c.ants.map((a) => [a, { x: a.x, y: a.y }])));
  const qh = cols.map((c) => c.queen.hunger);
  sim.update(config);
  cols.forEach((c, i) => {
    const s = S[c.id];
    if (c.queen.alive && c.queen.hunger > qh[i] + 0.01) { /* fed by someone */ }
    const alive = new Set(c.ants);
    for (const [a, p] of before[i]) {
      if (!alive.has(a)) { if (w.isBelowSurface(p.x, p.y)) s.deathsWhere.nest += 1; else s.deathsWhere.surface += 1; track.delete(a); }
    }
    if (t % 500 === 0) s.popSeries.push(`${t}:${c.ants.length}/${Math.round(c.foodStored)}/${c.larvae.length}`);
  });
  census(t);
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : 'n/a');
const top = (o, n = 8) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}=${v}`).join(' ');
const q = (arr, p) => { if (!arr.length) return 'n/a'; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))].toFixed(1); };
for (const c of cols) {
  const s = S[c.id];
  console.log(`\n=== ${c.id} seed=${SEED} ticks=${TICKS} ===`);
  console.log('pop/food/larvae:', s.popSeries.join(' '));
  console.log('final ants', c.ants.length, 'births', c.births, 'deaths', c.deaths, JSON.stringify(c.deathsByCause), 'queenAlive', c.queen.alive, 'succ', c.queenSuccessions);
  console.log('deathsWhere', JSON.stringify(s.deathsWhere));
  console.log('foodStored', Math.round(c.foodStored), 'target', c.foodStoreTarget, 'deposited', Math.round(s.deposited), 'consumed', Math.round(s.consumed), 'nestPellets', c.nestFoodPellets.length);
  console.log('deposits tunnel/chamber', s.depTunnel, s.depChamber, 'dist-to-mouth p10/p50/p90', q(s.depDist, 0.1), q(s.depDist, 0.5), q(s.depDist, 0.9), 'depth p50', q(s.depDepth, 0.5));
  console.log('queen fed by ants', s.feedQueen, 'amt', Math.round(s.feedQueenAmt), 'eggs', c.queen.eggsLaid, 'excavated', c.excavatedTiles);
  console.log('intruder ant-ticks (underground on rival side):', s.intruderTicks, pct(s.intruderTicks, s.antTicks));
  console.log('soldier underground share', pct(s.soldierUnder, s.soldierTicks), ' senescent in-nest share', pct(s.oldInNest, s.oldTicks));
  console.log('focus flips', s.focusFlips, 'per 1000 ant-ticks', (1000 * s.focusFlips / s.antTicks).toFixed(2));
  console.log('SEEK_FIGHT runs', s.seekRuns, 'of which <=2 ticks', s.seekFlick);
  console.log('STORE_FOOD_IN_NEST share', pct(s.storeTicks, s.antTicks));
  for (const [k, v] of Object.entries(s.focusStateTicks)) {
    const tot = Object.values(v).reduce((a, b) => a + b, 0);
    console.log(`  [${k}] ${pct(tot, s.antTicks)} :`, Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 9).map(([st, n]) => `${st} ${pct(n, tot)}`).join(', '));
  }
  console.log('stuck (90-tick windows, <2 tiles):', top(s.stuck, 12));
}
console.log('\nduels', sim.combatSystem.battles, 'antlions', sim.antLionSystem.lions.length, 'surface pellets', sim.foodPellets.length);
