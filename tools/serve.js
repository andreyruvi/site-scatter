/**
 * A static server for local development.
 *
 * This exists because the page uses ES modules, and a browser refuses to load
 * a module over `file://` — opening index.html by double-clicking it gives a
 * CORS error and a blank page. Thirty lines of `node:http` is cheaper than a
 * dependency, and it keeps the project's zero-dependency promise honest.
 *
 *   node tools/serve.js  →  http://localhost:8080
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (request, response) => {
  const path = decodeURIComponent(request.url.split('?')[0]);
  // normalize() plus the leading-dots strip keeps a request inside the project.
  const relative = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, relative);

  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`Not found: ${relative}`);
  }
}).listen(PORT, () => {
  process.stdout.write(`Site Scatter on http://localhost:${PORT}\n`);
});
