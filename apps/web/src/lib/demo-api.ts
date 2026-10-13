/*
 * The offline demo: the real services and rules running in the browser on
 * demo data saved on this device. No server, no real email (the codes show
 * on screen and every email lands in Settings → Email inbox).
 */
import { at, fromWallClock, toWallClock, ymd } from '@granted/core';
import {
  DEMO_PASSWORD, DEMO_TZ, GrantedError, GrantedService, MemoryStore, demoAnchor, nullMailer, seedDemo, type Actor, type Snapshot,
} from '@granted/services';
import type { Role } from '@granted/core';
import { ApiError, type Api, type DemoControls } from './api';
import { getPref, setPref } from './storage';

const LS_DATA = 'granted-demo-data-v2';
const LS_SESSION = 'granted-demo-session-v2';
const LS_CLOCK = 'granted-demo-clock-v2';

type Clock = { mode: 'auto' | 'set' | 'live'; base?: number; setAt?: number };

function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e instanceof GrantedError) throw new ApiError(e.message, e.status, e.code, e.fields);
    throw e;
  });
}

export class DemoApi implements Api {
  readonly mode = 'demo' as const;
  readonly demo: DemoControls;
  viewAs: Role | null = null;
  private store = new MemoryStore();
  private svc: GrantedService;
  private userId: string | null = null;
  private clock: Clock = getPref<Clock>(LS_CLOCK, { mode: 'auto' });
  private autoStart = Date.now();
  private anchor = '';

