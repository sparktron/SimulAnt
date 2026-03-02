export function updateHud(stats) {
  setText('modeIndicator', stats.viewMode);
  setText('hudTick', String(stats.tick));
  setText('hudAnts', `${stats.ants}`);
  setText('hudWorkers', `${stats.workers}`);
  setText('hudSoldiers', `${stats.soldiers}`);
  setText('hudFood', stats.foodStored.toFixed(1));
  setText('hudFps', stats.fps.toFixed(1));

  setBar('healthYellow', 0);
  setText('healthYellowLabel', '(no ant selected)');
  setBar('healthBlack', Math.max(0, Math.min(100, (stats.foodStored / 120) * 100)));
  setText('healthBlackLabel', `food ${stats.foodStored.toFixed(1)}`);
  setBar('healthRed', 0);
  setText('healthRedLabel', 'not implemented');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setBar(id, valuePercent) {
  const el = document.getElementById(id);
  if (el) el.style.height = `${valuePercent}%`;
}
