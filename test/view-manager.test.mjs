import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewManager, VIEW } from '../src/ui/ViewManager.js';
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { getSurfaceMinZoom, normalizeSurfaceTerrain } from '../src/render/SurfaceRenderer.js';
import { TERRAIN } from '../src/sim/world.js';
import { Ant } from '../src/sim/ant.js';
import { SeededRng } from '../src/sim/rng.js';

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

  const foodBefore = sim.colony.foodStored;
  sim.colony.storeFood(42);
  vm.toggle();
  vm.toggle();

  assert.equal(sim.colony.foodStored, foodBefore + 42);
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


test('Excavation tracks nearest entrance while dirt deposition controls surface mound', () => {
  const sim = new SimulationCore('seed-soil');
  sim.nestEntrances = [
    { id: 'left', x: 40, y: sim.world.nestY, excavatedSoilTotal: 0, soilOnSurface: 0 },
    { id: 'right', x: 200, y: sim.world.nestY, excavatedSoilTotal: 0, soilOnSurface: 0 },
  ];

  sim.onExcavate(10, 195, sim.world.nestY + 20);

  assert.equal(sim.nestEntrances[0].soilOnSurface, 0);
  assert.equal(sim.nestEntrances[1].excavatedSoilTotal, 10);
  assert.equal(sim.nestEntrances[1].soilOnSurface, 0);

  sim.onDepositDirt(10, 195, sim.world.nestY);
  assert.equal(sim.nestEntrances[1].soilOnSurface, 7);
});

test('Nest entrance soil and excavation totals persist through serialization', () => {
  const sim = new SimulationCore('seed-save-soil');
  sim.onExcavate(5, sim.world.nestX, sim.world.nestY + 10);
  sim.onDepositDirt(3, sim.world.nestX, sim.world.nestY);

  const serialized = sim.serialize({});
  const restored = new SimulationCore('other');
  restored.loadFromSerialized(serialized);

  assert.equal(restored.nestEntrances.length, 1);
  assert.equal(restored.nestEntrances[0].excavatedSoilTotal, sim.nestEntrances[0].excavatedSoilTotal);
  assert.equal(restored.nestEntrances[0].soilOnSurface, sim.nestEntrances[0].soilOnSurface);
  assert.equal(restored.nestEntrances[0].x, sim.nestEntrances[0].x);
});


test('Surface terrain normalization maps underground terrain to ground palette', () => {
  assert.equal(normalizeSurfaceTerrain(TERRAIN.SOIL), TERRAIN.GROUND);
  assert.equal(normalizeSurfaceTerrain(TERRAIN.TUNNEL), TERRAIN.GROUND);
  assert.equal(normalizeSurfaceTerrain(TERRAIN.WATER), TERRAIN.WATER);
  assert.equal(normalizeSurfaceTerrain(TERRAIN.HAZARD), TERRAIN.HAZARD);
});


test('Surface minimum zoom keeps viewport within surface band', () => {
  const minZoom = getSurfaceMinZoom(642, 128);
  assert.ok(minZoom > 4.9);
  assert.ok(minZoom < 5.1);
});

