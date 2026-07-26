import test from 'node:test';
import assert from 'node:assert/strict';
import { Ant } from '../src/sim/ant.js';
import { Colony } from '../src/sim/colony.js';
import { SeededRng } from '../src/sim/rng.js';
import { CombatSystem } from '../src/sim/systems/CombatSystem.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';
import { World } from '../src/sim/world.js';

const CONFIG = sanitizeTickConfig({
  combatEngageChance: 0.25,
  combatWorkerDamage: 8,
  combatSoldierDamage: 16,
});

function createCollision(blackRole = 'worker', redRole = 'worker') {
  const world = new World(32, 32);
  const blackRng = new SeededRng('combat-black');
  const redRng = new SeededRng('combat-red');
  const blackColony = new Colony(world, blackRng, 0);
  const redColony = new Colony(world, redRng, 0, {
    id: 'red',
    homeX: 24,
    workerColor: '#d93828',
    soldierColor: '#ff6654',
  });
  const blackAnt = new Ant(12, 8, blackRng, blackRole);
  const redAnt = new Ant(12, 8, redRng, redRole);
  blackAnt.health = 100;
  redAnt.health = 100;
  blackColony.ants = [blackAnt];
  redColony.ants = [redAnt];
  return {
    blackColony,
    redColony,
    blackAnt,
    redAnt,
  };
}

test('opposing ants engage below the 25% collision threshold and fight to one survivor', () => {
  const collision = createCollision();
  const rng = {
    values: [0.249, 0],
    next() {
      return this.values.shift();
    },
  };
  const combat = new CombatSystem(rng);

  assert.equal(combat.resolve(collision.blackColony, collision.redColony, CONFIG), 1);
  assert.equal(collision.blackColony.ants.length, 1);
  assert.equal(collision.redColony.ants.length, 0);
  assert.equal(collision.blackAnt.health, 4);
  assert.equal(collision.redColony.deathsByCause.combat, 1);
  assert.equal(combat.battles, 1);
});

test('opposing ants do not engage at or above the 25% collision threshold', () => {
  const collision = createCollision();
  const combat = new CombatSystem({ next: () => 0.25 });

  assert.equal(combat.resolve(collision.blackColony, collision.redColony, CONFIG), 0);
  assert.equal(collision.blackAnt.health, 100);
  assert.equal(collision.redAnt.health, 100);
  assert.equal(collision.blackColony.ants.length, 1);
  assert.equal(collision.redColony.ants.length, 1);
});

test('soldier damage exceeds worker damage and lets a soldier win the duel', () => {
  const collision = createCollision('worker', 'soldier');
  const rng = {
    values: [0, 0],
    next() {
      return this.values.shift();
    },
  };
  const combat = new CombatSystem(rng);

  combat.resolve(collision.blackColony, collision.redColony, CONFIG);

  assert.equal(CONFIG.combatWorkerDamage, 8);
  assert.equal(CONFIG.combatSoldierDamage, 16);
  assert.equal(collision.blackColony.ants.length, 0);
  assert.equal(collision.redColony.ants.length, 1);
  assert.equal(collision.redAnt.health, 44);
  assert.equal(collision.blackColony.deathsByCause.combat, 1);
});

test('combat config sanitizer preserves the soldier damage advantage', () => {
  const sanitized = sanitizeTickConfig({
    combatWorkerDamage: 50,
    combatSoldierDamage: 1,
  });

  assert.equal(sanitized.combatWorkerDamage, 49);
  assert.equal(sanitized.combatSoldierDamage, 50);
});
