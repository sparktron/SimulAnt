import test from 'node:test';
import assert from 'node:assert/strict';
import { SurfaceRenderer } from '../src/render/SurfaceRenderer.js';
import { TERRAIN } from '../src/sim/world.js';

function createFakeCanvasContext() {
  return {
    fillRectCalls: [],
    fillStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    setTransform() {},
    fillRect(x, y, w, h) { this.fillRectCalls.push({ x, y, w, h, fillStyle: this.fillStyle }); },
    save() {},
    restore() {},
    translate() {},
    scale() {},
    drawImage() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    fillText() {},
    strokeRect() {},
    arc() {},
  };
}

function createOffscreenContext() {
  return {
    createImageData(w, h) {
      return { data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData() {},
  };
}

test('SurfaceRenderer only draws surface ants and pellets', () => {
  const world = {
    width: 16,
    height: 24,
    nestX: 8,
    nestY: 7,
    terrain: new Uint8Array(16 * 24).fill(TERRAIN.GROUND),
    toFood: new Float32Array(16 * 24),
    toHome: new Float32Array(16 * 24),
    danger: new Float32Array(16 * 24),
    index(x, y) {
      return y * this.width + x;
    },
  };

  const mainCtx = createFakeCanvasContext();
  const offscreenCtx = createOffscreenContext();
  const fakeDocument = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: world.width,
        height: world.nestY + 1,
        getContext() {
          return offscreenCtx;
        },
      };
    },
  };

  const oldDocument = globalThis.document;
  globalThis.document = fakeDocument;

  try {
    const canvas = {
      clientWidth: 320,
      clientHeight: 200,
      getContext() {
        return mainCtx;
      },
      getBoundingClientRect() {
        return { width: this.clientWidth, height: this.clientHeight };
      },
    };

    const renderer = new SurfaceRenderer(canvas, world);
    const colony = {
      ants: [
        { id: 'surface-ant', x: 4, y: 6, baseColor: '#111111', carryingType: 'none', hunger: 80, health: 90 },
        { id: 'nest-ant', x: 5, y: 10, baseColor: '#222222', carryingType: 'none', hunger: 75, health: 88 },
      ],
      foodStored: 0,
    };

    renderer.draw(colony, { showToFood: false, showScent: false, showToHome: false, showDanger: false }, [{ x: 8, y: 7, id: 'e0', soilOnSurface: 0 }], [
      { x: 3, y: 5 },
      { x: 3, y: 10 },
    ]);

    const unitRects = mainCtx.fillRectCalls.filter((call) => call.w === 1 && call.h === 1);

    assert.ok(unitRects.some((call) => call.x === 4 && call.y === 6), 'surface ant should render');
    assert.ok(!unitRects.some((call) => call.x === 5 && call.y === 10), 'underground ant should not render in surface view');
    assert.ok(unitRects.some((call) => call.x === 3 && call.y === 5), 'surface pellet should render');
    assert.ok(!unitRects.some((call) => call.x === 3 && call.y === 10), 'underground pellet should not render in surface view');
  } finally {
    globalThis.document = oldDocument;
  }
});
