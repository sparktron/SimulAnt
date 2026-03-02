export function updateHud(stats) {
  setText('modeIndicator', stats.viewMode);
  setText('hudTick', String(stats.tick));
  setText('hudAnts', `${stats.ants}`);
  setText('hudWorkers', `${stats.workers}`);
  setText('hudSoldiers', `${stats.soldiers}`);
  setText('hudFood', stats.foodStored.toFixed(1));
  setText('hudFps', stats.fps.toFixed(1));
  setText('hudDig', stats.digStatus || 'AUTO-DIG: OFF');

  setBar('healthYellow', Math.max(0, Math.min(100, (stats.foodStored / 120) * 100)));
  setBar('healthBlack', Math.max(0, Math.min(100, (stats.queenAlive ? 100 : 0))));
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
