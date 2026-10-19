// Serving the web app from the Function App: files, app routes, caching, headers, and staying inside www.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { createStatic, isApiPath } from '../src/static';

let serve: ReturnType<typeof createStatic>;
let outside: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'granted-www-'));
  const www = join(dir, 'www');
  mkdirSync(join(www, 'assets'), { recursive: true });
  writeFileSync(join(www, 'index.html'), '<!doctype html><title>Granted</title>');
  writeFileSync(join(www, 'privacy.html'), '<h1>Privacy</h1>');
  writeFileSync(join(www, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(www, '.env'), 'SECRET=1');
  outside = join(dir, 'secret.txt');
  writeFileSync(outside, 'do not serve');
  serve = createStatic(www);
});

describe('web app hosting', () => {
  test('S01 the app at / and app routes fall back to index.html', async () => {
    for (const p of ['/', '/index.html', '/home', '/projects/p1']) {
      const r = await serve('GET', p);
      expect(r.status).toBe(200);
      expect(r.headers['Content-Type']).toMatch(/text\/html/);
      expect(String(r.body)).toContain('<title>Granted</title>');
      expect(r.headers['Cache-Control']).toBe('no-cache');
    }
  });

  test('S02 files with the right type; hashed assets cached for a year', async () => {
    const js = await serve('GET', '/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers['Content-Type']).toMatch(/javascript/);
    expect(js.headers['Cache-Control']).toContain('immutable');
    expect(String((await serve('GET', '/privacy.html')).body)).toContain('Privacy');
  });

  test('S03 missing files are 404, not the app', async () => {
    expect((await serve('GET', '/assets/missing.js')).status).toBe(404);
    expect((await serve('GET', '/nope.png')).status).toBe(404);
  });

  test('S04 never serves outside www or dotfiles', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/.env', '/%2e%65nv', '/..%2fsecret.txt', '/a%00b']) {
      const r = await serve('GET', p);
      expect(String(r.body || '')).not.toContain('do not serve');
      expect(String(r.body || '')).not.toContain('SECRET');
    }
    expect((await serve('GET', '/%E0%A4%A')).status).toBe(400);
  });

  test('S05 security headers on every response; only GET and HEAD', async () => {
    const r = await serve('GET', '/');
    expect(r.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['Content-Security-Policy']).toContain("connect-src 'self'");
    expect(r.headers['Strict-Transport-Security']).toContain('max-age=');
    expect(r.headers['X-Content-Type-Options']).toBe('nosniff');
    expect((await serve('HEAD', '/')).body).toBeUndefined();
    expect((await serve('POST', '/')).status).toBe(405);
  });

  test('S06 /api goes to the API, everything else to the app', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api/health')).toBe(true);
    expect(isApiPath('/apiary')).toBe(false);
    expect(isApiPath('/')).toBe(false);
  });
});
