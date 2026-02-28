export function updateHud(element, stats) {
  element.innerHTML = `
    <p><strong>FPS:</strong> ${stats.fps.toFixed(1)}</p>
    <p><strong>Sim ms:</strong> ${stats.simMs.toFixed(2)}</p>
    <p><strong>Tick:</strong> ${stats.tick}</p>
    <p><strong>Ants alive:</strong> ${stats.ants}</p>
    <p><strong>Food stored:</strong> ${stats.foodStored.toFixed(1)}</p>
    <p><strong>Births / Deaths:</strong> ${stats.births} / ${stats.deaths}</p>
  `;
}
