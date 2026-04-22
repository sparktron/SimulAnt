import test from 'node:test';
import assert from 'node:assert/strict';

test('simulation modules import cleanly', async () => {
  const modules = await Promise.all([
    import('../src/sim/world.js'),
    import('../src/sim/ant.js'),
    import('../src/sim/colony.js'),
    import('../src/sim/DigSystem.js'),
    import('../src/sim/SimulationCore.js'),
    import('../src/sim/core/SimulationTypes.js'),
    import('../src/sim/core/MicroPatchEngine.js'),
    import('../src/sim/core/MacroEngine.js'),
    import('../src/sim/core/TickScheduler.js'),
  ]);

  for (const mod of modules) {
    assert.ok(mod && typeof mod === 'object');
  }
});
