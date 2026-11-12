import test from 'node:test';
import assert from 'node:assert/strict';
import { Ant, FIGHT_COLOR } from '../src/sim/ant.js';
import { Colony } from '../src/sim/colony.js';
import { SeededRng } from '../src/sim/rng.js';
import { CombatSystem } from '../src/sim/systems/CombatSystem.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';
import { World } from '../src/sim/world.js';

const CONFIG = sanitizeTickConfig({
  combatEngageChance: 0.25,
  combatWorkerDamage: 8,
  combatSoldierDamage: 16,
  combatDuelSeconds: 3,
});
const DUEL_TICKS = CombatSystem.duelTicks(CONFIG);

function scriptedRng(values, fallback = 0.99) {
  return { next: () => (values.length > 0 ? values.shift() : fallback) };
}

function createCollision(blackRole = 'worker', redRole = 'worker', { redDx = 0 } = {}) {
  const world = new World(32, 32);
  const blackRng = new SeededRng('combat-black');
  const redRng = new SeededRng('combat-red');
  const blackColony = new Colony(world, blackRng, 0);
  const redColony = new Colony(world, redRng, 0, {
    id: 'red',
    homeX: 24,
    workerColor: '#d93828',
    soldierColor: '#8e1a12',
  });
  const blackAnt = new Ant(12, 8, blackRng, blackRole);
  const redAnt = new Ant(12 + redDx, 8, redRng, redRole);
  blackAnt.health = 100;
  redAnt.health = 100;
  blackColony.ants = [blackAnt];
  redColony.ants = [redAnt];
  return { blackColony, redColony, blackAnt, redAnt };
}

function runTicks(combat, collision, ticks, config = CONFIG) {
  for (let i = 0; i < ticks; i += 1) combat.resolve(collision.blackColony, collision.redColony, config);
}

test('duel length follows combatDuelSeconds at the sim tick rate', () => {
  assert.equal(DUEL_TICKS, 90);
  assert.equal(CombatSystem.duelTicks({ ...CONFIG, combatDuelSeconds: 5 }), 150);
});

test('workers engage below the aggression-adjusted threshold and lock into a purple duel', () => {
  const c = createCollision();
  const combat = new CombatSystem(scriptedRng([0.49]));

  assert.equal(combat.resolve(c.blackColony, c.redColony, CONFIG), 1);
  assert.equal(combat.activeDuelCount, 1);
  for (const ant of [c.blackAnt, c.redAnt]) {
    assert.equal(ant.inDuel, true);
    assert.equal(ant.state, 'FIGHT');
    assert.equal(ant.alive, true);
    assert.equal(Ant.getNormalColor(ant.state, ant.baseColor), FIGHT_COLOR);
  }
  assert.equal(combat.battles, 1);
});

test('workers do not engage at or above the aggression-adjusted threshold', () => {
  const c = createCollision();
  const combat = new CombatSystem({ next: () => 0.5 });

  assert.equal(combat.resolve(c.blackColony, c.redColony, CONFIG), 0);
  assert.equal(c.blackAnt.inDuel, false);
  assert.equal(c.blackAnt.health, 100);
  assert.equal(c.redAnt.health, 100);
});

test('the duel lasts the full duration and the healthier ant wins', () => {
  const c = createCollision();
  c.blackAnt.health = 90;
  c.redAnt.health = 70;
  c.blackAnt.state = 'FORAGE_SEARCH';
  const combat = new CombatSystem(scriptedRng([0, 0]));

  runTicks(combat, c, DUEL_TICKS); // engage tick + DUEL_TICKS-1 combat ticks
  assert.equal(c.blackAnt.alive, true, 'duel must still be running before the timer expires');
  assert.equal(c.redAnt.alive, true, 'duel must still be running before the timer expires');
  assert.equal(combat.activeDuelCount, 1);

  runTicks(combat, c, 1);
  assert.equal(combat.activeDuelCount, 0);
  assert.equal(c.redAnt.alive, false);
  assert.equal(c.redColony.ants.length, 0);
  assert.equal(c.redColony.deathsByCause.combat, 1);
  assert.equal(c.blackColony.ants.length, 1);
  assert.equal(c.blackAnt.inDuel, false);
  assert.equal(c.blackAnt.state, 'FORAGE_SEARCH', 'winner resumes what it was doing');
  // Winner absorbed the opponent's damage and a finishing wound.
  assert.ok(Math.abs(c.blackAnt.health - (90 - CONFIG.combatWorkerDamage) * 0.75) < 1e-9);
});

