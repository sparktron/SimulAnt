/*
  Ant steering and movement primitives — extracted from ant.js (Phase 3 of
  the decomposition plan, see docs/ant-decomposition-plan.md).

  The heaviest RNG users in the simulation: pheromone-weighted movement,
  correlated random walk, obstacle/danger avoidance. Pure relocation — every
  rng.* call stays in its original order, verified by the replay-hash test.

  Depends one-way on navigation (corridor predicates, entry targets) and on
  the shared DIRS / gaussianRandom primitives in constants.js.
*/

import * as navigation from './navigation.js';
import { DIRS, gaussianRandom } from './constants.js';

/*
    Moves ant by evaluating pheromone gradient + momentum + directional bias.

    Algorithm:
    1. Compute weight for each of 8 directions based on pheromone concentration
    2. Apply directional penalties (hard-block reverse, discourage back-diagonals)
    3. Add steering contribution from heading/meander (correlated random walk)
    4. Sample by weighted distribution to pick movement
    5. Returns true if ant moved, false if all neighbors are blocked

    Key insight: Combining pheromone strength (followAlpha/followBeta) with
    directional momentum prevents jitter and keeps trails stable. The threshold
    logic lets ants lock onto trails without constantly recomputing the gradient.
*/
export function moveByPheromone(ant, world, rng, config, channel, entrance, colony, trailAttractionField = null) {
  if (!colony) colony = ant._currentColony;
  const field = channel === 'home' ? world.toHome : world.toFood;
  const epsilon = 0.001;
  const reverseDir = (ant.dir + 4) % DIRS.length;
  const homeScentWeight = getHomeScentWeight(ant, config, entrance);
  const enforceEntranceCorridor = navigation.isEntranceTransitState(ant) && !!entrance;

  // Trail gravitation (config.trailGravitation): a returning carrier senses the
  // strongest food-trail tile within a small radius and biases its step toward
  // it, so separate return lines MERGE into shared corridors. This converges the
  // visible trails without touching searchers' outbound exploration — carriers
  // normally only sense the 8 adjacent tiles, so two parallel lines a few tiles
  // apart never feel each other. Gravitation lets a carrier climb sideways onto
  // the dominant nearby corridor. gravUX/gravUY = unit vector toward it.
  let gravUX = 0, gravUY = 0, gravStrength = 0;
  if (config.trailGravitation && trailAttractionField && ant.carrying?.type === 'food') {
    const R = config.trailGravitationRadius ?? 3;
    const here = trailAttractionField[world.index(ant.x, ant.y)] ?? 0;
    let bestV = here, bx = ant.x, by = ant.y;
    for (let oy = -R; oy <= R; oy += 1) {
      for (let ox = -R; ox <= R; ox += 1) {
        if (ox === 0 && oy === 0) continue;
        const sx = ant.x + ox, sy = ant.y + oy;
        if (!world.inBounds(sx, sy) || !world.isPassable(sx, sy)) continue;
        const v = trailAttractionField[world.index(sx, sy)] ?? 0;
        if (v > bestV) { bestV = v; bx = sx; by = sy; }
      }
    }
    // Only gravitate toward a clearly stronger corridor than the ant's own tile,
    // so carriers already on the dominant line aren't pulled off it.
    if (bestV > here && bestV > (config.trailGravitationMinTrail ?? 0.5)) {
      const dx = bx - ant.x, dy = by - ant.y;
      const len = Math.hypot(dx, dy) || 1;
      gravUX = dx / len; gravUY = dy / len;
      gravStrength = Math.min(bestV * (config.trailGravitationGain ?? 0.5), config.trailGravitationMax ?? 4.0);
    }
  }

  // (Previous behavior: when carriers were on weak pheromone we bypassed the
  // weighted steering and ran a greedy descent toward the entrance. The
  // greedy step always picked the closest-distance neighbor, which produced
  // perfectly straight return paths even when natural wander would have been
  // realistic. With the gentler homeTieBiasScaleCarrying and restored
  // returnCarryNoiseScale, the weighted steering keeps carriers oriented
  // toward the entrance without erasing all per-step variance, so the
  // fallback is no longer needed.)

  const weights = [];
  let total = 0;

  for (let i = 0; i < DIRS.length; i += 1) {
    const d = i;
    const nx = ant.x + DIRS[d][0];
    const ny = ant.y + DIRS[d][1];
    if (!world.isPassable(nx, ny)) {
      weights.push({ d, w: 0 });
      continue;
    }
    if (enforceEntranceCorridor && navigation.violatesEntranceCorridor(ant,nx, ny, entrance)) {
      weights.push({ d, w: 0 });
      continue;
    }

    const nidx = world.index(nx, ny);
    const rawPher = Math.pow(field[nidx] + epsilon, config.followAlpha);
    const scentScale = channel === 'home' ? homeScentWeight : 1;
    const uncappedPherContribution = rawPher * config.followBeta * scentScale;
    const pherContribution = channel === 'home'
      ? Math.min(uncappedPherContribution, config.homeScentMaxContributionPerStep ?? 999)
      : uncappedPherContribution;
    // Angular distance from the ant's last-moved direction.  delta=0 forward,
    // 1 forward-45°, 2 sideways, 3 back-45°, 4 reverse.  Hard-block reverse so
    // ants never flip 180°; strongly discourage back-diagonals.  Net effect:
    // the candidate set is effectively forward, forward-45°, or sideways —
    // a smooth gait instead of pheromone-driven jitter.
    const delta = Math.min(
      (d - ant.dir + DIRS.length) % DIRS.length,
      (ant.dir - d + DIRS.length) % DIRS.length,
    );
    let directionalMult;
    if (delta === 0) directionalMult = 1.6;        // forward
    else if (delta === 1) directionalMult = 1.3;   // forward-45°
    else if (delta === 2) directionalMult = 0.5;   // sideways
    else if (delta === 3) directionalMult = 0.05;  // back-45°
    else directionalMult = 0;                      // reverse — forbidden
    const momentum = 0;
    const reversePenalty = d === reverseDir ? config.reversePenalty : 0;

    // Danger avoidance: reduce weight for tiles with danger pheromone.
    // Configurable so tuning can be tightened without altering steering math.
    const dangerAvoidanceWeight = config.dangerAvoidanceWeight ?? 1.25;
    const dangerPenalty = world.danger[nidx] * dangerAvoidanceWeight;

    // Crowding avoidance: reduce weight toward congested tiles
    const crowdingPenalty = colony ? getCrowdingPenalty(ant, nx, ny, colony) : 0;

    let tieBias = 0;
    if (entrance) {
      const neighborDist = Math.hypot(nx - entrance.x, ny - entrance.y);
      if (channel === 'home') {
        // Normalize by step length so bias is consistent at any distance from nest.
        // progress ≈ +1 stepping directly toward nest, -1 stepping directly away.
        const antDist = Math.hypot(ant.x - entrance.x, ant.y - entrance.y) + 0.001;
        const stepLen = Math.hypot(DIRS[d][0], DIRS[d][1]);
        const progress = (antDist - neighborDist) / stepLen;
        // Boost the home goal-vector bias when carrying food so the nest
        // direction reliably beats momentum (0.3) even on a weakly-trailed
        // tile — otherwise carriers drift in their last wander direction.
        const carrying = ant.carrying?.type === 'food';
        const scale = carrying
          ? (config.homeTieBiasScaleCarrying ?? 0.6)
          : (config.homeTieBiasScale ?? 0.05);
        tieBias = progress * scale;
      } else {
        // Normalize by step length (same pattern as home channel) so the
        // magnitude is ≈ ±scale regardless of how far from the nest the ant
        // is.  The old formula (neighborDist * scale) produced absolute values
        // of ~9+ at search distances, swamping headingBias (0.20) and
        // momentum (0.3) and making all 8 directions nearly equally weighted —
        // the correlated walk had no influence and ants appeared to bounce
        // randomly.  outwardProgress ≈ +1 stepping directly away from nest,
        // ≈ -1 stepping directly toward it.
        const antDist = Math.hypot(ant.x - entrance.x, ant.y - entrance.y) + 0.001;
        const stepLen = Math.hypot(DIRS[d][0], DIRS[d][1]);
        const outwardProgress = (neighborDist - antDist) / stepLen;
        tieBias = outwardProgress * (config.foodTieBiasScale ?? 0.18);
      }
    }

    // Reduce wander noise when the ant is already locked onto a trail so it
    // follows pheromone all the way to the source instead of drifting off.
    // Strong-trail noise is essentially zero so foragers walk a clean line
    // along the corridor instead of jittering off and on it every few ticks.
    const carryingFood = ant.carrying?.type === 'food';
    const currentTrailValue = field[world.index(ant.x, ant.y)] ?? 0;
    const trailLockThreshold = config.trailLockThreshold ?? 1.0;
    const onClearTrail = !carryingFood && channel === 'food' && currentTrailValue > trailLockThreshold;
    const onWeakTrail = !carryingFood && channel === 'food' && currentTrailValue > 0.1;
    const noiseReduction = carryingFood ? (config.returnCarryNoiseScale ?? 0.15) : onClearTrail ? 0.0 : onWeakTrail ? 0.25 : 1.0;
    const pherBoost = carryingFood && channel === 'home' ? 2.0 : 1.0;  // 2x home pheromone boost

    // Trail re-acquisition: if ant ant was on a trail recently but lost it,
    // bias toward the last known trail direction for a few ticks.
    let reacquireBias = 0;
    if (!onWeakTrail && channel === 'food' && ant._ticksSinceOnTrail < 5 && ant._lastTrailDir >= 0) {
      reacquireBias = d === ant._lastTrailDir ? 0.4 : 0;
    }

    const noise = rng.range(0, config.wanderNoise * noiseReduction);
    const boostedPherContribution = pherContribution * pherBoost;

    // Heading alignment: soft bias toward the persistent exploration heading
    // (ant.theta, maintained by #updateWanderHeading).  Uses the dot product
    // so alignment decays smoothly as the candidate direction diverges from
    // theta.  Only applied to the food channel during free search so it does
    // not fight goal-directed home-pheromone steering.
    let headingContrib = 0;
    if (channel === 'food') {
      const headingBias = config.headingBias ?? 0.20;
      const dirLen = Math.hypot(DIRS[d][0], DIRS[d][1]);
      const dot = (DIRS[d][0] / dirLen) * Math.cos(ant.theta)
                + (DIRS[d][1] / dirLen) * Math.sin(ant.theta);
      headingContrib = Math.max(0, dot) * headingBias;
    }

    // Trail corridor lock: when returning with food, multiply ant candidate's
    // weight by a boost proportional to the food trail value on that tile.
    // Multiplicative so it scales with the dominant home-pheromone signal and
    // always tips the balance toward the existing corridor over a blank tile.
    let trailBoost = 1.0;
    if (trailAttractionField) {
      const tv = trailAttractionField[nidx] ?? 0;
      if (tv > 0.1) {
        trailBoost = 1.0 + Math.min(tv * (config.returnTrailBoostScale ?? 0.15), config.returnTrailBoostMax ?? 3.0);
      }
    }

    // Apply the directional multiplier to the steering signal so the gait
    // term overrides pheromone differences smaller than ~3×.  Reverse is
    // killed outright (mult=0); back-45° barely survives.  Penalties are
    // applied AFTER the multiplier so danger/reverse subtractions still bite.
    // Lateral pull toward the strongest nearby corridor (see gravitation block).
    let gravContribution = 0;
    if (gravStrength > 0) {
      const dirLen = Math.hypot(DIRS[d][0], DIRS[d][1]) || 1;
      const gdot = (DIRS[d][0] / dirLen) * gravUX + (DIRS[d][1] / dirLen) * gravUY;
      gravContribution = Math.max(0, gdot) * gravStrength;
    }
    const steerSignal = (boostedPherContribution + tieBias + reacquireBias + headingContrib + gravContribution) * directionalMult * trailBoost;
    const weight = Math.max(0, steerSignal + noise - reversePenalty - dangerPenalty - crowdingPenalty);
    weights.push({
      d,
      w: weight,
      components: {
        pheromone: pherContribution,
        momentum,
        tieBias,
        noise,
        reversePenalty,
        dangerPenalty,
      },
    });
    total += weight;
  }

  let chosenDir = ant.dir;
  if (total > 0.0001) {
    let pick = rng.range(0, total);
    for (let i = 0; i < weights.length; i += 1) {
      pick -= weights[i].w;
      if (pick <= 0) {
        chosenDir = weights[i].d;
        break;
      }
    }
  } else if (channel === 'home' && entrance) {
    return moveToward(ant, world, entrance.x, entrance.y, rng);
  } else {
    const safestDirs = [];
    let lowestDanger = Number.POSITIVE_INFINITY;
    for (let i = 0; i < DIRS.length; i += 1) {
      const nx = ant.x + DIRS[i][0];
      const ny = ant.y + DIRS[i][1];
      if (!world.isPassable(nx, ny)) continue;
      const danger = world.danger[world.index(nx, ny)];
      if (danger + 1e-6 < lowestDanger) {
        lowestDanger = danger;
        safestDirs.length = 0;
        safestDirs.push(i);
      } else if (Math.abs(danger - lowestDanger) <= 1e-6) {
        safestDirs.push(i);
      }
    }
    if (safestDirs.length > 0) {
      chosenDir = pickDirectionalCandidate(ant, safestDirs, rng);
    } else {
      chosenDir = (ant.dir + (rng.chance(0.5) ? 1 : DIRS.length - 1)) % DIRS.length;
    }
  }

  const tx = ant.x + DIRS[chosenDir][0];
  const ty = ant.y + DIRS[chosenDir][1];
  if (!world.isPassable(tx, ty)) return false;
  const chosenWeight = weights.find((weight) => weight.d === chosenDir);
  ant.lastSteeringDebug = {
    channel,
    chosenDir,
    components: chosenWeight?.components || null,
    homeScentWeight: channel === 'home' ? homeScentWeight : 0,
    distanceToEntrance: entrance ? Math.hypot(ant.x - entrance.x, ant.y - entrance.y) : null,
  };
  // Update trail re-acquisition memory: remember direction while on trail
  const movedTrailValue = field[world.index(tx, ty)] ?? 0;
  if (channel === 'food') {
    if (movedTrailValue > 0.1) {
      ant._lastTrailDir = chosenDir;
      ant._ticksSinceOnTrail = 0;
    } else {
      ant._ticksSinceOnTrail += 1;
    }
  }

  const prevX = ant.x;
  const prevY = ant.y;
  ant.x = tx;
  ant.y = ty;
  ant.dir = chosenDir;
  // Keep theta consistent with the direction actually taken so the correlated
  // walk in #updateWanderHeading builds on real movement, not desired heading.
  ant.theta = Math.atan2(DIRS[ant.dir][1], DIRS[ant.dir][0]);
  if (colony && (prevX !== ant.x || prevY !== ant.y)) {
    colony.moveAntInGrid(prevX, prevY, ant.x, ant.y);
  }
  return true;
}

