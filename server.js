const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const VERBOSE = process.env.VERBOSE === '1';
const QUIET = process.env.QUIET === '1';

/**
 * Resolves a request URL to a safe file path inside `root`.
 *
 * Strips the query/hash, percent-decodes, and rejects anything that escapes
 * `root` (path traversal) or is a malformed encoding. Returns either
 * `{ filePath }` or `{ status }` (400 bad request / 403 forbidden) so the
 * handler can respond without ever touching a path outside the served folder.
 */
function resolveSafePath(root, rawUrl) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(String(rawUrl).split('?')[0].split('#')[0]);
  } catch {
    return { status: 400 }; // malformed percent-encoding, e.g. "/%"
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.join(root, urlPath);
  const relative = path.relative(root, filePath);

  // relative starting with ".." (or absolute) means filePath escaped root;
  // an empty relative means it resolved to root itself (a directory).
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { status: 403 };
  }

  return { filePath };
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath)) {
    case '.js': return 'application/javascript';
    case '.css': return 'text/css';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'text/html';
  }
}

const server = http.createServer((req, res) => {
  const resolved = resolveSafePath(__dirname, req.url);

  if (resolved.status) {
    const message = resolved.status === 400 ? '400 - Bad Request\n' : '403 - Forbidden\n';
    res.writeHead(resolved.status, { 'Content-Type': 'text/plain' });
    res.end(message);
    if (!QUIET) console.log(`  ${resolved.status}  ${req.method} ${req.url}`);
    return;
  }

  const { filePath } = resolved;

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 - File Not Found\n');
      if (!QUIET) console.log(`  404  ${req.method} ${req.url}`);
    } else {
      res.writeHead(200, {
        'Content-Type': contentTypeFor(filePath),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(content);
      // Per-request 200 logs are quiet by default — the page loads ~30 files
      // on startup which buries anything else. Set VERBOSE=1 to see them.
      if (VERBOSE && !QUIET) console.log(`  200  ${req.method} ${req.url}`);
    }
  });
});

// Only bind the port when run directly (node server.js); importing the module
// for tests must not start a listener.
if (require.main === module) {
  server.listen(PORT, () => {
    const banner = [
      '',
      '  SimulAnt dev server is running.',
      '',
      `    Open:    http://localhost:${PORT}`,
      '    Stop:    Ctrl+C',
      '    Caching: disabled (every request bypasses browser cache)',
      '',
      `  Logging: 404s always, 200s only when VERBOSE=1 (currently ${VERBOSE ? 'on' : 'off'}). QUIET=1 silences everything.`,
      '',
    ].join('\n');
    console.log(banner);
  });
}

module.exports = { resolveSafePath, contentTypeFor };
