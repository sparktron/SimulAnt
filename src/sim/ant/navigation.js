/*
    Ant entrance / nest navigation helpers — extracted from ant.js (Phase 2 of
    the decomposition plan, see docs/ant-decomposition-plan.md).

    Pure free functions taking the ant as the first argument. These are the
    navigation *leaves*: geometry, corridor predicates, and the per-ant entrance
    scatter offset. None of them call steering, so they carry no determinism
    risk on their own.

    `moveThroughEntranceShaft` is intentionally NOT here — it wraps the steering
    primitive `moveToward` (which in turn calls the corridor predicates below),
    forming a navigation<->steering cycle. It moves with steering in Phase 4.
*/

export function getNestEntryTargetY(ant, world, entrance) {
  const baseX = entrance?.x ?? ant.x;
  const baseY = entrance?.y ?? world.entranceY ?? world.nestY;
  const maxDepthSearch = 6;

  // The target is always below the ant's current position — if the ant is
  // already in the shaft (below entrance.y), aim deeper instead of pulling
  // it back up to the entrance mouth. This keeps ants moving toward the
  // chamber when the entrance sits above the surface/underground boundary.
  const searchFrom = Math.max(baseY, ant.y);
  for (let dy = 1; dy <= maxDepthSearch; dy += 1) {
    const candidateY = Math.min(world.height - 1, searchFrom + dy);
    if (world.isPassable(baseX, candidateY)) {
      return candidateY;
    }
  }
  return searchFrom;
}

export function isEntranceTransitState(ant) {
  return ant.state === 'RETURN_HOME'
    || ant.state === 'RETURN_NEST_TO_EAT'
    || ant.state === 'RETURN_TO_NEST_HEAL'
    || ant.state === 'EXIT_NEST'
    || ant.state === 'STORE_FOOD_IN_NEST'
    || ant.state === 'HAUL_DIRT'
    || ant.state === 'NURSE_ENTER_NEST'
    || ant.state === 'DIG_ENTER_NEST'
    || ant.state === 'RETURN_NEST_FOR_QUEEN_FOOD';
}

export function violatesEntranceCorridor(ant, nextX, nextY, entrance) {
  if (!entrance) return false;
  if (!(nextY > entrance.y)) return false;

  const shaftHalfWidth = Math.max(1, (entrance.radius ?? 1) + 1);
  const currentDx = Math.abs(ant.x - entrance.x);
  const nextDx = Math.abs(nextX - entrance.x);
  if (nextDx <= shaftHalfWidth) return false;

  // Never allow a descent from mouth-or-above into the lower band unless
  // the ant is already aligned with the shaft corridor.
  if (ant.y <= entrance.y) return true;

  const movingTowardCorridor = nextDx < currentDx;
  const climbingTowardMouth = nextY < ant.y;
  return !movingTowardCorridor && !climbingTowardMouth;
}

export function distanceToEntrance(ant, colony) {
  const entrance = colony?.nearestEntrance?.(ant.x, ant.y);
  if (!entrance) return 0;
  return Math.hypot(ant.x - entrance.x, ant.y - entrance.y);
}

export function aimThetaAtEntrance(ant, colony) {
  const entrance = colony?.nearestEntrance?.(ant.x, ant.y);
  if (!entrance) return;
  ant.theta = Math.atan2(entrance.y - ant.y, entrance.x - ant.x);
}

export function entranceColumnOffset(ant, radius) {
  // Deterministic per-ant scatter across the entrance width.
  // Parse the id suffix once — cached so sorts/comparisons remain cheap.
  if (ant._entranceColumnOffset === undefined) {
    const numericPart = Number.parseInt((ant.id || '').slice(4), 10) || 0;
    const span = Math.max(1, radius * 2 + 1);
    ant._entranceColumnOffset = (numericPart % span) - Math.floor(span / 2);
  }
  return ant._entranceColumnOffset;
}
