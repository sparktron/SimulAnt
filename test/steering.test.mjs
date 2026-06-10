import test from 'node:test';
import assert from 'node:assert/strict';
import { World, TERRAIN } from '../src/sim/world.js';
import { Ant } from '../src/sim/ant.js';
import { SeededRng } from '../src/sim/rng.js';
import { moveByPheromone } from '../src/sim/ant/steering.js';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

// Phase 2 — steering micro-characterization. moveByPheromone is the core of
// foraging behavior but had no direct unit coverage; it was only exercised
// indirectly through full-sim runs. These tests pin three things the review and
// the A/B harness care about: (1) how strong a trail must be to recruit a
// passing searcher (the break-even root cause, review bug #1), (2) the
// reverse-forbidden gait invariant, and (3) the v0.45.1 gravitation homeward
// filter that kills carrier death spirals. See docs/pheromone-strategy.md.

// DIRS index map (constants.js): 0=E,1=SE,2=S,3=SW,4=W,5=NW,6=N,7=NE  (y grows down).
const EAST = 0; const WEST = 4; const NORTH = 6;
const CONFIG = sanitizeTickConfig(getDefaultConfig());

function groundWorld(w = 32, h = 32) {
  const world = new World(w, h);
  world.terrain.fill(TERRAIN.GROUND);
  world.markTerrainDirty();
  return world;
}

// ---------------------------------------------------------------------------
// 1. Recruitment threshold characterization (review bug #1). A searcher moving
//    EAST passes a single trail tile due NORTH (a corridor it crosses). We sweep
//    the trail strength v and measure how often it actually turns onto the trail.
//
//    This is the break-even root cause made quantitative: the gait multiplier
//    (forward x1.6 vs sideways x0.5) means a perpendicular trail must be strong
//    to win the step. Mid-route values from a single carrier pass are ~0.3-0.5,
//    where recruitment is only ~18-34% — so a lone discoverer's trail recruits
//    almost nobody and trails fail to multiply discovery. A future recruitment
//    fix should RAISE the weak-trail numbers; update the thresholds when it does.
// ---------------------------------------------------------------------------
function pTurnOntoTrail(world, rng, v, samples) {
  const cx = 16; const cy = 16;
  world.toFood.fill(0);
  world.toFood[world.index(cx, cy - 1)] = v; // trail tile due north
  let turned = 0;
  const ant = new Ant(cx, cy, rng, 'worker');
  for (let i = 0; i < samples; i += 1) {
    ant.x = cx; ant.y = cy; ant.dir = EAST; ant.theta = 0; // committed heading: east
    ant.carrying = null; ant.carryingType = 'none';
    ant._ticksSinceOnTrail = Infinity; ant._lastTrailDir = -1;
    moveByPheromone(ant, world, rng, CONFIG, 'food', null);
    if (ant.dir === NORTH) turned += 1;
  }
  return turned / samples;
}

test('recruitment onto a crossed trail rises monotonically with trail strength', () => {
  const world = groundWorld();
  const rng = new SeededRng('recruit-char');
  const strengths = [0.1, 0.3, 0.5, 1, 2, 4, 8];
  const probs = strengths.map((v) => pTurnOntoTrail(world, rng, v, 4000));

  for (let i = 1; i < probs.length; i += 1) {
    assert.ok(probs[i] >= probs[i - 1] - 0.02, `P(turn) should be non-decreasing: ${probs}`);
  }
  // Weak single-carrier trail barely recruits — this is the bug-#1 deficit.
  const pWeak = probs[strengths.indexOf(0.3)];
  assert.ok(pWeak < 0.30, `weak trail (v=0.3) should recruit poorly, got ${pWeak.toFixed(3)}`);
  // Even at half strength the searcher mostly keeps going straight.
  const pHalf = probs[strengths.indexOf(0.5)];
  assert.ok(pHalf < 0.50, `half-strength trail should still be minority recruit, got ${pHalf.toFixed(3)}`);
  // A strong, reinforced corridor does recruit reliably.
  const pStrong = probs[strengths.indexOf(4)];
  assert.ok(pStrong > 0.80, `strong trail (v=4) should recruit reliably, got ${pStrong.toFixed(3)}`);
});