export function moveThroughEntranceShaft(ant, world, entrance, targetY, rng) {
  if (!entrance) return false;
  const shaftHalfWidth = Math.max(1, (entrance.radius ?? 1) + 1);
  return moveToward(ant, world, entrance.x, targetY, rng, {
    entranceX: entrance.x,
    entranceY: entrance.y,
    shaftHalfWidth,
  });
}

export function getHomeScentWeight(ant, config, entrance) {
  if (!entrance) return config.homeScentBaseWeight ?? 1.0;

  const distance = Math.hypot(ant.x - entrance.x, ant.y - entrance.y);
  const falloffStart = Math.max(0, config.homeScentFalloffStartDist ?? 10);
  const falloffEnd = Math.max(falloffStart + 0.0001, config.homeScentFalloffEndDist ?? 100);
  const minFalloff = Math.min(1, Math.max(0, config.homeScentMinFalloff ?? 0.1));
  const t = Math.min(1, Math.max(0, (distance - falloffStart) / (falloffEnd - falloffStart)));
  const distanceFalloff = 1 - (1 - minFalloff) * t;

  const returningToNest = ant.carrying?.type === 'food'
    || ant.state === 'RETURN_HOME'
    || ant.state === 'RETURN_TO_NEST_HEAL'
    || ant.state === 'RETURN_NEST_TO_EAT';
  const stateScale = returningToNest ? (config.homeScentReturnStateScale ?? 1.0) : (config.homeScentSearchStateScale ?? 0.3);

  // Boost scent weight when carrying food and close to entrance
  let proximityBoost = 1.0;
  if (ant.carrying?.type === 'food' && distance < 60) {
    proximityBoost = 1 + (1 - distance / 60) * 3.0;  // up to 4x boost at entrance
  }

  return (config.homeScentBaseWeight ?? 1.0) * distanceFalloff * stateScale * proximityBoost;
}

