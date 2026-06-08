import { createControls, syncToolPalette, syncSurfaceOnlyControls } from './ui/controls.js';
import { updateHud } from './ui/hud.js';
import { SurfaceRenderer } from './render/SurfaceRenderer.js';
import { NestRenderer } from './render/NestRenderer.js';
import { MiniMap } from './render/MiniMap.js';
import { SimulationCore } from './sim/SimulationCore.js';
import { sanitizeTickConfig } from './sim/core/SimulationTypes.js';
import { ViewManager, VIEW } from './ui/ViewManager.js';
import { InputRouter } from './input/InputRouter.js';
import { normalizeUnhandledRejectionReason, shouldReportFatalWindowError } from './ui/runtimeErrorGate.js';
import { ColonyStatusPanel } from './ui/ColonyStatusPanel.js';
import { ParameterEditor } from './ui/ParameterEditor.js';

const STORAGE_KEY = 'simant-save-v2';
const SIM_DT = 1 / 30;
const BASE_SIM_SPEED_SCALE = 0.4;
const DEBUG_UI = false;
const DEBUG_RENDER = false;
const EDIT_TOOLS = new Set(['food', 'wall', 'water', 'hazard', 'erase', 'dig', 'fill']);

const state = {
  paused: false,
  simSpeed: 1,
  selectedTool: 'food',
  brushRadius: 3,
  seed: 'simant-default',
  selectedAntId: null,
  cursor: { surface: null, nest: null },
  overlays: {
    showToFood: false,
    showToHome: false,
    showDanger: false,
    showScent: true,
    showAntJobs: false,
  },
  debug: {
    showEntranceInfo: false,
    showStats: false,
    digStatus: 'AUTO-DIG: OFF',
  },
  config: {
    tickSeconds: SIM_DT,
    antCap: 2000,
    // Food trails are deliberately MEDIUM-strength and short-lived. Stronger
    // trails (v0.26.6 tried evapFood=0.15, deposit=0.5) trap foragers on
    // stale corridors after a food cluster depletes — telemetry showed pop
    // peak dropping from 234 (weak trails) to 137 (strong trails) because
    // ants kept committing to dead corridors instead of finding new food.
    //
    // 0.25 puts the food half-life at ~2.8 sim sec — enough time for a few
    // carriers to reinforce a real corridor, short enough that a depleted
    // source's trail dissolves before it bottles up the workforce.
    evapFood: 0.25,
    evapHome: 0.015,
    evapDanger: 0.08,
    // Food diffusion is moderate so trails have a detectable width (ants
    // sense only 8 immediate neighbors) while still staying legible.
    diffFood: 0.02,
    diffHome: 0.18,
    diffDanger: 0.12,
    diffIntervalTicks: 2,
    depositFood: 0.7,
    depositHome: 0.15,
    dangerDeposit: 0.3,
    hazardDeathChance: 0.02,
    foodPickupRate: 0.7,
    digChance: 0.04,
    digEnergyCost: 8,
    digHomeBoost: 0.9,
    digRecruitRadius: 16,
    digWorkersPerFront: 4,
    queenEggTicks: 20,
    // queenEggFoodCost was 0.15. In long-run telemetry the queen stopped
    // laying entirely once foodStored hit 0 (most of mid/late game), even
    // though her health (97%) said she was perfectly capable. With S1's
    // health-scaling already self-limiting her, the food gate became a
    // redundant binding constraint. Drop to a token 0.02 so brief deposits
    // still pull eggs through.
    queenEggFoodCost: 0.02,
    // Egg laying scales with queen health: progress per tick = health/healthMax.
    // Below queenLayingMinHealth fraction she stops laying entirely (recovery).
    // Each egg laid costs queenEggHealthCost health, creating a feedback loop
    // that self-limits the queen and ties birth rate to her condition.
    queenEggHealthCost: 0.05,
    queenLayingMinHealth: 0.2,
    // Trophallaxis: a fed ant can pass a small amount of hunger to an
    // adjacent hungry one each tick. Rates are intentionally small — this is
    // a survival-pressure release, not the primary feeding channel.
    trophallaxisRate: 2.0,
    trophallaxisDonorMinHungerFraction: 0.6,
    trophallaxisRecipientMaxHungerFraction: 0.4,
    queenHungerDrain: 0.25,
    queenEatNutrition: 5,
    queenHealthDrainRate: 7,
    queenHealthRecoveryPerNutrition: 0.25,
    queenFoodRequestHealthThreshold: 0.5,
    queenFoodRequestClearThreshold: 0.8,
    queenFoodRequestHungerThreshold: 0.2,
    queenCourierPickupNutrition: 6,
    queenSuccessionDelayTicks: 150,
    queenSuccessionFoodCost: 60,
    queenSuccessionMinHealthFraction: 0.5,
    foodReservePerAnt: 40,
    foodMinReserve: 300,
    foodRespawnCooldownTicks: 60,
    broodFoodDrainRate: 0.005,
    broodGestationSeconds: 8,
    broodStarvationTicks: 600,
    larvaeCrowdingThreshold: 8,
    workerEatNutrition: 25,
    starvationRecoveryHealth: 5,
    healthDrainRate: 5,
    healthRegenRate: 1,
    // Idle drain must stay below move drain — punishing ants for standing still
    // (e.g. waiting in an entrance traffic jam) compounded into nest die-off.
    healthWorkIdleDrainRate: 0.03,
    healthWorkMoveDrainRate: 0.08,
    healthWorkCarryDrainRate: 0.01,
    healthWorkFightDrainRate: 0.6,
    healthEatRecoveryRate: 0.45,
    workerEmergencyEatNutrition: 35,
    carryingHungerDrainRate: 0.5,
    fightingHungerDrainRate: 3,
    soldierSpawnChance: 0.05,  // 5% chance for soldiers to spawn via brood
    foodVisionRadius: 24,
    surfaceFoodSearchMaxMissTicks: 400,  // Give foragers much more time to find food
    surfaceReturnToNestHungerThreshold: 0.6,  // Return after timeout with safety margin
    followAlpha: 1.5,
    // Moderate trail pull — strong enough to bias toward established corridors,
    // weak enough that searchers don't get locked onto stale trails when food
    // is depleted. Higher values (8+) caused trail traps; lower values (2)
    // lost the recruitment benefit.
    followBeta: 4.0,
    wanderNoise: 0.02,
    randomTurnChance: 0.02,
    momentumBias: 0.3,
    reversePenalty: 0.9,
    homeDepositIntervalTicks: 3,
    homeDepositMinDistance: 20,
    innerScatterRadius: 6,
    nearEntranceScatterRadius: 8,
    foodTrailDistanceScale: 1.0,
    // Carriers fade in food-trail deposits from 0 → full over the first 8
    // tiles past the entrance. Prevents the entrance from becoming the
    // global pheromone maximum (all returners funnel through it), which
    // would pull new searchers right back to the entrance.
    foodDepositMinDistance: 8,
    trailLockThreshold: 1.0,
    foodTrailDecayPerStep: 0.92,
    // Modest distance scaling — 1.0 at entrance, up to 1.8 ≥16 tiles out.
    // Steeper scales (v0.26.6's 2.5) combined with bigger deposits created
    // sticky stale corridors. The remaining 1.8× boost still produces a
    // real outward gradient without overconcentrating mass on any single
    // active path.
    maxFoodTrailScale: 1.8,
    homeScentBaseWeight: 1.0,
    homeScentSearchStateScale: 0.3,
    homeScentReturnStateScale: 1.0,
    homeScentFalloffStartDist: 10,
    homeScentFalloffEndDist: 100,
    homeScentMinFalloff: 0.1,
    homeScentMaxContributionPerStep: 999,
    homeTieBiasScale: 0.05,
    // homeTieBiasScaleCarrying was 2.5 — strong enough that the goal-bias
    // dominated direction selection and returners traced arrow-straight
    // lines back to the entrance. 0.6 keeps them clearly homing without
    // erasing the per-step variance from noise and pheromone gradients.
    homeTieBiasScaleCarrying: 0.6,
    // returnCarryNoiseScale was 0.05 — effectively zero noise on the return
    // path, which combined with high tie-bias made paths deterministic given
    // the pheromone field. 0.3 gives the gait a natural meander while still
    // suppressing the full search-noise level.
    // Consolidation: carriers strongly prefer existing food-trail tiles on the
    // way home (boost 0.15→0.6, max 3→6) and meander less (0.3→0.1), so returners
    // merge onto shared corridors instead of each cutting a private diagonal.
    // Only safe BECAUSE adaptiveTrail decays trails to depleted sources — strong
    // consolidation on a stale field just herds ants onto dead routes (-13% A/B).
    returnCarryNoiseScale: 0.1,
    returnTrailBoostScale: 0.6,
    returnTrailBoostMax: 6.0,
    // Re-enabled (was 0 in the weak-trail era). Without it, an off-trail
    // searcher has essentially no preferred direction — pherContribution is
    // zero off-trail, momentum is hardcoded to 0, and noise is 0.02. The
    // correlated random walk picks a theta and drifts it, but theta itself
    // is unbiased, so foragers wander aimlessly between trails. 0.1 gives
    // a small but persistent outward push that keeps them committed to a
    // direction without overpowering trail-following when a trail is found.
    foodTieBiasScale: 0.1,
    // Adaptive recruitment decay: a carrier's trail-laying strength is seeded at
    // pickup (recruitRichBudget for rich sources, 1.0 otherwise) and decays each
    // tick (recruitDecayPerStep) on the way home. Straight returns from live rich
    // clusters lay a strong corridor; wandering carriers and marginal/depleted
    // sources lay almost nothing, so the field stops smearing and consolidates on
    // clusters still being harvested. First trail config to beat trails-OFF (+10%
    // nutrition, 6-seed×5000-tick A/B). See docs/pheromone-foraging-rca.
    adaptiveTrail: true,
    recruitDecayPerStep: 0.97,
    recruitRichBudget: 1.6,
    debugSteeringContributions: false,
    debugSteeringLogIntervalTicks: 30,
    pheromoneMaxClamp: 150,
    enablePheromones: true,
    // Phase 1: correlated random walk tuning constants (ant movement core).
    // These are calibrated for 1-tile/tick discrete movement.  The spec values
    // (sigma=0.35, meanderAmp=0.25) assume a continuous sub-tile step size;
    // using them directly produces tight circles.  Reduce meanderAmplitude
    // first if ants look too twitchy; raise it if paths look too linear.
    walkRho: 0.75,          // turn-to-turn correlation (0 = memoryless, 1 = fixed arc)
    walkSigma: 0.05,        // Gaussian noise scale (radians per tick)
    walkMaxTurnRate: 0.45,  // hard clamp on total turn per tick (radians)
    meanderAmplitude: 0.05, // meander bias magnitude (radians)
    pTurnSignFlip: 0.85,    // probability meander sign PERSISTS each tick (no flip)
    // Stronger persistence on the current heading. Was 0.20 — too small to
    // hold a direction across a few ticks of correlated-walk turn drift, so
    // foragers turned visibly often even with no obstacle in front of them.
    // 0.40 makes them commit to a heading the way a real ant on a search
    // path does: walk a few tiles, gentle curve, repeat. Still gets
    // overridden when a real pheromone gradient appears.
    headingBias: 0.40,      // max additive weight toward persistent theta in food-channel search
    // Phase 2: smooth obstacle avoidance composed into the wander turn sum.
    obstacleLookahead: 2,   // tiles ahead of theta to probe for walls
    obstacleTurnGain: 0.30, // base radians/tick of corrective turn (×1.5 when ahead is blocked)
    // Phase 4: smooth danger avoidance composed into the wander turn sum.
    dangerTurnLookahead: 2, // tiles off theta to probe danger pheromone
    dangerTurnGain: 0.40,   // max radians/tick when one side fully dominates
  },
  casteTargets: {
    workers: 100,
    soldiers: 0,
  },
  colonyStatus: {
    workAllocation: { forage: 55, dig: 20, nurse: 25 },
    casteAllocation: { workers: 85, soldiers: 10, breeders: 5 },
  },
};

