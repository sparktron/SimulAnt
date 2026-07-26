/**
 * Resolves local combat between ants from opposing colonies.
 *
 * A collision is two living opponents occupying the same world tile after
 * movement. Each pair gets one deterministic engagement roll per tick. Once
 * engaged, the ants alternate attacks until exactly one dies; soldiers deal
 * more damage per attack than workers.
 */
export class CombatSystem {
  constructor(rng) {
    this.rng = rng;
    this.battles = 0;
  }

  resolve(blackColony, redColony, config) {
    const redByTile = new Map();
    for (const ant of redColony.ants) {
      if (!ant.alive) continue;
      const key = `${ant.x},${ant.y}`;
      const occupants = redByTile.get(key);
      if (occupants) occupants.push(ant);
      else redByTile.set(key, [ant]);
    }

    const engagedBlack = new Set();
    const engagedRed = new Set();

    for (const blackAnt of blackColony.ants) {
      if (!blackAnt.alive || engagedBlack.has(blackAnt)) continue;
      const opponents = redByTile.get(`${blackAnt.x},${blackAnt.y}`);
      if (!opponents) continue;

      for (const redAnt of opponents) {
        if (!redAnt.alive || engagedRed.has(redAnt)) continue;
        if (this.rng.next() >= config.combatEngageChance) continue;

        engagedBlack.add(blackAnt);
        engagedRed.add(redAnt);
        this.#fightToDeath(blackAnt, blackColony, redAnt, redColony, config);
        this.battles += 1;
        break;
      }
    }

    if (engagedBlack.size > 0) blackColony.removeDeadAnts();
    if (engagedRed.size > 0) redColony.removeDeadAnts();

    return engagedBlack.size;
  }

  #fightToDeath(blackAnt, blackColony, redAnt, redColony, config) {
    blackAnt.state = 'FIGHT';
    redAnt.state = 'FIGHT';

    const blackDamage = this.#damageFor(blackAnt, config);
    const redDamage = this.#damageFor(redAnt, config);
    let attacker = this.rng.next() < 0.5 ? blackAnt : redAnt;

    while (blackAnt.alive && redAnt.alive) {
      if (attacker === blackAnt) {
        this.#attack(blackAnt, redAnt, redColony, blackDamage);
        attacker = redAnt;
      } else {
        this.#attack(redAnt, blackAnt, blackColony, redDamage);
        attacker = blackAnt;
      }
    }
  }

  #damageFor(ant, config) {
    return ant.role === 'soldier'
      ? config.combatSoldierDamage
      : config.combatWorkerDamage;
  }

  #attack(_attacker, defender, defendingColony, damage) {
    defender.health = Math.max(0, defender.health - damage);
    if (defender.health > 0) return;
    defender.alive = false;
    defendingColony.recordDeath('combat');
  }

  serialize() {
    return { battles: this.battles };
  }

  loadFromSerialized(data) {
    this.battles = Number.isFinite(data?.battles) ? Math.max(0, Math.floor(data.battles)) : 0;
  }
}