export function getCrowdingPenalty(ant, x, y, colony) {
  // Disable crowding penalty near the entrance — entrances are *supposed*
  // to be crowded (they're chokepoints).  The penalty should only apply on
  // open trails and foraging areas to spread ants out.
  const entrance = colony.nearestEntrance(x, y);
  if (entrance) {
    const distToEntrance = Math.hypot(x - entrance.x, y - entrance.y);
    if (distToEntrance < 4) return 0;
  }

  // Count nearby ants (within 2 tiles) to detect crowding
  let nearbyAntCount = 0;
  const range = 2;
  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      if (dx === 0 && dy === 0) continue; // Don't count self
      const checkX = x + dx;
      const checkY = y + dy;
      nearbyAntCount += colony.countAntsAt(checkX, checkY);
    }
  }
  // Keep crowding avoidance soft and bounded. A hard quadratic penalty
  // can zero out all pheromone weights near dense nest traffic, causing
  // ants to ignore trails and mill around the entrance basin.
  const onTileCount = colony.countAntsAt(x, y);
  const localPenalty = Math.max(0, onTileCount - 1) * 0.35;
  const nearbyPenalty = nearbyAntCount * 0.05;
  return Math.min(3, localPenalty + nearbyPenalty);
}

export function moveToward(ant, world, tx, ty, rng, constraints = null) {
  // Score each passable neighbor by distance-to-target plus a crowding penalty.
  // Without the crowding term, every exit/enter goal sends ants to the exact
  // same tile and they stack indefinitely at the entrance column.
  const scored = [];
  let bestScore = Number.POSITIVE_INFINITY;
  const colony = ant._currentColony;

  for (let i = 0; i < DIRS.length; i += 1) {
    const nx = ant.x + DIRS[i][0];
    const ny = ant.y + DIRS[i][1];
    if (!world.isPassable(nx, ny)) continue;
    if (constraints) {
      const entranceX = constraints.entranceX;
      const entranceY = constraints.entranceY;
      const hasCorridor = Number.isFinite(entranceX)
        && Number.isFinite(entranceY)
        && Number.isFinite(constraints.shaftHalfWidth);
      if (hasCorridor && navigation.violatesEntranceCorridor(ant,nx, ny, {
        x: entranceX,
        y: entranceY,
        radius: Math.max(0, constraints.shaftHalfWidth - 1),
      })) {
        continue;
      }
    }
    const d = Math.hypot(tx - nx, ty - ny);
    const crowd = colony ? colony.countAntsAt(nx, ny) : 0;
    // Each already-present ant costs ~0.6 units of distance equivalence.
    // Strong enough to prefer an empty sidestep over a 1-tile-better but occupied target,
    // but weak enough that ants still make progress through lightly crowded tunnels.
    const score = d + crowd * 0.6;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      scored.length = 0;
      scored.push(i);
    } else if (score < bestScore + 1e-9) {
      scored.push(i);
    }
  }

  if (scored.length > 0) {
    const bestDir = pickDirectionalCandidate(ant, scored, rng);
    const prevX = ant.x;
    const prevY = ant.y;
    ant.x += DIRS[bestDir][0];
    ant.y += DIRS[bestDir][1];
    ant.dir = bestDir;
    ant.theta = Math.atan2(DIRS[ant.dir][1], DIRS[ant.dir][0]);
    if (colony && (prevX !== ant.x || prevY !== ant.y)) {
      colony.moveAntInGrid(prevX, prevY, ant.x, ant.y);
    }
    return true;
  }

  return false;
}