const canvas = mustById('simCanvas');
const simCore = new SimulationCore(state.seed);
if (typeof window !== 'undefined') {
  window.__sim = {
    simCore,
    state,
    // Pull the rolling stats buffer as a downloadable JSONL/CSV file. Called
    // by the LOG button and the keyboard shortcut, also reachable from the
    // browser devtools console as window.__sim.downloadLog('jsonl' | 'csv').
    downloadLog: (format = 'jsonl') => downloadStatsLog(format),
    // Direct access for ad-hoc console inspection without a download.
    statsSnapshot: () => simCore.stats.getSummary(),
    statsSamples: () => simCore.stats.samples.slice(),
  };
}
const viewManager = new ViewManager(VIEW.SURFACE);
const surfaceRenderer = new SurfaceRenderer(canvas, simCore.world);
const nestRenderer = new NestRenderer(canvas, simCore.world);
const miniMap = new MiniMap(mustById('minimapCanvas'));

surfaceRenderer.resize();
nestRenderer.resize();

simCore.colony.setWorkAllocation(state.colonyStatus.workAllocation);
applyColonyStatusToConfig();

new InputRouter(canvas, viewManager, {
  surface: {
    screenToWorld: (sx, sy) => surfaceRenderer.screenToWorld(sx, sy),
    paint: (x, y) => applyToolIfInBounds(x, y),
    selectAnt: (x, y) => selectAntNear(x, y),
    onPointerWorld: (x, y) => {
      state.cursor.surface = { x, y };
    },
    pan: (dx, dy) => {
      surfaceRenderer.cameraX -= dx / surfaceRenderer.zoom;
      surfaceRenderer.cameraY -= dy / surfaceRenderer.zoom;
    },
    zoom: (zoomDelta) => {
      surfaceRenderer.zoom = Math.max(1, Math.min(10, surfaceRenderer.zoom * zoomDelta));
    },
  },
  nest: {
    screenToWorld: (sx, sy) => nestRenderer.screenToWorld(sx, sy),
    paint: (x, y) => applyToolIfInBounds(x, y),
    selectAnt: (x, y) => selectAntNear(x, y),
    onPointerWorld: (x, y) => {
      state.cursor.nest = { x, y };
    },
    pan: (dx, dy) => {
      nestRenderer.cameraX -= dx / nestRenderer.zoom;
      nestRenderer.cameraY -= dy / nestRenderer.zoom;
    },
    zoom: (zoomDelta) => {
      nestRenderer.zoom = Math.max(1, Math.min(10, nestRenderer.zoom * zoomDelta));
    },
  },
});

