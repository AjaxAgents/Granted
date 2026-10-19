/*
 * Serves the web app from the same Function App as the API, so one Azure
 * resource (one URL) is the whole of Granted:
 *
 *   https://<app>.azurewebsites.net/          the app
 *   https://<app>.azurewebsites.net/api/...   the API
 *
 * Files come from the `www` folder in the deployment package (the built web
 * app, built with VITE_API_BASE=/api). Paths are normalised and kept inside
 * that folder; anything that isn't a file falls back to index.html.
 */
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

export interface StaticResponse { status: number; headers: Record<string, string>; body?: Buffer }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

/** Same policy as the web app's own meta tag: only this site, no inline script, no framing. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), geolocation=(), microphone=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function createStatic(root: string) {
  const base = resolve(root);
  const cache = new Map<string, Buffer>();

  async function file(rel: string): Promise<Buffer | null> {
    const full = resolve(base, rel);
    if (full !== base && !full.startsWith(base + sep)) return null; // never outside www
    if (cache.has(full)) return cache.get(full) as Buffer;
    try {
      const s = await stat(full);
      if (!s.isFile()) return null;
      const buf = await readFile(full);
      if (buf.length < 2 * 1024 * 1024) cache.set(full, buf);
      return buf;
    } catch { return null; }
  }

  return async function serve(method: string, urlPath: string): Promise<StaticResponse> {
    if (method !== 'GET' && method !== 'HEAD') return { status: 405, headers: { Allow: 'GET, HEAD', ...SECURITY_HEADERS } };
    let p: string;
    try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return { status: 400, headers: SECURITY_HEADERS }; }
    if (p.includes('\0')) return { status: 400, headers: SECURITY_HEADERS };
    p = normalize(p).replace(/\\/g, '/').replace(/^\/+/, '');
    if (p === '' || p.endsWith('/')) p += 'index.html';
    if (p.split('/').some((seg) => seg.startsWith('.'))) return notFound(); // no dotfiles, no ..

    let body = await file(join(...p.split('/')));
    let name = p;
    // App routes (no file extension) get the app itself.
    if (!body && !extname(p)) { body = await file('index.html'); name = 'index.html'; }
    if (!body) return notFound();

    const type = TYPES[extname(name).toLowerCase()] || 'application/octet-stream';
    const immutable = name.startsWith('assets/'); // Vite puts a content hash in every file name there
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SECURITY_HEADERS,
    };
    return { status: 200, headers, body: method === 'HEAD' ? undefined : body };
  };

  function notFound(): StaticResponse {
    return { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }, body: Buffer.from('Not found') };
  }
}

/** True for paths the API answers; everything else is the web app. */
export const isApiPath = (path: string) => path === '/api' || path.startsWith('/api/');
