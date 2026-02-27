export function updateHud(element, stats) {
  const load = Math.min(100, (stats.ants / 2000) * 100);
  element.innerHTML = `
    <p><strong>FPS:</strong> ${stats.fps.toFixed(1)}</p>
    <p><strong>Sim ms:</strong> ${stats.simMs.toFixed(2)}</p>
    <p><strong>Tick:</strong> ${stats.tick}</p>
    <p><strong>Ants alive:</strong> ${stats.ants} (${load.toFixed(0)}% cap basis)</p>
    <p><strong>Food stored:</strong> ${stats.foodStored.toFixed(1)}</p>
    <p><strong>Births / Deaths:</strong> ${stats.births} / ${stats.deaths}</p>
  `;
}