createControls(state, {
  stepOnce: () => simCore.update(state.config),
  reset: (seed) => {
    state.seed = seed || state.seed;
    simCore.reset(state.seed);
    state.selectedAntId = null;
    syncRenderWorld();
  },
  save: () => saveState(),
  load: () => loadState(),
  clearWorld: () => simCore.clearWorld(),
  toggleView: () => viewManager.toggle(),
  getView: () => viewManager.getCurrent(),
  toggleDebugStats: () => {
    state.debug.showStats = !state.debug.showStats;
    state.debug.showEntranceInfo = state.debug.showStats;
  },
  toggleScentOverlay: () => {
    state.overlays.showScent = !state.overlays.showScent;
  },
  spawnFoodAtCursor: () => {
    if (viewManager.getCurrent() !== VIEW.SURFACE || !state.cursor.surface) return;
    simCore.spawnFoodCluster(state.cursor.surface.x, state.cursor.surface.y, 8, 12);
  },
  starveSelectedAnt: () => {
    const ant = simCore.findAntById(state.selectedAntId);
    if (!ant) return;
    ant.hunger = 5;
  },
  addFoodToStore: () => {
    simCore.addFoodToStore(50);
  },
  togglePheromones: () => {
    state.config.enablePheromones = !state.config.enablePheromones;
    return state.config.enablePheromones;
  },
  toggleAutoDig: () => {
    const enabled = simCore.toggleAutoDig();
    state.debug.digStatus = enabled ? 'AUTO-DIG: ON' : 'AUTO-DIG: OFF';
  },
  downloadLog: (format) => downloadStatsLog(format),
  forceChamber: () => {
    const carved = simCore.forceChamberAtDigFront(state.config);
    state.debug.digStatus = carved ? 'AUTO-DIG: CHAMBER CARVED' : 'AUTO-DIG: CHAMBER FAILED';
  },
});

