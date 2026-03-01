import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewManager, VIEW } from '../src/ui/ViewManager.js';
import { SimulationCore } from '../src/sim/SimulationCore.js';

test('ViewManager toggles between SURFACE and NEST only', () => {
  const vm = new ViewManager(VIEW.SURFACE);
  assert.equal(vm.getCurrent(), VIEW.SURFACE);
  vm.toggle();
  assert.equal(vm.getCurrent(), VIEW.NEST);
  vm.toggle();
  assert.equal(vm.getCurrent(), VIEW.SURFACE);
});

test('Simulation state persists across view toggles', () => {
  const vm = new ViewManager(VIEW.SURFACE);
  const sim = new SimulationCore('seed-persist');

  const ant = sim.colony.ants[0];
  const before = { x: ant.x, y: ant.y };
  ant.x += 5;
  ant.y += 2;

  vm.toggle();
  vm.toggle();

  assert.deepEqual({ x: ant.x, y: ant.y }, { x: before.x + 5, y: before.y + 2 });
});
