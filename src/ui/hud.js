export function updateHud(element, stats) {
  const load = Math.min(100, (stats.ants / 2000) * 100);
  element.innerHTML = `
    <p><strong>FPS:</strong> ${stats.fps.toFixed(1)} | <strong>View:</strong> ${stats.viewMode}</p>
    <p><strong>Sim ms:</strong> ${stats.simMs.toFixed(2)} | <strong>Tick:</strong> ${stats.tick}</p>
    <p><strong>Ants:</strong> ${stats.ants} (${load.toFixed(0)}% cap basis)</p>
    <p><strong>Roles:</strong> W ${stats.roles.worker} / S ${stats.roles.soldier} / M ${stats.roles.male} / B ${stats.roles.breeder}</p>
    <p><strong>Brood:</strong> Egg ${stats.brood.egg} / Larva ${stats.brood.larva} / Pupa ${stats.brood.pupa}</p>
    <p><strong>Food:</strong> ${stats.foodStored.toFixed(1)} | <strong>Queen HP:</strong> ${stats.queenHealth.toFixed(0)}</p>
    <p><strong>Dug tiles:</strong> ${stats.dugTiles} | <strong>Births / Deaths:</strong> ${stats.births} / ${stats.deaths}</p>
  `;
}