const colonyStatusPanel = new ColonyStatusPanel({
  initialState: {
    work: {
      wA: state.colonyStatus.workAllocation.forage / 100,
      wB: state.colonyStatus.workAllocation.dig / 100,
      wC: state.colonyStatus.workAllocation.nurse / 100,
    },
    caste: {
      wA: state.colonyStatus.casteAllocation.workers / 100,
      wB: state.colonyStatus.casteAllocation.soldiers / 100,
      wC: state.colonyStatus.casteAllocation.breeders / 100,
    },
  },
  onWorkChange: (percentages) => {
    state.colonyStatus.workAllocation = {
      forage: percentages.a,
      dig: percentages.b,
      nurse: percentages.c,
    };
    simCore.colony.setWorkAllocation(state.colonyStatus.workAllocation);
  },
  onCasteChange: (percentages) => {
    state.colonyStatus.casteAllocation = {
      workers: percentages.a,
      soldiers: percentages.b,
      breeders: percentages.c,
    };
    state.casteTargets.workers = percentages.a;
    state.casteTargets.soldiers = percentages.b;
    applyColonyStatusToConfig();
  },
});

// Initialize parameter editor
const parameterEditor = new ParameterEditor('#parameterEditorContainer', state, () => {
  // Parameters are already mutated in state.config; write sanitized values back
  // so malformed UI or preset input cannot persist NaN/unsafe config state.
  Object.assign(state.config, sanitizeTickConfig(state.config));
});

// Setup tab switching
function switchTab(tabName) {
  const statsView = document.getElementById('statsView');
  const paramsView = document.getElementById('paramsView');
  const statsBtn = document.getElementById('statsTabBtn');
  const paramsBtn = document.getElementById('paramsTabBtn');

  if (tabName === 'stats') {
    statsView.classList.add('active');
    paramsView.classList.remove('active');
    statsBtn.classList.add('active');
    paramsBtn.classList.remove('active');
  } else if (tabName === 'params') {
    statsView.classList.remove('active');
    paramsView.classList.add('active');
    statsBtn.classList.remove('active');
    paramsBtn.classList.add('active');
  }
}

document.getElementById('statsTabBtn').addEventListener('click', () => switchTab('stats'));
document.getElementById('paramsTabBtn').addEventListener('click', () => switchTab('params'));

window.addEventListener('resize', () => {
  surfaceRenderer.resize();
  nestRenderer.resize();
});

viewManager.onChange((mode) => {
  if (mode !== VIEW.SURFACE && mode !== VIEW.NEST) {
    console.warn(`[SimAnt] View "${mode}" is not a valid mode — snapping back to SURFACE.`);
    viewManager.setView(VIEW.SURFACE);
    return;
  }
  mustById('viewToggleBtn').textContent = mode === VIEW.SURFACE ? 'VIEW: SURFACE' : 'VIEW: NEST';
  mustById('modeIndicator').textContent = mode;
  // Surface tools (food/wall/water/...) vs nest tools (dig/fill) are only
  // meaningful in their own view — enable the applicable set and re-home the
  // selection if the active tool just became inert.
  syncToolPalette(state, mode);
  // The SCENT button (surface-only overlays) is disabled outside SURFACE view.
  syncSurfaceOnlyControls(mode);
});

