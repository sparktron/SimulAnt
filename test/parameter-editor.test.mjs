import test from 'node:test';
import assert from 'node:assert/strict';
import { ParameterEditor } from '../src/ui/ParameterEditor.js';
import { parameterDefinitions } from '../src/ui/params.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.type = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this.value = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  dispatch(type) {
    const handler = this.listeners.get(type);
    if (handler) handler({ target: this });
  }
}

function findChild(element, predicate) {
  if (predicate(element)) return element;
  for (const child of element.children) {
    const found = findChild(child, predicate);
    if (found) return found;
  }
  return null;
}

test('ParameterEditor rejects malformed numeric input without writing NaN config', () => {
  const oldDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };

  try {
    let changeCount = 0;
    const editor = Object.create(ParameterEditor.prototype);
    editor.state = { config: { walkRho: 0.75 } };
    editor.onConfigChange = () => { changeCount += 1; };

    const parameterElement = editor.renderParameter({
      key: 'walkRho',
      label: 'Walk Rho',
      description: '',
      min: 0,
      max: 1,
      step: 0.05,
    });

    const numberInput = findChild(parameterElement, (el) => el.tagName === 'input' && el.type === 'number');
    const rangeInput = findChild(parameterElement, (el) => el.tagName === 'input' && el.type === 'range');
    assert.ok(numberInput, 'expected number input');
    assert.ok(rangeInput, 'expected range input');

    numberInput.value = '';
    numberInput.dispatch('input');

    assert.equal(editor.state.config.walkRho, 0.75);
    assert.equal(numberInput.value, 0.75);
    assert.equal(rangeInput.value, 0.75);
    assert.equal(changeCount, 0, 'blank input should not notify config changes');

    numberInput.value = '0.5abc';
    numberInput.dispatch('input');

    assert.equal(editor.state.config.walkRho, 0.75);
    assert.equal(numberInput.value, 0.75);
    assert.equal(rangeInput.value, 0.75);
    assert.equal(changeCount, 0, 'malformed input should not notify config changes');
  } finally {
    globalThis.document = oldDocument;
  }
});

test('ParameterEditor clamps valid numeric input and notifies config changes', () => {
  const oldDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };

  try {
    let changeCount = 0;
    const editor = Object.create(ParameterEditor.prototype);
    editor.state = { config: { walkRho: 0.75 } };
    editor.onConfigChange = () => { changeCount += 1; };

    const parameterElement = editor.renderParameter({
      key: 'walkRho',
      label: 'Walk Rho',
      description: '',
      min: 0,
      max: 1,
      step: 0.05,
    });

    const numberInput = findChild(parameterElement, (el) => el.tagName === 'input' && el.type === 'number');
    const rangeInput = findChild(parameterElement, (el) => el.tagName === 'input' && el.type === 'range');

    numberInput.value = '3';
    numberInput.dispatch('input');

    assert.equal(editor.state.config.walkRho, 1);
    assert.equal(numberInput.value, 1);
    assert.equal(rangeInput.value, 1);
    assert.equal(changeCount, 1);
  } finally {
    globalThis.document = oldDocument;
  }
});

test('ParameterEditor renders initial expanded parameter groups on first paint', () => {
  const oldDocument = globalThis.document;
  const oldLocalStorage = globalThis.localStorage;
  const container = new FakeElement('div');
  globalThis.localStorage = {
    getItem() { return null; },
    setItem() {},
  };
  globalThis.document = {
    querySelector(selector) {
      assert.equal(selector, '#parameterEditorContainer');
      return container;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };

  try {
    const editor = new ParameterEditor('#parameterEditorContainer', { config: {} }, () => {});

    assert.equal(editor.expandedGroups.has('Movement'), true);
    assert.equal(editor.expandedGroups.has('Decision-Making'), true);
    assert.ok(
      findChild(container, (el) => el.tagName === 'input' && el.type === 'range'),
      'initially expanded groups should render parameter sliders on first paint',
    );
  } finally {
    globalThis.document = oldDocument;
    if (oldLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldLocalStorage;
  }
});

test('ParameterEditor does not expose a duplicate soldier-allocation control', () => {
  assert.equal(
    Object.hasOwn(parameterDefinitions, 'soldierSpawnChance'),
    false,
    'the caste allocation triangle is the sole user-facing soldier-allocation control',
  );
});
