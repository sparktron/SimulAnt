import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('index loads a swappable theme stylesheet and shared selector without inline CSS', () => {
  assert.match(indexHtml, /<link id="themeStylesheet" rel="stylesheet" href="styles\.css"\s*\/>/);
  assert.match(indexHtml, /href="themes\/switcher\.css"/);
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

test('core controls use readable text and touch-friendly target sizes', () => {
  assert.match(stylesheet, /\.palette-btn\s*{[^}]*min-height:\s*30px[^}]*font-size:\s*12px/s);
  assert.match(stylesheet, /\.param-label\s*{[^}]*font-size:\s*12px/s);
  assert.match(stylesheet, /\.param-help-icon\s*{[^}]*width:\s*24px[^}]*height:\s*24px[^}]*font-size:\s*12px/s);
  assert.match(stylesheet, /@media\s*\(pointer:\s*coarse\)\s*{[\s\S]*min-height:\s*44px/);
});

test('every registered theme sheet exists, keeps the base rules, and is listed in index.html', async () => {
  const { THEMES } = await import('../src/ui/ThemeManager.js');
  const sheetMap = indexHtml.match(/const sheets = (\{[^}]*\})/)[1];
  const options = [...indexHtml.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(options, Object.entries(THEMES).map(([name, theme]) => [name, theme.label]));
  for (const [name, { href }] of Object.entries(THEMES)) {
    assert.match(sheetMap, new RegExp(`${name}: '${href.replace('.', '\\.')}'`), `pre-paint map has ${name}`);
    const css = readFileSync(new URL(`../${href}`, import.meta.url), 'utf8');
    assert.match(css, /\.param-slider\b/, `${href} keeps parameter editor rules`);
    assert.match(css, /#simCanvas\s*{[^}]*width:\s*100%[^}]*height:\s*100%/s, `${href} keeps the canvas sizing rule`);
  }
});

test('90s Retro uses system fonts only; Realistic loads Barlow with a system fallback', () => {
  const nineties = readFileSync(new URL('../themes/nineties.css', import.meta.url), 'utf8');
  const realistic = readFileSync(new URL('../themes/realistic.css', import.meta.url), 'utf8');
  assert.doesNotMatch(nineties, /@import|@font-face|fonts\.googleapis/);
  assert.match(nineties, /Tahoma, 'MS Sans Serif', Geneva/);
  assert.match(realistic, /^@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Barlow/);
  assert.match(realistic, /--ui-font:'Barlow', 'Segoe UI', system-ui, sans-serif/);
});

test('the shared switcher only styles the classic selector for classic', () => {
  const switcher = readFileSync(new URL('../themes/switcher.css', import.meta.url), 'utf8');
  for (const name of ['modern', 'retro', 'nineties', 'realistic']) {
    assert.equal(switcher.split(`:not([data-theme='${name}'])`).length - 1, 2, `${name} excluded from classic-only rules`);
  }
});