let accumulator = 0;
let lastTime = performance.now();
let fps = 60;
let fpsTimer = 0;
let frameCount = 0;
let simMs = 0;
let hasFatalError = false;
const lastGoodRenderState = {
  view: VIEW.SURFACE,
  surfaceCam: { x: surfaceRenderer.cameraX, y: surfaceRenderer.cameraY, zoom: surfaceRenderer.zoom },
  nestCam: { x: nestRenderer.cameraX, y: nestRenderer.cameraY, zoom: nestRenderer.zoom },
};

window.addEventListener('error', (event) => {
  if (!shouldReportFatalWindowError(event)) return;
  reportFatalError(event.error || event.message || 'Unknown window error');
});

window.addEventListener('unhandledrejection', (event) => {
  reportFatalError(normalizeUnhandledRejectionReason(event.reason));
});

requestAnimationFrame(loop);

/**
 * Main browser frame loop.
 *
 * Called by requestAnimationFrame; drives fixed-step simulation updates,
 * rendering, and HUD refresh. Side effects include mutating global `state`,
 * stepping `simCore`, and drawing to canvas.
 */
function loop(now) {
  if (hasFatalError) return;

  try {
    const elapsed = Math.min(0.25, (now - lastTime) / 1000);
    lastTime = now;

    fpsTimer += elapsed;
    frameCount += 1;
    if (fpsTimer >= 0.5) {
      fps = frameCount / fpsTimer;
      fpsTimer = 0;
      frameCount = 0;
    }

    if (!state.paused) {
      accumulator += elapsed * state.simSpeed * BASE_SIM_SPEED_SCALE;
      const start = performance.now();
      while (accumulator >= SIM_DT) {
        simCore.update(state.config);
        accumulator -= SIM_DT;
      }
      simMs = performance.now() - start;
    }

    const activeView = getSafeViewMode();
    try {
      if (activeView === VIEW.SURFACE) {
        surfaceRenderer.draw(simCore.colony, state.overlays, simCore.nestEntrances, simCore.foodPellets, {
          selectedAntId: state.selectedAntId,
          showDebugStats: state.debug.showStats,
          showEntranceInfo: state.debug.showEntranceInfo,
          cursor: state.cursor.surface,
        });
      } else {
        nestRenderer.draw(simCore.colony, state.overlays, {
          selectedAntId: state.selectedAntId,
          showDebugStats: state.debug.showStats,
        });
      }
      captureLastGoodRenderState(activeView);
    } catch (renderError) {
      recoverFromRenderError(renderError);
    }

    // Minimap reflects whichever view is active via that renderer's camera.
    try {
      const activeCam = activeView === VIEW.SURFACE ? surfaceRenderer : nestRenderer;
      miniMap.draw(simCore.world, simCore.colony, activeCam, canvas);
    } catch (miniMapError) {
      if (DEBUG_UI) console.debug('[SimAnt UI] Minimap draw failed:', miniMapError);
    }

    const selectedAnt = simCore.findAntById(state.selectedAntId);
    const antHealthStats = getAntHealthStats(simCore.colony.ants);
    const hudCounts = getHudAntCounts(simCore.colony.ants, simCore.world.nestY);
    try {
      updateHud({
        viewMode: activeView,
        fps,
        tick: simCore.tick,
        ants: simCore.colony.ants.length,
        workers: hudCounts.workers,
        soldiers: hudCounts.soldiers,
        breeders: hudCounts.breeders,
        nurses: hudCounts.nurses,
        foragers: hudCounts.jobsForage,
        diggers: hudCounts.jobsDig,
        jobsForage: hudCounts.jobsForage,
        jobsDig: hudCounts.jobsDig,
        jobsNurse: hudCounts.jobsNurse,
        foodStored: getHudFoodTotal(simCore.colony),
        queenHealth: simCore.colony.queen.health,
        queenAlive: simCore.colony.queen.alive,
        selectedAntHealth: selectedAnt ? selectedAnt.health : null,
        antHealthStats,
        simMs,
        digStatus: state.debug.digStatus,
        pherStats: simCore.world.getPheromoneStats(),
        antsSurface: hudCounts.surface,
        antsUnderground: hudCounts.underground,
        followingFood: simCore.colony.ants.filter((ant) => ant.state === 'FORAGE_SEARCH' || ant.state === 'GO_TO_FOOD').length,
        followingHome: simCore.colony.ants.filter((ant) => ant.state === 'RETURN_HOME' || ant.state === 'CARRY_TO_NEST').length,
        deaths: simCore.colony.deaths,
        deathsByCause: simCore.colony.deathsByCause,
        virtualFoodRemaining: simCore.colony._virtualFoodStored,
        virtualFoodInitial: simCore.colony._virtualFoodInitial,
      });
    } catch (hudError) {
      console.error('[SimAnt] HUD update threw an error — simulation continues, but the stats panel may show stale numbers:', hudError);
    }

    maybeLogSteeringDebug(selectedAnt);

    requestAnimationFrame(loop);
  } catch (error) {
    reportFatalError(error);
  }
}


