import test from 'node:test';
import assert from 'node:assert/strict';
import { syncControlState } from '../src/ui/controls.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

function fakeElement(value = '') {
  return {
    value,
    checked: false,
    disabled: false,
    textContent: '',
    classList: new FakeClassList(),
    attributes: new Map(),
    setAttribute(name, nextValue) {
      this.attributes.set(name, String(nextValue));
    },
  };
}

test('syncControlState restores sliders, toggles, selected tool, and view availability', () => {
  const oldDocument = globalThis.document;
  const elements = new Map([
    ['startPauseBtn', fakeElement()],
    ['speedSlider', fakeElement()],
    ['speedLabel', fakeElement()],
    ['brushSlider', fakeElement()],
    ['brushLabel', fakeElement()],
    ['antCapSlider', fakeElement()],
    ['antCapLabel', fakeElement()],
    ['scentBtn', fakeElement()],
    ['jobsBtn', fakeElement()],
    ['pheromoneBtn', fakeElement()],
    ['jobLegend', fakeElement()],
  ]);
  const radios = ['food', 'wall', 'water', 'hazard', 'erase', 'dig', 'fill'].map((value) => {
    const radio = fakeElement(value);
    const label = fakeElement();
    radio.closest = () => label;
    return radio;
  });

  globalThis.document = {
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll(selector) {
      return selector === 'input[name="tool"]' ? radios : [];
    },
    querySelector(selector) {
      const match = selector.match(/value="([^"]+)"/);
      return radios.find((radio) => radio.value === match?.[1]) || null;
    },
  };

  try {
    syncControlState({
      paused: true,
      simSpeed: 2.5,
      brushRadius: 7,
      selectedTool: 'dig',
      overlays: { showScent: false, showAntJobs: true },
      config: { antCap: 1400, enablePheromones: false },
    }, 'NEST');

    assert.equal(elements.get('startPauseBtn').textContent, 'START');
    assert.equal(elements.get('speedLabel').textContent, '2.5x');
    assert.equal(elements.get('brushLabel').textContent, '7');
    assert.equal(elements.get('antCapLabel').textContent, '1400');
    assert.equal(elements.get('scentBtn').textContent, 'SCENT: OFF');
    assert.equal(elements.get('scentBtn').disabled, true);
    assert.equal(elements.get('jobsBtn').textContent, 'JOBS: ON');
    assert.equal(elements.get('pheromoneBtn').textContent, 'PHERO: OFF');
    assert.equal(elements.get('jobLegend').classList.contains('active'), true);
    assert.equal(radios.find((radio) => radio.value === 'dig').checked, true);
    assert.equal(radios.find((radio) => radio.value === 'food').disabled, true);
    assert.equal(radios.find((radio) => radio.value === 'dig').disabled, false);
  } finally {
    globalThis.document = oldDocument;
  }
});
