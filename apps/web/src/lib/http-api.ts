/*
 * Talks to the Granted API over HTTPS. The session token lives in the iOS
 * Keychain in the app, and in this browser's storage on the web.
 */
import type { Role } from '@granted/core';
import { ApiError, type Api, type SignInResult } from './api';
import { getSecret, setSecret } from './storage';

const TOKEN_KEY = 'granted.session';

export class HttpApi implements Api {
  readonly mode = 'server' as const;
  viewAs: Role | null = null;
  private token: string | null = null;
  private skew = 0;

  constructor(private base: string) {}

  now() { return new Date(Date.now() + this.skew); }
  isSignedIn() { return !!this.token; }

  async restore() {
    this.token = await getSecret(TOKEN_KEY);
    if (!this.token) return false;
    try { await this.home(); return true; } catch { await this.setToken(null); return false; }
  }

  private async setToken(t: string | null) { this.token = t; await setSecret(TOKEN_KEY, t); }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (this.viewAs) headers['X-Granted-View-As'] = this.viewAs;
    let res: Response;
    try {
      res = await fetch(this.base + '/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
    } catch {
      throw new ApiError('No connection. Check your signal and try again.', 0, 'offline');
    }
    const date = res.headers.get('Date');
    if (date) { const t = new Date(date).getTime(); if (!isNaN(t)) this.skew = t - Date.now(); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && this.token && !path.startsWith('auth/')) await this.setToken(null);
      const e = (data && data.error) || {};
      throw new ApiError(e.message || 'Something went wrong. Try again.', res.status, e.code || 'error', e.fields);
    }
    return data as T;
  }

  signUp(f: Parameters<Api['signUp']>[0]) { return this.call<{ email: string; devCode?: string }>('POST', 'auth/signup', f); }
  async verify(email: string, code: string) { const r = await this.call<{ token: string; message: string }>('POST', 'auth/verify', { email, code }); await this.setToken(r.token); return { message: r.message }; }
  resend(email: string, purpose: 'signup' | 'reset') { return this.call<{ devCode?: string }>('POST', 'auth/resend', { email, purpose }); }
  async signIn(email: string, password: string): Promise<SignInResult> {
    const r = await this.call<{ token?: string; needsVerification?: true; email?: string; devCode?: string }>('POST', 'auth/signin', { email, password });
    if (r.needsVerification) return { needsVerification: true, email: r.email || email, devCode: r.devCode };
    await this.setToken(r.token as string); return { ok: true };
  }
  forgot(email: string) { return this.call<{ devCode?: string }>('POST', 'auth/forgot', { email }); }
  async reset(email: string, code: string, password: string) { await this.call('POST', 'auth/reset', { email, code, password }); }
  async signOut() { this.viewAs = null; await this.setToken(null); }

  home() { return this.call<Awaited<ReturnType<Api['home']>>>('GET', 'me'); }
  updateProfile(f: Parameters<Api['updateProfile']>[0]) { return this.call<Awaited<ReturnType<Api['updateProfile']>>>('PATCH', 'me', f); }
  async changePassword(current: string, next: string) { const r = await this.call<{ token: string }>('POST', 'me/password', { current, next }); await this.setToken(r.token); }
  async deleteAccount(password: string) { await this.call('DELETE', 'me', { password }); await this.signOut(); }

  project(id: string) { return this.call<Awaited<ReturnType<Api['project']>>>('GET', 'projects/' + encodeURIComponent(id)); }
  createProject(name: string, location: string, timeZone?: string) { return this.call<Awaited<ReturnType<Api['createProject']>>>('POST', 'projects', { name, location, timeZone }); }
  enterCode(code: string) { return this.call<Awaited<ReturnType<Api['enterCode']>>>('POST', 'projects/join', { code }); }
  async leaveProject(id: string) { await this.call('POST', `projects/${encodeURIComponent(id)}/leave`); }
  async saveSettings(id: string, patch: Parameters<Api['saveSettings']>[1]) { await this.call('PATCH', `projects/${encodeURIComponent(id)}/settings`, patch); }
  async replaceLookahead(id: string, activities: Parameters<Api['replaceLookahead']>[1]) { return (await this.call<{ count: number }>('PUT', `projects/${encodeURIComponent(id)}/lookahead`, { activities })).count; }
  async regenerateCode(id: string) { return (await this.call<{ code: string }>('POST', `projects/${encodeURIComponent(id)}/code`)).code; }
  async deleteProject(id: string, confirmCode: string) { await this.call('DELETE', 'projects/' + encodeURIComponent(id), { confirmCode }); }
  async setSuspended(id: string, subId: string, suspended: boolean) { await this.call('POST', `projects/${encodeURIComponent(id)}/suspend`, { subId, suspended }); }

  async decideJoin(joinId: string, approve: boolean, role?: Role, trade?: string) { await this.call('POST', `joinreqs/${encodeURIComponent(joinId)}/decision`, { approve, role, trade }); }
  invite(projectId: string, email: string, role: Role, trade: string) { return this.call<Awaited<ReturnType<Api['invite']>>>('POST', `projects/${encodeURIComponent(projectId)}/invites`, { email, role, trade }); }
  async revokeInvite(id: string) { await this.call('DELETE', 'invites/' + encodeURIComponent(id)); }
  async changeRole(memberId: string, role: Role, trade?: string) { await this.call('PATCH', 'members/' + encodeURIComponent(memberId), trade === undefined ? { role } : { role, trade }); }
  async removeMember(memberId: string) { await this.call('DELETE', 'members/' + encodeURIComponent(memberId)); }

  submitRequest(projectId: string, input: Parameters<Api['submitRequest']>[1]) { return this.call<Awaited<ReturnType<Api['submitRequest']>>>('POST', `projects/${encodeURIComponent(projectId)}/requests`, input); }
  async cancelRequest(id: string) { await this.call('DELETE', 'requests/' + encodeURIComponent(id)); }
  decideRequest(id: string, approve: boolean, note: string) { return this.call<Awaited<ReturnType<Api['decideRequest']>>>('POST', `requests/${encodeURIComponent(id)}/decision`, { approve, note }); }
  emergencyPass(projectId: string, input: Parameters<Api['emergencyPass']>[1]) { return this.call<Awaited<ReturnType<Api['emergencyPass']>>>('POST', `projects/${encodeURIComponent(projectId)}/emergency`, input); }
  async noShowSweep(projectId: string) { return (await this.call<{ count: number }>('POST', `projects/${encodeURIComponent(projectId)}/noshow`)).count; }

  checkGate(projectId: string, code: string) { return this.call<Awaited<ReturnType<Api['checkGate']>>>('POST', `projects/${encodeURIComponent(projectId)}/gate/check`, { code }); }
  admit(projectId: string, code: string) { return this.call<Awaited<ReturnType<Api['admit']>>>('POST', `projects/${encodeURIComponent(projectId)}/gate/admit`, { code }); }
  turnAway(projectId: string, code: string) { return this.call<Awaited<ReturnType<Api['turnAway']>>>('POST', `projects/${encodeURIComponent(projectId)}/gate/turnaway`, { code }); }
}
