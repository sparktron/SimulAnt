import test from 'node:test';
import assert from 'node:assert/strict';
import { Ant } from '../src/sim/ant.js';
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';
import { getDefaultConfig } from '../src/ui/params.js';

const config = sanitizeTickConfig({ ...getDefaultConfig(), combatEngageChance: 1 });

function encounter(role = 'worker') {
  const sim = new SimulationCore('local-rival-encounter');
  const red = sim.rivalColony.ants.find(a => a.role === role);
  const black = sim.colony.ants.find(a => a.role === 'worker');
  Object.assign(red, { x: 120, y: 40, health: 100, hunger: 100, carrying: null, workFocus: 'forage' });
  Object.assign(black, { x: 123, y: 40, health: 100, hunger: 100, carrying: null });
  sim.rivalColony.ants = [red];
  sim.colony.ants = [black];
  sim.microEngine.setExternalState({ foodPellets: [], nestEntrances: sim.nestEntrances, rivalNestEntrances: sim.rivalNestEntrances });
  return { sim, red, black };
}

test('red colony has the same work and caste defaults and physical attributes', () => {
  const sim = new SimulationCore('rival-parity');
  assert.deepEqual(sim.rivalColony.workAllocation, sim.colony.workAllocation);
  assert.deepEqual(sim.rivalColony.casteAllocation, sim.colony.casteAllocation);
  for (const role of ['worker', 'soldier']) {
    const black = sim.colony.ants.find(a => a.role === role);
    const red = sim.rivalColony.ants.find(a => a.role === role);
    assert.equal(red.healthMax, black.healthMax);
    assert.equal(red.hungerMax, black.hungerMax);
    assert.deepEqual(red.hungerDrainRates, black.hungerDrainRates);
  }
  assert.ok(sim.rivalDigSystem.fronts.every(f => Math.abs(f.x - sim.rivalColony.homeX) <= 2));
});

for (const role of ['worker', 'soldier']) {
  test(`healthy red ${role} seeks a nearby opponent using normal movement and grid updates`, () => {
    const { sim, red } = encounter(role);
    sim.colony.rebuildAntGridFromAnts();
    sim.rivalColony.rebuildAntGridFromAnts();
    sim.rivalColony.opponentColony = sim.colony;
    red.update(sim.world, sim.rivalColony, sim.rng, config);
    assert.equal(red.state, 'SEEK_FIGHT');
    assert.equal(red.x, 121);
    assert.equal(sim.rivalColony.countAntsAt(120, 40), 0);
    assert.equal(sim.rivalColony.countAntsAt(red.x, red.y), 1);
  });
}

test('red ants preserve cargo and healing priorities instead of seeking fights', () => {
  for (const condition of ['cargo', 'health', 'hunger', 'distant', 'disabled', 'nurse', 'dig', 'courier']) {
    const { sim, red, black } = encounter();
    sim.colony.rebuildAntGridFromAnts();
    sim.rivalColony.opponentColony = sim.colony;
    if (condition === 'cargo') red.carrying = { type: 'food', pelletNutrition: 40 };
    if (condition === 'nurse' || condition === 'dig') red.workFocus = condition;
    if (condition === 'courier') sim.rivalColony.queen.foodCourierAntId = red.id;
    if (condition === 'health') red.health = 10;
    if (condition === 'hunger') red.hunger = 10;
    if (condition === 'distant') black.x = red.x + config.combatSenseRadius + 1;
    sim.colony.rebuildAntGridFromAnts();
    const cfg = condition === 'disabled' ? { ...config, combatEngageChance: 0 } : config;
    red.update(sim.world, sim.rivalColony, sim.rng, cfg);
    assert.notEqual(red.state, 'SEEK_FIGHT', condition);
  }
});

test('rival digging progresses, saves, and restores without changing replay', () => {
  const sim = new SimulationCore('rival-dig-save');
  sim.toggleAutoDig();
  for (let i = 0; i < 20; i++) sim.update(config);
  assert.equal(sim.rivalDigSystem.autoDig, true);
  assert.ok(sim.rivalDigSystem.fronts.some(f => f.age > 0), 'red digging fronts must advance');
  const snapshot = structuredClone(sim.serialize({}));
  const restored = new SimulationCore('other');
  restored.loadFromSerialized(snapshot);
  assert.deepEqual(restored.rivalDigSystem.serialize(), sim.rivalDigSystem.serialize());
  for (let i = 0; i < 10; i++) { sim.update(config); restored.update(config); }
  assert.ok(JSON.stringify(restored.serialize({})) === JSON.stringify(sim.serialize({})), 'save/load must replay identically');
});

test('fighting color overrides worker and soldier jobs', () => {
  for (const role of ['worker', 'soldier']) {
    assert.equal(Ant.getJobColor('FIGHT', 'forage', role), '#ff3030');
    assert.equal(Ant.getJobColor('SEEK_FIGHT', 'forage', role), '#ff3030');
    assert.notEqual(Ant.getJobColor('PATROL', 'forage', role), '#ff3030');
  }
});


test('normal mode colors active fights purple for both colonies and restores base color', () => {
  for (const base of ['#1a1208', '#d93828', '#7a4a9a', '#ff6654']) {
    assert.equal(Ant.getNormalColor('FIGHT', base), '#b44cff');
    assert.equal(Ant.getNormalColor('SEEK_FIGHT', base), base);
    assert.equal(Ant.getNormalColor('FORAGE_SEARCH', base), base);
  }
});
