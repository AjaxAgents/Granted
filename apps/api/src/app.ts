/*
 * The HTTP API, independent of the hosting framework so it can be tested
 * directly. index.ts connects it to Azure Functions; dev-server.ts to Node's
 * http server for local work.
 *
 * Every route that touches a project goes through GrantedService, which
 * checks the caller's access on that project. Maintenance mode is requested
 * with the X-Granted-View-As header and honoured only for Ajax admin
 * accounts that are Admins on the project.
 */
import { isRole } from '@granted/core';
import { GrantedError, GrantedService, type Actor } from '@granted/services';
import type { ZodType } from 'zod';
import type { ApiConfig } from './config';
import { Schemas } from './schemas';
import { Tokens } from './auth';

export interface ApiRequest { method: string; path: string; headers: Record<string, string | undefined>; body?: unknown; ip?: string }
export interface ApiResponse { status: number; headers: Record<string, string>; body?: unknown }

type Handler = (c: { params: Record<string, string>; body: any; actor: Actor | null; req: ApiRequest; ip: string }) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Route { method: string; parts: string[]; auth: 'none' | 'user' | 'external'; schema?: ZodType; handler: Handler }

export function createApi(svc: GrantedService, cfg: ApiConfig, log: (msg: string) => void = console.error) {
  const tokens = new Tokens(cfg);
  const routes: Route[] = [];
  const add = (method: string, path: string, auth: Route['auth'], schema: ZodType | undefined, handler: Handler) =>
    routes.push({ method, parts: path.split('/').filter(Boolean), auth, schema, handler });
  const session = async (userId: string, sessionVersion: number) => ({ token: await tokens.issue(userId, sessionVersion) });

  // ---------------- health
  add('GET', 'health', 'none', undefined, async () => ({ ok: true, authMode: cfg.authMode }));

  // ---------------- accounts (local sign-in)
  add('POST', 'auth/signup', 'none', Schemas.signUp, async ({ body, ip }) => svc.signUp(body, ip));
  add('POST', 'auth/verify', 'none', Schemas.verify, async ({ body }) => {
    const r = await svc.verifyEmail(body.email, body.code);
    return Object.assign(await session(r.userId, r.sessionVersion), { message: r.message });
  });
  add('POST', 'auth/resend', 'none', Schemas.resend, async ({ body }) => svc.resendCode(body.email, body.purpose));
  add('POST', 'auth/signin', 'none', Schemas.signIn, async ({ body, ip }) => {
    const r = await svc.signIn(body.email, body.password, ip);
    return 'needsVerification' in r ? r : session(r.userId, r.sessionVersion);
  });
  add('POST', 'auth/forgot', 'none', Schemas.forgot, async ({ body }) => svc.startPasswordReset(body.email));
  add('POST', 'auth/reset', 'none', Schemas.reset, async ({ body }) => { await svc.resetPassword(body.email, body.code, body.password); return { ok: true }; });

  // ---------------- External ID first sign-in
  add('POST', 'auth/profile', 'external', Schemas.externalProfile, async ({ body, req }) => {
    const ext = await tokens.verifyExternal(bearer(req) || '');
    if (!ext) throw new GrantedError(401, 'unauthenticated', 'Sign in to continue.');
    return svc.createExternalProfile(ext.externalId, ext.email, body);
  });

  // ---------------- me
  add('GET', 'me', 'user', undefined, async ({ actor }) => svc.home(actor as Actor));
  add('PATCH', 'me', 'user', Schemas.profile, async ({ actor, body }) => svc.updateProfile(actor as Actor, body));
  add('POST', 'me/password', 'user', Schemas.password, async ({ actor, body }) => {
    const r = await svc.changePassword(actor as Actor, body.current, body.next);
    return session((actor as Actor).userId, r.sessionVersion); // this device stays signed in; others are signed out
  });
  add('DELETE', 'me', 'user', Schemas.deleteAccount, async ({ actor, body }) => { await svc.deleteAccount(actor as Actor, body.password); return { ok: true }; });

  // ---------------- projects
  add('POST', 'projects', 'user', Schemas.createProject, async ({ actor, body }) => svc.createProject(actor as Actor, body));
  add('POST', 'projects/join', 'user', Schemas.code, async ({ actor, body }) => svc.enterCode(actor as Actor, body.code));
  add('GET', 'projects/:id', 'user', undefined, async ({ actor, params }) => svc.projectView(actor as Actor, params.id));
  add('PATCH', 'projects/:id/settings', 'user', Schemas.settings, async ({ actor, params, body }) => { await svc.saveProjectSettings(actor as Actor, params.id, body); return { ok: true }; });
  add('PUT', 'projects/:id/lookahead', 'user', Schemas.lookahead, async ({ actor, params, body }) => ({ count: await svc.replaceLookahead(actor as Actor, params.id, body.activities) }));
  add('POST', 'projects/:id/code', 'user', undefined, async ({ actor, params }) => ({ code: await svc.regenerateCode(actor as Actor, params.id) }));
  add('DELETE', 'projects/:id', 'user', Schemas.deleteProject, async ({ actor, params, body }) => { await svc.deleteProject(actor as Actor, params.id, body.confirmCode); return { ok: true }; });
  add('POST', 'projects/:id/leave', 'user', undefined, async ({ actor, params }) => { await svc.leaveProject(actor as Actor, params.id); return { ok: true }; });
  add('POST', 'projects/:id/suspend', 'user', Schemas.suspend, async ({ actor, params, body }) => { await svc.setSuspended(actor as Actor, params.id, body.subId, body.suspended); return { ok: true }; });

  // ---------------- team
  add('POST', 'joinreqs/:id/decision', 'user', Schemas.joinDecision, async ({ actor, params, body }) => { await svc.decideJoin(actor as Actor, params.id, body.approve, body.role, body.trade); return { ok: true }; });
  add('POST', 'projects/:id/invites', 'user', Schemas.invite, async ({ actor, params, body }) => svc.invite(actor as Actor, params.id, body));
  add('DELETE', 'invites/:id', 'user', undefined, async ({ actor, params }) => { await svc.revokeInvite(actor as Actor, params.id); return { ok: true }; });
  add('PATCH', 'members/:id', 'user', Schemas.member, async ({ actor, params, body }) => { await svc.changeRole(actor as Actor, params.id, body.role, body.trade); return { ok: true }; });
  add('DELETE', 'members/:id', 'user', undefined, async ({ actor, params }) => { await svc.removeMember(actor as Actor, params.id); return { ok: true }; });

  // ---------------- deliveries
  add('POST', 'projects/:id/requests', 'user', Schemas.delivery, async ({ actor, params, body }) => svc.submitRequest(actor as Actor, params.id, body));
  add('DELETE', 'requests/:id', 'user', undefined, async ({ actor, params }) => { await svc.cancelRequest(actor as Actor, params.id); return { ok: true }; });
  add('POST', 'requests/:id/decision', 'user', Schemas.decision, async ({ actor, params, body }) => svc.decideRequest(actor as Actor, params.id, body.approve, body.note));
  add('POST', 'projects/:id/emergency', 'user', Schemas.emergency, async ({ actor, params, body }) => svc.emergencyPass(actor as Actor, params.id, body));
  add('POST', 'projects/:id/noshow', 'user', undefined, async ({ actor, params }) => ({ count: await svc.noShowSweep(params.id, actor as Actor) }));

  // ---------------- gate
  add('POST', 'projects/:id/gate/check', 'user', Schemas.gate, async ({ actor, params, body }) => svc.checkGatePass(actor as Actor, params.id, body.code));
  add('POST', 'projects/:id/gate/admit', 'user', Schemas.gate, async ({ actor, params, body }) => svc.admit(actor as Actor, params.id, body.code));
  add('POST', 'projects/:id/gate/turnaway', 'user', Schemas.gate, async ({ actor, params, body }) => svc.turnAway(actor as Actor, params.id, body.code));

  function bearer(req: ApiRequest): string | null {
    const h = req.headers['authorization'] || '';
    return /^Bearer [A-Za-z0-9._~+/=-]+$/.test(h) ? h.slice(7) : null;
  }

  async function authenticate(req: ApiRequest): Promise<Actor | null> {
    const t = bearer(req); if (!t) return null;
    let userId: string | null = null;
    if (cfg.authMode === 'external') {
      const ext = await tokens.verifyExternal(t);
      if (!ext) return null;
      userId = await svc.userIdForExternal(ext.externalId);
      if (!userId) throw new GrantedError(403, 'profile_required', 'Finish setting up your profile.');
    } else {
      const s = await tokens.verifyLocal(t);
      if (!s) return null;
      const current = await svc.sessionVersion(s.userId);
      if (current === null || current !== s.sessionVersion) return null;
      userId = s.userId;
    }
    const va = req.headers['x-granted-view-as'];
    return { userId, viewAs: va && isRole(va) ? va : null, ip: req.ip };
  }

  function cors(req: ApiRequest): Record<string, string> {
    const origin = req.headers['origin'];
    if (!origin || !cfg.allowedOrigins.includes(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin, Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Granted-View-As',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '600',
    };
  }

  const baseHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

  return async function handle(req: ApiRequest): Promise<ApiResponse> {
    const headers = Object.assign({}, baseHeaders, cors(req));
    const reply = (status: number, body?: unknown): ApiResponse => ({ status, headers, body });
    try {
      if (req.method === 'OPTIONS') return reply(204);
      const parts = req.path.replace(/^\/?(api\/)?/, '').split('/').filter(Boolean);
      let methodMismatch = false;
      for (const r of routes) {
        if (r.parts.length !== parts.length) continue;
        const params: Record<string, string> = {}; let ok = true;
        for (let i = 0; i < parts.length; i++) {
          if (r.parts[i].startsWith(':')) {
            if (!/^[A-Za-z0-9_-]{1,100}$/.test(parts[i])) { ok = false; break; }
            params[r.parts[i].slice(1)] = parts[i];
          } else if (r.parts[i] !== parts[i]) { ok = false; break; }
        }
        if (!ok) continue;
        if (r.method !== req.method) { methodMismatch = true; continue; }
        let actor: Actor | null = null;
        if (r.auth === 'user') { actor = await authenticate(req); if (!actor) return reply(401, { error: { code: 'unauthenticated', message: 'Sign in to continue.' } }); }
        let body: unknown = req.body ?? {};
        if (r.schema) {
          const parsed = r.schema.safeParse(body);
          if (!parsed.success) return reply(400, { error: { code: 'invalid', message: 'Some information is missing or not in the right format.' } });
          body = parsed.data;
        }
        const out = await r.handler({ params, body, actor, req, ip: req.ip || '' });
        return reply(200, out ?? { ok: true });
      }
      return methodMismatch ? reply(405, { error: { code: 'method', message: 'Method not allowed.' } }) : reply(404, { error: { code: 'not_found', message: 'Not found.' } });
    } catch (e) {
      if (e instanceof GrantedError) return reply(e.status, { error: { code: e.code, message: e.message, fields: e.fields } });
      log('Unhandled error on ' + req.method + ' ' + req.path + ': ' + (e instanceof Error ? e.stack || e.message : String(e)));
      return reply(500, { error: { code: 'server', message: 'Something went wrong. Try again in a moment.' } });
    }
  };
}