test('Auto-dig grows tunnels and soil mound over time', () => {
  const sim = new SimulationCore('seed-auto-dig');
  const cfg = {
    antCap: 300,
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

  sim.toggleAutoDig();

  const beforeExcavated = sim.colony.excavatedTiles;
  const beforeSoil = sim.nestEntrances[0].soilOnSurface;

  for (let i = 0; i < 300; i += 1) sim.update(cfg);

  assert.ok(sim.colony.excavatedTiles > beforeExcavated);
  assert.ok(sim.nestEntrances[0].soilOnSurface > beforeSoil);
});



test('Auto-dig does not excavate when no worker is near any dig front', () => {
  const sim = new SimulationCore('seed-auto-dig-nearby-workers');
  const cfg = {
    antCap: 300,
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

  for (const ant of sim.colony.ants) {
    ant.x = sim.world.width - 2;
    ant.y = sim.world.nestY + 2;
  }

  sim.toggleAutoDig();
  const beforeExcavated = sim.colony.excavatedTiles;

  for (let i = 0; i < 120; i += 1) sim.update(cfg);

  assert.equal(sim.colony.excavatedTiles, beforeExcavated);
  assert.equal(
    sim.colony.ants.some((ant) => ant.carryingType === 'dirt'),
    false,
  );
});





test('Dirt-carrying ant deposits at surface near entrance', () => {
  const sim = new SimulationCore('seed-dirt-surface-deposit');
  const ant = sim.colony.ants[0];
  const entrance = sim.nestEntrances[0];

  // Place ant on surface right at the entrance with dirt
  ant.role = 'worker';
  ant.x = entrance.x;
  ant.y = entrance.y;
  ant.carrying = { type: 'dirt', amount: 2 };
  ant.carryingType = 'dirt';

  const beforeSoil = sim.nestEntrances[0].soilOnSurface;

  // Run individual ant update (not full sim) to isolate behavior
  const cfg = {
    tickSeconds: 1 / 30, antCap: 2000, evapFood: 0.01, evapHome: 0.015,
    evapDanger: 0.08, diffFood: 0.03, diffHome: 0.18, diffDanger: 0.12,
    diffIntervalTicks: 2, depositFood: 0.2, depositHome: 0.08, dangerDeposit: 0.3,
    hazardDeathChance: 0, foodPickupRate: 0.7, digChance: 0.04, digEnergyCost: 8,
    digHomeBoost: 0.9, queenEggTicks: 20, queenEggFoodCost: 0.25,
    queenHungerDrain: 0.5, queenEatNutrition: 8, queenHealthDrainRate: 7,
    queenHealthRecoveryPerNutrition: 0.25, queenFoodRequestHealthThreshold: 0.5,
    queenFoodRequestClearThreshold: 0.8, queenCourierPickupNutrition: 6,
    broodFoodDrainRate: 0.01, broodGestationSeconds: 8, workerEatNutrition: 25,
    starvationRecoveryHealth: 5, healthDrainRate: 0, healthRegenRate: 1,
    healthWorkIdleDrainRate: 0, healthWorkMoveDrainRate: 0, healthWorkCarryDrainRate: 0,
    healthWorkFightDrainRate: 0, healthEatRecoveryRate: 0.45,
    workerEmergencyEatNutrition: 35, carryingHungerDrainRate: 0,
    fightingHungerDrainRate: 0, soldierSpawnChance: 0, foodVisionRadius: 7,
    surfaceFoodSearchMaxMissTicks: 180, surfaceReturnToNestHungerThreshold: 0.5,
    followAlpha: 1.5, followBeta: 5, wanderNoise: 0.06, randomTurnChance: 0,
    momentumBias: 0.3, reversePenalty: 0.9, homeDepositIntervalTicks: 3,
    homeDepositMinDistance: 20, nearEntranceScatterRadius: 15,
    foodTrailDistanceScale: 1.1, maxFoodTrailScale: 3.2,
    homeScentBaseWeight: 1, homeScentSearchStateScale: 0.3,
    homeScentReturnStateScale: 1, homeScentFalloffStartDist: 10,
    homeScentFalloffEndDist: 9999, homeScentMinFalloff: 1,
    homeScentMaxContributionPerStep: 999, homeTieBiasScale: 0.05,
    foodTieBiasScale: 0.01, pheromoneMaxClamp: 10,
  };

  sim.colony.setNestEntrances(sim.nestEntrances);
  sim.colony.setSurfaceFoodPellets([]);
  ant.update(sim.world, sim.colony, sim.rng, cfg);

  assert.equal(ant.carrying, null, 'Ant should have deposited dirt');
  assert.ok(sim.nestEntrances[0].soilOnSurface > beforeSoil, 'Soil on surface should increase');
});

test('Auto-dig workers carry dirt and increase surface soil via entrance deposit', () => {
  const sim = new SimulationCore('seed-auto-dig-haul');
  const cfg = {
    antCap: 300,
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

  sim.toggleAutoDig();
  const beforeSoil = sim.nestEntrances[0].soilOnSurface;

  let sawDirtCarrier = false;
  for (let i = 0; i < 400; i += 1) {
    sim.update(cfg);
    if (sim.colony.ants.some((ant) => ant.carryingType === 'dirt')) sawDirtCarrier = true;
  }

  assert.equal(sawDirtCarrier, true);
  assert.ok(sim.nestEntrances[0].soilOnSurface > beforeSoil);
});

test('Forced chamber creates chamber terrain tiles', () => {
  const sim = new SimulationCore('seed-chamber');
  const cfg = {
    antCap: 300,
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

  sim.toggleAutoDig();
  for (let i = 0; i < 20; i += 1) sim.update(cfg);

  let carved = false;
  for (let i = 0; i < 5; i += 1) {
    carved = sim.forceChamberAtDigFront(cfg) || carved;
    if (carved) break;
    sim.update(cfg);
  }

  const chamberTiles = sim.world.terrain.reduce((count, tile) => count + (tile === TERRAIN.CHAMBER ? 1 : 0), 0);

  assert.equal(carved, true);
  assert.ok(chamberTiles > 0);
});

test('Dig system sanitizes corrupted saved front progress to prevent lockups', () => {
  const sim = new SimulationCore('seed-corrupt-dig');
  const cfg = {
    antCap: 300,
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

  const save = sim.serialize({});
  save.digSystem = {
    autoDig: true,
    fronts: [
      {
        x: sim.world.nestX,
        y: sim.world.nestY + 6,
        dir: 0,
        progress: Infinity,
        age: 1,
        stepsSinceChamber: 1,
        lastAdvanceTick: 1,
      },
    ],
  };

  sim.loadFromSerialized(save);
  sim.update(cfg);

  assert.equal(Number.isFinite(sim.digSystem.fronts[0].progress), true);
  assert.ok(sim.tick > 0);
});


test('Ant base color and carrying type persist through serialization', () => {
  const sim = new SimulationCore('seed-ant-color');
  const ant = sim.colony.ants[0];
  ant.baseColor = '#ffcc00';
  ant.originalBaseColor = '#ffcc00';
  ant.carryingType = 'dirt';

  const serialized = sim.serialize({});
  const restored = new SimulationCore('other');
  restored.loadFromSerialized(serialized);

  assert.equal(restored.colony.ants[0].baseColor, '#ffcc00');
  assert.equal(restored.colony.ants[0].originalBaseColor, '#ffcc00');
  assert.equal(restored.colony.ants[0].carryingType, 'dirt');
});

test('Worker ant color migrates from stale soldier-red save data', () => {
  const sim = new SimulationCore('seed-worker-color-migration');
  const ant = sim.colony.ants.find((candidate) => candidate.role === 'worker');
  assert.ok(ant);

  ant.baseColor = '#d93828';
  ant.originalBaseColor = '#d93828';

  const serialized = sim.serialize({});
  const restored = new SimulationCore('other-worker-color-migration');
  restored.loadFromSerialized(serialized);

  const restoredAnt = restored.colony.ants.find((candidate) => candidate.id === ant.id);
  assert.equal(restoredAnt.role, 'worker');
  assert.equal(restoredAnt.originalBaseColor, '#1a1208');
  assert.equal(restoredAnt.baseColor, '#1a1208');
});

test('Soldier ant color migrates from stale soldier-red save data', () => {
  const sim = new SimulationCore('seed-soldier-color-migration');
  const ant = sim.colony.ants.find((candidate) => candidate.role === 'worker');
  assert.ok(ant);

  ant.role = 'soldier';
  ant.baseColor = '#d93828';
  ant.originalBaseColor = '#d93828';

  const serialized = sim.serialize({});
  const restored = new SimulationCore('other-soldier-color-migration');
  restored.loadFromSerialized(serialized);

  const restoredAnt = restored.colony.ants.find((candidate) => candidate.id === ant.id);
  assert.equal(restoredAnt.role, 'soldier');
  // Legacy soldier-red should migrate to the current default for that role
  assert.equal(restoredAnt.originalBaseColor, Ant.getDefaultBaseColor('soldier'));
  assert.equal(restoredAnt.baseColor, Ant.getDefaultBaseColor('soldier'));
});

test('All ant roles use their designated base color', () => {
  const rng = new SeededRng('seed-role-color-consistency');
  const worker = new Ant(0, 0, rng, 'worker');
  const soldier = new Ant(0, 0, rng, 'soldier');
  const breeder = new Ant(0, 0, rng, 'breeder');

  assert.equal(worker.baseColor, Ant.getDefaultBaseColor('worker'));
  assert.equal(soldier.baseColor, Ant.getDefaultBaseColor('soldier'));
  assert.equal(breeder.baseColor, Ant.getDefaultBaseColor('breeder'));
});

test('Depositing and consuming food updates nest food cell storage', () => {
  const sim = new SimulationCore('seed-nest-food');
  const totalNestFood = () => sim.world.nestFood.reduce((sum, value) => sum + value, 0);
  const before = totalNestFood();

  sim.colony.depositPellet(5);
  assert.equal(totalNestFood(), before + 5);

  sim.colony.consumeFromStore(2);
  assert.equal(totalNestFood(), before + 3);
});


test('Food-carrying ants must enter nest before depositing pellets', () => {
  const sim = new SimulationCore('seed-deposit-inside-nest');
  const ant = sim.colony.ants[0];
  const entrance = sim.nestEntrances[0];
  sim.colony.setNestEntrances(sim.nestEntrances);

  ant.role = 'worker';
  ant.x = entrance.x;
  ant.y = Math.max(0, entrance.y - 2);
  ant.carrying = { type: 'food', pelletNutrition: 4 };
  ant.carryingType = 'food';

  const cfg = {
    tickSeconds: 1 / 30, randomTurnChance: 0, maxFoodTrailScale: 1.2,
    foodTrailDistanceScale: 1, depositFood: 0.1, pheromoneMaxClamp: 10,
    followAlpha: 1, momentumBias: 0, reversePenalty: 0, followBeta: 1,
    wanderNoise: 0, homeDepositMinDistance: 2, homeDepositIntervalTicks: 8,
    depositHome: 0.1, foodVisionRadius: 5, nearEntranceScatterRadius: 4,
    hazardDeathChance: 0, dangerDeposit: 0, healthDrainRate: 0, healthRegenRate: 0,
    workerEatNutrition: 0, starvationRecoveryHealth: 0,
    healthWorkIdleDrainRate: 0, healthWorkMoveDrainRate: 0,
    healthWorkCarryDrainRate: 0, healthWorkFightDrainRate: 0,
    healthEatRecoveryRate: 0, carryingHungerDrainRate: 0,
    fightingHungerDrainRate: 0, workerEmergencyEatNutrition: 0,
    homeScentBaseWeight: 1, homeScentReturnStateScale: 1,
    homeScentSearchStateScale: 0.3, homeScentFalloffStartDist: 10,
    homeScentFalloffEndDist: 9999, homeScentMinFalloff: 1,
    homeScentMaxContributionPerStep: 999, homeTieBiasScale: 0.05,
    foodTieBiasScale: 0.01, surfaceFoodSearchMaxMissTicks: 180,
    surfaceReturnToNestHungerThreshold: 0.5,
  };

  // Ensure ant has full vitals so it focuses on depositing, not eating
  ant.hunger = 100;
  ant.health = 100;

  ant.update(sim.world, sim.colony, sim.rng, cfg);
  assert.notEqual(ant.carrying, null);

  let enteredNestBeforeDrop = false;
  for (let i = 0; i < 200 && ant.carrying; i += 1) {
    ant.update(sim.world, sim.colony, sim.rng, cfg);
    if (ant.y >= sim.world.nestY + 1) enteredNestBeforeDrop = true;
  }

  let nestFoodTotal = 0;
  for (let i = 0; i < sim.world.nestFood.length; i += 1) nestFoodTotal += sim.world.nestFood[i];

  assert.equal(ant.carrying, null, 'Ant should deposit food within 200 ticks');
  assert.ok(enteredNestBeforeDrop, 'Ant should enter nest before depositing');
  assert.ok(nestFoodTotal > 0, 'Nest food storage should increase');
});
