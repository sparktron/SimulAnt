export const THEMES = Object.freeze({
  classic: Object.freeze({ label: 'Classic', href: 'styles.css' }),
  retro: Object.freeze({ label: 'Retro Polished', href: 'themes/retro.css' }),
  modern: Object.freeze({ label: 'Modern Sleek', href: 'themes/modern.css' }),
});
const STORAGE_KEY = 'simulant-theme';
const listeners = new Set();
function savedTheme() {
  try { const value = globalThis.localStorage?.getItem(STORAGE_KEY); return Object.hasOwn(THEMES, value) ? value : 'classic'; }
  catch { return 'classic'; }
}
let current = savedTheme();
let retainedStylesheet = null;
export function getTheme() { return current; }
export function setTheme(name) {
  if (!Object.hasOwn(THEMES, name)) throw new RangeError(`Unknown theme: ${name}`);
  const changed = name !== current;
  current = name;
  const doc = globalThis.document;
  if (doc) {
    doc.documentElement.dataset.theme = name;
    const link = doc.getElementById('themeStylesheet');
    if (link && link.getAttribute('href') !== THEMES[name].href) {
      // Keep the last applied sheet visible while @import/fonts resolve.
      // One retained sheet also handles rapid switches before a load completes.
      if (!retainedStylesheet && link.sheet && link.cloneNode) {
        retainedStylesheet = link.cloneNode();
        retainedStylesheet.removeAttribute('id');
        link.before(retainedStylesheet);
      }
      link.addEventListener?.('load', () => {
        retainedStylesheet?.remove();
        retainedStylesheet = null;
      }, { once: true });
      link.setAttribute('href', THEMES[name].href);
    }
    const select = doc.getElementById('themeSelect');
    if (select) select.value = name;
  }
  try { globalThis.localStorage?.setItem(STORAGE_KEY, name); } catch { /* Themes still work when storage is unavailable. */ }
  if (changed) for (const fn of listeners) fn(name);
}
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