  constructor() {
    this.svc = new GrantedService({
      store: this.store, mailer: nullMailer, clock: () => this.now(),
      config: {
        adminCodeHash: (import.meta.env.VITE_DEMO_ADMIN_CODE_HASH as string | undefined) || '',
        passwordIterations: 100000, exposeCodes: true, storeAccountMail: true, appUrl: location.origin,
      },
    });
    let saveTimer = 0;
    this.store.onChange = () => { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => setPref(LS_DATA, this.store.snapshot()), 50); };
    const self = this;
    this.demo = {
      clockMode: () => self.clock.mode,
      setClock(date: string, time: string) { self.clock = { mode: 'set', base: fromWallClock(at(date, time), DEMO_TZ).getTime(), setAt: Date.now() }; setPref(LS_CLOCK, self.clock); },
      autoClock() { self.clock = { mode: 'auto' }; self.autoStart = Date.now(); setPref(LS_CLOCK, self.clock); },
      liveClock() { self.clock = { mode: 'live' }; setPref(LS_CLOCK, self.clock); },
      async reset() { self.store.clear(); await self.seed(); self.userId = null; setPref(LS_SESSION, null); self.demo.autoClock(); },
      async inbox(email: string) { return (await self.store.find('mail', { to: email })).sort((a, b) => b.ts.localeCompare(a.ts)); },
      accounts: [
        { label: 'Admin · Alex Morgan', email: 'alex.morgan@ajaxbuilding.com' },
        { label: 'Access Control · Riley Alvarez', email: 'riley.alvarez@gate.example.com' },
        { label: 'Contractor · Dana Ruiz', email: 'dana.ruiz@northfield.example.com' },
      ],
      password: DEMO_PASSWORD,
    };
  }

  private async seed() {
    this.anchor = demoAnchor(new Date());
    await seedDemo(this.store, this.anchor, 100000);
    setPref(LS_DATA, this.store.snapshot());
  }

  /** Demo default: the demo day at 7:15 AM site time, running forward from when the page opened. */
  now(): Date {
    if (this.clock.mode === 'live') return new Date();
    if (this.clock.mode === 'set' && this.clock.base) return new Date(this.clock.base + (Date.now() - (this.clock.setAt || Date.now())));
    const start = fromWallClock(at(this.anchor || ymd(toWallClock(new Date(), DEMO_TZ)), '07:15'), DEMO_TZ).getTime();
    return new Date(start + (Date.now() - this.autoStart));
  }

  private actor(): Actor {
    if (!this.userId) throw new ApiError('Sign in to continue.', 401, 'unauthenticated');
    return { userId: this.userId, viewAs: this.viewAs };
  }

  isSignedIn() { return !!this.userId; }

  async restore(): Promise<boolean> {
    const snap = getPref<Snapshot | null>(LS_DATA, null);
    if (snap && snap.users && Object.keys(snap.users).length) {
      this.store.load(snap);
      const p = Object.values(snap.projects || {}).find((x) => x && x.demoAnchor);
      this.anchor = p && p.demoAnchor ? p.demoAnchor : demoAnchor(new Date());
    } else await this.seed();
    const sid = getPref<string | null>(LS_SESSION, null);
    if (sid && (await this.svc.sessionVersion(sid)) !== null) { this.userId = sid; return true; }
    return false;
  }

  private signedIn(userId: string) { this.userId = userId; setPref(LS_SESSION, userId); }

  signUp(f: Parameters<Api['signUp']>[0]) { return wrap(this.svc.signUp(f, 'demo')); }
  async verify(email: string, code: string) { const r = await wrap(this.svc.verifyEmail(email, code)); this.signedIn(r.userId); return { message: r.message }; }
  resend(email: string, purpose: 'signup' | 'reset') { return wrap(this.svc.resendCode(email, purpose)); }
  async signIn(email: string, password: string) {
    const r = await wrap(this.svc.signIn(email, password, 'demo'));
    if ('needsVerification' in r) return r;
    this.signedIn(r.userId); return { ok: true as const };
  }
  forgot(email: string) { return wrap(this.svc.startPasswordReset(email)); }
  reset(email: string, code: string, password: string) { return wrap(this.svc.resetPassword(email, code, password)); }
  async signOut() { this.userId = null; this.viewAs = null; setPref(LS_SESSION, null); }

  home() { return wrap(this.svc.home(this.actor())); }
  updateProfile(f: Parameters<Api['updateProfile']>[0]) { return wrap(this.svc.updateProfile(this.actor(), f)); }
  async changePassword(current: string, next: string) { await wrap(this.svc.changePassword(this.actor(), current, next)); }
  async deleteAccount(password: string) { await wrap(this.svc.deleteAccount(this.actor(), password)); await this.signOut(); }

  project(id: string) { return wrap(this.svc.projectView(this.actor(), id)); }
  createProject(name: string, location: string, timeZone?: string) { return wrap(this.svc.createProject(this.actor(), { name, location, timeZone: timeZone || DEMO_TZ, sampleLookahead: true })); }
  enterCode(code: string) { return wrap(this.svc.enterCode(this.actor(), code)); }
  leaveProject(id: string) { return wrap(this.svc.leaveProject(this.actor(), id)); }
  saveSettings(id: string, patch: Parameters<Api['saveSettings']>[1]) { return wrap(this.svc.saveProjectSettings(this.actor(), id, patch as never)); }
  replaceLookahead(id: string, activities: Parameters<Api['replaceLookahead']>[1]) { return wrap(this.svc.replaceLookahead(this.actor(), id, activities)); }
  regenerateCode(id: string) { return wrap(this.svc.regenerateCode(this.actor(), id)); }
  deleteProject(id: string, confirmCode: string) { return wrap(this.svc.deleteProject(this.actor(), id, confirmCode)); }
  setSuspended(id: string, subId: string, suspended: boolean) { return wrap(this.svc.setSuspended(this.actor(), id, subId, suspended)); }

  decideJoin(joinId: string, approve: boolean, role?: Role, trade?: string) { return wrap(this.svc.decideJoin(this.actor(), joinId, approve, role, trade)); }
  invite(projectId: string, email: string, role: Role, trade: string) { return wrap(this.svc.invite(this.actor(), projectId, { email, role, trade })); }
  revokeInvite(id: string) { return wrap(this.svc.revokeInvite(this.actor(), id)); }
  changeRole(memberId: string, role: Role, trade?: string) { return wrap(this.svc.changeRole(this.actor(), memberId, role, trade)); }
  removeMember(memberId: string) { return wrap(this.svc.removeMember(this.actor(), memberId)); }

  submitRequest(projectId: string, input: Parameters<Api['submitRequest']>[1]) { return wrap(this.svc.submitRequest(this.actor(), projectId, input)); }
  cancelRequest(id: string) { return wrap(this.svc.cancelRequest(this.actor(), id)); }
  decideRequest(id: string, approve: boolean, note: string) { return wrap(this.svc.decideRequest(this.actor(), id, approve, note)); }
  emergencyPass(projectId: string, input: Parameters<Api['emergencyPass']>[1]) { return wrap(this.svc.emergencyPass(this.actor(), projectId, input)); }
  noShowSweep(projectId: string) { return wrap(this.svc.noShowSweep(projectId, this.actor())); }

  checkGate(projectId: string, code: string) { return wrap(this.svc.checkGatePass(this.actor(), projectId, code)); }
  admit(projectId: string, code: string) { return wrap(this.svc.admit(this.actor(), projectId, code)); }
  turnAway(projectId: string, code: string) { return wrap(this.svc.turnAway(this.actor(), projectId, code)); }
}
