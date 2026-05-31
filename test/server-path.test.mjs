import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveSafePath, contentTypeFor } from '../server.js';

const ROOT = path.sep === '\\' ? 'C:\\srv\\app' : '/srv/app';

test('serves index.html for the root path', () => {
  const r = resolveSafePath(ROOT, '/');
  assert.equal(r.status, undefined);
  assert.ok(r.filePath.endsWith(`${path.sep}index.html`));
});

test('serves normal in-root files', () => {
  const r = resolveSafePath(ROOT, '/src/main.js');
  assert.equal(r.status, undefined);
  assert.ok(r.filePath.startsWith(ROOT + path.sep));
  assert.ok(r.filePath.endsWith(`${path.sep}main.js`));
});

test('strips query string before resolving', () => {
  const r = resolveSafePath(ROOT, '/index.html?v=123');
  assert.equal(r.status, undefined);
  assert.ok(r.filePath.endsWith(`${path.sep}index.html`));
});

test('rejects raw .. path traversal with 403', () => {
  const r = resolveSafePath(ROOT, '/../../../etc/passwd');
  assert.equal(r.status, 403);
  assert.equal(r.filePath, undefined);
});

test('rejects percent-encoded path traversal with 403', () => {
  for (const url of ['/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc/passwd']) {
    const r = resolveSafePath(ROOT, url);
    assert.equal(r.status, 403, `expected 403 for ${url}`);
  }
});

test('rejects malformed percent-encoding with 400', () => {
  const r = resolveSafePath(ROOT, '/%');
  assert.equal(r.status, 400);
});

test('a resolved file path never escapes the root', () => {
  const attacks = ['/../secrets', '/a/../../b', '/%2e%2e/x', '/./../../y'];
  for (const url of attacks) {
    const r = resolveSafePath(ROOT, url);
    if (!r.status) {
      assert.ok(
        r.filePath.startsWith(ROOT + path.sep),
        `${url} resolved to ${r.filePath}, which is outside ${ROOT}`,
      );
    }
  }
});

test('contentTypeFor maps extensions correctly', () => {
  assert.equal(contentTypeFor('/a/main.js'), 'application/javascript');
  assert.equal(contentTypeFor('/a/styles.css'), 'text/css');
  assert.equal(contentTypeFor('/a/data.json'), 'application/json');
  assert.equal(contentTypeFor('/a/pic.png'), 'image/png');
  assert.equal(contentTypeFor('/a/index.html'), 'text/html');
  assert.equal(contentTypeFor('/a/noext'), 'text/html');
});
