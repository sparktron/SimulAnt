import test from 'node:test';
import assert from 'node:assert/strict';
import { TriangleControl } from '../src/ui/TriangleControl.js';

class FakeElement {
  constructor() {
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.className = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  setPointerCapture() {}

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 180, height: 160 };
  }
}

test('TriangleControl supports keyboard adjustment and cancels pointer drags', () => {
  const oldDocument = globalThis.document;
  globalThis.document = {
    createElement() { return new FakeElement(); },
    createElementNS() { return new FakeElement(); },
  };

  try {
    const container = new FakeElement();
    const changes = [];
    const control = new TriangleControl({
      container,
      title: 'WORK ALLOCATION',
      labels: ['Forage', 'Dig', 'Nurse'],
      initialWeights: { wA: 0.5, wB: 0.25, wC: 0.25 },
      onChange: (value) => changes.push(value),
    });

    const beforeX = control.currentPoint.x;
    let prevented = false;
    control.svg.listeners.get('keydown')({
      key: 'ArrowRight',
      preventDefault() { prevented = true; },
    });

    assert.equal(prevented, true);
    assert.ok(control.currentPoint.x > beforeX);
    assert.match(control.svg.getAttribute('aria-valuetext'), /Forage \d+%/);
    assert.ok(changes.length >= 2, 'initialization and keyboard input should notify listeners');

    control.dragging = true;
    control.svg.listeners.get('pointercancel')();
    assert.equal(control.dragging, false);
  } finally {
    globalThis.document = oldDocument;
  }
});
