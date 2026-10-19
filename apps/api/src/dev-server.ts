/*
 * Local API for development: in-memory store with the demo project.
 *   npm run dev -w apps/api      then point the web app at http://localhost:7071/api
 * With GRANTED_WWW=<folder of a web build made with VITE_API_BASE=/api> it also serves
 * the app at http://localhost:7071/, the same way the Function App does in Azure.
 */
import { createServer } from 'node:http';
import { createApi } from './app';
import { loadConfig } from './config';
import { createServices } from './container';
import { createStatic, isApiPath } from './static';

process.env.TZ = 'UTC';
const cfg = loadConfig(Object.assign({
  GRANTED_STORE: 'memory', GRANTED_SEED_DEMO: 'true', EXPOSE_CODES: 'true',
  SESSION_SECRET: 'dev-only-secret-dev-only-secret-dev-only-secret',
  ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost',
}, process.env));
const svc = await createServices(cfg, console.log);
const handle = createApi(svc, cfg, console.error);
const port = Number(process.env.PORT) || 7071;
const serveStatic = process.env.GRANTED_WWW ? createStatic(process.env.GRANTED_WWW) : null;
createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://x').pathname;
  if (serveStatic && !isApiPath(path)) {
    const r = await serveStatic(req.method || 'GET', path);
    res.writeHead(r.status, r.headers);
    res.end(r.body);
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
  const out = await handle({ method: req.method || 'GET', path, headers, body, ip: req.socket.remoteAddress || '' });
  res.writeHead(out.status, out.headers);
  res.end(out.body === undefined ? '' : JSON.stringify(out.body));
}).listen(port, () => console.log('Granted API (memory, demo data) on http://localhost:' + port + '/api'));
