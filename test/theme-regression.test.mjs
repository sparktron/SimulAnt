// Locks the observable renderer behavior of the pre-existing skins (classic,
// retro, modern) so replacing hard-coded `skin.name === ...` checks with skin
// properties cannot silently change their output.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SurfaceRenderer } from '../src/render/SurfaceRenderer.js';
import { NestRenderer } from '../src/render/NestRenderer.js';
import { MiniMap } from '../src/render/MiniMap.js';
import { TERRAIN } from '../src/sim/world.js';

// A 2D context that records every call with the paint state in effect, so the
// hash covers colors, geometry, and call order.
function recorder(log) {
  const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1 };
  const base = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(image) { this.image = image; log.push(['put', createHash('sha256').update(image.data).digest('hex')]); },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    measureText: () => ({ width: 1 }),
  };
  return new Proxy(base, {
    get(o, k) {
      if (k in o) return o[k];
      if (k in state) return state[k];
      return (...args) => log.push([String(k), state.fillStyle, state.strokeStyle,
        ...args.map(a => (typeof a === 'number' ? Math.round(a * 1000) / 1000 : typeof a))]);
    },
    set(o, k, v) { if (k in state) state[k] = v; else o[k] = v; return true; },
  });
}

function setup() {
  const log = [];
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => recorder(log) }) };
  // modern's queen pulses on wall-clock time; pin it so digests are stable.
  mock.method(performance, 'now', () => 0);
  const w = { width: 24, height: 24, nestY: 8, nestX: 12, terrainVersion: 1, fieldsVersion: 1 };
  const types = Object.values(TERRAIN); const n = w.width * w.height;
  w.terrain = Uint8Array.from({ length: n }, (_, i) => types[(i * 7 + Math.floor(i / 24)) % types.length]);
  w.toFood = Float32Array.from({ length: n }, (_, i) => (i % 17) / 3);
  w.toHome = Float32Array.from({ length: n }, (_, i) => (i % 13) / 4);
  w.danger = Float32Array.from({ length: n }, (_, i) => (i % 7) / 10);
  w.index = (x, y) => y * w.width + x; w.inBounds = (x, y) => x >= 0 && y >= 0 && x < w.width && y < w.height;
  const ants = [
    { id: 1, x: 5, y: 3, role: 'worker', state: 'FORAGE_SEARCH', baseColor: '#222', carryingType: 'food' },
    { id: 2, x: 9, y: 6, role: 'soldier', state: 'FIGHT', baseColor: '#5c1010' },
    { id: 3, x: 14, y: 14, role: 'worker', state: 'DIG', baseColor: '#222', carryingType: 'dirt' },
  ];
  const colony = { id: 'black', ants, queen: { alive: true, x: 12, y: 15, hunger: 1, health: 1 }, larvae: [{ stage: 2 }, { stage: 4 }], nestFoodPellets: [{ x: 11, y: 12, amount: 2 }], homeX: 12, homeY: 12 };
  const canvas = { clientWidth: 96, clientHeight: 64, getContext: () => recorder(log) };
  return { log, w, colony, canvas };
}

function digest(log) { return createHash('sha256').update(JSON.stringify(log)).digest('hex').slice(0, 16); }

function renderAll(name) {
  const { log, w, colony, canvas } = setup();
  const out = {};
  const surface = new SurfaceRenderer(canvas, w); surface.setSkin(name); surface.zoom = 6;
  const entrances = [{ x: 12, y: 8, soilOnSurface: 9 }];
  const pellets = [{ x: 3, y: 2 }, { x: 20, y: 5 }];
  for (const [mode, overlays] of [['plain', {}], ['scent', { showScent: true, showDanger: true }], ['jobs', { showAntJobs: true }]]) {
    log.length = 0;
    // Two frames so heading caches see movement.
    surface.draw(colony, overlays, entrances, pellets, { selectedAntId: 1 });
    colony.ants[0].x += 1;
    surface.draw(colony, overlays, entrances, pellets, { selectedAntId: 1 });
    colony.ants[0].x -= 1;
    out[`surface-${mode}`] = digest(log);
  }
  const nest = new NestRenderer(canvas, w); nest.setSkin(name); nest.zoom = 6;
  log.length = 0;
  nest.draw(colony, {}, { selectedAntId: 3 }); colony.ants[2].y += 1; nest.draw(colony, {}, { selectedAntId: 3 }); colony.ants[2].y -= 1;
  out.nest = digest(log);
  const mini = new MiniMap(recorder(log)); mini.canvas = { width: 0, height: 0 }; mini.ctx = recorder(log); mini.setSkin(name);
  log.length = 0;
  mini.draw(w, colony, { cameraX: 12, cameraY: 6, zoom: 6 }, canvas, { ants: [{ x: 2, y: 2 }] });
  out.minimap = digest(log);
  return out;
}

// Golden digests recorded on v0.62.1, before the skin-property refactor.
const GOLDEN = {
  classic: {"surface-plain":"82fda0a877220162","surface-scent":"3d4965081ba0a146","surface-jobs":"d40a05bf3cdd206a","nest":"05ea2250b9d8fe2c","minimap":"81b68983aaaa3320"},
  retro: {"surface-plain":"0265f177be5657b1","surface-scent":"5e463d8eb698ef1e","surface-jobs":"e65de3e866aaa90b","nest":"a8295e15ecd5c782","minimap":"0959d9ff73d96f2b"},
  modern: {"surface-plain":"4f555405d1fd4732","surface-scent":"06cedc2a189d7641","surface-jobs":"e2b0442fe52b09f9","nest":"b7a8f277f176c2b4","minimap":"04ecc0eadc7993c8"},
};

for (const name of ['classic', 'retro', 'modern']) {
  test(`${name} skin renders identically to the pre-refactor baseline`, () => {
    const actual = renderAll(name);
    if (process.env.PRINT_GOLDEN) console.log(name, JSON.stringify(actual));
    assert.deepEqual(actual, GOLDEN[name]);
  });
}
