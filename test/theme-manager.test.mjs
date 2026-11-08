import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
async function setup(value, blocked = false) {
  const storage = new Map(value ? [['simulant-theme', value]] : []);
  const root = { dataset: {} };
  const link = { href: 'styles.css', getAttribute() { return this.href; }, setAttribute(_, value) { this.href = value; } };
  const select = {};
  globalThis.document = { documentElement: root, getElementById: id => id === 'themeStylesheet' ? link : id === 'themeSelect' ? select : null };
  globalThis.localStorage = {
    getItem(key) { if (blocked) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage unavailable'); storage.set(key, value); },
  };
  const manager = await import(`../src/ui/ThemeManager.js?test=${sequence++}`);
  return { manager, storage, root, link, select };
}
test('theme defaults, persistence, validation, and subscriptions', async () => {
  const { manager:m, storage, root, link, select } = await setup();
  assert.equal(m.getTheme(), 'classic');
  const calls = [];
  const unsubscribe = m.onThemeChange(name => calls.push(name));
  m.setTheme('retro');
  assert.equal(root.dataset.theme, 'retro');
  assert.equal(link.href, 'themes/retro.css');
  assert.equal(select.value, 'retro');
  assert.equal(storage.get('simulant-theme'), 'retro');
  m.setTheme('retro');
  assert.deepEqual(calls, ['retro']);
  assert.throws(() => m.setTheme('unknown'), RangeError);
  assert.throws(() => m.setTheme('__proto__'), RangeError);
  assert.equal(m.getTheme(), 'retro');
  unsubscribe(); m.setTheme('modern');
  assert.deepEqual(calls, ['retro']);
  assert.equal(storage.has('simant-save-v2'), false);
});
test('saved choice is restored, invalid choice defaults, and blocked storage is tolerated', async () => {
  assert.equal((await setup('modern')).manager.getTheme(), 'modern');
  assert.equal((await setup('unrecognized')).manager.getTheme(), 'classic');
  const { manager:m, root } = await setup('retro', true);
  assert.equal(m.getTheme(), 'classic');
  m.setTheme('modern');
  assert.equal(root.dataset.theme, 'modern');
});