function getHudAntCounts(ants, nestY) {
  const counts = {
    workers: 0,
    soldiers: 0,
    breeders: 0,
    nurses: 0,
    jobsForage: 0,
    jobsDig: 0,
    jobsNurse: 0,
    surface: 0,
    underground: 0,
  };

  if (!Array.isArray(ants)) return counts;

  for (const ant of ants) {
    if (!ant?.alive) continue;

    if (ant.y > nestY) {
      counts.underground += 1;
    } else {
      counts.surface += 1;
    }

    if (ant.role === 'worker') {
      counts.workers += 1;
      if (ant.workFocus === 'dig') counts.jobsDig += 1;
      else if (ant.workFocus === 'nurse') {
        counts.jobsNurse += 1;
        counts.nurses += 1;
      } else {
        counts.jobsForage += 1;
      }
      continue;
    }

    if (ant.role === 'soldier') counts.soldiers += 1;
    else if (ant.role === 'breeder') counts.breeders += 1;
  }

  return counts;
}


function getHudFoodTotal(colony) {
  if (typeof colony?.getTotalStoredFood === 'function') {
    return colony.getTotalStoredFood();
  }

  const stored = Number.isFinite(colony?.foodStored) ? colony.foodStored : 0;
  const pelletFood = Array.isArray(colony?.nestFoodPellets)
    ? colony.nestFoodPellets.reduce((sum, pellet) => {
      const amount = Number.isFinite(pellet?.amount)
        ? pellet.amount
        : (Number.isFinite(pellet?.nutrition) ? pellet.nutrition : 0);
      return sum + amount;
    }, 0)
    : 0;

  // `foodStored` is canonical in current saves; pellet sum is a legacy/fallback source.
  return Math.max(stored, pelletFood);
}

function getAntHealthStats(ants) {
  if (!Array.isArray(ants) || ants.length === 0) {
    return { min: 0, avg: 0, max: 0 };
  }

  let min = 100;
  let max = 0;
  let total = 0;
  for (const ant of ants) {
    const health = Math.max(0, Math.min(100, ant.health ?? 0));
    min = Math.min(min, health);
    max = Math.max(max, health);
    total += health;
  }

  return {
    min,
    avg: total / ants.length,
    max,
  };
}

function maybeLogSteeringDebug(selectedAnt) {
  if (!state.config.debugSteeringContributions || !state.debug.showStats) return;
  const interval = Math.max(1, Math.floor(state.config.debugSteeringLogIntervalTicks || 1));
  if (simCore.tick % interval !== 0) return;

  const sample = selectedAnt || simCore.colony.ants.find((ant) => ant.role === 'worker');
  if (!sample?.lastSteeringDebug) return;

  console.debug('[SimAnt Steering Debug]', {
    tick: simCore.tick,
    antId: sample.id,
    state: sample.state,
    carrying: sample.carrying?.type || 'none',
    channel: sample.lastSteeringDebug.channel,
    chosenDir: sample.lastSteeringDebug.chosenDir,
    components: sample.lastSteeringDebug.components,
    distanceToEntrance: sample.lastSteeringDebug.distanceToEntrance,
    homeScentWeight: sample.lastSteeringDebug.homeScentWeight,
  });
}

/**
 * Selects the closest ant to a world-space point.
 *
 * Used by pointer input handlers in both views. Returns true when selection
 * succeeds and updates `state.selectedAntId`.
 */
function selectAntNear(x, y) {
  const ant = simCore.findAntNear(x, y, 2);
  if (!ant) return false;
  state.selectedAntId = ant.id;
  return true;
}

/**
 * Applies the currently selected paint tool to a world-space point.
 *
 * Called by pointer drag/paint input. Floors coordinates to grid cells,
 * validates bounds and tool support, then mutates simulation world state.
 */
function applyToolIfInBounds(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !simCore?.world) return;

  const worldX = Math.floor(x);
  const worldY = Math.floor(y);
  const activeView = getSafeViewMode();

  if (DEBUG_UI) {
    console.debug('[SimAnt UI] Canvas click:', {
      tool: state.selectedTool,
      viewMode: activeView,
      canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
      worldPoint: { x: worldX, y: worldY },
      nest: { x: simCore.world.nestX, y: simCore.world.nestY },
      cameras: {
        surface: { x: surfaceRenderer.cameraX, y: surfaceRenderer.cameraY, zoom: surfaceRenderer.zoom },
        nest: { x: nestRenderer.cameraX, y: nestRenderer.cameraY, zoom: nestRenderer.zoom },
      },
    });
  }

  if (!simCore.world.inBounds(worldX, worldY)) return;

  if (!EDIT_TOOLS.has(state.selectedTool)) {
    if (DEBUG_UI) console.debug('[SimAnt UI] Ignored unsupported tool selection.', state.selectedTool);
    return;
  }

  simCore.applyTool(state.selectedTool, worldX, worldY, state.brushRadius);
}

