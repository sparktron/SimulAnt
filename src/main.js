import { createControls } from './ui/controls.js';
import { updateHud } from './ui/hud.js';
import { SurfaceRenderer } from './render/SurfaceRenderer.js';
import { NestRenderer } from './render/NestRenderer.js';
import { SimulationCore } from './sim/SimulationCore.js';
import { ViewManager, VIEW } from './ui/ViewManager.js';
import { InputRouter } from './input/InputRouter.js';
import { normalizeUnhandledRejectionReason, shouldReportFatalWindowError } from './ui/runtimeErrorGate.js';

const STORAGE_KEY = 'simant-save-v2';
const SIM_DT = 1 / 30;
const BASE_SIM_SPEED_SCALE = 0.4;

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
    digStatus: 'AUTO-DIG: OFF',
  },
  config: {
    tickSeconds: SIM_DT,
    antCap: 2000,
    evapFood: 0.1,
    evapHome: 0.55,
    evapDanger: 0.35,
    diffFood: 0.2,
    diffHome: 0.1,
    diffDanger: 0.12,
    diffIntervalTicks: 2,
    depositFood: 1.2,
    depositHome: 0.12,
    dangerDeposit: 0.6,
    hazardDeathChance: 0.02,
    foodPickupRate: 0.7,
    digChance: 0.04,
    digEnergyCost: 8,
    digHomeBoost: 0.9,
    queenEggTicks: 20,
    queenEggFoodCost: 0.8,
    queenHungerDrain: 2.8,
    queenEatNutrition: 8,
    queenHealthDrainRate: 7,
    workerEatNutrition: 25,
    starvationRecoveryHealth: 5,
    healthDrainRate: 10,
    healthRegenRate: 1,
    soldierSpawnChance: 0.2,
    foodVisionRadius: 7,
    followAlpha: 1.5,
    followBeta: 3.4,
    wanderNoise: 0.06,
    randomTurnChance: 0.045,
    momentumBias: 0.3,
    reversePenalty: 0.9,
    homeDepositIntervalTicks: 3,
    homeDepositMinDistance: 10,
    nearEntranceScatterRadius: 9,
    foodTrailDistanceScale: 1.1,
    maxFoodTrailScale: 3.2,
    pheromoneMaxClamp: 10,
  },
  casteTargets: {
    workers: 70,
    soldiers: 30,
  },
};

const canvas = mustById('simCanvas');
const simCore = new SimulationCore(state.seed);
const viewManager = new ViewManager(VIEW.SURFACE);
const surfaceRenderer = new SurfaceRenderer(canvas, simCore.world);
const nestRenderer = new NestRenderer(canvas, simCore.world);

surfaceRenderer.resize();
nestRenderer.resize();

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

window.addEventListener('resize', () => {
  surfaceRenderer.resize();
  nestRenderer.resize();
});

viewManager.onChange((mode) => {
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

window.addEventListener('error', (event) => {
  if (!shouldReportFatalWindowError(event)) return;
  reportFatalError(event.error || event.message || 'Unknown window error');
});

window.addEventListener('unhandledrejection', (event) => {
  reportFatalError(normalizeUnhandledRejectionReason(event.reason));
});

requestAnimationFrame(loop);

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

    const activeView = viewManager.getCurrent();
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
      });
    }

    const selectedAnt = simCore.findAntById(state.selectedAntId);
    updateHud({
      viewMode: activeView,
      fps,
      tick: simCore.tick,
      ants: simCore.colony.ants.length,
      workers: simCore.colony.ants.filter((ant) => ant.role === 'worker').length,
      soldiers: simCore.colony.ants.filter((ant) => ant.role === 'soldier').length,
      foodStored: simCore.colony.foodStored,
      queenAlive: simCore.colony.queen.alive,
      selectedAntHealth: selectedAnt ? selectedAnt.health : 0,
      simMs,
      digStatus: state.debug.digStatus,
      pherStats: simCore.world.getPheromoneStats(),
      followingFood: simCore.colony.ants.filter((ant) => ant.state === 'FORAGE_SEARCH' || ant.state === 'GO_TO_FOOD').length,
      followingHome: simCore.colony.ants.filter((ant) => ant.state === 'RETURN_HOME' || ant.state === 'CARRY_TO_NEST').length,
    });

    requestAnimationFrame(loop);
  } catch (error) {
    reportFatalError(error);
  }
}

function selectAntNear(x, y) {
  const ant = simCore.findAntNear(x, y, 2);
  if (!ant) return false;
  state.selectedAntId = ant.id;
  return true;
}

function applyToolIfInBounds(x, y) {
  if (!simCore.world.inBounds(x, y)) return;
  simCore.applyTool(state.selectedTool, x, y, state.brushRadius);
}

function saveState() {
  const save = simCore.serialize({
    simSpeed: state.simSpeed,
    config: state.config,
    overlays: state.overlays,
    casteTargets: state.casteTargets,
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

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  const data = JSON.parse(raw);

  simCore.loadFromSerialized(data);
  syncRenderWorld();

  Object.assign(state.config, data.state?.config || {});
  Object.assign(state.overlays, data.state?.overlays || {});
  Object.assign(state.casteTargets, data.state?.casteTargets || {});
  state.simSpeed = data.state?.simSpeed || state.simSpeed;
  state.selectedTool = data.state?.selectedTool || state.selectedTool;
  state.brushRadius = data.state?.brushRadius || state.brushRadius;
  state.selectedAntId = data.state?.selectedAntId || null;

  const surfaceCam = data.state?.cameras?.surface;
  if (surfaceCam) {
    surfaceRenderer.cameraX = surfaceCam.x;
    surfaceRenderer.cameraY = surfaceCam.y;
    surfaceRenderer.zoom = surfaceCam.zoom;
  }
  const nestCam = data.state?.cameras?.nest;
  if (nestCam) {
    nestRenderer.cameraX = nestCam.x;
    nestRenderer.cameraY = nestCam.y;
    nestRenderer.zoom = nestCam.zoom;
  }

  const mode = data.state?.viewMode;
  if (mode === VIEW.SURFACE || mode === VIEW.NEST) viewManager.setView(mode);
}

function syncRenderWorld() {
  surfaceRenderer.setWorld(simCore.world);
  nestRenderer.setWorld(simCore.world);
}

function mustById(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element: ${id}`);
  return el;
}

function reportFatalError(error) {
  if (hasFatalError) return;
  hasFatalError = true;
  state.paused = true;
  console.error('[SimAnt] Fatal runtime error:', error);
}
