import test from 'node:test';
import assert from 'node:assert/strict';
import { Ant, FIGHT_COLOR } from '../src/sim/ant.js';
import { combatSenseRadiusFor } from '../src/sim/ant/decisions.js';
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
    if (condition === 'distant') black.x = red.x + combatSenseRadiusFor(red, config) + 1;
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
    assert.equal(Ant.getJobColor('FIGHT', 'forage', role), FIGHT_COLOR);
    assert.equal(Ant.getJobColor('SEEK_FIGHT', 'forage', role), '#ff3030');
    assert.equal(Ant.getJobColor('RAID', 'forage', role), '#ff3030');
    assert.notEqual(Ant.getJobColor('PATROL', 'forage', role), '#ff3030');
  }
});


test('normal mode colors active fights purple for both colonies and restores base color', () => {
  for (const base of ['#1a1208', '#d93828', '#5c1010', '#8e1a12']) {
    assert.equal(Ant.getNormalColor('FIGHT', base), FIGHT_COLOR);
    assert.equal(Ant.getNormalColor('SEEK_FIGHT', base), base);
    assert.equal(Ant.getNormalColor('FORAGE_SEARCH', base), base);
  }
});


test('soldiers are dark red, never purple, and purple is reserved for duels', () => {
  const sim = new SimulationCore('soldier-colors');
  const isPurple = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
    return b > g && b >= r * 0.8;
  };
  for (const colony of [sim.colony, sim.rivalColony]) {
    const soldier = colony.ants.find(a => a.role === 'soldier');
    const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(soldier.baseColor.slice(i, i + 2), 16));
    assert.ok(r > g * 2 && r > b * 2, `${colony.id} soldier ${soldier.baseColor} must be red`);
    assert.ok(r < 0xa0, `${colony.id} soldier ${soldier.baseColor} must be a dark red`);
    assert.ok(!isPurple(Ant.getJobColor('PATROL', 'forage', 'soldier')));
  }
  assert.ok(isPurple(FIGHT_COLOR));
});

test('saves with retired purple / light-red soldier colors migrate to the new palette', () => {
  const sim = new SimulationCore('soldier-color-migration');
  const snapshot = structuredClone(sim.serialize({}));
  const blackSoldier = snapshot.colony.ants.find(a => a.role === 'soldier');
  const redSoldier = snapshot.rivalColony.ants.find(a => a.role === 'soldier');
  blackSoldier.baseColor = blackSoldier.originalBaseColor = '#7a4a9a';
  redSoldier.baseColor = redSoldier.originalBaseColor = '#ff6654';
  const restored = new SimulationCore('other');
  restored.loadFromSerialized(snapshot);
  assert.equal(restored.colony.ants.find(a => a.id === blackSoldier.id).baseColor, Ant.getDefaultBaseColor('soldier'));
  assert.equal(restored.rivalColony.ants.find(a => a.id === redSoldier.id).baseColor, '#8e1a12');
});

test('black ants now hunt red ants too', () => {
  const { sim, black } = encounter();
  sim.colony.rebuildAntGridFromAnts();
  sim.rivalColony.rebuildAntGridFromAnts();
  black.workFocus = 'forage';
  black.update(sim.world, sim.colony, sim.rng, config);
  assert.equal(black.state, 'SEEK_FIGHT');
  assert.equal(black.x, 122);
});

test('soldiers commit to a sensed enemy without the worker engage roll', () => {
  const { sim, red } = encounter('soldier');
  sim.colony.rebuildAntGridFromAnts();
  sim.rivalColony.rebuildAntGridFromAnts();
  const cfg = { ...config, combatEngageChance: 0.001 };
  red.update(sim.world, sim.rivalColony, sim.rng, cfg);
  assert.equal(red.state, 'SEEK_FIGHT');
});

test('enemySeekBias widens sensing; soldiers sense further than workers', () => {
  const worker = { role: 'worker' };
  const soldier = { role: 'soldier' };
  const base = { combatSenseRadius: 6 };
  assert.equal(combatSenseRadiusFor(worker, { ...base, enemySeekBias: 0 }), 6);
  assert.equal(combatSenseRadiusFor(worker, { ...base, enemySeekBias: 1 }), 12);
  assert.ok(combatSenseRadiusFor(soldier, { ...base, enemySeekBias: 0.5 })
    > combatSenseRadiusFor(worker, { ...base, enemySeekBias: 0.5 }));
});

function soldierAlone(seed) {
  const sim = new SimulationCore(seed);
  const soldier = sim.colony.ants.find(a => a.role === 'soldier');
  const entrance = sim.nestEntrances[0];
  Object.assign(soldier, { x: entrance.x, y: entrance.y - 3, health: 100, hunger: 100, carrying: null });
  sim.colony.ants = [soldier];
  sim.rivalColony.ants = [];
  sim.colony.rebuildAntGridFromAnts();
  sim.rivalColony.rebuildAntGridFromAnts();
  sim.microEngine.setExternalState({ foodPellets: [], nestEntrances: sim.nestEntrances, rivalNestEntrances: sim.rivalNestEntrances });
  return { sim, soldier, startX: soldier.x };
}