/**
 * Returns a validated active view mode.
 *
 * Guards against invalid enum values from external callers and restores
 * SURFACE mode when corruption is detected.
 */
function getSafeViewMode() {
  const mode = viewManager.getCurrent();
  if (mode === VIEW.SURFACE || mode === VIEW.NEST) return mode;
  console.warn(`[SimAnt] Active view mode "${mode}" is unrecognized — falling back to SURFACE.`);
  viewManager.setView(VIEW.SURFACE);
  return VIEW.SURFACE;
}

/**
 * Stores camera/view data from the last successful render.
 *
 * Called after each successful draw so render recovery can restore a known
 * good camera state when an exception occurs.
 */
function captureLastGoodRenderState(view) {
  lastGoodRenderState.view = view;
  lastGoodRenderState.surfaceCam = {
    x: surfaceRenderer.cameraX,
    y: surfaceRenderer.cameraY,
    zoom: surfaceRenderer.zoom,
  };
  lastGoodRenderState.nestCam = {
    x: nestRenderer.cameraX,
    y: nestRenderer.cameraY,
    zoom: nestRenderer.zoom,
  };
}

/**
 * Performs best-effort recovery after renderer exceptions.
 *
 * Resets view/camera values to last valid values (or safe defaults) and
 * triggers renderer resize to reinitialize projection state.
 */
function recoverFromRenderError(error) {
  console.error('[SimAnt] Renderer threw — resetting cameras to the last known good state and continuing:', error);
  const fallbackView = lastGoodRenderState.view === VIEW.NEST ? VIEW.NEST : VIEW.SURFACE;

  viewManager.setView(fallbackView);
  surfaceRenderer.cameraX = Number.isFinite(lastGoodRenderState.surfaceCam.x) ? lastGoodRenderState.surfaceCam.x : simCore.world.nestX;
  surfaceRenderer.cameraY = Number.isFinite(lastGoodRenderState.surfaceCam.y) ? lastGoodRenderState.surfaceCam.y : simCore.world.nestY * 0.42;
  surfaceRenderer.zoom = Number.isFinite(lastGoodRenderState.surfaceCam.zoom) ? lastGoodRenderState.surfaceCam.zoom : 2;
  nestRenderer.cameraX = Number.isFinite(lastGoodRenderState.nestCam.x) ? lastGoodRenderState.nestCam.x : simCore.world.nestX;
  nestRenderer.cameraY = Number.isFinite(lastGoodRenderState.nestCam.y) ? lastGoodRenderState.nestCam.y : simCore.world.nestY + 28;
  nestRenderer.zoom = Number.isFinite(lastGoodRenderState.nestCam.zoom) ? lastGoodRenderState.nestCam.zoom : 3;

  surfaceRenderer.resize();
  nestRenderer.resize();

  if (DEBUG_RENDER) {
    console.debug('[SimAnt Render] Recovery state:', {
      fallbackView,
      canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
      nest: { x: simCore.world.nestX, y: simCore.world.nestY },
      surfaceCam: { ...lastGoodRenderState.surfaceCam },
      nestCam: { ...lastGoodRenderState.nestCam },
    });
  }
}

/**
 * Serializes simulation and UI state into localStorage.
 *
 * Called by the Save control. Side effect: writes JSON under STORAGE_KEY.
 */
