import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [root, seed, tickArg = '5000'] = process.argv.slice(2);
const ticks = Number(tickArg);
const { SimulationCore } = await import(pathToFileURL(resolve(root, 'src/sim/SimulationCore.js')));
const { getDefaultConfig } = await import(pathToFileURL(resolve(root, 'src/ui/params.js')));
const sim = new SimulationCore(seed);
const config = getDefaultConfig();
const start = performance.now();
for (let tick = 0; tick < ticks; tick += 1) sim.update(config);
console.log(JSON.stringify({
  seed, ticks, elapsedMs: Math.round(performance.now() - start),
  colonies: [sim.colony, sim.rivalColony].map(colony => ({
    id: colony.id,
    population: colony.ants.length,
    births: colony.births,
    food: Math.round(colony.foodStored),
    eggs: colony.queen.eggsLaid,
    queenAlive: colony.queen.alive,
    queenHunger: Math.round(colony.queen.hunger),
    excavated: colony.excavatedTiles,
    deaths: colony.deathsByCause,
  })),
}));
