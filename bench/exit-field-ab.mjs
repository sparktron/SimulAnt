/*
 * Nest-exit routing A/B: instant tunnel-distance field vs lagged exit scent
 * (config.exitScentField). One (arm, seed) run per process, 7,500 ticks,
 * written as JSON. Results and method: docs/exit-field-experiment.md.
 *
 *   node bench/exit-field-ab.mjs . instant a /tmp/instant-a.json
 *   node bench/exit-field-ab.mjs . scent   a /tmp/scent-a.json
 *
 * Arg 1 is the repo root holding src/ (lets you bench an older checkout).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [rootArg, arm, seed, out] = process.argv.slice(2);
const ROOT = pathToFileURL(resolve(rootArg)).href;
const { SimulationCore } = await import(ROOT + '/src/sim/SimulationCore.js');
const { sanitizeTickConfig } = await import(ROOT + '/src/sim/core/SimulationTypes.js');
const { getDefaultConfig } = await import(ROOT + '/src/ui/params.js');
const config = sanitizeTickConfig({ ...getDefaultConfig(), exitScentField: arm === 'scent' });
const TICKS = 7500;
const sim = new SimulationCore(seed); const w = sim.world;
const hist = new Map(), under = new Map(), exitRun = new Map();
const m = {};
const t0 = performance.now();
for (let t = 1; t <= TICKS; t++) {
  sim.update(config);
  for (const c of [sim.colony, sim.rivalColony]) {
    const g = m[c.id] ??= { hurtCross: 0, hurtTicks: 0, stuckSurf: 0, stuckUnder: 0, n: 0, clumpTiles: 0, samples: 0, exitRuns: [], finalAlive: 0, firstBreach: null };
    if (g.firstBreach === null && c.nestEntrances.length > 1) g.firstBreach = t;
    for (const a of c.ants) {
      if (!a.alive || a.role !== 'worker') continue;
      const u = a.y > w.nestY; const prev = under.get(a);
      if (a.health < a.healthMax * 0.5) { g.hurtTicks++; if (prev !== undefined && prev !== u) g.hurtCross++; }
      under.set(a, u);
      // exit latency: consecutive underground ticks in EXIT_NEST, completed on surfacing
      const r = exitRun.get(a) ?? 0;
      if (u && a.state === 'EXIT_NEST') exitRun.set(a, r + 1);
      else { if (!u && r > 0) g.exitRuns.push(r); exitRun.set(a, 0); }
    }
  }
  if (t % 30) continue;
  for (const c of [sim.colony, sim.rivalColony]) for (const a of c.ants) {
    let h = hist.get(a); if (!h) hist.set(a, h = []); h.push([a.x, a.y]); if (h.length > 5) h.shift(); }
  if (t >= 3000 && t % 250 === 0) for (const c of [sim.colony, sim.rivalColony]) {
    const g = m[c.id]; g.samples++;
    const occ = new Map();
    for (const a of c.ants) {
      if (!a.alive || a.role === 'queen') continue; g.n++;
      if (a.y > w.nestY) { const k = a.x + ',' + a.y; occ.set(k, (occ.get(k) || 0) + 1); }
      const h = hist.get(a); if (!h || h.length < 5) continue;
      const xs = h.map(p => p[0]), ys = h.map(p => p[1]);
      if (Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) > 3) continue;
      if (a.state === 'NURSE' || a.state === 'NURSE_TEND_BROOD' || a.state.startsWith('DIG_AT')) continue;
      if (a.y <= w.nestY) g.stuckSurf++; else g.stuckUnder++;
    }
    const pts = [...occ.entries()].map(([k, v]) => [...k.split(',').map(Number), v]);
    for (const [x, y] of pts) { let s = 0; for (const [x2, y2, v] of pts) if (Math.abs(x2 - x) <= 1 && Math.abs(y2 - y) <= 1) s += v; if (s >= 5) g.clumpTiles++; }
  }
}
const ms = Math.round(performance.now() - t0);
for (const c of [sim.colony, sim.rivalColony]) m[c.id].finalAlive = c.ants.filter(a => a.alive).length;
writeFileSync(out, JSON.stringify({ arm, seed, ticks: TICKS, ms, colonies: m }));