function saveState() {
  const save = simCore.serialize({
    simSpeed: state.simSpeed,
    config: state.config,
    overlays: state.overlays,
    casteTargets: state.casteTargets,
    colonyStatus: state.colonyStatus,
    selectedTool: state.selectedTool,
    brushRadius: state.brushRadius,
    selectedAntId: state.selectedAntId,
    viewMode: viewManager.getCurrent(),
    cameras: {
      surface: {
        x: surfaceRenderer.cameraX,
        y: surfaceRenderer.cameraY,
        zoom: surfaceRenderer.zoom,
      },
      nest: {
        x: nestRenderer.cameraX,
        y: nestRenderer.cameraY,
        zoom: nestRenderer.zoom,
      },
    },
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
}

/**
 * Loads simulation and UI state from localStorage.
 *
 * Called by the Load control. This function validates/normalizes stored data
 * before mutating runtime state to avoid fatal crashes from corrupted saves.
 */
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    console.error('[SimAnt] Saved game in localStorage is not valid JSON — skipping load. The save may be from an older version or hand-edited:', error);
    return;
  }

  simCore.loadFromSerialized(data);
  syncRenderWorld();

  Object.assign(state.config, data.state?.config || {});
  Object.assign(state.config, sanitizeTickConfig(state.config));
  Object.assign(state.overlays, data.state?.overlays || {});
  Object.assign(state.casteTargets, data.state?.casteTargets || {});
  if (data.state?.colonyStatus) {
    Object.assign(state.colonyStatus.workAllocation, data.state.colonyStatus.workAllocation || {});
    Object.assign(state.colonyStatus.casteAllocation, data.state.colonyStatus.casteAllocation || {});
  }
  simCore.colony.setWorkAllocation(state.colonyStatus.workAllocation);
  applyColonyStatusToConfig();
  colonyStatusPanel.sync({
    work: state.colonyStatus.workAllocation,
    caste: state.colonyStatus.casteAllocation,
  });
  state.simSpeed = data.state?.simSpeed || state.simSpeed;
  const savedTool = data.state?.selectedTool;
  state.selectedTool = EDIT_TOOLS.has(savedTool) ? savedTool : 'food';
  state.brushRadius = data.state?.brushRadius || state.brushRadius;
  state.selectedAntId = data.state?.selectedAntId || null;

  const surfaceCam = data.state?.cameras?.surface;
  if (surfaceCam && Number.isFinite(surfaceCam.x) && Number.isFinite(surfaceCam.y) && Number.isFinite(surfaceCam.zoom)) {
    surfaceRenderer.cameraX = surfaceCam.x;
    surfaceRenderer.cameraY = surfaceCam.y;
    surfaceRenderer.zoom = surfaceCam.zoom;
  }
  const nestCam = data.state?.cameras?.nest;
  if (nestCam && Number.isFinite(nestCam.x) && Number.isFinite(nestCam.y) && Number.isFinite(nestCam.zoom)) {
    nestRenderer.cameraX = nestCam.x;
    nestRenderer.cameraY = nestCam.y;
    nestRenderer.zoom = nestCam.zoom;
  }

  const mode = data.state?.viewMode;
  if (mode === VIEW.SURFACE || mode === VIEW.NEST) viewManager.setView(mode);
}


/**
 * Applies colony status allocation state into runtime config.
 *
 * Keeps caste sliders and spawn chance consistent. Side effect: mutates
 * `state.config` and colony caste allocation.
 */
function applyColonyStatusToConfig() {
  const caste = state.colonyStatus.casteAllocation;
  const workerSoldierTotal = Math.max(1, caste.workers + caste.soldiers);
  state.config.soldierSpawnChance = caste.soldiers / workerSoldierTotal;
  simCore.colony.setCasteAllocation(caste);
}

/**
 * Rebinds renderers to the latest world instance.
 *
 * Required after reset/load because SimulationCore replaces world objects.
 */
function syncRenderWorld() {
  surfaceRenderer.setWorld(simCore.world);
  nestRenderer.setWorld(simCore.world);
}

/**
 * Retrieves a required DOM element or throws.
 *
 * Used during startup to fail fast when required controls are missing.
 */
function mustById(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[SimAnt] index.html is missing a required element with id="${id}". The page cannot start until this element is restored.`);
  return el;
}

/**
 * Triggers a browser download of the rolling ColonyStats buffer.
 *
 * Called by the LOG control button and the 'y' keyboard shortcut. Filename
 * encodes the current tick so successive downloads in one session don't
 * overwrite each other.
 */
function downloadStatsLog(format = 'jsonl') {
  const btn = document.getElementById('downloadLogBtn');
  const flashBtn = (text) => {
    if (!btn) return;
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = text;
    setTimeout(() => {
      btn.textContent = btn.dataset.label || 'LOG ↓';
    }, 2000);
  };

  const stats = simCore.stats;
  if (!stats || stats.samples.length === 0) {
    console.warn(`[SimAnt] Log is empty. ColonyStats records a snapshot every 30 ticks, and the simulation is currently at tick ${simCore.tick}. Wait until at least tick 30, then click LOG again.`);
    flashBtn(`EMPTY (tick ${simCore.tick}/30)`);
    return;
  }
  try {
    const isCSV = format === 'csv';
    const body = isCSV ? stats.toCSV() : stats.toJSONL();
    const mime = isCSV ? 'text/csv' : 'application/x-ndjson';
    const ext = isCSV ? 'csv' : 'jsonl';
    const safeSeed = String(state.seed || 'default').replace(/[^a-z0-9_-]+/gi, '_');
    const filename = `simant-log-tick${simCore.tick}-${safeSeed}.${ext}`;
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    console.info(`[SimAnt] Saved ${stats.samples.length} snapshots to "${filename}" (${isCSV ? 'CSV' : 'JSONL'} format). Check your browser's downloads folder.`);
    flashBtn(`SAVED ${stats.samples.length}`);
  } catch (error) {
    console.error('[SimAnt] Could not save the log file. The Blob/anchor download path threw — your browser may be blocking programmatic downloads, or storage is full. Details:', error);
    flashBtn('FAILED — see console');
  }
}

/**
 * Switches runtime into fatal-error mode.
 *
 * Called by global error listeners and top-level loop catch; prevents further
 * simulation frames after unrecoverable exceptions.
 */
function reportFatalError(error) {
  if (hasFatalError) return;
  hasFatalError = true;
  state.paused = true;
  console.error('[SimAnt] FATAL: simulation loop has been stopped because an unrecoverable error was thrown. Reload the page to restart. Details:', error);
}
