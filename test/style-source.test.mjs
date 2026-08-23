import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('index loads the single external stylesheet without an inline style block', () => {
  assert.match(indexHtml, /<link rel="stylesheet" href="styles\.css"\s*\/>/);
  assert.doesNotMatch(indexHtml, /<style[\s>]/i);
});

test('external stylesheet contains styles used by the parameter editor', () => {
  assert.match(stylesheet, /\.param-slider\b/);
  assert.match(stylesheet, /\.parameter-editor\b/);
});

test('save and load feedback uses a visible polite live region', () => {
  assert.match(indexHtml, /id="persistenceStatus"/);
  assert.match(indexHtml, /role="status"/);
  assert.match(indexHtml, /aria-live="polite"/);
  assert.match(indexHtml, /aria-atomic="true"/);
  assert.match(stylesheet, /\.persistence-status\b/);
  assert.match(stylesheet, /\.persistence-status:empty\s*{[^}]*display:\s*none/s);
});
