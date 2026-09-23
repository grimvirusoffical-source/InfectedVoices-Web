import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const voicesRoot = path.resolve(root, 'voices');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json'
};

function inside(parent, target) {
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return target === parent || target.startsWith(prefix);
}

async function statFile(file) {
  try {
    const stat = await fs.stat(file);
    return stat;
  } catch {
    return null;
  }
}

async function resolveRequest(pathname) {
  if (pathname === '/' || pathname === '/index.html') return { file: path.join(root, 'index.html') };
  if (pathname === '/get' || pathname === '/get/' || pathname === '/get/index.html') {
    return { file: path.join(root, 'get', 'index.html') };
  }
  if (pathname === '/download' || pathname === '/download/' || pathname === '/download/index.html') {
    return { file: path.join(root, 'download', 'index.html') };
  }
  if (pathname === '/voices') return { redirect: '/voices/' };
  if (!pathname.startsWith('/voices/')) return { missing: true };

  const rel = decodeURIComponent(pathname.slice('/voices/'.length));
  if (rel.includes('\0')) return { missing: true };
  const target = path.resolve(voicesRoot, rel);
  if (!inside(voicesRoot, target)) return { missing: true };

  const stat = await statFile(target);
  if (stat?.isDirectory()) {
    if (!pathname.endsWith('/')) return { redirect: pathname + '/' };
    const index = path.join(target, 'index.html');
    if (await statFile(index)) return { file: index };
    return { missing: true };
  }
  if (stat?.isFile()) return { file: target };
  if (!path.extname(target)) {
    const html = target + '.html';
    if ((await statFile(html))?.isFile()) return { file: html };
    const asDir = await statFile(target);
    if (asDir?.isDirectory()) return { redirect: pathname + '/' };
  }
  return { missing: true };
}

function sendJson(res, status, data, method) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/me') {
      sendJson(res, 200, { user: null, csrf: '' }, req.method);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'InfectedVoices', host: 'web-shell' }, req.method);
      return;
    }
    sendJson(res, 404, { error: 'Not found.' }, req.method);
    return;
  }
  let resolved;
  try {
    resolved = await resolveRequest(url.pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request.');
    return;
  }
  if (resolved.redirect) {
    res.writeHead(302, { location: resolved.redirect });
    res.end();
    return;
  }
  if (!resolved.file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found.');
    return;
  }
  const body = await fs.readFile(resolved.file);
  const type = TYPES[path.extname(resolved.file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
});

server.listen(port, host, () => {
  console.log(`Infected Voices web shell on http://${host}:${port}`);
});
