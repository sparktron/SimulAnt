import test from 'node:test';
import assert from 'node:assert/strict';
import { PresetManager } from '../src/ui/PresetManager.js';

test('PresetManager ignores valid JSON that is not a preset object', () => {
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { return 'null'; },
    setItem() {},
  };

  try {
    const manager = new PresetManager();
    assert.deepEqual(manager.getPresetNames(), []);
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test('PresetManager filters malformed entries from an otherwise valid store', () => {
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      return JSON.stringify({ Good: { antCap: 1200 }, Bad: null, AlsoBad: [] });
    },
    setItem() {},
  };

  try {
    const manager = new PresetManager();
    assert.deepEqual(manager.getPresetNames(), ['Good']);
    assert.deepEqual(manager.loadPreset('Good'), { antCap: 1200 });
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});
