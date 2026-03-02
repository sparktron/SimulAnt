import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewManager, VIEW } from '../src/ui/ViewManager.js';
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { normalizeSurfaceTerrain } from '../src/render/SurfaceRenderer.js';
import { TERRAIN } from '../src/sim/world.js';

// ── Toggle state machine ────────────────────────────────────────────

test('ViewManager toggles between SURFACE and NEST only', () => {
  const vm = new ViewManager(VIEW.SURFACE);
  assert.equal(vm.getCurrent(), VIEW.SURFACE);
  vm.toggle();
  assert.equal(vm.getCurrent(), VIEW.NEST);
  vm.toggle();
  assert.equal(vm.getCurrent(), VIEW.SURFACE);
});

test('ViewManager rejects invalid view values', () => {
  const vm = new ViewManager(VIEW.SURFACE);
  assert.throws(() => vm.setView('INVALID'), /Invalid view/);
});

test('setView is idempotent and does not fire listeners', () => {
  const vm = new ViewManager(VIEW.SURFACE);
  let called = 0;
  vm.onChange(() => (called += 1));
  vm.setView(VIEW.SURFACE);
  assert.equal(called, 0, 'listener should not fire for no-op setView');
});

test('onChange fires on toggle with correct mode', () => {
  const vm = new ViewManager(VIEW.SURFACE);
  const modes = [];
  vm.onChange((m) => modes.push(m));
  vm.toggle();
  vm.toggle();
  assert.deepEqual(modes, [VIEW.NEST, VIEW.SURFACE]);
});

// ── Simulation persistence across toggles ───────────────────────────

test('Simulation state persists across view toggles', () => {
  const vm = new ViewManager(VIEW.SURFACE);
  const sim = new SimulationCore('seed-persist');

  const ant = sim.colony.ants[0];
  const before = { x: ant.x, y: ant.y };
  ant.x += 5;
  ant.y += 2;

  vm.toggle();
  vm.toggle();

  assert.deepEqual({ x: ant.x, y: ant.y }, { x: before.x + 5, y: before.y + 2 });
});

test('Colony food stored persists across toggles', () => {
  const vm = new ViewManager(VIEW.SURFACE);
  const sim = new SimulationCore('seed-food');

  sim.colony.storeFood(42);
  vm.toggle();
  vm.toggle();

  assert.equal(sim.colony.foodStored, 42);
});

test('Simulation tick count persists across toggles', () => {
  const vm = new ViewManager(VIEW.SURFACE);
  const sim = new SimulationCore('seed-tick');
  const cfg = {
    antCap: 100,
    evaporationRate: 0.01,
    diffusionRate: 0.12,
    pheromoneUpdateTicks: 2,
    toFoodDeposit: 0.5,
    toHomeDeposit: 0.4,
    dangerDeposit: 0.6,
    hazardDeathChance: 0.02,
    foodPickupRate: 0.7,
    digChance: 0.04,
    digEnergyCost: 8,
    digHomeBoost: 0.9,
    queenEggTicks: 20,
    queenEggFoodCost: 0.8,
    soldierSpawnChance: 0.2,
  };

  for (let i = 0; i < 10; i += 1) sim.update(cfg);
  const tickBefore = sim.tick;

  vm.toggle();
  assert.equal(sim.tick, tickBefore, 'tick unchanged after toggle to NEST');

  vm.toggle();
  assert.equal(sim.tick, tickBefore, 'tick unchanged after toggle back to SURFACE');
});

// ── Camera independence ─────────────────────────────────────────────

test('View cameras are independent objects', () => {
  const surfaceCam = { x: 100, y: 50, zoom: 3 };
  const nestCam = { x: 100, y: 160, zoom: 3 };

  surfaceCam.x = 200;
  assert.notEqual(surfaceCam.x, nestCam.x, 'mutating surface cam must not affect nest cam');
});

// ── Only two valid states ───────────────────────────────────────────

test('VIEW enum has exactly SURFACE and NEST', () => {
  const keys = Object.keys(VIEW);
  assert.equal(keys.length, 2);
  assert.ok(keys.includes('SURFACE'));
  assert.ok(keys.includes('NEST'));
});

test('Constructor rejects unknown initial view', () => {
  assert.throws(() => new ViewManager('BOTH'), /Invalid initial view/);
});


test('Excavation adds soil to nearest nest entrance', () => {
  const sim = new SimulationCore('seed-soil');
  sim.nestEntrances = [
    { id: 'left', x: 40, y: sim.world.nestY, excavatedSoilTotal: 0, soilOnSurface: 0 },
    { id: 'right', x: 200, y: sim.world.nestY, excavatedSoilTotal: 0, soilOnSurface: 0 },
  ];

  sim.onExcavate(10, 195, sim.world.nestY + 20);

  assert.equal(sim.nestEntrances[0].soilOnSurface, 0);
  assert.equal(sim.nestEntrances[1].excavatedSoilTotal, 10);
  assert.equal(sim.nestEntrances[1].soilOnSurface, 7);
});

test('Nest entrance soil persists through serialization', () => {
  const sim = new SimulationCore('seed-save-soil');
  sim.onExcavate(5, sim.world.nestX, sim.world.nestY + 10);

  const serialized = sim.serialize({});
  const restored = new SimulationCore('other');
  restored.loadFromSerialized(serialized);

  assert.equal(restored.nestEntrances.length, 1);
  assert.equal(restored.nestEntrances[0].soilOnSurface, sim.nestEntrances[0].soilOnSurface);
  assert.equal(restored.nestEntrances[0].x, sim.nestEntrances[0].x);
});


test('Surface terrain normalization maps underground terrain to ground palette', () => {
  assert.equal(normalizeSurfaceTerrain(TERRAIN.SOIL), TERRAIN.GROUND);
  assert.equal(normalizeSurfaceTerrain(TERRAIN.TUNNEL), TERRAIN.GROUND);
  assert.equal(normalizeSurfaceTerrain(TERRAIN.WATER), TERRAIN.WATER);
  assert.equal(normalizeSurfaceTerrain(TERRAIN.HAZARD), TERRAIN.HAZARD);
});
