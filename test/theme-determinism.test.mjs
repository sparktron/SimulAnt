// Rendering must never draw from or advance the simulation RNG, nor mutate
// simulation state, for any theme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/sim/SimulationCore.js';
import { SurfaceRenderer } from '../src/render/SurfaceRenderer.js';
import { NestRenderer } from '../src/render/NestRenderer.js';
import { MiniMap } from '../src/render/MiniMap.js';

function context() {
  return new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}), measureText: () => ({ width: 1 }),
  }, { get: (o, k) => (k in o ? o[k] : () => {}) });
}

test('drawing every theme leaves the sim RNG stream and state untouched', () => {
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context() }) };
  const core = new SimulationCore('theme-determinism');
  const reference = new SimulationCore('theme-determinism');
  const snapshot = c => JSON.stringify({
    rng: c.rng.state,
    ants: c.colony.ants.map(a => [a.id, a.x, a.y, a.state]),
    rivals: c.rivalColony.ants.map(a => [a.id, a.x, a.y, a.state]),
    terrain: Buffer.from(c.world.terrain).toString('base64'),
  });
  const before = snapshot(core);
  const canvas = { clientWidth: 640, clientHeight: 480, getContext: () => context() };
  for (const name of ['classic', 'retro', 'modern', 'nineties', 'realistic']) {
    const surface = new SurfaceRenderer(canvas, core.world); surface.setSkin(name);
    const nest = new NestRenderer(canvas, core.world); nest.setSkin(name);
    const mini = new MiniMap(canvas); mini.canvas = { width: 0, height: 0 }; mini.setSkin(name);
    for (const zoom of [3, 8]) {
      surface.zoom = zoom; nest.zoom = zoom;
      surface.draw(core.colony, { showScent: true, showAntJobs: true }, core.nestEntrances, core.foodPellets,
        { rivalColony: core.rivalColony, rivalNestEntrances: core.rivalNestEntrances, selectedAntId: core.colony.ants[0]?.id });
      nest.draw(core.colony, {}, { rivalColony: core.rivalColony });
      mini.draw(core.world, core.colony, surface, canvas, core.rivalColony);
    }
  }
  assert.equal(snapshot(core), before);
  // A second core that never rendered draws the same next random numbers.
  assert.equal(core.rng.next(), reference.rng.next());
});
