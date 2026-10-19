// The HTTP layer: sessions, validation, CORS, maintenance header and error mapping.
import { beforeAll, describe, expect, test } from 'vitest';
import { GrantedService, MemoryMailer, MemoryStore, seedDemo, DEMO_PASSWORD, DEMO_PROJECT_ID } from '@granted/services';
import { createApi, type ApiRequest } from '../src/app';
import { loadConfig } from '../src/config';

const cfg = loadConfig({ GRANTED_STORE: 'memory', SESSION_SECRET: 'test-secret-test-secret-test-secret-123', ALLOWED_ORIGINS: 'https://app.example.com,capacitor://localhost', EXPOSE_CODES: 'true' });
let handle: ReturnType<typeof createApi>;
let clock = new Date('2026-10-12T13:00:00Z');
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => handle({ method, path: '/api/' + path, headers, body, ip: '10.0.0.1' } as ApiRequest);
const auth = (token: string, extra: Record<string, string> = {}) => Object.assign({ authorization: 'Bearer ' + token }, extra);

beforeAll(async () => {
  const store = new MemoryStore();
  await seedDemo(store, '2026-10-12', 1000);
  const svc = new GrantedService({ store, mailer: new MemoryMailer(), clock: () => clock, config: { passwordIterations: 1000, exposeCodes: true } });
  handle = createApi(svc, cfg, () => undefined);
});

async function signIn(email: string) {
  const r = await call('POST', 'auth/signin', { email, password: DEMO_PASSWORD });
  expect(r.status).toBe(200);
  return (r.body as { token: string }).token;
}

describe('API', () => {
  test('H01 health and unknown routes', async () => {
    expect((await call('GET', 'health')).status).toBe(200);
    expect((await call('GET', 'nope')).status).toBe(404);
    expect((await call('DELETE', 'health')).status).toBe(405);
  });

  test('H02 project data needs a valid session', async () => {
    expect((await call('GET', 'projects/' + DEMO_PROJECT_ID)).status).toBe(401);
    expect((await call('GET', 'projects/' + DEMO_PROJECT_ID, undefined, auth('not.a.token'))).status).toBe(401);
    const t = await signIn('dana.ruiz@northfield.example.com');
    const r = await call('GET', 'projects/' + DEMO_PROJECT_ID, undefined, auth(t));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ role: 'contractor' });
  });

  test('H03 malformed bodies are refused before the services', async () => {
    const r = await call('POST', 'auth/signin', { email: 'a@b.com', password: 'x', extra: 'field' });
    expect(r.status).toBe(400);
    const r2 = await call('POST', 'auth/signin', { email: 42 });
    expect(r2.status).toBe(400);
  });

  test('H04 errors map to statuses with safe messages', async () => {
    const r = await call('POST', 'auth/signin', { email: 'dana.ruiz@northfield.example.com', password: 'Wrong2026' });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: 'bad_credentials', message: 'Email or password is incorrect.' } });
    const t = await signIn('riley.alvarez@gate.example.com');
    const forbidden = await call('POST', 'projects/' + DEMO_PROJECT_ID + '/requests', { activityId: 'A1200', gateId: 'G1', date: '2026-10-15', slot: '09:00', zoneId: 'Z-SLY', material: 'x', quantity: 1, unit: 'pcs', pallets: 1, pocName: 'x', pocPhone: '2145550100' }, auth(t));
    expect(forbidden.status).toBe(403);
  });

  test('H05 CORS only for listed origins', async () => {
    const ok = await call('OPTIONS', 'me', undefined, { origin: 'capacitor://localhost' });
    expect(ok.status).toBe(204);
    expect(ok.headers['Access-Control-Allow-Origin']).toBe('capacitor://localhost');
    const no = await call('OPTIONS', 'me', undefined, { origin: 'https://evil.example.com' });
    expect(no.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(no.headers['Cache-Control']).toBe('no-store');
  });

  test('H06 maintenance header works only for an Ajax admin account', async () => {
    const admin = await signIn('alex.morgan@ajaxbuilding.com');
    const v = await call('GET', 'projects/' + DEMO_PROJECT_ID, undefined, auth(admin, { 'x-granted-view-as': 'access' }));
    expect(v.body).toMatchObject({ role: 'access', maintenance: true });
    const dana = await signIn('dana.ruiz@northfield.example.com');
    const d = await call('GET', 'projects/' + DEMO_PROJECT_ID, undefined, auth(dana, { 'x-granted-view-as': 'admin' }));
    expect(d.body).toMatchObject({ role: 'contractor', maintenance: false });
  });

  test('H07 changing the password signs out other sessions', async () => {
    const a = await signIn('marcus.hale@caliche.example.com');
    const b = await signIn('marcus.hale@caliche.example.com');
    const ch = await call('POST', 'me/password', { current: DEMO_PASSWORD, next: 'Changed2026' }, auth(a));
    expect(ch.status).toBe(200);
    const fresh = (ch.body as { token: string }).token;
    expect((await call('GET', 'me', undefined, auth(b))).status).toBe(401);
    expect((await call('GET', 'me', undefined, auth(fresh))).status).toBe(200);
  });

  test('H08 sign-up, confirm and use the session', async () => {
    const su = await call('POST', 'auth/signup', { first: 'Jo', last: 'Lee', phone: '2145550199', email: 'jo@hilltop.example.com', password: 'Hilltop2026', company: 'Hilltop', declaredAjax: 'no', code: 'ddc2-7hkq' });
    expect(su.status).toBe(200);
    const code = (su.body as { devCode: string }).devCode;
    const v = await call('POST', 'auth/verify', { email: 'jo@hilltop.example.com', code });
    expect(v.status).toBe(200);
    expect((v.body as { message: string }).message).toMatch(/Request sent/);
    const me = await call('GET', 'me', undefined, auth((v.body as { token: string }).token));
    expect(me.body).toMatchObject({ pending: [{ projectId: DEMO_PROJECT_ID }] });
    clock = new Date(clock.getTime() + 1000);
  });

  test('H09 production settings are checked at start-up', () => {
    expect(() => loadConfig({ GRANTED_ENV: 'production', GRANTED_STORE: 'memory', SESSION_SECRET: 'x'.repeat(40), EXPOSE_CODES: 'true' })).toThrow(/EXPOSE_CODES|GRANTED_STORE|MAIL_FROM/);
    expect(() => loadConfig({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  test('H10 unread Key Vault secrets are refused; the app address defaults to the Function App', () => {
    expect(() => loadConfig({ SESSION_SECRET: '@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/session-secret)' })).toThrow(/Key Vault/);
    expect(loadConfig({ SESSION_SECRET: 'x'.repeat(40), WEBSITE_HOSTNAME: 'func-granted.azurewebsites.net' }).appUrl).toBe('https://func-granted.azurewebsites.net');
    expect(loadConfig({ SESSION_SECRET: 'x'.repeat(40), APP_URL: 'https://granted.ajaxbuilding.com/', WEBSITE_HOSTNAME: 'func' }).appUrl).toBe('https://granted.ajaxbuilding.com');
  });
});
