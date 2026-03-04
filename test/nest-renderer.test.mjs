import test from 'node:test';
import assert from 'node:assert/strict';
import { NestRenderer } from '../src/render/NestRenderer.js';
import { TERRAIN } from '../src/sim/world.js';

function createFakeCanvasContext() {
  return {
    arcCalls: 0,
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
    stroke() {},
    fill() {},
    fillText() {},
    strokeRect() {},
    arc() { this.arcCalls += 1; },
  };
}

function createOffscreenContext(width, height) {
  return {
    createImageData(w, h) {
      return { data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData() {},
  };
}

function createWorld() {
  const width = 8;
  const height = 8;
  const terrain = new Uint8Array(width * height).fill(TERRAIN.GROUND);
  return {
    width,
    height,
    nestX: 4,
    nestY: 3,
    terrain,
    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < width && y < height;
    },
    index(x, y) {
      return y * width + x;
    },
  };
}

test('NestRenderer hides queen marker by default and shows it only when enabled', () => {
  const world = createWorld();
  const mainCtx = createFakeCanvasContext();
  const offscreenCtx = createOffscreenContext(world.width, world.height);

  const fakeDocument = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: world.width,
        height: world.height,
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

    const renderer = new NestRenderer(canvas, world);
    const colony = {
      ants: [],
      nestFoodPellets: [],
      foodStored: 0,
      queen: { alive: true, hunger: 100, health: 100, x: world.nestX, y: world.nestY + 2 },
    };

    renderer.draw(colony, { showDebugStats: false });
    assert.equal(mainCtx.arcCalls, 0, 'queen marker should not render by default');

    renderer.draw(colony, { showDebugStats: false, showQueenMarker: true });
    assert.equal(mainCtx.arcCalls, 2, 'queen marker should render as two circles when enabled');
  } finally {
    globalThis.document = oldDocument;
  }
});

test('NestRenderer clamps surface ants to ground transition line instead of sky', () => {
  const world = createWorld();
  const mainCtx = createFakeCanvasContext();
  const offscreenCtx = createOffscreenContext(world.width, world.height);

  const fakeDocument = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: world.width,
        height: world.height,
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

    const renderer = new NestRenderer(canvas, world);
    const skyAnt = { id: 'a1', x: 2, y: 0, baseColor: '#1a1208', carryingType: 'none', hunger: 100, health: 100 };
    const colony = {
      ants: [skyAnt],
      nestFoodPellets: [],
      foodStored: 0,
      queen: { alive: true, hunger: 100, health: 100, x: world.nestX, y: world.nestY + 2 },
    };

    renderer.draw(colony, { showDebugStats: false, showQueenMarker: false });

    const antDraw = mainCtx.fillRectCalls.find((call) => call.fillStyle === '#1a1208' && call.w === 1 && call.h === 1);
    assert.ok(antDraw, 'ant body should be rendered');
    assert.equal(antDraw.y, world.nestY, 'surface ant should render on transition line in nest view');
  } finally {
    globalThis.document = oldDocument;
  }
});