// Convert a continuous heading angle (radians) to the nearest of the 8 DIRS.
export function thetaToDir(ant, theta) {
  let bestDir = 0;
  let bestDot = -Infinity;
  const cx = Math.cos(theta);
  const cy = Math.sin(theta);
  for (let i = 0; i < DIRS.length; i++) {
    const d = DIRS[i];
    const len = Math.hypot(d[0], d[1]);
    const dot = (d[0] / len) * cx + (d[1] / len) * cy;
    if (dot > bestDot) { bestDot = dot; bestDir = i; }
  }
  return bestDir;
}

// Phase 4: smooth danger avoidance as a turn term.
//
// Samples world.danger at +/-45° off theta at `dangerTurnLookahead` tiles
// and returns a signed turn proportional to the lateral gradient.  The
// ant smoothly curves away from rising danger before the discrete
// dangerPenalty in #moveByPheromone has to scatter it at the boundary.
//
// Returns 0 when both sides read negligible danger so we don't burn turn
// budget on noise far from any hazard.
export function computeDangerTurn(ant, world, config) {
  const lookahead = config.dangerTurnLookahead ?? 2;
  const gain      = config.dangerTurnGain      ?? 0.40;
  const sideAngle = Math.PI / 4;

  const sampleAt = (angle) => {
    const tx = Math.round(ant.x + Math.cos(angle) * lookahead);
    const ty = Math.round(ant.y + Math.sin(angle) * lookahead);
    if (!world.inBounds(tx, ty)) return 0;
    return world.danger[world.index(tx, ty)] || 0;
  };

  const leftDanger  = sampleAt(ant.theta + sideAngle);
  const rightDanger = sampleAt(ant.theta - sideAngle);

  if (leftDanger < 1e-6 && rightDanger < 1e-6) return 0;

  // Positive gradient → more danger on the left → turn right (negative).
  // Normalize by (sum + epsilon) so the term saturates instead of growing
  // unboundedly with strong fields; the outer clamp finishes the job.
  const gradient = (leftDanger - rightDanger) / (leftDanger + rightDanger + 1e-6);
  return -gradient * gain;
}

