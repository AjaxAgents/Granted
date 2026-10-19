/*
 * Azure Functions entry point (Node.js v4 programming model).
 *   site          every request: /api/* goes to the API, anything else is the web app (from ./www)
 *   noShowSweep   hourly: marks missed deliveries and emails the contractor and the project's admins
 *
 * host.json sets routePrefix to "" so this one function sees every path, and
 * AzureWebJobsDisableHomepage=true (infra/main.bicep) so "/" is the app, not the Functions page.
 */
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './app';
import { loadConfig } from './config';
import { createServices } from './container';
import { createStatic, isApiPath } from './static';

const cfg = loadConfig();
const ready = createServices(cfg).then((svc) => ({ svc, handle: createApi(svc, cfg) }));
const serveStatic = createStatic(join(dirname(fileURLToPath(import.meta.url)), '..', 'www'));

app.http('site', {
  route: '{*path}',
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (req: HttpRequest, ctx: InvocationContext) => {
    const path = new URL(req.url).pathname;
    if (!isApiPath(path)) {
      const r = await serveStatic(req.method, path);
      return { status: r.status, headers: r.headers, body: r.body };
    }
    const { handle } = await ready;
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    let body: unknown;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const text = await req.text();
      if (text.length > 512 * 1024) return { status: 413, jsonBody: { error: { code: 'too_large', message: 'Request too large.' } } };
      try { body = text ? JSON.parse(text) : {}; } catch { return { status: 400, jsonBody: { error: { code: 'invalid', message: 'Invalid JSON.' } } }; }
    }
    const ip = (headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/:\d+$/, '');
    const res = await handle({ method: req.method === 'HEAD' ? 'GET' : req.method, path, headers, body, ip });
    if (res.status >= 500) ctx.error('API error', req.method, path);
    return { status: res.status, headers: res.headers, jsonBody: res.body };
  },
});

app.timer('noShowSweep', {
  schedule: '0 5 * * * *', // five past every hour
  handler: async (_t: unknown, ctx: InvocationContext) => {
    const { svc } = await ready;
    const n = await svc.noShowSweepAll();
    ctx.log('No-show sweep: ' + n + ' flagged');
  },
});
