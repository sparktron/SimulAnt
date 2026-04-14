export function updateHud(stats) {
  setText('modeIndicator', stats.viewMode);
  setText('hudTick', String(stats.tick));
  setText('hudAnts', `${stats.ants}`);
  const surface = asNonNegativeInt(stats.antsSurface);
  const underground = asNonNegativeInt(stats.antsUnderground);
  setText('hudAntLocation', `(${surface}↑ ${underground}↓)`);
  setText('hudWorkers', `${stats.workers}`);
  setText('hudSoldiers', `${stats.soldiers}`);
  setText('hudBreeders', `${asNonNegativeInt(stats.breeders)}`);

  const workers = asNonNegativeInt(stats.workers);
  let jobsForage = Number.isFinite(stats.jobsForage) ? asNonNegativeInt(stats.jobsForage) : workers;
  let jobsDig = Number.isFinite(stats.jobsDig) ? asNonNegativeInt(stats.jobsDig) : 0;
  let jobsNurse = Number.isFinite(stats.jobsNurse) ? asNonNegativeInt(stats.jobsNurse) : 0;
  let nurses = Number.isFinite(stats.nurses) ? asNonNegativeInt(stats.nurses) : jobsNurse;

  // Guard against inconsistent producer payloads where workers are set but jobs are all zero.
  if (workers > 0 && jobsForage + jobsDig + jobsNurse === 0) {
    jobsForage = workers;
    jobsDig = 0;
    jobsNurse = 0;
    nurses = 0;
  }

  setText('hudNurses', `${nurses}`);
  setText('hudForagers', `${jobsForage}`);
  setText('hudDiggers', `${jobsDig}`);
  setText('hudJobs', `${jobsForage} / ${jobsDig} / ${jobsNurse}`);
  setText('hudFood', formatNumber(stats.foodStored));
  setText('hudQueenHealth', formatNumber(stats.queenHealth));
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

function asNonNegativeInt(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function formatNumber(value) {
  const number = Number.isFinite(value) ? value : 0;
  return number.toFixed(1);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setBar(id, valuePercent) {
  const el = document.getElementById(id);
  if (el) el.style.height = `${valuePercent}%`;
}
