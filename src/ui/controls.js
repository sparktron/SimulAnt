/*
    Keyboard and UI button handlers for core controls.

    Maps keyboard inputs to simulation actions (pause/step/reset/view-toggle)
    and slider inputs to mutable config (sim speed, brush size, ant cap).

    State mutation pattern:
    - state.paused, state.simSpeed, state.brushRadius mutate directly
    - config changes (antCap) mutate state.config which is passed to next tick
    - View toggle calls actions.toggleView() which updates ViewManager
    - Reset seeds and loads call actions with string/data arguments

    UI/simulation boundary:
    - Controls read from state and trigger actions
    - Actions mutate state, may call SimulationCore methods
    - State changes are reflected in HUD on next frame
*/

const TOOL_BY_KEY = {
  '1': 'food',
  '2': 'wall',
  '3': 'water',
  '4': 'hazard',
  '5': 'erase',
  '6': 'dig',
  '7': 'fill',
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

  const saveBtn = byId('saveBtn');
  const loadBtn = byId('loadBtn');
  const clearBtn = byId('clearBtn');
  const scentBtn = byId('scentBtn');
  const jobsBtn = byId('jobsBtn');
  const pheromoneBtn = byId('pheromoneBtn');
  const downloadLogBtn = byId('downloadLogBtn');
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

  document.querySelectorAll('input[name="tool"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      state.selectedTool = radio.value;
    });
  });

  saveBtn.addEventListener('click', () => actions.save());
  loadBtn.addEventListener('click', () => actions.load());
  clearBtn.addEventListener('click', () => actions.clearWorld());
  scentBtn.addEventListener('click', () => {
    if (actions.toggleScentOverlay) actions.toggleScentOverlay();
  });
  jobsBtn.addEventListener('click', () => {
    state.overlays.showAntJobs = !state.overlays.showAntJobs;
    const legend = byId('jobLegend');
    legend.classList.toggle('active', state.overlays.showAntJobs);
  });
  byId('closeHelpBtn').addEventListener('click', () => helpPanel.close());
  pheromoneBtn.addEventListener('click', () => {
    if (actions.togglePheromones) {
      const enabled = actions.togglePheromones();
      pheromoneBtn.textContent = enabled ? 'PHERO: ON' : 'PHERO: OFF';
    }
  });
  downloadLogBtn.addEventListener('click', () => {
    if (actions.downloadLog) {
      actions.downloadLog('jsonl');
    } else {
      console.error(
        '[SimAnt] LOG button was clicked but no downloadLog handler is wired. '
        + 'main.js must pass { downloadLog } in the actions object given to createControls.',
      );
    }
  });

  document.addEventListener('keydown', (event) => {
    // Don't steal keys while the user is typing in any text/number field.
    if (event.target.matches('input[type="text"], input[type="number"], textarea')) return;

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
      if (actions.spawnFoodAtCursor) actions.spawnFoodAtCursor();
    } else if (event.key.toLowerCase() === 'k') {
      if (actions.starveSelectedAnt) actions.starveSelectedAnt();
    } else if (event.key.toLowerCase() === 'o') {
      if (actions.addFoodToStore) actions.addFoodToStore();
    } else if (event.key.toLowerCase() === 'g') {
      if (actions.toggleAutoDig) actions.toggleAutoDig();
    } else if (event.key.toLowerCase() === 'c') {
      if (actions.forceChamber) actions.forceChamber();
    } else if (event.key.toLowerCase() === 't') {
      state.overlays.showToFood = !state.overlays.showToFood;
    } else if (event.key.toLowerCase() === 'v') {
      if (actions.toggleScentOverlay) actions.toggleScentOverlay();
    } else if (event.key.toLowerCase() === 'l') {
      state.overlays.showToHome = !state.overlays.showToHome;
    } else if (event.key.toLowerCase() === 'd') {
      state.overlays.showDanger = !state.overlays.showDanger;
    } else if (event.key.toLowerCase() === 'j') {
      state.overlays.showAntJobs = !state.overlays.showAntJobs;
      const legend = byId('jobLegend');
      legend.classList.toggle('active', state.overlays.showAntJobs);
    } else if (event.key.toLowerCase() === 'y') {
      if (actions.downloadLog) actions.downloadLog(event.shiftKey ? 'csv' : 'jsonl');
    } else if (event.key.toLowerCase() === 'p') {
      if (actions.togglePheromones) {
        const enabled = actions.togglePheromones();
        pheromoneBtn.textContent = enabled ? 'PHERO: ON' : 'PHERO: OFF';
      }
    } else if (event.code === 'F3') {
      event.preventDefault();
      if (actions.toggleDebugStats) actions.toggleDebugStats();
    } else if (event.code === 'F4') {
      event.preventDefault();
      if (actions.toggleQueenMarker) actions.toggleQueenMarker();
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
