import test from 'node:test';
import assert from 'node:assert/strict';
import { InputRouter } from '../src/input/InputRouter.js';
import { ViewManager, VIEW } from '../src/ui/ViewManager.js';

function createFakeCanvas() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0 };
    },
    setPointerCapture() {},
  };
}

test('InputRouter safely ignores invalid screenToWorld result on pointerdown', () => {
  const canvas = createFakeCanvas();
  const viewManager = new ViewManager(VIEW.NEST);
  let paintCalls = 0;

  new InputRouter(canvas, viewManager, {
    surface: { screenToWorld: () => ({ x: 1, y: 1 }) },
    nest: {
      screenToWorld: () => ({ x: Number.NaN, y: Number.NaN }),
      paint: () => {
        paintCalls += 1;
      },
    },
  });

  assert.doesNotThrow(() => {
    canvas.listeners.get('pointerdown')({
      pointerId: 1,
      clientX: 30,
      clientY: 40,
      button: 0,
      shiftKey: false,
    });
  });

  assert.equal(paintCalls, 0, 'paint should not run when translated point is invalid');
});
