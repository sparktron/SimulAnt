const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const VERBOSE = process.env.VERBOSE === '1';
const QUIET = process.env.QUIET === '1';

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const extname = path.extname(filePath);

  let contentType = 'text/html';
  if (extname === '.js') contentType = 'application/javascript';
  else if (extname === '.css') contentType = 'text/css';
  else if (extname === '.json') contentType = 'application/json';
  else if (extname === '.png') contentType = 'image/png';
  else if (extname === '.jpg' || extname === '.jpeg') contentType = 'image/jpeg';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 - File Not Found\n');
      if (!QUIET) console.log(`  404  ${req.method} ${req.url}`);
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
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
