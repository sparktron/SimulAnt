import test from 'node:test';
import assert from 'node:assert/strict';
import { supportsNativeDialog, tryOpenNativeDialog } from '../src/ui/ColonyStatusPanel.js';

test('supportsNativeDialog detects dialog API by shape', () => {
  assert.equal(supportsNativeDialog({}), false);
  assert.equal(supportsNativeDialog({ showModal() {}, close() {} }), true);
});

test('tryOpenNativeDialog returns true when showModal opens dialog', () => {
  const dialog = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };

  assert.equal(tryOpenNativeDialog(dialog), true);
  assert.equal(dialog.open, true);
});

test('tryOpenNativeDialog returns false when showModal throws', () => {
  const dialog = {
    open: false,
    showModal() {
      throw new Error('unsupported');
    },
    close() {
      this.open = false;
    },
  };

  assert.equal(tryOpenNativeDialog(dialog), false);
  assert.equal(dialog.open, false);
});
