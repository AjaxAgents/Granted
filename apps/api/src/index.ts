/*
 * Azure Functions entry point (Node.js v4 programming model).
 *   api           every /api/* route, anonymous at the platform level; the app checks sessions itself
 *   noShowSweep   hourly: marks missed deliveries and emails the contractor and the project's admins
 */
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { createApi } from './app';
import { loadConfig } from './config';
import { createServices } from './container';

const cfg = loadConfig();
const ready = createServices(cfg).then((svc) => ({ svc, handle: createApi(svc, cfg) }));

app.http('api', {
  route: '{*path}',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (req: HttpRequest, ctx: InvocationContext) => {
    const { handle } = await ready;
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    let body: unknown;
    if (req.method !== 'GET' && req.method !== 'OPTIONS') {
      const text = await req.text();
      if (text.length > 512 * 1024) return { status: 413, jsonBody: { error: { code: 'too_large', message: 'Request too large.' } } };
      try { body = text ? JSON.parse(text) : {}; } catch { return { status: 400, jsonBody: { error: { code: 'invalid', message: 'Invalid JSON.' } } }; }
    }
    const ip = (headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/:\d+$/, '');
    const res = await handle({ method: req.method, path: new URL(req.url).pathname, headers, body, ip });
    if (res.status >= 500) ctx.error('API error', req.method, new URL(req.url).pathname);
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
