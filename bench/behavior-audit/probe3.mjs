const repo = process.argv[2]; const SEED = process.argv[3] || 'probe-a'; const TICKS = Number(process.argv[4]) || 12000;
const { SimulationCore } = await import(`${repo}/src/sim/SimulationCore.js`);
const { Ant } = await import(`${repo}/src/sim/ant.js`);
const { getDefaultConfig } = await import(`${repo}/src/ui/params.js`);
const { sanitizeTickConfig } = await import(`${repo}/src/sim/core/SimulationTypes.js`);
const config = sanitizeTickConfig({ ...getDefaultConfig(), ...(process.env.OV ? JSON.parse(process.env.OV) : {}) });
const sim = new SimulationCore(SEED); const cols = [sim.colony, sim.rivalColony]; const w = sim.world;
let cur = null; const ou = Ant.prototype.update;
Ant.prototype.update = function (...a) { cur = this; const r = ou.apply(this, a); cur = null; return r; };
const B = {}; const ep = new Map();
for (const c of cols) {
  const b = B[c.id] = { win: null, rows: [], epTotal: 0, epFed: 0, epTicks: 0, epTicksUnfed: 0 };
  const reset = () => { b.win = { dep: 0, eatOld: 0, eatYoung: 0, eatOther: 0, surfForagers: 0, healers: 0, samples: 0 }; }; reset(); b.reset = reset;
  const od = c.depositPellet.bind(c); c.depositPellet = (...a) => { const g = od(...a); b.win.dep += g; return g; };
  const oc = c.consumeFromStore.bind(c); c.consumeFromStore = (amt) => { const g = oc(amt); if (cur && cur._currentColony === c) { if (cur.age > cur.maxAge * 0.8) b.win.eatOld += g; else b.win.eatYoung += g; } else b.win.eatOther += g; return g; };
}
for (let t = 1; t <= TICKS; t++) {
  sim.update(config);
  for (const c of cols) {
    const b = B[c.id];
    for (const a of c.ants) {
      let e = ep.get(a);
      if (a.state === 'RETURN_NEST_TO_EAT' || (e && a.state === 'EXIT_NEST')) {
        if (!e) { e = { start: t, hunger0: a.hunger, lastEat: a._lastNestEatTick, ticks: 0, bounces: 0, last: a.state }; ep.set(a, e); }
        e.ticks += 1; if (e.last !== a.state) { e.bounces += 1; e.last = a.state; }
      } else if (e) {
        const fed = a._lastNestEatTick !== e.lastEat;
        b.epTotal += 1; b.epTicks += e.ticks; if (fed) b.epFed += 1; else b.epTicksUnfed += e.ticks;
        (b.bounces ||= []).push(e.bounces); ep.delete(a);
      }
    }
    if (t % 30 === 0) { b.win.samples += 1; for (const a of c.ants) { if (a.role === 'worker' && a.workFocus === 'forage' && !w.isBelowSurface(a.x, a.y)) b.win.surfForagers += 1; if (a.state === 'HEAL_IN_NEST') b.win.healers += 1; } }
    if (t % 1000 === 0) {
      const x = b.win; const old = c.ants.filter((a) => a.age > a.maxAge * 0.8).length;
      b.rows.push(`${t}: n=${c.ants.length} old=${old} food=${Math.round(c.foodStored)} dep=${Math.round(x.dep)} eatOld=${Math.round(x.eatOld)} eatYoung=${Math.round(x.eatYoung)} brood+queen=${Math.round(x.eatOther)} surfForagers~${Math.round(x.surfForagers / x.samples)} healers~${Math.round(x.healers / x.samples)}`);
      b.reset();
    }
  }
}
for (const c of cols) { const b = B[c.id]; console.log(`\n== ${c.id} ==\n` + b.rows.join('\n'));
  const bs = (b.bounces || []).sort((x, y) => x - y);
  console.log(`go-home-to-eat episodes ${b.epTotal}, ended with a meal ${b.epFed} (${(100 * b.epFed / b.epTotal).toFixed(0)}%), ant-ticks in episodes ${b.epTicks}, of which in unfed episodes ${b.epTicksUnfed}; direction flips p50/p90/max ${bs[Math.floor(bs.length * .5)]}/${bs[Math.floor(bs.length * .9)]}/${bs[bs.length - 1]}`); }
