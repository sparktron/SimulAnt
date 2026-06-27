import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { getDefaultConfig } from '../src/ui/params.js';
import { sanitizeTickConfig } from '../src/sim/core/SimulationTypes.js';

// Phase 0 — config integrity. These tests make the three sources of truth for
// simulation config agree, so headless A/B experiments (the whole pheromone
// tuning methodology) cannot silently run different physics than the game:
//   1. getDefaultConfig()  — the parameter-editor + sweep surface
//   2. main.js `config`    — the live runtime config (checked by config-defaults)
//   3. sanitizeTickConfig  — the per-tick NaN/range firewall
// See docs/pheromone-strategy.md and the Phase 0 review.

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

// Files that DECLARE config rather than CONSUME it. Excluded from "is this key
// actually read by logic?" scans so a key that only appears as a default or a
// sanitizer pass-through still counts as unwired.
const DECLARATION_FILES = ['ui/params.js', 'main.js', 'sim/core/SimulationTypes.js'];

function walkJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.claude') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkJsFiles(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

// Strip block and line comments so a key mentioned only in prose ("momentumBias
// is hardcoded to 0") is never mistaken for a live consumption.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const SRC_FILES = walkJsFiles(SRC_DIR);
const CODE_BY_FILE = new Map(SRC_FILES.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

function isDeclarationFile(file) {
  return DECLARATION_FILES.some((d) => file.endsWith(d));
}

// A default key is "wired" if its bare identifier appears in any non-declaration
// source file after comments are stripped. Bare-identifier matching is robust to
// destructuring ({ x } = config) and renamed receivers (safeConfig.x).
function isWired(key) {
  const re = new RegExp(`\\b${key}\\b`);
  for (const [file, code] of CODE_BY_FILE) {
    if (isDeclarationFile(file)) continue;
    if (re.test(code)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test 1: No invisible knobs. Every parameter read with an inline `config.X ??`
// fallback must also exist in getDefaultConfig, otherwise it cannot be tuned in
// the editor or swept in a headless run — the experiment never moves it.
// ---------------------------------------------------------------------------
test('every code-only `config.X ?? default` knob is exposed in getDefaultConfig', () => {
  const defaults = getDefaultConfig();
  const knobRe = /config\.([A-Za-z_][A-Za-z0-9_]*)\s*\?\?/g;
  const knobs = new Set();
  for (const [file, code] of CODE_BY_FILE) {
    // The sanitizer is the guard layer, not a consumer — its own `?? fallbacks`
    // are the firewall, not tunable knobs.
    if (file.endsWith('sim/core/SimulationTypes.js')) continue;
    let m;
    while ((m = knobRe.exec(code)) !== null) knobs.add(m[1]);
  }

  const missing = [...knobs].filter((k) => !(k in defaults)).sort();
  assert.deepEqual(
    missing,
    [],
    'Invisible knobs (read with a "config.X ?? fallback" but absent from getDefaultConfig): '
      + `${missing.join(', ')}. Add them to getDefaultConfig + main.js so they are tunable/sweepable.`,
  );
});

// ---------------------------------------------------------------------------
// Test 2: Dead-param registry. Every key in getDefaultConfig that is read
// nowhere in logic must be listed (with a reason) in KNOWN_UNWIRED. The check is
// bidirectional, so the registry self-cleans: adding a new orphan fails until
// it is justified or removed, and re-wiring (or deleting) a listed key fails
// until it is taken off the list. Prevents silent config rot that wastes
// experiments (see docs/pheromone-strategy.md).
// ---------------------------------------------------------------------------
const KNOWN_UNWIRED = {
  // Vestigial economy knobs that were never implemented.
  digChance: 'never implemented; candidate for removal',
  digEnergyCost: 'never implemented; candidate for removal',
  foodPickupRate: 'never implemented; candidate for removal',
  // Superseded behaviors.
  soldierSpawnChance: 'brood soldier path reworked; knob no longer read',
  randomTurnChance: 'superseded by the correlated random walk (walk* params)',
  momentumBias: 'stubbed to 0 in steering.js; re-wiring is a steering experiment',
  foodTrailDecayPerStep: 'superseded by adaptive recruitment decay (recruitDecayPerStep)',
  // Debug instrumentation that was removed from the steering path.
  debugSteeringContributions: 'steering debug path removed; knob no longer read',
  debugSteeringLogIntervalTicks: 'steering debug path removed; knob no longer read',
};

test('every orphaned default is registered in KNOWN_UNWIRED (and vice versa)', () => {
  const defaults = getDefaultConfig();
  const detectedDead = Object.keys(defaults).filter((k) => !isWired(k)).sort();
  const registered = Object.keys(KNOWN_UNWIRED).sort();

  const unregisteredDead = detectedDead.filter((k) => !(k in KNOWN_UNWIRED));
  assert.deepEqual(
    unregisteredDead,
    [],
    `New orphaned defaults (read nowhere in logic) — wire them up or add to KNOWN_UNWIRED with a reason: `
      + `${unregisteredDead.join(', ')}`,
  );

  const staleRegistry = registered.filter((k) => !detectedDead.includes(k));
  assert.deepEqual(
    staleRegistry,
    [],
    `KNOWN_UNWIRED lists keys that are now wired (or removed) — drop them from the registry: `
      + `${staleRegistry.join(', ')}`,
  );
});

// ---------------------------------------------------------------------------
// Test 3: sanitize(getDefaultConfig()) is the identity. Every shipped default
// must survive its own clamp unchanged; if a default ever drifts outside the
// sanitizer's range the game would silently run a capped value instead of the
// configured one. This is the real guard against the "headingBias documented as
// 0.20 but shipped as 0.40"-class drift.
// ---------------------------------------------------------------------------
test('sanitizeTickConfig leaves every shipped default unchanged', () => {
  const defaults = getDefaultConfig();
  const sanitized = sanitizeTickConfig(defaults);
  const drifted = [];
  for (const key of Object.keys(defaults)) {
    if (sanitized[key] !== defaults[key]) {
      drifted.push(`${key}: default=${defaults[key]} -> sanitized=${sanitized[key]}`);
    }
  }
  assert.deepEqual(
    drifted,
    [],
    `Defaults clamped by sanitizeTickConfig (a default sits outside its own range): ${drifted.join('; ')}`,
  );
});

// ---------------------------------------------------------------------------
// Test 4: Canonical merge integrity. The sanitizer fallbacks are intentionally
// inert (evaporation->0, deposits->0) — a "don't crash on a missing key" tier,
// NOT gameplay defaults. So a harness that builds a PARTIAL config gets inert
// physics for omitted keys. The supported pattern is to start from a full
// getDefaultConfig() and spread overrides on top. This test pins that pattern:
// in-range overrides survive sanitize, and untouched keys keep their defaults.
// ---------------------------------------------------------------------------
test('sanitize({ ...getDefaultConfig(), ...overrides }) preserves overrides and defaults', () => {
  const defaults = getDefaultConfig();
  const overrides = {
    enablePheromones: false,
    evapFood: 0.5,
    followBeta: 6.0,
    foodVisionRadius: 24,
    headingBias: 0.25,
    trailGravitationMax: 5.0,
  };
  const sanitized = sanitizeTickConfig({ ...defaults, ...overrides });

  for (const [key, value] of Object.entries(overrides)) {
    assert.equal(sanitized[key], value, `override ${key} should survive sanitize`);
  }
  // An untouched key keeps the real gameplay default — not the inert fallback.
  assert.equal(sanitized.depositFood, defaults.depositFood, 'untouched key keeps its default');
  assert.equal(sanitized.evapHome, defaults.evapHome, 'untouched key keeps its default');
});
