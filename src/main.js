import { createControls } from './ui/controls.js';
import { updateHud } from './ui/hud.js';
import { SurfaceRenderer } from './render/SurfaceRenderer.js';
import { NestRenderer } from './render/NestRenderer.js';
import { SimulationCore } from './sim/SimulationCore.js';
import { ViewManager, VIEW } from './ui/ViewManager.js';
import { InputRouter } from './input/InputRouter.js';
import { normalizeUnhandledRejectionReason, shouldReportFatalWindowError } from './ui/runtimeErrorGate.js';
import { ColonyStatusPanel } from './ui/ColonyStatusPanel.js';

const STORAGE_KEY = 'simant-save-v2';
const SIM_DT = 1 / 30;
const BASE_SIM_SPEED_SCALE = 0.4;
const DEBUG_UI = false;
const DEBUG_RENDER = false;
const EDIT_TOOLS = new Set(['food', 'wall', 'water', 'hazard', 'erase']);

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
    showScent: false,
  },
  debug: {
    showEntranceInfo: false,
    showStats: false,
    showQueenMarker: true,
    digStatus: 'AUTO-DIG: OFF',
  },
  config: {
    tickSeconds: SIM_DT,
    antCap: 2000,
    evapFood: 0.012,
    evapHome: 0.015,
    evapDanger: 0.08,
    // Food diffusion is intentionally very low so the forager trails stay
    // narrow and legible instead of bleeding into a wide green haze.
    diffFood: 0.006,
    diffHome: 0.18,
    diffDanger: 0.12,
    diffIntervalTicks: 2,
    depositFood: 0.35,
    depositHome: 0.08,
    dangerDeposit: 0.3,
    hazardDeathChance: 0.02,
    foodPickupRate: 0.7,
    digChance: 0.04,
    digEnergyCost: 8,
    digHomeBoost: 0.9,
    queenEggTicks: 20,
    queenEggFoodCost: 0.15,
    queenHungerDrain: 0.25,
    queenEatNutrition: 5,
    queenHealthDrainRate: 7,
    queenHealthRecoveryPerNutrition: 0.25,
    queenFoodRequestHealthThreshold: 0.5,
    queenFoodRequestClearThreshold: 0.8,
    queenCourierPickupNutrition: 6,
    broodFoodDrainRate: 0.005,
    broodGestationSeconds: 8,
    workerEatNutrition: 25,
    starvationRecoveryHealth: 5,
    healthDrainRate: 5,
    healthRegenRate: 1,
    healthWorkIdleDrainRate: 0.1,
    healthWorkMoveDrainRate: 0.25,
    healthWorkCarryDrainRate: 0.15,
    healthWorkFightDrainRate: 0.6,
    healthEatRecoveryRate: 0.45,
    workerEmergencyEatNutrition: 35,
    carryingHungerDrainRate: 1.5,
    fightingHungerDrainRate: 3,
    soldierSpawnChance: 0.05,  // 5% chance for soldiers to spawn via brood
    foodVisionRadius: 7,
    surfaceFoodSearchMaxMissTicks: 180,  // Increased: give foragers more time to find food
    surfaceReturnToNestHungerThreshold: 0.5,  // Lowered: less aggressive nest rushing
    followAlpha: 1.5,
    followBeta: 5.0,
    wanderNoise: 0.06,
    randomTurnChance: 0.045,
    momentumBias: 0.3,
    reversePenalty: 0.9,
    homeDepositIntervalTicks: 3,
    homeDepositMinDistance: 20,
    nearEntranceScatterRadius: 30,
    foodTrailDistanceScale: 1.1,
    maxFoodTrailScale: 3.2,
    homeScentBaseWeight: 1.0,
    homeScentSearchStateScale: 0,
    homeScentReturnStateScale: 1.0,
    homeScentFalloffStartDist: 10,
    homeScentFalloffEndDist: 9999,
    homeScentMinFalloff: 1.0,
    homeScentMaxContributionPerStep: 999,
    homeTieBiasScale: 0.05,
    foodTieBiasScale: 0.04,
    debugSteeringContributions: false,
    debugSteeringLogIntervalTicks: 30,
    pheromoneMaxClamp: 10,
  },
  casteTargets: {
    workers: 100,
    soldiers: 0,
  },
  colonyStatus: {
    workAllocation: { forage: 55, dig: 20, nurse: 25 },
    casteAllocation: { workers: 85, soldiers: 15, breeders: 0 },
  },
};

const canvas = mustById('simCanvas');
const simCore = new SimulationCore(state.seed);
const viewManager = new ViewManager(VIEW.SURFACE);
const surfaceRenderer = new SurfaceRenderer(canvas, simCore.world);
const nestRenderer = new NestRenderer(canvas, simCore.world);

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
  toggleDebugStats: () => {
    state.debug.showStats = !state.debug.showStats;
    state.debug.showEntranceInfo = state.debug.showStats;
  },
  toggleScentOverlay: () => {
    state.overlays.showScent = !state.overlays.showScent;
  },
  toggleQueenMarker: () => {
    state.debug.showQueenMarker = !state.debug.showQueenMarker;
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
  toggleAutoDig: () => {
    const enabled = simCore.toggleAutoDig();
    state.debug.digStatus = enabled ? 'AUTO-DIG: ON' : 'AUTO-DIG: OFF';
  },
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
    applyColonyStatusToConfig();
  },
});

window.addEventListener('resize', () => {
  surfaceRenderer.resize();
  nestRenderer.resize();
});

viewManager.onChange((mode) => {
  if (mode !== VIEW.SURFACE && mode !== VIEW.NEST) {
    console.warn('[SimAnt] Invalid view transition requested:', mode);
    viewManager.setView(VIEW.SURFACE);
    return;
  }
  mustById('viewToggleBtn').textContent = mode === VIEW.SURFACE ? 'VIEW: SURFACE' : 'VIEW: NEST';
  mustById('modeIndicator').textContent = mode;
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
        nestRenderer.draw(simCore.colony, {
          selectedAntId: state.selectedAntId,
          showDebugStats: state.debug.showStats,
          showQueenMarker: state.debug.showQueenMarker,
        });
      }
      captureLastGoodRenderState(activeView);
    } catch (renderError) {
      recoverFromRenderError(renderError);
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
      });
    } catch (hudError) {
      console.error('[SimAnt] HUD update failed (continuing simulation loop):', hudError);
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
  console.warn('[SimAnt] Invalid active view mode. Falling back to SURFACE.', mode);
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
  console.error('[SimAnt] Render error. Recovering safely:', error);
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
    console.error('[SimAnt] Ignoring invalid saved JSON payload:', error);
    return;
  }

  simCore.loadFromSerialized(data);
  syncRenderWorld();

  Object.assign(state.config, data.state?.config || {});
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
  if (!el) throw new Error(`Missing required element: ${id}`);
  return el;
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
  console.error('[SimAnt] Fatal runtime error:', error);
}
