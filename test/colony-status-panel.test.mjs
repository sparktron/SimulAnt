import test from 'node:test';
import assert from 'node:assert/strict';
import { ColonyStatusPanel } from '../src/ui/ColonyStatusPanel.js';

function installDocument(ids = []) {
  const elements = new Map(ids.map((id) => [id, { id, addEventListener() {}, showModal() {}, close() {} }]));
  global.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    addEventListener() {},
  };
}

test('ColonyStatusPanel fails open when required DOM nodes are missing', () => {
  installDocument();

  assert.doesNotThrow(() => {
    const panel = new ColonyStatusPanel({
      initialState: {
        work: { wA: 0.4, wB: 0.3, wC: 0.3 },
        caste: { wA: 0.7, wB: 0.2, wC: 0.1 },
      },
      onWorkChange: () => {},
      onCasteChange: () => {},
    });

    assert.equal(panel.enabled, false);
    panel.sync({
      work: { forage: 50, dig: 30, nurse: 20 },
      caste: { workers: 70, soldiers: 20, breeders: 10 },
    });
  });
});