test('soldiers always engage and out-damage workers in a duel', () => {
  const c = createCollision('worker', 'soldier');
  const combat = new CombatSystem(scriptedRng([0, 0]));

  assert.equal(combat.resolve(c.blackColony, c.redColony, CONFIG), 1, 'soldier engages without a roll');
  runTicks(combat, c, DUEL_TICKS);
  assert.equal(c.blackColony.ants.length, 0);
  assert.equal(c.redColony.ants.length, 1);
  assert.ok(Math.abs(c.redAnt.health - (100 - CONFIG.combatWorkerDamage) * 0.75) < 1e-9);
  assert.equal(c.blackColony.deathsByCause.combat, 1);
});

test('hunters engage adjacent enemies; idle workers need a shared tile', () => {
  const idle = createCollision('worker', 'worker', { redDx: 1 });
  assert.equal(new CombatSystem({ next: () => 0 }).resolve(idle.blackColony, idle.redColony, CONFIG), 0);

  const seeking = createCollision('worker', 'worker', { redDx: 1 });
  seeking.redAnt.state = 'SEEK_FIGHT';
  assert.equal(new CombatSystem({ next: () => 0 }).resolve(seeking.blackColony, seeking.redColony, CONFIG), 1);

  const soldier = createCollision('soldier', 'worker', { redDx: 1 });
  assert.equal(new CombatSystem({ next: () => 0.99 }).resolve(soldier.blackColony, soldier.redColony, CONFIG), 1);
});

test('a duel ends early and frees the survivor if the opponent dies of other causes', () => {
  const c = createCollision();
  const combat = new CombatSystem(scriptedRng([0]));
  runTicks(combat, c, 5);
  c.redAnt.alive = false;
  runTicks(combat, c, 1);
  assert.equal(combat.activeDuelCount, 0);
  assert.equal(c.blackAnt.inDuel, false);
  assert.equal(c.blackAnt.alive, true);
  assert.equal(c.blackColony.deathsByCause.combat, 0);
});

test('dueling ants hold position during their own update', () => {
  const c = createCollision();
  const combat = new CombatSystem(scriptedRng([0]));
  runTicks(combat, c, 1);
  const rng = new SeededRng('duel-hold');
  for (let i = 0; i < 10; i += 1) {
    c.blackAnt.update(c.blackColony.world, c.blackColony, rng, CONFIG);
  }
  assert.equal(c.blackAnt.x, 12);
  assert.equal(c.blackAnt.y, 8);
  assert.equal(c.blackAnt.state, 'FIGHT');
});

test('combatEngageChance 0 disables all engagement, soldiers included', () => {
  const c = createCollision('soldier', 'soldier');
  const combat = new CombatSystem({ next: () => 0 });
  assert.equal(combat.resolve(c.blackColony, c.redColony, { ...CONFIG, combatEngageChance: 0 }), 0);
});

test('combat config sanitizer preserves the soldier damage advantage and clamps new knobs', () => {
  const sanitized = sanitizeTickConfig({
    combatWorkerDamage: 50,
    combatSoldierDamage: 1,
    enemySeekBias: 7,
    combatDuelSeconds: 99,
  });

  assert.equal(sanitized.combatWorkerDamage, 49);
  assert.equal(sanitized.combatSoldierDamage, 50);
  assert.equal(sanitized.enemySeekBias, 1);
  assert.equal(sanitized.combatDuelSeconds, 10);
});

test('red aggression increases worker engagement without increasing damage', () => {
  const normal = createCollision();
  const aggressive = createCollision();
  assert.equal(new CombatSystem({ next: () => 0.4 }).resolve(
    normal.blackColony, normal.redColony, { ...CONFIG, redAggressionMultiplier: 1 }), 0);
  const combat = new CombatSystem({ next: () => 0.4 });
  assert.equal(combat.resolve(aggressive.blackColony, aggressive.redColony, CONFIG), 1);
  aggressive.blackAnt.health = 100;
  aggressive.redAnt.health = 100;
  runTicks(combat, aggressive, DUEL_TICKS);
  const survivor = aggressive.blackAnt.alive ? aggressive.blackAnt : aggressive.redAnt;
  assert.ok(Math.abs(survivor.health - (100 - CONFIG.combatWorkerDamage) * 0.69) < 1e-9);
});

test('close duels favor the healthier ant 60/40 regardless of colony', () => {
  const config = { ...CONFIG, combatWorkerDamage: 0, combatSoldierDamage: 0 };
  for (const [blackHealth, redHealth, roll, blackWins] of [
    [100, 80, 0.599, true], [100, 80, 0.6, false],
    [80, 100, 0.599, false], [80, 100, 0.6, true],
    [100, 79, 0.99, true], [79, 100, 0.99, false],
    [100, 100, 0.49, false], [100, 100, 0.5, true],
  ]) {
    const c = createCollision('soldier', 'soldier');
    c.blackAnt.health = blackHealth;
    c.redAnt.health = redHealth;
    const combat = new CombatSystem(scriptedRng([roll, 0]));
    runTicks(combat, c, DUEL_TICKS + 1, config);
    assert.equal(c.blackAnt.alive, blackWins, `${blackHealth} vs ${redHealth}, roll ${roll}`);
  }
});

