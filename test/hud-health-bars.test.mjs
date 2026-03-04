import test from 'node:test';
import assert from 'node:assert/strict';
import { updateHud } from '../src/ui/hud.js';

function installFakeDocument() {
  const elements = new Map();

  global.document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, { textContent: '', style: { height: '' } });
      }
      return elements.get(id);
    },
  };

  return elements;
}

test('HUD health bars bind to selected health and aggregate health stats', () => {
  const elements = installFakeDocument();

  updateHud({
    viewMode: 'SURFACE',
    tick: 1,
    ants: 10,
    workers: 7,
    soldiers: 3,
    foodStored: 20,
    fps: 60,
    digStatus: 'AUTO-DIG: OFF',
    pherStats: { maxFood: 0, maxHome: 0, avgFood: 0, avgHome: 0 },
    followingFood: 0,
    followingHome: 0,
    selectedAntHealth: 42,
    antHealthStats: { min: 20, avg: 55, max: 90 },
  });

  assert.equal(elements.get('healthYellow').style.height, '42%');
  assert.equal(elements.get('healthBlack').style.height, '20%');
  assert.equal(elements.get('healthRed').style.height, '90%');
  assert.equal(elements.get('hudHealthStats').textContent, 'MIN:20.0 AVG:55.0 MAX:90.0');
});

test('HUD health bars fall back to aggregate average when no selected ant', () => {
  const elements = installFakeDocument();

  updateHud({
    viewMode: 'SURFACE',
    tick: 1,
    ants: 4,
    workers: 4,
    soldiers: 0,
    foodStored: 0,
    fps: 60,
    digStatus: 'AUTO-DIG: OFF',
    pherStats: { maxFood: 0, maxHome: 0, avgFood: 0, avgHome: 0 },
    followingFood: 0,
    followingHome: 0,
    selectedAntHealth: null,
    antHealthStats: { min: 10, avg: 35, max: 70 },
  });

  assert.equal(elements.get('healthYellow').style.height, '35%');
});


test('HUD health stats tolerate partial/malformed aggregate payloads', () => {
  const elements = installFakeDocument();

  assert.doesNotThrow(() => {
    updateHud({
      viewMode: 'SURFACE',
      tick: 1,
      ants: 1,
      workers: 1,
      soldiers: 0,
      foodStored: 0,
      fps: 60,
      digStatus: 'AUTO-DIG: OFF',
      pherStats: { maxFood: 0, maxHome: 0, avgFood: 0, avgHome: 0 },
      followingFood: 0,
      followingHome: 0,
      selectedAntHealth: null,
      antHealthStats: { avg: 25 },
    });
  });

  assert.equal(elements.get('healthYellow').style.height, '25%');
  assert.equal(elements.get('healthBlack').style.height, '0%');
  assert.equal(elements.get('healthRed').style.height, '0%');
});
