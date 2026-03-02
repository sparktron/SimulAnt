export function createControls(state, actions) {
  const seedInput = byId('seedInput');
  const speedSlider = byId('speedSlider');
  const brushSlider = byId('brushSlider');
  const antCapSlider = byId('antCapSlider');
  const workerSlider = byId('workerSlider');
  const soldierSlider = byId('soldierSlider');

  byId('stepBtn').addEventListener('click', () => actions.stepOnce());
  byId('resetBtn').addEventListener('click', () => actions.reset(seedInput.value));
  byId('saveBtn').addEventListener('click', () => actions.save());
  byId('loadBtn').addEventListener('click', () => actions.load());
  byId('clearBtn').addEventListener('click', () => actions.clearWorld());

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

  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'n') actions.stepOnce();
    else if (event.key.toLowerCase() === 'r') actions.reset(seedInput.value);
  });
}

function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element: ${id}`);
  return el;
}
