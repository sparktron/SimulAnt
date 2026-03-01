import { createControls } from './ui/controls.js';
import { updateHud } from './ui/hud.js';
import { SurfaceRenderer } from './render/SurfaceRenderer.js';
import { NestRenderer } from './render/NestRenderer.js';
import { SimulationCore } from './sim/SimulationCore.js';
import { ViewManager, VIEW } from './ui/ViewManager.js';
import { InputRouter } from './input/InputRouter.js';

const STORAGE_KEY = 'simant-save-v2';
const SIM_DT = 1 / 30;

const state = {
  paused: false,
  simSpeed: 1,
  selectedTool: 'food',
  brushRadius: 3,
  seed: 'simant-default',
  overlays: {
    showFood: false,
    showToFood: false,
    showToHome: false,
    showDanger: false,
  },
  config: {
    antCap: 2000,
    evaporationRate: 0.01,
    diffusionRate: 0.12,
    pheromoneUpdateTicks: 2,
    toFoodDeposit: 0.5,
    toHomeDeposit: 0.4,
    dangerDeposit: 0.6,
    hazardDeathChance: 0.02,
    foodPickupRate: 0.7,
    digChance: 0.04,
    digEnergyCost: 8,
    digHomeBoost: 0.9,
    queenEggTicks: 20,
    queenEggFoodCost: 0.8,
    soldierSpawnChance: 0.2,
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
    syncRenderWorld();
  },
  save: () => saveState(),
  load: () => loadState(),
  clearWorld: () => simCore.clearWorld(),
  toggleView: () => viewManager.toggle(),
});

window.addEventListener('resize', () => {
  surfaceRenderer.resize();
  nestRenderer.resize();
});

viewManager.onChange((mode) => {
  mustById('viewToggleBtn').textContent = mode === VIEW.SURFACE ? 'VIEW: SURFACE' : 'VIEW: NEST';
});

let accumulator = 0;
let lastTime = performance.now();
let fps = 60;
let fpsTimer = 0;
let frameCount = 0;
let simMs = 0;

requestAnimationFrame(loop);

function loop(now) {
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
    accumulator += elapsed * state.simSpeed;
    const start = performance.now();
    while (accumulator >= SIM_DT) {
      simCore.update(state.config);
      accumulator -= SIM_DT;
    }
    simMs = performance.now() - start;
  }

  const activeView = viewManager.getCurrent();
  if (activeView === VIEW.SURFACE) {
    surfaceRenderer.draw(simCore.colony, state.overlays);
  } else {
    nestRenderer.draw(simCore.colony);
  }

  updateHud({
    viewMode: activeView,
    fps,
    tick: simCore.tick,
    ants: simCore.colony.ants.length,
    workers: simCore.colony.ants.filter((ant) => ant.role === 'worker').length,
    soldiers: simCore.colony.ants.filter((ant) => ant.role === 'soldier').length,
    foodStored: simCore.colony.foodStored,
    queenAlive: simCore.colony.queen.alive,
    simMs,
  });

  requestAnimationFrame(loop);
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
