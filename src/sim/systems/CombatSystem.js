/**
 * Resolves local combat between ants from opposing colonies as timed duels.
 *
 * Engagement: two living, not-already-dueling opponents on the same tile get
 * one deterministic engagement roll per tick. A "hunter" (a soldier, or an ant
 * actively seeking a fight) also engages opponents on any of the 8 adjacent
 * tiles. Soldiers always commit; other pairs roll combatEngageChance (red
 * aggression multiplies it).
 *
 * Duel: both ants lock in place in the FIGHT state (rendered purple) for
 * combatDuelSeconds. Over the duel each ant loses its opponent's damage stat
 * (combatWorkerDamage / combatSoldierDamage) in even per-tick slices, on top of
 * the normal fighting hunger/health drain. When the timer runs out the ant
 * with more health usually wins and the other dies. Close fights give the
 * healthier ant combatCloseFightWinChance (default 60%) within
 * combatCloseFightMargin; an exact tie is a coin flip. The survivor also
 * takes a random finishing wound (combatWoundMin/MaxHealthFraction). If
 * either ant dies early (damage, starvation, a predator), the other is freed.
 */
const NEIGHBOR_OFFSETS = Object.freeze([
  [0, 0],
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]);

export class CombatSystem {
  constructor(rng) {
    this.rng = rng;
    this.battles = 0;
    this.duels = [];
  }

  resolve(blackColony, redColony, config) {
    const finished = this.#advanceDuels(blackColony, redColony, config);
    const started = this.#startDuels(blackColony, redColony, config);
    if (finished > 0) {
      blackColony.removeDeadAnts();
      redColony.removeDeadAnts();
    }
    return started;
  }

  /** Number of duels currently in progress. */
  get activeDuelCount() {
    return this.duels.length;
  }

  static duelTicks(config) {
    const seconds = Number.isFinite(config.combatDuelSeconds) ? config.combatDuelSeconds : 3;
    const tickSeconds = config.tickSeconds > 0 ? config.tickSeconds : 1 / 30;
    return Math.max(1, Math.round(seconds / tickSeconds));
  }

  #startDuels(blackColony, redColony, config) {
    if (!(config.combatEngageChance > 0)) return 0;

    const redByTile = new Map();
    for (const ant of redColony.ants) {
      if (!ant.alive || ant.inDuel) continue;
      const key = `${ant.x},${ant.y}`;
      const occupants = redByTile.get(key);
      if (occupants) occupants.push(ant);
      else redByTile.set(key, [ant]);
    }
    if (redByTile.size === 0) return 0;

    const aggression = redColony.id === 'red' ? (config.redAggressionMultiplier ?? 2) : 1;
    const workerChance = Math.min(1, config.combatEngageChance * aggression);
    const totalTicks = CombatSystem.duelTicks(config);
    let started = 0;

