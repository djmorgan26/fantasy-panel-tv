// Zero-dependency static server for local development and screenshots.
// Serves web/ at /, the preview harness at /preview.html, and (only when
// ALLOW_LOCAL_CONFIG=1) your private config.local.json for live testing.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.env.ROOT || '.');
const PORT = Number(process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const DATA_HOSTS = new Set(['api.sleeper.app', 'lm-api-reads.fantasy.espn.com', 'site.api.espn.com']);

// Same allowlisted proxy the TV app implements natively.
async function proxy(target, res) {
  let u;
  try {
    u = new URL(target);
  } catch {
    return res.writeHead(400).end();
  }
  if (u.protocol !== 'https:' || !DATA_HOSTS.has(u.hostname)) return res.writeHead(403).end('host not allowed');
  const headers = { accept: 'application/json' };
  if (u.hostname.endsWith('espn.com') && process.env.ALLOW_LOCAL_CONFIG === '1') {
    try {
      const cfg = JSON.parse(await readFile(join(ROOT, 'config.local.json'), 'utf8'));
      const e = (cfg.espn || []).find((x) => x.espn_s2);
      if (e) headers.cookie = `espn_s2=${e.espn_s2}; SWID=${e.swid}`;
    } catch {
      /* no private cookies */
    }
  }
  try {
    const r = await fetch(u, { headers, signal: AbortSignal.timeout(20000) });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(502).end(String(e));
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/proxy') return proxy(url.searchParams.get('u'), res);
  let path = decodeURIComponent(url.pathname);
  let file;
  if (path === '/' || path === '') path = '/index.html';
  if (path === '/preview.html') file = join(ROOT, 'tools/preview/preview.html');
  else if (path === '/brand.html') file = join(ROOT, 'tools/brand/brand.html');
  else if (path === '/config.local.json') {
    if (process.env.ALLOW_LOCAL_CONFIG !== '1') return res.writeHead(404).end();
    file = join(ROOT, 'config.local.json');
  } else file = join(ROOT, 'web', normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '0.0.0.0', () => console.log(`fantasy panel on http://localhost:${PORT}  (preview: /preview.html?demo=1)`));
