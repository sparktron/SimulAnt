import { createControls } from './ui/controls.js';
import { updateHud } from './ui/hud.js';
import { SurfaceRenderer } from './render/SurfaceRenderer.js';
import { NestRenderer } from './render/NestRenderer.js';
import { SimulationCore } from './sim/SimulationCore.js';
import { TERRAIN } from './sim/world.js';
import { ViewManager, VIEW } from './ui/ViewManager.js';
import { InputRouter } from './input/InputRouter.js';
import { createLeftToolbar } from './ui/LeftToolbar.js';
import { HelpModal } from './ui/HelpModal.js';
import { Toast } from './ui/Toast.js';
import { createMapEditorOverlay } from './ui/MapEditorOverlay.js';

const STORAGE_KEY = 'simant-save-v2';
const SIM_DT = 1 / 30;

const state = {
  paused: false,
  simSpeed: 1,
  selectedTool: 'food',
  editorMode: 'dig',
  mapEditorActive: false,
  showMinimap: false,
  brushRadius: 3,
  seed: 'simant-default',
  overlays: {
    showFood: false,
    showToFood: false,
    showToHome: false,
    showDanger: false,
  },
  debug: {
    showEntranceInfo: false,
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
const toast = new Toast();
const helpModal = new HelpModal();
const simCore = new SimulationCore(state.seed);
const viewManager = new ViewManager(VIEW.SURFACE);
const surfaceRenderer = new SurfaceRenderer(canvas, simCore.world);
const nestRenderer = new NestRenderer(canvas, simCore.world);

const mapEditor = createMapEditorOverlay((mode) => {
  state.editorMode = mode;
});

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
});

createLeftToolbar({
  state,
  viewManager,
  toast,
  actions: {
    toggleMinimap: () => {
      state.showMinimap = !state.showMinimap;
      mustById('minimap').hidden = !state.showMinimap;
    },
    toggleHelp: () => helpModal.toggle(),
    toggleEditor: () => {
      state.mapEditorActive = !state.mapEditorActive;
      mapEditor.setActive(state.mapEditorActive);
    },
    centerSelectedAnt: () => toast.show('No ant selected.'),
    centerBlackQueen: () => {
      const qx = simCore.world.nestX;
      const qy = simCore.world.nestY + 2;
      if (viewManager.getCurrent() === VIEW.SURFACE) {
        surfaceRenderer.cameraX = qx;
        surfaceRenderer.cameraY = Math.min(simCore.world.nestY - 8, qy);
      } else {
        nestRenderer.cameraX = qx;
        nestRenderer.cameraY = qy;
      }
    },
    togglePause: () => {
      state.paused = !state.paused;
      toast.show(state.paused ? 'Paused' : 'Running');
    },
    toggleScent: () => {
      state.overlays.showToFood = !state.overlays.showToFood;
      state.overlays.showToHome = state.overlays.showToFood;
      state.overlays.showDanger = state.overlays.showToFood;
    },
    toggleAutoDig: () => {
      const on = simCore.toggleAutoDig();
      toast.show(`Auto-dig ${on ? 'ON' : 'OFF'}`);
    },
    forceChamber: () => {
      if (simCore.forceChamber()) toast.show('Forced chamber at dig front');
    },
  },
});

window.addEventListener('resize', () => {
  surfaceRenderer.resize();
  nestRenderer.resize();
});

viewManager.onChange((mode) => {
  mustById('modeIndicator').textContent = mode;
});

let accumulator = 0;
let lastTime = performance.now();
let fps = 60;
let fpsTimer = 0;
let frameCount = 0;

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
    while (accumulator >= SIM_DT) {
      simCore.update(state.config);
      accumulator -= SIM_DT;
    }
  }

  const activeView = viewManager.getCurrent();
  if (activeView === VIEW.SURFACE) {
    surfaceRenderer.draw(simCore.colony, state.overlays, simCore.nestEntrances, state.debug.showEntranceInfo);
  } else {
    nestRenderer.draw(simCore.colony);
    if (activeView === VIEW.RED_NEST) drawOverlayText('Red colony not implemented');
  }

  updateHud({
    viewMode: activeView,
    fps,
    tick: simCore.tick,
    ants: simCore.colony.ants.length,
    workers: simCore.colony.ants.filter((ant) => ant.role === 'worker').length,
    soldiers: simCore.colony.ants.filter((ant) => ant.role === 'soldier').length,
    foodStored: simCore.colony.foodStored,
  });

  requestAnimationFrame(loop);
}

function drawOverlayText(msg) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, canvas.clientWidth, 28);
  ctx.fillStyle = '#ffd0d0';
  ctx.font = 'bold 14px monospace';
  ctx.fillText(msg, 12, 19);
  ctx.restore();
}

function applyToolIfInBounds(x, y) {
  if (!simCore.world.inBounds(x, y)) return;
  if (!state.mapEditorActive) return;

  if (state.editorMode === 'dig') {
    if (viewManager.getCurrent() === VIEW.SURFACE) simCore.applyTool('erase', x, y, 1);
    else {
      const idx = simCore.world.index(x, y);
      if (simCore.world.terrain[idx] === TERRAIN.SOIL) simCore.applyTool('carve', x, y, 1);
    }
  } else if (state.editorMode === 'food' && viewManager.getCurrent() === VIEW.SURFACE) {
    simCore.applyTool('food', x, y, 1);
  } else if (state.editorMode === 'pheromone' && viewManager.getCurrent() === VIEW.SURFACE) {
    const idx = simCore.world.index(x, y);
    simCore.world.toFood[idx] += 3;
  }
}

function saveState() {
  const save = simCore.serialize({
    simSpeed: state.simSpeed,
    config: state.config,
    overlays: state.overlays,
    casteTargets: state.casteTargets,
    brushRadius: state.brushRadius,
    viewMode: viewManager.getCurrent(),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  const data = JSON.parse(raw);
  simCore.loadFromSerialized(data);
  syncRenderWorld();
}

function syncRenderWorld() {
  surfaceRenderer.setWorld(simCore.world);
  nestRenderer.setWorld(simCore.world);
}

function mustById(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}
