import { World, TERRAIN } from './sim/world.js';
import { SeededRng } from './sim/rng.js';
import { Colony } from './sim/colony.js';
import { Renderer } from './render/renderer.js';
import { createControls } from './ui/controls.js';
import { updateHud } from './ui/hud.js';

const STORAGE_KEY = 'simulant-save-v2';
const SIM_DT = 1 / 30;

const state = {
  seed: 'simulant-default',
  paused: false,
  simSpeed: 1,
  selectedTool: 'food',
  brushRadius: 3,
  viewMode: 'surface',
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
    digChance: 0.06,
    queenLayTicks: 90,
    eggCost: 0.9,
  },
};

let rng;
let world;
let colony;
let renderer;

let accumulator = 0;
let lastTime = performance.now();
let tick = 0;

let fps = 60;
let simMs = 0;
let fpsTimer = 0;
let frameCount = 0;

const canvas = document.getElementById('simCanvas');
const hudElement = document.getElementById('hud');

resetSimulation(state.seed);
renderer = new Renderer(canvas, world);
renderer.resize();
initMouseControls(canvas, renderer, () => world);

createControls(state, {
  stepOnce: () => runTicks(1),
  reset: (seed) => resetSimulation(seed),
  save: () => saveState(),
  load: () => loadState(),
  clearWorld: () => clearWorld(),
});

window.addEventListener('resize', () => renderer.resize());
requestAnimationFrame(loop);

function resetSimulation(seed) {
  state.seed = seed || 'simulant-default';
  rng = new SeededRng(state.seed);
  world = new World(256, 256);

  world.paintCircle(world.nestX + 45, world.nestY, 10, (idx) => {
    world.food[idx] = 10;
  });
  world.paintCircle(world.nestX - 60, world.nestY + 30, 15, (idx) => {
    world.food[idx] = 8;
  });
  world.paintCircle(world.nestX + 70, world.nestY - 50, 14, (idx) => {
    world.terrain[idx] = TERRAIN.HAZARD;
  });

  colony = new Colony(world, rng, 24);
  tick = 0;
  accumulator = 0;
  if (renderer) renderer.world = world;
}

function runTicks(count) {
  const start = performance.now();
  for (let i = 0; i < count; i += 1) {
    tick += 1;
    colony.update(state.config);
    if (tick % state.config.pheromoneUpdateTicks === 0) {
      world.diffuseAndEvaporate(state.config.diffusionRate, state.config.evaporationRate, true);
    }
  }
  simMs = performance.now() - start;
}

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
      runTicks(1);
      accumulator -= SIM_DT;
    }
  }

  renderer.draw(colony, state.overlays, state.viewMode);
  updateHud(hudElement, {
    fps,
    simMs,
    tick,
    ants: colony.ants.length,
    foodStored: colony.foodStored,
    births: colony.births,
    deaths: colony.deaths,
    queenHealth: colony.queen.health,
    dugTiles: colony.dugTiles,
    roles: colony.countRoles(),
    brood: colony.broodCounts(),
    viewMode: state.viewMode,
  });

  requestAnimationFrame(loop);
}

function applyTool(worldX, worldY) {
  const radius = state.brushRadius;
  switch (state.selectedTool) {
    case 'food':
      world.paintCircle(worldX, worldY, radius, (idx) => {
        world.food[idx] = Math.min(world.food[idx] + 4, 20);
        if (world.terrain[idx] !== TERRAIN.GROUND) world.terrain[idx] = TERRAIN.GROUND;
      });
      break;
    case 'wall':
      world.paintCircle(worldX, worldY, radius, (idx) => {
        world.terrain[idx] = TERRAIN.WALL;
      });
      break;
    case 'water':
      world.paintCircle(worldX, worldY, radius, (idx) => {
        world.terrain[idx] = TERRAIN.WATER;
      });
      break;
    case 'hazard':
      world.paintCircle(worldX, worldY, radius, (idx) => {
        world.terrain[idx] = TERRAIN.HAZARD;
      });
      break;
    case 'erase':
      world.paintCircle(worldX, worldY, radius, (idx) => {
        world.terrain[idx] = TERRAIN.GROUND;
        world.food[idx] = 0;
        world.toFood[idx] = 0;
        world.toHome[idx] = 0;
        world.danger[idx] = 0;
      });
      break;
    case 'nest':
      world.setNest(worldX, worldY);
      colony.queen.x = world.nestX;
      colony.queen.y = world.nestY;
      break;
    default:
      break;
  }
}

function initMouseControls(canvasEl, simRenderer, getWorld) {
  let painting = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  canvasEl.addEventListener('contextmenu', (event) => event.preventDefault());

  canvasEl.addEventListener('pointerdown', (event) => {
    canvasEl.setPointerCapture(event.pointerId);
    lastX = event.clientX;
    lastY = event.clientY;

    if (event.button === 2 || event.shiftKey) {
      panning = true;
    } else {
      painting = true;
      const rect = canvasEl.getBoundingClientRect();
      const pt = simRenderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      applyTool(pt.x, pt.y);
    }
  });

  canvasEl.addEventListener('pointermove', (event) => {
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    if (panning) {
      simRenderer.cameraX -= dx / simRenderer.zoom;
      simRenderer.cameraY -= dy / simRenderer.zoom;
      return;
    }

    if (painting) {
      const rect = canvasEl.getBoundingClientRect();
      const pt = simRenderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      if (getWorld().inBounds(pt.x, pt.y)) {
        applyTool(pt.x, pt.y);
      }
    }
  });

  canvasEl.addEventListener('pointerup', () => {
    painting = false;
    panning = false;
  });

  canvasEl.addEventListener('wheel', (event) => {
    event.preventDefault();
    const zoomDelta = event.deltaY < 0 ? 1.1 : 0.9;
    simRenderer.zoom = Math.max(1, Math.min(10, simRenderer.zoom * zoomDelta));
  });
}

function saveState() {
  const save = {
    seed: state.seed,
    world: world.serialize(),
    colony: colony.serialize(),
    state: {
      simSpeed: state.simSpeed,
      config: state.config,
      overlays: state.overlays,
      viewMode: state.viewMode,
    },
    tick,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  const data = JSON.parse(raw);
  state.seed = data.seed || state.seed;
  rng = new SeededRng(state.seed);
  world = World.fromSerialized(data.world);
  colony = Colony.fromSerialized(world, rng, data.colony);
  tick = data.tick || 0;

  Object.assign(state.config, data.state?.config || {});
  Object.assign(state.overlays, data.state?.overlays || {});
  state.simSpeed = data.state?.simSpeed || state.simSpeed;
  state.viewMode = data.state?.viewMode || state.viewMode;

  renderer.world = world;
}

function clearWorld() {
  world.terrain.fill(TERRAIN.GROUND);
  world.food.fill(0);
  world.toFood.fill(0);
  world.toHome.fill(0);
  world.danger.fill(0);
}
