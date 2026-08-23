import test from 'node:test';
import assert from 'node:assert/strict';
import { showPersistenceStatus } from '../src/ui/PersistenceStatus.js';

test('persistence status exposes visible success and failure messages', () => {
  const region = { textContent: '', dataset: {} };

  showPersistenceStatus(region, 'Simulation saved.');
  assert.equal(region.textContent, 'Simulation saved.');
  assert.equal(region.dataset.level, 'success');

  showPersistenceStatus(region, 'Save failed.', 'error');
  assert.equal(region.textContent, 'Save failed.');
  assert.equal(region.dataset.level, 'error');
});

test('persistence status normalizes unknown levels to notice', () => {
  const region = { textContent: '', dataset: {} };

  showPersistenceStatus(region, 'No saved simulation found.', 'unexpected');

  assert.equal(region.dataset.level, 'notice');
});

test('persistence status requires its aria-live region', () => {
  assert.throws(
    () => showPersistenceStatus(null, 'Simulation saved.'),
    /Persistence status region is required/,
  );
});