test('enemySeekBias sends soldiers raiding toward the rival nest; 0 keeps them home', () => {
  const raid = soldierAlone('soldier-raid');
  const home = soldierAlone('soldier-raid');
  const rivalX = raid.sim.rivalColony.homeX;
  const hungerFree = { ...config, enemySeekBias: 1 };
  for (let i = 0; i < 400; i += 1) {
    raid.soldier.hunger = 100;
    raid.soldier.update(raid.sim.world, raid.sim.colony, raid.sim.rng, hungerFree);
    home.soldier.hunger = 100;
    home.soldier.update(home.sim.world, home.sim.colony, home.sim.rng, { ...config, enemySeekBias: 0 });
  }
  assert.equal(raid.soldier.raiding, true);
  assert.equal(raid.soldier.state, 'RAID');
  assert.ok(Math.abs(raid.soldier.x - rivalX) < Math.abs(raid.startX - rivalX) / 2,
    `raider should close most of the gap to the rival nest (x=${raid.soldier.x}, rival=${rivalX})`);
  assert.equal(home.soldier.raiding, false);
  assert.ok(Math.abs(home.soldier.x - home.startX) < 20, 'bias 0 soldier stays near home');
});

test('raiding soldiers give up the raid when hungry', () => {
  const { sim, soldier } = soldierAlone('soldier-raid-hungry');
  soldier.raiding = true;
  soldier.hunger = 10;
  soldier.update(sim.world, sim.colony, sim.rng, { ...config, enemySeekBias: 1 });
  assert.equal(soldier.raiding, false);
  assert.equal(soldier.state, 'PATROL');
});

test('save/load in the middle of a duel replays identically', () => {
  const sim = new SimulationCore('duel-save');
  const black = sim.colony.ants.find(a => a.role === 'worker');
  const red = sim.rivalColony.ants.find(a => a.role === 'soldier');
  Object.assign(black, { x: 128, y: 40, health: 100, hunger: 100, carrying: null });
  Object.assign(red, { x: 128, y: 40, health: 100, hunger: 100, carrying: null });
  sim.colony.rebuildAntGridFromAnts();
  sim.rivalColony.rebuildAntGridFromAnts();
  sim.update(config);
  assert.ok(sim.combatSystem.activeDuelCount >= 1, 'a duel must be running');
  assert.equal(black.inDuel, true);
  const snapshot = structuredClone(sim.serialize({}));
  const restored = new SimulationCore('other');
  restored.loadFromSerialized(snapshot);
  assert.equal(restored.combatSystem.activeDuelCount, sim.combatSystem.activeDuelCount);
  assert.equal(restored.colony.ants.find(a => a.id === black.id).inDuel, true);
  for (let i = 0; i < 120; i += 1) { sim.update(config); restored.update(config); }
  assert.ok(JSON.stringify(restored.serialize({})) === JSON.stringify(sim.serialize({})), 'save/load must replay identically');
  assert.equal(black.inDuel, false, 'the duel must have finished');
});

test('enemySeekBias loosens the soldier hunger gate but not the worker gate', async () => {
  const { fightHungerFloor } = await import('../src/sim/ant/decisions.js');
  const soldier = { role: 'soldier', hungerMax: 100 };
  const worker = { role: 'worker', hungerMax: 100 };
  assert.equal(fightHungerFloor(soldier, { enemySeekBias: 0 }), 50);
  assert.ok(Math.abs(fightHungerFloor(soldier, { enemySeekBias: 1 }) - 20) < 1e-9);
  assert.equal(fightHungerFloor(worker, { enemySeekBias: 1 }), 50);
});

test('pursuit continues without rerolling until the commitment expires', () => {
  const { sim, red, black } = encounter();
  const committedConfig = { ...config, combatPursuitTicks: 3, combatPursuitCooldownTicks: 10 };
  red.update(sim.world, sim.rivalColony, sim.rng, committedConfig);
  assert.equal(red.pursuit.targetId, black.id);
  const restored = new SimulationCore('pursuit-reload');
  restored.loadFromSerialized(JSON.parse(JSON.stringify(sim.serialize({}))));
  assert.deepEqual(restored.rivalColony.ants[0].pursuit, red.pursuit);

  const rareEngagement = { ...committedConfig, combatEngageChance: 1e-12 };
  for (let i = 0; i < 2; i += 1) {
    red.update(sim.world, sim.rivalColony, sim.rng, rareEngagement);
    assert.equal(red.state, 'SEEK_FIGHT');
  }
  red.update(sim.world, sim.rivalColony, sim.rng, rareEngagement);
  assert.notEqual(red.state, 'SEEK_FIGHT');
});