// Phase 2: smooth obstacle avoidance as a turn term.
//
// Probes three points at `obstacleLookahead` tiles ahead of the persistent
// heading (theta): straight-ahead, +45°, -45°.  Returns a signed turn
// (radians) that nudges theta away from impassable tiles.  Magnitude is
// controlled by `obstacleTurnGain`.  The result is small enough to compose
// additively with the meander/noise terms; the outer clamp keeps total
// turn-per-tick bounded.
//
// This catches walls *before* the ant moves into them so the correlated
// walk curves smoothly along corridors and around obstacles, rather than
// relying solely on #moveByPheromone's wall-passability rejection (which
// produces abrupt scattering when the ant is shoved against a wall).
export function computeObstacleTurn(ant, world, config) {
  const lookahead = config.obstacleLookahead ?? 2;
  const sideAngle = Math.PI / 4;
  const gain      = config.obstacleTurnGain ?? 0.30;

  const blockedAt = (angle) => {
    const tx = Math.round(ant.x + Math.cos(angle) * lookahead);
    const ty = Math.round(ant.y + Math.sin(angle) * lookahead);
    return !world.isPassable(tx, ty);
  };

  const aheadBlocked = blockedAt(ant.theta);
  const leftBlocked  = blockedAt(ant.theta + sideAngle);
  const rightBlocked = blockedAt(ant.theta - sideAngle);

  if (aheadBlocked) {
    // Strong avoidance when wall is straight ahead — turn whichever side
    // is open.  When both sides are open, break the tie by continuing the
    // current rotation (prevTurn sign) so we don't oscillate.  When both
    // are blocked we leave the turn at zero and let the outer pipeline
    // (meander noise + #moveByPheromone wall rejection) handle the dead
    // end without locking us into a hard turn that just hits another wall.
    if (!leftBlocked && rightBlocked)        return +gain * 1.5;
    if (!rightBlocked && leftBlocked)        return -gain * 1.5;
    if (!leftBlocked && !rightBlocked)       return (ant.prevTurn >= 0 ? +1 : -1) * gain * 1.5;
    return 0;
  }
  if (leftBlocked  && !rightBlocked) return -gain;
  if (rightBlocked && !leftBlocked) return +gain;
  return 0;
}

