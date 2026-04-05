import test from 'node:test';
import assert from 'node:assert/strict';
import { SeededRng } from '../src/sim/rng.js';

// --- Determinism ---

test('same seed produces same sequence', () => {
  const rng1 = new SeededRng('test-seed');
  const rng2 = new SeededRng('test-seed');

  for (let i = 0; i < 100; i += 1) {
    assert.equal(rng1.next(), rng2.next());
  }
});

test('different seeds produce different sequences', () => {
  const rng1 = new SeededRng('seed-a');
  const rng2 = new SeededRng('seed-b');

  let same = true;
  for (let i = 0; i < 10; i += 1) {
    if (rng1.next() !== rng2.next()) {
      same = false;
      break;
    }
  }
  assert.ok(!same, 'Different seeds should produce different values');
});

// --- Range ---

test('next returns values in [0, 1)', () => {
  const rng = new SeededRng('range-test');
  for (let i = 0; i < 1000; i += 1) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `next() should be in [0,1), got ${v}`);
  }
});

test('range returns values within specified bounds', () => {
  const rng = new SeededRng('range-bounds');
  for (let i = 0; i < 500; i += 1) {
    const v = rng.range(5, 10);
    assert.ok(v >= 5 && v < 10, `range(5,10) should be in [5,10), got ${v}`);
  }
});

test('int returns non-negative integers below max', () => {
  const rng = new SeededRng('int-test');
  for (let i = 0; i < 500; i += 1) {
    const v = rng.int(8);
    assert.ok(Number.isInteger(v), `int() should return integer, got ${v}`);
    assert.ok(v >= 0 && v < 8, `int(8) should be in [0,8), got ${v}`);
  }
});

// --- Chance ---

test('chance with 0 always returns false', () => {
  const rng = new SeededRng('chance-zero');
  for (let i = 0; i < 100; i += 1) {
    assert.equal(rng.chance(0), false);
  }
});

test('chance with 1 always returns true', () => {
  const rng = new SeededRng('chance-one');
  for (let i = 0; i < 100; i += 1) {
    assert.equal(rng.chance(1), true);
  }
});

test('chance produces roughly expected distribution', () => {
  const rng = new SeededRng('chance-dist');
  let trueCount = 0;
  const trials = 10000;
  const probability = 0.3;

  for (let i = 0; i < trials; i += 1) {
    if (rng.chance(probability)) trueCount += 1;
  }

  const ratio = trueCount / trials;
  assert.ok(Math.abs(ratio - probability) < 0.05,
    `Expected ~${probability}, got ${ratio}`);
});

// --- Reseed ---

test('reseed resets sequence', () => {
  const rng = new SeededRng('reseed-test');
  const first = [];
  for (let i = 0; i < 5; i += 1) first.push(rng.next());

  rng.reseed('reseed-test');
  for (let i = 0; i < 5; i += 1) {
    assert.equal(rng.next(), first[i]);
  }
});

// --- Edge Cases ---

test('empty string seed works', () => {
  const rng = new SeededRng('');
  const v = rng.next();
  assert.ok(Number.isFinite(v));
});

test('numeric seed works', () => {
  const rng = new SeededRng(12345);
  const v = rng.next();
  assert.ok(Number.isFinite(v));
});
