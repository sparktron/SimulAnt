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

  setBar('healthYellow', Math.max(0, Math.min(100, (stats.selectedAntHealth / 100) * 100)));
  setBar('healthBlack', Math.max(0, Math.min(100, (stats.foodStored / 300) * 100)));
  setBar('healthRed', Math.max(0, Math.min(100, (stats.soldiers / Math.max(1, stats.ants)) * 100)));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setBar(id, valuePercent) {
  const el = document.getElementById(id);
  if (el) el.style.height = `${valuePercent}%`;
}
