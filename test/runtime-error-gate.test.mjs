import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUnhandledRejectionReason, shouldReportFatalWindowError } from '../src/ui/runtimeErrorGate.js';

test('ignores resource load style window error events', () => {
  const event = {
    error: undefined,
    message: 'Script error.',
    target: { tagName: 'LINK' },
  };

  assert.equal(shouldReportFatalWindowError(event), false);
});

test('ignores message-only window errors with no runtime error object', () => {
  const event = {
    error: undefined,
    message: 'Script error.',
    target: globalThis,
  };

  assert.equal(shouldReportFatalWindowError(event), false);
});

test('reports fatal for uncaught script errors with Error object', () => {
  const event = {
    error: new Error('boom'),
    message: 'boom',
    target: globalThis,
  };

  assert.equal(shouldReportFatalWindowError(event), true);
});

test('normalizes rejection reasons to printable values', () => {
  assert.equal(normalizeUnhandledRejectionReason('bad'), 'bad');
  assert.equal(normalizeUnhandledRejectionReason(null), 'Unhandled promise rejection');
  assert.equal(typeof normalizeUnhandledRejectionReason({ code: 1 }), 'string');
});
