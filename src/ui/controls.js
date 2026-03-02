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
  const viewToggleBtn = byId('viewToggleBtn');

  const seedInput = byId('seedInput');
  const speedSlider = byId('speedSlider');
  const brushSlider = byId('brushSlider');
  const antCapSlider = byId('antCapSlider');
  const workerSlider = byId('workerSlider');
  const soldierSlider = byId('soldierSlider');

  const saveBtn = byId('saveBtn');
  const loadBtn = byId('loadBtn');
  const clearBtn = byId('clearBtn');
  const helpPanel = byId('helpPanel');

  startPauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    syncPauseButton(startPauseBtn, state.paused);
  });
  stepBtn.addEventListener('click', () => actions.stepOnce());
  resetBtn.addEventListener('click', () => actions.reset(seedInput.value));
  viewToggleBtn.addEventListener('click', () => actions.toggleView());

  speedSlider.addEventListener('input', () => {
    state.simSpeed = Number(speedSlider.value);
    byId('speedLabel').textContent = `${state.simSpeed.toFixed(1)}x`;
  });

  brushSlider.addEventListener('input', () => {
    state.brushRadius = Number(brushSlider.value);
    byId('brushLabel').textContent = `${state.brushRadius}`;
  });

  antCapSlider.addEventListener('input', () => {
    state.config.antCap = Number(antCapSlider.value);
    byId('antCapLabel').textContent = `${state.config.antCap}`;
  });

  workerSlider.addEventListener('input', () => {
    state.casteTargets.workers = Number(workerSlider.value);
    byId('workerPct').textContent = `${state.casteTargets.workers}%`;
  });

  soldierSlider.addEventListener('input', () => {
    state.casteTargets.soldiers = Number(soldierSlider.value);
    byId('soldierPct').textContent = `${state.casteTargets.soldiers}%`;
  });

  document.querySelectorAll('input[name="tool"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      state.selectedTool = radio.value;
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
    } else if (event.code === 'Tab') {
      event.preventDefault();
      actions.toggleView();
    } else if (event.key.toLowerCase() === 'n') {
      actions.stepOnce();
    } else if (event.key.toLowerCase() === 'r') {
      actions.reset(seedInput.value);
    } else if (event.key.toLowerCase() === 'h') {
      if (helpPanel.open) helpPanel.close();
      else helpPanel.showModal();
    } else if (event.key.toLowerCase() === 'f') {
      state.overlays.showFood = !state.overlays.showFood;
    } else if (event.key.toLowerCase() === 'g') {
      state.overlays.showToFood = !state.overlays.showToFood;
    } else if (event.key.toLowerCase() === 'o') {
      state.overlays.showToHome = !state.overlays.showToHome;
    } else if (event.key.toLowerCase() === 'd') {
      state.overlays.showDanger = !state.overlays.showDanger;
    } else if (event.code === 'F3') {
      event.preventDefault();
      if (actions.toggleDebugEntrances) actions.toggleDebugEntrances();
    } else if (TOOL_BY_KEY[event.key]) {
      state.selectedTool = TOOL_BY_KEY[event.key];
      const radio = document.querySelector(`input[name="tool"][value="${state.selectedTool}"]`);
      if (radio) radio.checked = true;
    }
  });

  syncPauseButton(startPauseBtn, state.paused);
}

function syncPauseButton(button, paused) {
  button.textContent = paused ? 'START' : 'PAUSE';
}

function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element: ${id}`);
  return el;
}
