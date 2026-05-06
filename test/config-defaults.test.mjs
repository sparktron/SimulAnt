import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDefaultConfig } from '../src/ui/params.js';

function parseLiteral(value) {
  const trimmed = value.trim();
  if (trimmed === 'SIM_DT') return 1 / 30;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return Number(trimmed);
}

function getRuntimeConfigDefaults() {
  const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const configBlock = mainSource.match(/config:\s*\{([\s\S]*?)\n  \},\n  casteTargets:/)?.[1];
  assert.ok(configBlock, 'runtime config block should be parseable');

  const runtimeDefaults = {};
  const seenKeys = new Set();
  for (const line of configBlock.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+):\s*([^,/]+)(?:,|\s)/);
    if (!match) continue;

    const [, key, rawValue] = match;
    assert.equal(seenKeys.has(key), false, `runtime config should define ${key} once`);
    seenKeys.add(key);
    runtimeDefaults[key] = parseLiteral(rawValue);
  }

  return runtimeDefaults;
}

test('parameter editor defaults match runtime config defaults', () => {
  const runtimeDefaults = getRuntimeConfigDefaults();
  const editorDefaults = getDefaultConfig();

  for (const [key, runtimeDefault] of Object.entries(runtimeDefaults)) {
    assert.equal(
      editorDefaults[key],
      runtimeDefault,
      `default mismatch for ${key}`,
    );
  }
});