// Correlated random walk: advances this.theta by a bounded, smoothed turn.
// this.dir is intentionally left unchanged here — see the NOTE below.
// Called from every wandering context (worker FORAGE_SEARCH, soldier patrol
// food-channel fallback, nurse idle wander, digger at-front wander).
// Goal-directed states (#moveToward, return-to-nest, deliver-food, etc.)
// deliberately skip the wander update so theta does not drift while the
// ant has an explicit destination.
//
// Turn model (per tick):
//   meanderTurn  = turnSign * meanderAmplitude * U(0.4, 1.0)
//   noiseTurn    = sigma * N(0, 1)
//   obstacleTurn = #computeObstacleTurn(world, config)   (Phase 2)
//   dangerTurn   = #computeDangerTurn(world, config)     (Phase 4)
//   rawTurn      = rho * prevTurn + noiseTurn + meanderTurn + obstacleTurn + dangerTurn
//   clampedTurn  = clamp(rawTurn, -maxTurnRate, maxTurnRate)
//   theta       += clampedTurn
//
// pheromoneTurn and goalTurn from the spec are intentionally NOT added as
// turn terms here.  They are handled elsewhere: the food/home pheromone
// gradient steers via the weighted-direction selection in #moveByPheromone
// (where headingContrib also lives), and explicit goal-directed movement
// (return-to-nest, go-to-food) is handled by #moveToward, which redirects
// motion outright rather than nudging the wander heading.  Composing all
// four into a single turn-sum would double-count the goal/pheromone signal
// and fight #moveByPheromone's selection.
export function updateWanderHeading(ant, rng, world, config) {
  // NOTE: spec defaults (sigma=0.35, meanderAmp=0.25) are calibrated for a
  // continuous-position system moving a fraction of a tile per tick.  In our
  // discrete 1-tile/tick system those values cause the ant to turn ~30°/tick
  // and trace tight circles.  Defaults here are scaled ~7× smaller so that
  // direction changes occur roughly every 5-10 ticks, producing organic arcs.
  const rho           = config.walkRho           ?? 0.75;
  const sigma         = config.walkSigma         ?? 0.05;
  const maxTurnRate   = config.walkMaxTurnRate   ?? 0.45;
  const meanderAmp    = config.meanderAmplitude  ?? 0.05;
  // pTurnSignFlip: probability the sign PERSISTS ant tick (no flip).
  const pPersist      = config.pTurnSignFlip     ?? 0.85;

  if (rng.chance(1 - pPersist)) ant.turnSign *= -1;

  const meanderTurn  = ant.turnSign * meanderAmp * rng.range(0.4, 1.0);
  const noiseTurn    = sigma * gaussianRandom(rng);
  const obstacleTurn = world ? computeObstacleTurn(ant, world, config) : 0;
  const dangerTurn   = world ? computeDangerTurn(ant, world, config)   : 0;
  const rawTurn      = rho * ant.prevTurn + noiseTurn + meanderTurn + obstacleTurn + dangerTurn;
  const clamped      = Math.max(-maxTurnRate, Math.min(maxTurnRate, rawTurn));

  ant.prevTurn = clamped;
  ant.theta   += clamped;
  // NOTE: ant.dir is intentionally NOT updated here.  Keeping ant.dir on
  // the actual last-moved direction ensures that (a) the momentum bias in
  // #moveByPheromone reflects where the ant really came from, and (b) the
  // reversal penalty targets the true reverse of that direction rather than
  // the wander heading's opposite.  Theta steers via the headingBias term
  // added to #moveByPheromone's weight calculation instead.
}

export function pickDirectionalCandidate(ant, candidates, rng) {
  if (!candidates?.length) return ant.dir;
  if (candidates.length === 1) return candidates[0];

  const reverseDir = (ant.dir + 4) % DIRS.length;
  let totalWeight = 0;
  const weightedCandidates = candidates.map((candidateDir) => {
    let weight = 1;
    if (candidateDir === ant.dir) {
      weight = 4;
    } else if (candidateDir === reverseDir) {
      weight = 0.8;
    } else {
      const delta = Math.min(
        (candidateDir - ant.dir + DIRS.length) % DIRS.length,
        (ant.dir - candidateDir + DIRS.length) % DIRS.length,
      );
      weight = delta === 1 ? 2.5 : 1.6;
    }
    totalWeight += weight;
    return { candidateDir, weight };
  });

  let pick = rng.range(0, totalWeight);
  for (let i = 0; i < weightedCandidates.length; i += 1) {
    pick -= weightedCandidates[i].weight;
    if (pick <= 0) return weightedCandidates[i].candidateDir;
  }
  return weightedCandidates[weightedCandidates.length - 1].candidateDir;
}
