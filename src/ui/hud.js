export function updateHud(element, stats) {
  element.innerHTML = `
    <p><strong>FPS:</strong> ${stats.fps.toFixed(1)}</p>
    <p><strong>Sim ms:</strong> ${stats.simMs.toFixed(2)}</p>
    <p><strong>Tick:</strong> ${stats.tick}</p>
    <p><strong>Queen:</strong> ${stats.queenAlive ? 'Alive' : 'Dead'}</p>
    <p><strong>Ants alive:</strong> ${stats.ants} (${stats.workers} workers / ${stats.soldiers} soldiers)</p>
    <p><strong>Food stored:</strong> ${stats.foodStored.toFixed(1)}</p>
    <p><strong>Eggs laid / Brood:</strong> ${stats.eggsLaid} / ${stats.brood}</p>
    <p><strong>Births / Deaths:</strong> ${stats.births} / ${stats.deaths}</p>
    <p><strong>Tunnel tiles excavated:</strong> ${stats.excavatedTiles}</p>
  `;
}
