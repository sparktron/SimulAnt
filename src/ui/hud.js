export function updateHud(stats) {
  setText('modeIndicator', stats.viewMode);
  setText('hudTick', String(stats.tick));
  setText('hudAnts', `${stats.ants}`);
  setText('hudWorkers', `${stats.workers}`);
  setText('hudSoldiers', `${stats.soldiers}`);
  setText('hudFood', stats.foodStored.toFixed(1));
  setText('hudFps', stats.fps.toFixed(1));
  setText('hudDig', stats.digStatus || 'AUTO-DIG: OFF');

  const pher = stats.pherStats || { maxFood: 0, maxHome: 0, avgFood: 0, avgHome: 0 };
  setText('hudPherMax', `F:${pher.maxFood.toFixed(2)} H:${pher.maxHome.toFixed(2)}`);
  setText('hudPherAvg', `F:${pher.avgFood.toFixed(2)} H:${pher.avgHome.toFixed(2)}`);
  setText('hudFollow', `F:${stats.followingFood || 0} H:${stats.followingHome || 0}`);
  const healthStats = normalizeHealthStats(stats.antHealthStats);
  setText('hudHealthStats', `MIN:${healthStats.min.toFixed(1)} AVG:${healthStats.avg.toFixed(1)} MAX:${healthStats.max.toFixed(1)}`);

  const focusHealth = Number.isFinite(stats.selectedAntHealth) ? stats.selectedAntHealth : healthStats.avg;
  setBar('healthYellow', clampPercent(focusHealth));
  setBar('healthBlack', clampPercent(healthStats.min));
  setBar('healthRed', clampPercent(healthStats.max));
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function normalizeHealthStats(value) {
  const min = Number.isFinite(value?.min) ? value.min : 0;
  const avg = Number.isFinite(value?.avg) ? value.avg : 0;
  const max = Number.isFinite(value?.max) ? value.max : 0;
  return { min, avg, max };
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setBar(id, valuePercent) {
  const el = document.getElementById(id);
  if (el) el.style.height = `${valuePercent}%`;
}
