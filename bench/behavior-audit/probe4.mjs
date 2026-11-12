const repo = process.argv[2];
const { SimulationCore } = await import(`${repo}/src/sim/SimulationCore.js`);
const { getDefaultConfig } = await import(`${repo}/src/ui/params.js`);
const { sanitizeTickConfig } = await import(`${repo}/src/sim/core/SimulationTypes.js`);
const config = sanitizeTickConfig(getDefaultConfig());
for (const seed of ['probe-a', 'probe-b', 'probe-c']) for (const ui of [false, true]) {
  const sim = new SimulationCore(seed);
  if (ui) sim.colony.setWorkAllocation({ forage: 55, dig: 20, nurse: 25 });
  const out = [];
  for (let t = 1; t <= 9000; t++) { sim.update(config); if (t % 3000 === 0) out.push(`${t}: blk ${sim.colony.ants.length}/${Math.round(sim.colony.foodStored)} red ${sim.rivalColony.ants.length}/${Math.round(sim.rivalColony.foodStored)}`); }
  console.log(seed, ui ? 'black=55/20/25 (browser)' : 'black=90/5/5 (headless)', '|', out.join(' | '), '| blk deaths', JSON.stringify(sim.colony.deathsByCause));
}
