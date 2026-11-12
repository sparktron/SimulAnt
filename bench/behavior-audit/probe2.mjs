const repo = process.argv[2]; const SEED = process.argv[3] || 'probe-a'; const TICKS = Number(process.argv[4]) || 16000;
const { SimulationCore } = await import(`${repo}/src/sim/SimulationCore.js`);
const { getDefaultConfig } = await import(`${repo}/src/ui/params.js`);
const { sanitizeTickConfig } = await import(`${repo}/src/sim/core/SimulationTypes.js`);
const { TERRAIN } = await import(`${repo}/src/sim/world.js`);
const config = sanitizeTickConfig({ ...getDefaultConfig(), ...(process.env.OV ? JSON.parse(process.env.OV) : {}) });
const sim = new SimulationCore(SEED); const cols = [sim.colony, sim.rivalColony]; const w = sim.world;
const raw = { black: {}, red: {} }; const stuckPos = { black: {}, red: {} }; const series = { black: [], red: [] };
const lionKillsNear = []; const ageAtDeath = { black: [], red: [] };
for (const c of cols) { const o = c.recordDeath.bind(c); c.recordDeath = (cause) => { raw[c.id][cause] = (raw[c.id][cause] || 0) + 1; o(cause); }; }
const track = new Map();
let revisits = 0, lionDeaths = 0;
for (let t = 1; t <= TICKS; t++) {
  const pre = cols.map((c) => new Set(c.ants));
  sim.update(config);
  cols.forEach((c, i) => {
    const alive = new Set(c.ants);
    for (const a of pre[i]) if (!alive.has(a)) ageAtDeath[c.id].push(a.age / a.maxAge);
    for (const a of c.ants) {
      let tr = track.get(a); if (!tr) { tr = { x: a.x, y: a.y, t }; track.set(a, tr); }
      if (t - tr.t >= 90) {
        if (Math.hypot(a.x - tr.x, a.y - tr.y) < 2 && !['FIGHT', 'HEAL_IN_NEST', 'EAT'].includes(a.state)) {
          const en = c.nearestEntrance(a.x, a.y);
          const k = `${a.workFocus}:${a.state}@dx${a.x - en.x},dy${a.y - en.y},carry=${a.carrying?.type || '-'},hung=${Math.round(a.hunger / 10) * 10},hp=${Math.round(a.health / 10) * 10}`;
          stuckPos[c.id][k] = (stuckPos[c.id][k] || 0) + 1;
        }
        tr.x = a.x; tr.y = a.y; tr.t = t;
      }
    }
    if (t % 1000 === 0) {
      const hungry = c.ants.filter((a) => a.hunger <= 0).length;
      const old = c.ants.filter((a) => a.age > a.maxAge * 0.8).length; const over = c.ants.filter((a) => a.age > a.maxAge).length;
      const under = c.ants.filter((a) => w.isBelowSurface(a.x, a.y)).length;
      series[c.id].push(`${t}: n=${c.ants.length} food=${Math.round(c.foodStored)} larv=${c.larvae.length} starving=${hungry} old=${old} >max=${over} under=${under} qH=${Math.round(c.queen.health)} crowd=${c.nestCrowding.toFixed(2)}`);
    }
  });
}
for (const c of cols) {
  console.log(`\n== ${c.id} ==`); console.log(series[c.id].join('\n'));
  console.log('raw causes', JSON.stringify(raw[c.id]), 'byCause', JSON.stringify(c.deathsByCause));
  const ages = ageAtDeath[c.id].sort((a, b) => a - b); console.log('age/maxAge at death p10/p50/p90', ages[Math.floor(ages.length * .1)]?.toFixed(2), ages[Math.floor(ages.length * .5)]?.toFixed(2), ages[Math.floor(ages.length * .9)]?.toFixed(2), 'n', ages.length);
  console.log('stuck top:'); Object.entries(stuckPos[c.id]).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log('  ', v, k));
  const en = c.nestEntrances; console.log('entrances', JSON.stringify(en.map((e) => [e.x, e.y, e.radius])), 'queen', c.queen.x, c.queen.y, 'home', c.homeX, c.homeY, 'fronts', JSON.stringify(c._digFronts.slice(0, 6)));
}
