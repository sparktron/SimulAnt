import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDefaultConfig } from '../src/ui/params.js';

test('parameter editor defaults match runtime maxFoodTrailScale default', () => {
  const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const matches = [...mainSource.matchAll(/maxFoodTrailScale:\s*([0-9.]+)/g)];

  assert.equal(matches.length, 1, 'runtime config should define maxFoodTrailScale once');
  const runtimeDefault = Number(matches[0][1]);

  assert.equal(runtimeDefault, 4.0);
  assert.equal(getDefaultConfig().maxFoodTrailScale, runtimeDefault);
});
