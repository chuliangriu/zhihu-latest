import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalBackend } from './local-backend.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(root, 'hackathon.config.json'), 'utf8'));
const publicDir = path.join(root, 'public');
const origin = `http://${config.host}:${config.port}`;
let business;
try { business = createLocalBackend(origin); }
catch { console.error('Local backend unavailable: check server-side model configuration. No secrets were printed.'); }
const contentTypes = new Map([['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.woff', 'font/woff']]);

function headers(type = 'application/json; charset=utf-8') {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${config.host}:${config.port}`);
  if (request.method === 'GET' && url.pathname === '/api/health') {
    response.writeHead(200, headers());
    response.end(JSON.stringify({ ok: Boolean(business), project: config.projectName, oauthEnabled: false, localDevelopment: true, backendConnected: Boolean(business) }));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (business) { business(request, response); return; }
    response.writeHead(503, headers());
    response.end(JSON.stringify({ success: false, error: { code: 'LOCAL_BACKEND_UNAVAILABLE' } }));
    return;
  }
  if (request.method !== 'GET') {
    response.writeHead(405, headers());
    response.end(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(publicDir, path.normalize(requested));
  if (!filePath.startsWith(publicDir + path.sep) || !existsSync(filePath)) {
    response.writeHead(404, headers());
    response.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, headers(contentTypes.get(path.extname(filePath)) || 'application/octet-stream'));
    response.end(body);
  } catch {
    response.writeHead(404, headers());
    response.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
  }
});

server.listen(config.port, config.host, () => {
  process.stdout.write(`mvp-frontend: http://${config.host}:${config.port}/\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