    for (const blackAnt of blackColony.ants) {
      if (!blackAnt.alive || blackAnt.inDuel) continue;
      const blackHunts = isHunter(blackAnt);
      let engaged = false;

      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const adjacent = dx !== 0 || dy !== 0;
        const opponents = redByTile.get(`${blackAnt.x + dx},${blackAnt.y + dy}`);
        if (!opponents) continue;

        for (const redAnt of opponents) {
          if (!redAnt.alive || redAnt.inDuel) continue;
          if (adjacent && !blackHunts && !isHunter(redAnt)) continue;
          const soldierInvolved = blackAnt.role === 'soldier' || redAnt.role === 'soldier';
          if (!soldierInvolved && this.rng.next() >= workerChance) continue;

          this.#beginDuel(blackAnt, redAnt, totalTicks);
          if (config.enablePheromones !== false) {
            blackColony.world.depositCombatAlarm(blackAnt.x, blackAnt.y, Math.min(totalTicks, 45));
          }
          started += 1;
          engaged = true;
          break;
        }
        if (engaged) break;
      }
    }
    return started;
  }

  #beginDuel(blackAnt, redAnt, totalTicks) {
    this.duels.push({
      black: blackAnt,
      red: redAnt,
      ticksLeft: totalTicks,
      totalTicks,
      blackResume: resumeStateFor(blackAnt),
      redResume: resumeStateFor(redAnt),
    });
    for (const ant of [blackAnt, redAnt]) {
      ant.inDuel = true;
      ant.state = 'FIGHT';
    }
    this.battles += 1;
  }

  #advanceDuels(blackColony, redColony, config) {
    if (this.duels.length === 0) return 0;
    let finished = 0;
    let write = 0;
    for (const duel of this.duels) {
      if (this.#stepDuel(duel, blackColony, redColony, config)) {
        finished += 1;
      } else {
        this.duels[write++] = duel;
      }
    }
    this.duels.length = write;
    return finished;
  }

  // Returns true when the duel is over.
  #stepDuel(duel, blackColony, redColony, config) {
    const { black, red } = duel;
    if (!black.alive || !red.alive) {
      this.#endDuel(duel);
      return true;
    }

    black.health = Math.max(0, black.health - damageFor(red, config) / duel.totalTicks);
    red.health = Math.max(0, red.health - damageFor(black, config) / duel.totalTicks);
    duel.ticksLeft -= 1;

    if (black.health <= 0 || red.health <= 0) {
      if (black.health <= 0) kill(black, blackColony);
      if (red.health <= 0) kill(red, redColony);
      this.#endDuel(duel);
      return true;
    }
    if (duel.ticksLeft > 0) return false;

    let blackLoses;
    const healthGap = Math.abs(black.health - red.health);
    const healthierIsBlack = black.health > red.health;
    if (healthGap === 0) blackLoses = this.rng.next() < 0.5;
    else if (healthGap <= Math.max(black.health, red.health) * config.combatCloseFightMargin) {
      const healthierWins = this.rng.next() < config.combatCloseFightWinChance;
      blackLoses = healthierWins !== healthierIsBlack;
    } else blackLoses = !healthierIsBlack;
    const winner = blackLoses ? red : black;
    const { combatWoundMinHealthFraction: woundMin, combatWoundMaxHealthFraction: woundMax } = config;
    winner.health *= woundMax - this.rng.next() * (woundMax - woundMin);
    if (blackLoses) kill(black, blackColony);
    else kill(red, redColony);
    this.#endDuel(duel);
    return true;
  }

  #endDuel(duel) {
    release(duel.black, duel.blackResume);
    release(duel.red, duel.redResume);
  }

  serialize() {
    return {
      battles: this.battles,
      duels: this.duels.map((duel) => ({
        blackId: duel.black.id,
        redId: duel.red.id,
        ticksLeft: duel.ticksLeft,
        totalTicks: duel.totalTicks,
        blackResume: duel.blackResume,
        redResume: duel.redResume,
      })),
    };
  }

  /**
   * Restores counters and relinks in-progress duels to the restored ants.
   * Duels whose ants are missing (legacy or trimmed saves) are dropped.
   */
  loadFromSerialized(data, blackColony = null, redColony = null) {
    this.battles = Number.isFinite(data?.battles) ? Math.max(0, Math.floor(data.battles)) : 0;
    this.duels = [];
    if (!Array.isArray(data?.duels) || !blackColony || !redColony) return;
    const blackById = new Map(blackColony.ants.map((ant) => [ant.id, ant]));
    const redById = new Map(redColony.ants.map((ant) => [ant.id, ant]));
    for (const saved of data.duels) {
      const black = blackById.get(saved?.blackId);
      const red = redById.get(saved?.redId);
      if (!black || !red || black.inDuel || red.inDuel) continue;
      const totalTicks = Math.max(1, Math.floor(saved.totalTicks) || 1);
      this.duels.push({
        black,
        red,
        ticksLeft: Math.max(1, Math.min(totalTicks, Math.floor(saved.ticksLeft) || 1)),
        totalTicks,
        blackResume: typeof saved.blackResume === 'string' ? saved.blackResume : resumeStateFor(black),
        redResume: typeof saved.redResume === 'string' ? saved.redResume : resumeStateFor(red),
      });
      black.inDuel = true;
      red.inDuel = true;
      black.state = 'FIGHT';
      red.state = 'FIGHT';
    }
  }
}

function isHunter(ant) {
  return ant.role === 'soldier' || ant.state === 'SEEK_FIGHT' || ant.state === 'RAID';
}

function damageFor(ant, config) {
  return ant.role === 'soldier' ? config.combatSoldierDamage : config.combatWorkerDamage;
}

// State a winner resumes after the duel. Pursuit states resume as the role's
// default so the next decision pass re-evaluates targets from scratch.
function resumeStateFor(ant) {
  const state = ant.state;
  if (!state || state === 'FIGHT' || state === 'SEEK_FIGHT') {
    return ant.role === 'soldier' ? 'PATROL' : 'FORAGE_SEARCH';
  }
  return state;
}

function release(ant, resumeState) {
  ant.inDuel = false;
  if (ant.alive) ant.state = resumeState;
}

function kill(ant, colony) {
  if (!ant.alive) return;
  ant.health = 0;
  ant.alive = false;
  colony.recordDeath('combat');
}