// ---------------------------------------------------------------------------
// 2. Reverse is forbidden. The gait gives the reverse direction multiplier 0,
//    so an ant never flips 180 degrees in a single step — even when the only
//    pheromone is directly behind it. Guards against a tuning change silently
//    re-enabling jittery back-and-forth motion.
// ---------------------------------------------------------------------------
test('an ant never reverses 180 degrees in one step, even toward a strong trail behind it', () => {
  const world = groundWorld();
  const rng = new SeededRng('reverse-invariant');
  const cx = 16; const cy = 16;
  // Very strong trail due WEST — the exact reverse of the ant's eastward heading.
  world.toFood[world.index(cx - 1, cy)] = 50;

  const ant = new Ant(cx, cy, rng, 'worker');
  for (let i = 0; i < 8000; i += 1) {
    ant.x = cx; ant.y = cy; ant.dir = EAST; ant.theta = 0;
    ant.carrying = null; ant.carryingType = 'none';
    ant._ticksSinceOnTrail = Infinity; ant._lastTrailDir = -1;
    moveByPheromone(ant, world, rng, CONFIG, 'food', null);
    assert.notEqual(ant.dir, WEST, 'ant must never choose the reverse direction');
  }
});

// ---------------------------------------------------------------------------
// 3. Gravitation homeward filter (v0.45.1). A returning carrier gravitates
//    toward a strong nearby food trail ONLY when that trail is closer to the
//    entrance than the ant. A trail BEHIND the ant (farther from the nest) must
//    be ignored, otherwise the carrier orbits its own fresh deposit (the death
//    spiral). A trail AHEAD should strengthen homing. We measure mean change in
//    distance-to-entrance per step (negative = homeward).
// ---------------------------------------------------------------------------
function meanHomewardDelta(world, rng, entrance, cx, cy, trailCells) {
  world.toFood.fill(0);
  for (const c of trailCells) world.toFood[world.index(c.x, c.y)] = c.v;
  const oldDist = Math.hypot(cx - entrance.x, cy - entrance.y);
  let sum = 0;
  const samples = 4000;
  const ant = new Ant(cx, cy, rng, 'worker');
  for (let i = 0; i < samples; i += 1) {
    ant.x = cx; ant.y = cy; ant.dir = WEST; ant.theta = Math.PI; // facing homeward
    ant.carrying = { type: 'food', pelletNutrition: 5 }; ant.carryingType = 'food';
    ant._ticksSinceOnTrail = Infinity; ant._lastTrailDir = -1;
    moveByPheromone(ant, world, rng, CONFIG, 'home', entrance, null, world.toFood);
    sum += Math.hypot(ant.x - entrance.x, ant.y - entrance.y) - oldDist;
  }
  return sum / samples;
}

test('carrier gravitation ignores a trail behind it but follows one ahead (no death spiral)', () => {
  const world = groundWorld(48, 48);
  const rng = new SeededRng('grav-filter');
  const cx = 30; const cy = 24;
  const entrance = { x: cx - 12, y: cy, radius: 2 }; // entrance to the WEST

  const base = meanHomewardDelta(world, rng, entrance, cx, cy, []);
  const behind = meanHomewardDelta(world, rng, entrance, cx, cy,
    [{ x: cx + 1, y: cy, v: 6 }, { x: cx + 2, y: cy, v: 6 }]); // EAST = away from nest
  const ahead = meanHomewardDelta(world, rng, entrance, cx, cy,
    [{ x: cx - 1, y: cy, v: 6 }, { x: cx - 2, y: cy, v: 6 }]); // WEST = toward nest

  assert.ok(base < 0, `baseline carrier should move homeward, got ${base.toFixed(4)}`);
  // The homeward filter must neutralize a behind-trail: progress stays ~baseline
  // and crucially never becomes less homeward (which would be the orbit pull).
  assert.ok(behind <= base + 0.01, `behind-trail must not pull the carrier backward (base ${base.toFixed(4)}, behind ${behind.toFixed(4)})`);
  // A trail ahead should make homing measurably stronger.
  assert.ok(ahead < base - 0.005, `ahead-trail should strengthen homing (base ${base.toFixed(4)}, ahead ${ahead.toFixed(4)})`);
});
