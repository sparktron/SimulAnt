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

// Which view each paint tool is meaningful in. Surface tools edit the
// above-ground world (terrain + food); the nest tools (dig/fill) only affect
// underground SOIL/TUNNEL cells, so they are inert while the SURFACE view is
// active. The palette disables whichever set doesn't apply — see syncToolPalette.
const TOOL_VIEW = {
  food: 'SURFACE',
  wall: 'SURFACE',
  water: 'SURFACE',
  hazard: 'SURFACE',
  erase: 'SURFACE',
  dig: 'NEST',
  fill: 'NEST',
};

/**
 * Enables only the paint tools that do something in the given view and disables
 * the rest. If the currently selected tool becomes invalid (e.g. DIG when the
 * user switches to SURFACE), the selection falls back to the first valid tool
 * for that view, so the next paint stroke always has a visible effect.
 *
 * @param {object} state - shared UI state; state.selectedTool may be reassigned
 * @param {'SURFACE'|'NEST'} view - the active view
 */
export function syncToolPalette(state, view) {
  const radios = document.querySelectorAll('input[name="tool"]');
  let selectedStillValid = false;
  let firstValid = null;

  radios.forEach((radio) => {
    const valid = TOOL_VIEW[radio.value] === view;
    radio.disabled = !valid;
    const label = radio.closest('label');
    if (label) label.classList.toggle('tool-disabled', !valid);
    if (valid && firstValid === null) firstValid = radio;
    if (valid && radio.value === state.selectedTool) selectedStillValid = true;
  });

  if (!selectedStillValid && firstValid) {
    state.selectedTool = firstValid.value;
    firstValid.checked = true;
  }
}

/**
 * Enables/disables controls whose effect is SURFACE-only. Pheromone, scent, and
 * danger overlays are only rendered by the surface view (by design), so the
 * SCENT button is disabled while the NEST view is active. The JOBS overlay and
 * PHERO simulation toggle work in both views and are intentionally left alone.
 *
 * @param {'SURFACE'|'NEST'} view - the active view
 */
export function syncSurfaceOnlyControls(view) {
  const scentBtn = document.getElementById('scentBtn');
  if (scentBtn) scentBtn.disabled = view !== 'SURFACE';
}

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

  // Pheromone/scent/danger overlays only render on the surface, so their
  // shortcuts are inert anywhere else.
  const isSurfaceView = () => !actions.getView || actions.getView() === 'SURFACE';

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
      if (!isSurfaceView()) return;
      state.overlays.showToFood = !state.overlays.showToFood;
    } else if (event.key.toLowerCase() === 'v') {
      if (!isSurfaceView()) return;
      if (actions.toggleScentOverlay) actions.toggleScentOverlay();
    } else if (event.key.toLowerCase() === 'l') {
      if (!isSurfaceView()) return;
      state.overlays.showToHome = !state.overlays.showToHome;
    } else if (event.key.toLowerCase() === 'd') {
      if (!isSurfaceView()) return;
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
    } else if (TOOL_BY_KEY[event.key]) {
      const tool = TOOL_BY_KEY[event.key];
      // Ignore number-key shortcuts for tools that are disabled in this view.
      const currentView = actions.getView ? actions.getView() : TOOL_VIEW[tool];
      if (TOOL_VIEW[tool] !== currentView) return;
      state.selectedTool = tool;
      const radio = document.querySelector(`input[name="tool"][value="${tool}"]`);
      if (radio) radio.checked = true;
    }
  });

  syncPauseButton(startPauseBtn, state.paused);

  // Establish the initial enabled/disabled control state for the starting view.
  if (actions.getView) {
    syncToolPalette(state, actions.getView());
    syncSurfaceOnlyControls(actions.getView());
  }
}

function syncPauseButton(button, paused) {
  button.textContent = paused ? 'START' : 'PAUSE';
}

function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element: ${id}`);
  return el;
}