test('finishing wounds reduce the survivor\'s remaining health by 25 to 40 percent', () => {
  const config = { ...CONFIG, combatWorkerDamage: 0, combatSoldierDamage: 0 };
  for (const [roll, multiplier] of [[0, 0.75], [0.999, 0.75 - 0.999 * 0.15]]) {
    const c = createCollision('soldier', 'soldier');
    c.redAnt.health = 50;
    const combat = new CombatSystem(scriptedRng([roll]));
    runTicks(combat, c, DUEL_TICKS + 1, config);
    assert.ok(Math.abs(c.blackAnt.health - 100 * multiplier) < 1e-9);
    assert.equal(c.blackAnt.alive, true);
  }
});

test('close-fight and wound knobs default to the documented values', () => {
  assert.equal(CONFIG.combatCloseFightMargin, 0.2);
  assert.equal(CONFIG.combatCloseFightWinChance, 0.6);
  assert.equal(CONFIG.combatWoundMinHealthFraction, 0.6);
  assert.equal(CONFIG.combatWoundMaxHealthFraction, 0.75);
});

test('sanitizer clamps close-fight and wound knobs and keeps wound max >= min', () => {
  const s = sanitizeTickConfig({
    combatCloseFightMargin: 5,
    combatCloseFightWinChance: 0.1,
    combatWoundMinHealthFraction: 0.9,
    combatWoundMaxHealthFraction: 0.3,
  });
  assert.equal(s.combatCloseFightMargin, 1);
  assert.equal(s.combatCloseFightWinChance, 0.5);
  assert.equal(s.combatWoundMinHealthFraction, 0.9);
  assert.equal(s.combatWoundMaxHealthFraction, 0.9);
  const bad = sanitizeTickConfig({ combatCloseFightWinChance: NaN, combatWoundMinHealthFraction: 'x' });
  assert.equal(bad.combatCloseFightWinChance, 0.6);
  assert.equal(bad.combatWoundMinHealthFraction, 0.6);
});

test('close-fight margin, win chance and wound range follow config', () => {
  // Gap of 30% of the healthier ant: not close by default, close at margin 0.4.
  const base = { ...CONFIG, combatWorkerDamage: 0, combatSoldierDamage: 0 };
  const config = { ...base, combatCloseFightMargin: 0.4, combatCloseFightWinChance: 0.9, combatWoundMinHealthFraction: 0.5, combatWoundMaxHealthFraction: 0.5 };
  for (const [roll, blackWins] of [[0.89, true], [0.9, false]]) {
    const c = createCollision('soldier', 'soldier');
    c.blackAnt.health = 100;
    c.redAnt.health = 70;
    const combat = new CombatSystem(scriptedRng([roll, 0.7]));
    runTicks(combat, c, DUEL_TICKS + 1, config);
    assert.equal(c.blackAnt.alive, blackWins, `roll ${roll}`);
    const survivor = blackWins ? c.blackAnt : c.redAnt;
    assert.ok(Math.abs(survivor.health - (blackWins ? 100 : 70) * 0.5) < 1e-9);
  }
  // Default margin treats the same 30% gap as decisive regardless of the roll.
  const c = createCollision('soldier', 'soldier');
  c.blackAnt.health = 100;
  c.redAnt.health = 70;
  runTicks(new CombatSystem(scriptedRng([0.99, 0])), c, DUEL_TICKS + 1, base);
  assert.equal(c.blackAnt.alive, true);
});

test('a duel leaves a local alarm that recruits a soldier outside combat sight', () => {
  const { blackColony, redColony, blackAnt } = createCollision('soldier');
  const { world, rng } = blackColony;
  const combat = new CombatSystem(new SeededRng('alarm-duel'));
  assert.equal(combat.resolve(blackColony, redColony, CONFIG), 1);
  const soldier = new Ant(blackAnt.x + 10, blackAnt.y, rng, 'soldier');
  soldier.hunger = soldier.hungerMax;
  soldier.health = soldier.healthMax;
  blackColony.ants.push(soldier);
  const before = soldier.x;
  soldier.update(world, blackColony, rng, CONFIG);
  assert.equal(soldier.state, 'RESPOND_ALARM');
  assert.ok(soldier.x < before);
});
