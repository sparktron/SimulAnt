const TOOL_BY_KEY = {
  '1': 'food',
  '2': 'wall',
  '3': 'water',
  '4': 'hazard',
  '5': 'erase',
  '6': 'nest',
};

export function createControls(state, actions) {
  const startPauseBtn = byId('startPauseBtn');
  const stepBtn = byId('stepBtn');
  const resetBtn = byId('resetBtn');
  const speedSlider = byId('speedSlider');
  const antCapSlider = byId('antCapSlider');
  const evapSlider = byId('evapSlider');
  const diffSlider = byId('diffSlider');
  const pheromoneTickSlider = byId('pheromoneTickSlider');
  const brushSlider = byId('brushSlider');
  const helpPanel = byId('helpPanel');
  const viewToggle = byId('viewModeUnderground');

  const seedInput = byId('seedInput');
  const saveBtn = byId('saveBtn');
  const loadBtn = byId('loadBtn');
  const clearBtn = byId('clearBtn');

  const overlayIds = [
    ['showFoodOverlay', 'showFood'],
    ['showToFoodOverlay', 'showToFood'],
    ['showToHomeOverlay', 'showToHome'],
    ['showDangerOverlay', 'showDanger'],
  ];

  startPauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    syncPauseButton(startPauseBtn, state.paused);
  });

  stepBtn.addEventListener('click', () => actions.stepOnce());
  resetBtn.addEventListener('click', () => actions.reset(seedInput.value));

  speedSlider.addEventListener('input', () => {
    state.simSpeed = Number(speedSlider.value);
    byId('speedLabel').textContent = `${state.simSpeed.toFixed(1)}x`;
  });

  antCapSlider.addEventListener('input', () => {
    state.config.antCap = Number(antCapSlider.value);
    byId('antCapLabel').textContent = `${state.config.antCap}`;
  });

  evapSlider.addEventListener('input', () => {
    state.config.evaporationRate = Number(evapSlider.value);
    byId('evapLabel').textContent = state.config.evaporationRate.toFixed(3);
  });

  diffSlider.addEventListener('input', () => {
    state.config.diffusionRate = Number(diffSlider.value);
    byId('diffLabel').textContent = state.config.diffusionRate.toFixed(3);
  });

  pheromoneTickSlider.addEventListener('input', () => {
    state.config.pheromoneUpdateTicks = Number(pheromoneTickSlider.value);
    byId('pheromoneTickLabel').textContent = `${state.config.pheromoneUpdateTicks}`;
  });

  brushSlider.addEventListener('input', () => {
    state.brushRadius = Number(brushSlider.value);
    byId('brushLabel').textContent = `${state.brushRadius}`;
  });

  viewToggle.addEventListener('change', (event) => {
    state.viewMode = event.target.checked ? 'underground' : 'surface';
  });

  viewToggle.checked = state.viewMode === 'underground';

  document.querySelectorAll('input[name="tool"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      state.selectedTool = radio.value;
    });
  });

  overlayIds.forEach(([id, key]) => {
    byId(id).addEventListener('change', (event) => {
      state.overlays[key] = event.target.checked;
    });
  });

  saveBtn.addEventListener('click', () => actions.save());
  loadBtn.addEventListener('click', () => actions.load());
  clearBtn.addEventListener('click', () => actions.clearWorld());

  byId('closeHelpBtn').addEventListener('click', () => helpPanel.close());

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      state.paused = !state.paused;
      syncPauseButton(startPauseBtn, state.paused);
    } else if (event.key.toLowerCase() === 'n') {
      actions.stepOnce();
    } else if (event.key.toLowerCase() === 'r') {
      actions.reset(seedInput.value);
    } else if (event.key.toLowerCase() === 'h') {
      if (helpPanel.open) helpPanel.close();
      else helpPanel.showModal();
    } else if (event.key.toLowerCase() === 'u') {
      viewToggle.checked = !viewToggle.checked;
      state.viewMode = viewToggle.checked ? 'underground' : 'surface';
    } else if (TOOL_BY_KEY[event.key]) {
      state.selectedTool = TOOL_BY_KEY[event.key];
      const radio = document.querySelector(`input[name="tool"][value="${state.selectedTool}"]`);
      if (radio) radio.checked = true;
    } else if (event.key.toLowerCase() === 'f') {
      toggleOverlay('showToFoodOverlay', 'showToFood', state);
    } else if (event.key.toLowerCase() === 'g') {
      toggleOverlay('showToHomeOverlay', 'showToHome', state);
    } else if (event.key.toLowerCase() === 'd') {
      toggleOverlay('showDangerOverlay', 'showDanger', state);
    } else if (event.key.toLowerCase() === 'o') {
      toggleOverlay('showFoodOverlay', 'showFood', state);
    }
  });

  syncPauseButton(startPauseBtn, state.paused);
}

function toggleOverlay(inputId, key, state) {
  const el = byId(inputId);
  el.checked = !el.checked;
  state.overlays[key] = el.checked;
}

function syncPauseButton(button, paused) {
  button.textContent = paused ? 'Start' : 'Pause';
}

function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element: ${id}`);
  return el;
}
