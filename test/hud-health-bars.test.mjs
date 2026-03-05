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
    nurses: 2,
    jobsForage: 4,
    jobsDig: 1,
    jobsNurse: 2,
    foodStored: 20,
    queenHealth: 88.5,
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
  assert.equal(elements.get('hudNurses').textContent, '2');
  assert.equal(elements.get('hudJobs').textContent, '4 / 1 / 2');
  assert.equal(elements.get('hudQueenHealth').textContent, '88.5');
});

test('HUD health bars fall back to aggregate average when no selected ant', () => {
  const elements = installFakeDocument();

  updateHud({
    viewMode: 'SURFACE',
    tick: 1,
    ants: 4,
    workers: 4,
    soldiers: 0,
    nurses: 1,
    jobsForage: 2,
    jobsDig: 1,
    jobsNurse: 1,
    foodStored: 0,
    queenHealth: 100,
    fps: 60,
    digStatus: 'AUTO-DIG: OFF',
    pherStats: { maxFood: 0, maxHome: 0, avgFood: 0, avgHome: 0 },
    followingFood: 0,
    followingHome: 0,
    selectedAntHealth: null,
    antHealthStats: { min: 10, avg: 35, max: 70 },
  });

  assert.equal(elements.get('healthYellow').style.height, '35%');
  assert.equal(elements.get('hudNurses').textContent, '1');
  assert.equal(elements.get('hudJobs').textContent, '2 / 1 / 1');
  assert.equal(elements.get('hudQueenHealth').textContent, '100.0');
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
      nurses: 0,
      jobsForage: 1,
      jobsDig: 0,
      jobsNurse: 0,
      foodStored: 0,
      queenHealth: 0,
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


test('HUD jobs fall back to worker totals when producer omits job fields', () => {
  const elements = installFakeDocument();

  updateHud({
    viewMode: 'SURFACE',
    tick: 1,
    ants: 5,
    workers: 5,
    soldiers: 0,
    foodStored: 2,
    queenHealth: 77,
    fps: 60,
    digStatus: 'AUTO-DIG: OFF',
    pherStats: { maxFood: 0, maxHome: 0, avgFood: 0, avgHome: 0 },
    followingFood: 0,
    followingHome: 0,
    selectedAntHealth: null,
    antHealthStats: { min: 10, avg: 35, max: 70 },
  });

  assert.equal(elements.get('hudJobs').textContent, '5 / 0 / 0');
  assert.equal(elements.get('hudNurses').textContent, '0');
  assert.equal(elements.get('hudFood').textContent, '2.0');
  assert.equal(elements.get('hudQueenHealth').textContent, '77.0');
});


test('HUD jobs self-heal when workers are non-zero but producer sends all-zero jobs', () => {
  const elements = installFakeDocument();

  updateHud({
    viewMode: 'SURFACE',
    tick: 1,
    ants: 12,
    workers: 9,
    soldiers: 3,
    nurses: 0,
    jobsForage: 0,
    jobsDig: 0,
    jobsNurse: 0,
    foodStored: 1,
    queenHealth: 90,
    fps: 60,
    digStatus: 'AUTO-DIG: OFF',
    pherStats: { maxFood: 0, maxHome: 0, avgFood: 0, avgHome: 0 },
    followingFood: 0,
    followingHome: 0,
    selectedAntHealth: null,
    antHealthStats: { min: 10, avg: 35, max: 70 },
  });

  assert.equal(elements.get('hudJobs').textContent, '9 / 0 / 0');
  assert.equal(elements.get('hudNurses').textContent, '0');
});
