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

test('NestRenderer only draws underground ants in nest view', () => {
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
      ants: [
        { id: 'surface-ant', x: 2, y: world.nestY - 2, baseColor: '#111111', carryingType: 'none', hunger: 80, health: 90 },
        { id: 'horizon-ant', x: 3, y: world.nestY, baseColor: '#333333', carryingType: 'none', hunger: 75, health: 88 },
        { id: 'nest-ant', x: 4, y: world.nestY + 2, baseColor: '#222222', carryingType: 'none', hunger: 70, health: 85 },
      ],
      nestFoodPellets: [],
      foodStored: 0,
      queen: { alive: false, hunger: 100, health: 100, x: world.nestX, y: world.nestY + 2 },
    };

    renderer.draw(colony, { showDebugStats: false });

    assert.ok(
      !mainCtx.fillRectCalls.some((call) => call.x === 2 && call.y === world.nestY - 2 && call.w === 1 && call.h === 1),
      'surface ant should not be rendered in nest view',
    );

    assert.ok(
      mainCtx.fillRectCalls.some((call) => call.x === 3 && call.y === world.nestY && call.w === 1 && call.h === 1),
      'horizon ant at nestY should be rendered in nest view (ant.y < nestY is the filter now)',
    );

    assert.ok(
      mainCtx.fillRectCalls.some((call) => call.x === 4 && call.y === world.nestY + 2 && call.w === 1 && call.h === 1),
      'nest ant should be rendered in nest view',
    );
  } finally {
    globalThis.document = oldDocument;
  }
});
