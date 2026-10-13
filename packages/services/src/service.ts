/*
 * Granted application services.
 *
 * Every rule about who may do what is enforced here, on the server side of
 * the API. The app may hide a button, but that is never the control.
 *
 *   accounts:   sign-up, email confirmation, sign-in with lockout, password
 *               reset and change, profile, account deletion (App Store 5.1.1(v))
 *   projects:   create (Ajax admin accounts only), project codes, settings,
 *               suspend companies, delete
 *   team:       join requests, invites bound to an email, roles, removal;
 *               approval emails go only to that project's admins
 *   deliveries: request -> rules engine -> approved / review / rejected,
 *               reschedule, cancel, review decisions, emergency passes, no-shows
 *   gate:       check a pass, admit (single use), turn away with notices
 *   maintenance mode: an Ajax admin account that is an Admin on a project can
 *               view it as Contractor or Access Control. It can only narrow
 *               what they may do, and everything done is labelled.
 */
import {
  AJAX_DOMAIN, CODE_NOT_FOUND, DEFAULT_SETTINGS, REASONS, ROLES,
  can, checkPass, classifyProjectCode, companyKey, deliveryStatus, evaluateRequest, fill, fmtClock, fmtDate, fmtTime,
  formatPhone, fromWallClock, isAjaxEmail, isRole, isValidEmail, isValidPassword, isValidPhone, isValidTimeZone, isWorkDay, lockState,
  newPassCode, newProjectCode, normEmail, normalizeProjectCode, notices, passPrefixFromCode, passWindow, siteToday, sixDigitCode,
  slotsForDay, toWallClock, validateSignUp, ymd, addDays, at,
  type Action, type Activity, type Gate, type Notice, type NoticeData, type NoticeEvent, type Role, type Settings, type SignUpForm, type Sub, type Zone,
} from '@granted/core';
import { checkPassword, hashPassword, matchesAdminCode, newId, secureRandom, sha256Hex } from './crypto';
import { GrantedError, bad, conflict, forbidden, locked, notFound, tooMany, unauthenticated } from './errors';
import type { Mailer } from './mailer';
import type { Store } from './store';
import type {
  Actor, AuditEntry, Credential, DeliveryRequest, GateEvent, Invite, JoinRequest, Mail, MailKind, Member, PassRecord, Project, User,
} from './types';
import type { GateCheckView, HomeView, JoinView, MemberView, Occupancy, ProjectView, PublicUser } from './views';

export interface ServiceConfig {
  /** Hash of the admin set-up code (see crypto.ts). Empty disables admin set-up. Never the code itself. */
  adminCodeHash?: string;
  /** PBKDF2-SHA256 iterations for new password hashes. 600,000 on the server (OWASP 2023); lower in the browser demo. */
  passwordIterations: number;
  /** Demo only: return email codes in responses because no email is sent. Must be false in production. */
  exposeCodes: boolean;
  /** Demo only: keep sign-up and reset code emails in the in-app inbox. */
  storeAccountMail: boolean;
  /** Link included in emails. */
  appUrl: string;
  defaultTimeZone: string;
  inviteDays: number;
  /** Sign in with a password (local accounts). False when Entra External ID handles sign-in. */
  localAuth: boolean;
}

export const DEFAULT_CONFIG: ServiceConfig = {
  adminCodeHash: '',
  passwordIterations: 600000,
  exposeCodes: false,
  storeAccountMail: false,
  appUrl: 'https://granted.example.com',
  defaultTimeZone: 'America/Chicago',
  inviteDays: 7,
  localAuth: true,
};

export interface Deps {
  store: Store;
  mailer: Mailer;
  clock?: () => Date;
  config?: Partial<ServiceConfig>;
}

export const DEFAULT_GATES: Gate[] = [
  { id: 'G1', name: 'Gate 1 · North', capacityPerSlot: 2 },
  { id: 'G2', name: 'Gate 2 · South heavy haul', capacityPerSlot: 1 },
];
export const DEFAULT_ZONES: Zone[] = [
  { id: 'Z-SLY', name: 'South laydown yard', capacityPallets: 60 },
  { id: 'Z-NLY', name: 'North laydown yard', capacityPallets: 40 },
  { id: 'Z-HA', name: 'Data Hall A staging', capacityPallets: 12 },
  { id: 'Z-HB', name: 'Data Hall B staging', capacityPallets: 12 },
  { id: 'Z-EY', name: 'Electrical yard', capacityPallets: 8 },
];
export const TRADES = ['Electrical', 'Mechanical', 'Fire protection', 'Controls', 'Glazing', 'General'];
export const UNITS = ['pcs', 'sections', 'reels', 'units', 'LF', 'crates', 'skids', 'boxes', 'load'];

export const roleLabel = (r: Role | string | null | undefined) => (r && isRole(r) ? ROLES[r].label : String(r || ''));
export const nameOf = (u: Pick<User, 'first' | 'last'> | null | undefined) => (u ? (u.first + ' ' + u.last).trim() : 'Unknown');
export function plural(n: number, w: string, pl?: string): string {
  return n + ' ' + (Number(n) === 1 ? w : (pl || (/(s|x|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's')));
}
const publicUser = (u: User): PublicUser => ({ id: u.id, email: u.email, first: u.first, last: u.last, phone: u.phone, company: u.company, isAjax: u.isAjax, isAdminAccount: u.isAdminAccount });
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const CODE_TTL_MIN = 15;
const CODE_MAX_TRIES = 5;

export interface DeliveryInput {
  id?: string | null;
  activityId: string; gateId: string; date: string; slot: string; zoneId: string;
  material: string; quantity: number | string; unit: string; pallets: number | string;
  weightLbs?: number | string | null; carrier?: string; truck?: string; pocName: string; pocPhone: string; justification?: string;
}

interface Ctx { user: User; project: Project; member: Member; realRole: Role; role: Role; maintenance: boolean }

export class GrantedService {
  readonly store: Store;
  readonly mailer: Mailer;
  readonly config: ServiceConfig;
  private clock: () => Date;

  constructor(deps: Deps) {
    this.store = deps.store;
    this.mailer = deps.mailer;
    this.clock = deps.clock || (() => new Date());
    this.config = Object.assign({}, DEFAULT_CONFIG, deps.config || {});
  }

  // ================================================================ time

  now(): Date { return this.clock(); }
  nowIso(): string { return this.clock().toISOString(); }
  tz(p: Project): string { return p.settings.timeZone || this.config.defaultTimeZone; }
  /** The jobsite's wall clock right now (see core/time.ts). */
  siteNow(p: Project): Date { return toWallClock(this.now(), this.tz(p)); }
  siteToday(p: Project): string { return siteToday(this.now(), this.tz(p)); }
  /** A stored instant as the site sees it, e.g. "Tue 10/13 7:05 AM". */
  siteLabel(p: Project, iso: string): string { const w = toWallClock(new Date(iso), this.tz(p)); return fmtDate(ymd(w)) + ' ' + fmtClock(w); }
  siteClock(p: Project, iso: string): string { return fmtClock(toWallClock(new Date(iso), this.tz(p))); }

  // ================================================================ low-level helpers

  private async audit(actorId: string | null, action: string, e: Partial<AuditEntry> = {}) {
    await this.store.put('audit', Object.assign({ id: newId('a-'), at: this.nowIso(), actorId, action }, e));
  }

  /** Records and sends mail. Account emails (codes) are stored only in the demo. */
  private async mail(list: Omit<Mail, 'id' | 'ts'>[]) {
    for (const m of list) {
      const rec: Mail = Object.assign({ id: newId('m-'), ts: this.nowIso() }, m);
      if (m.kind !== 'account' || this.config.storeAccountMail) await this.store.put('mail', rec);
      try { await this.mailer.send(rec); } catch { /* delivery failures are logged by the mailer; the action still stands */ }
    }
  }

  /** Sliding-window rate limit. Returns false once `limit` hits fall inside `minutes`. */
  async throttle(key: string, limit: number, minutes: number): Promise<boolean> {
    return this.store.withLock('throttle:' + key, async () => {
      const t = this.now().getTime();
      const rec = (await this.store.get('throttle', key)) || { id: key, hits: [] };
      rec.hits = rec.hits.filter((h) => t - new Date(h).getTime() < minutes * 60000);
      if (rec.hits.length >= limit) return false;
      rec.hits.push(this.nowIso());
      await this.store.put('throttle', rec);
      return true;
    });
  }

  private async userByEmail(email: string): Promise<User | null> {
    const list = await this.store.find('users', { email: normEmail(email) });
    return list.find((u) => !u.deleted) || null;
  }

  private async activeUser(userId: string): Promise<User> {
    const u = await this.store.get('users', userId);
    if (!u || u.deleted || !u.verified) throw unauthenticated();
    return u;
  }

  private async liveProject(projectId: string): Promise<Project> {
    const p = await this.store.get('projects', projectId);
    if (!p || p.deleted) throw notFound('That project no longer exists.');
    return p;
  }

  private async activeMembers(projectId: string): Promise<Member[]> {
    return (await this.store.find('members', { projectId, status: 'active' }));
  }

  private async membership(projectId: string, userId: string): Promise<Member | null> {
    const m = await this.store.get('members', projectId + '__' + userId);
    return m && m.status === 'active' ? m : null;
  }

  /** Loads the caller, the project and their access, and checks a permission against the effective role. */
  async ctx(actor: Actor, projectId: string, action?: Action): Promise<Ctx> {
    const user = await this.activeUser(actor.userId);
    const project = await this.liveProject(projectId);
    const member = await this.membership(projectId, user.id);
    if (!member) throw forbidden('You’re not on this project.');
    const realRole = member.role;
    const canMaintain = user.isAdminAccount && realRole === 'admin';
    const view = actor.viewAs && isRole(actor.viewAs) && canMaintain ? actor.viewAs : null;
    const role = view || realRole;
    if (action && !can(role, action)) throw forbidden();
    return { user, project, member, realRole, role, maintenance: !!view };
  }

  private async emailsFor(projectId: string, role: Role): Promise<string[]> {
    const ms = (await this.activeMembers(projectId)).filter((m) => m.role === role);
    const out: string[] = [];
    for (const m of ms) { const u = await this.store.get('users', m.userId); if (u && !u.deleted) out.push(u.email); }
    return [...new Set(out)];
  }
  /** Emails to this project's admins only (never every admin account). */
  private async mailProjectAdmins(p: Project, subject: string, body: string) {
    const to = await this.emailsFor(p.id, 'admin');
    await this.mail(to.map((e) => ({ to: e, subject, body, kind: 'team' as MailKind, projectId: p.id })));
  }

  /** Companies that book on a project, built from its non-Access members. */
  async subsForProject(p: Project): Promise<Sub[]> {
    const out = new Map<string, Sub>();
    for (const m of await this.activeMembers(p.id)) {
      if (m.role === 'access') continue;
      const u = await this.store.get('users', m.userId); if (!u || u.deleted) continue;
      const key = companyKey(u.company);
      const cur = out.get(key) || { id: key, name: u.company, trade: '', suspended: !!(p.suspended && p.suspended[key]) };
      if (!cur.trade && m.trade) cur.trade = m.trade;
      out.set(key, cur);
    }
    return [...out.values()];
  }

  private noticeData(p: Project, r: DeliveryRequest, extra?: Partial<NoticeData>): NoticeData {
    return Object.assign({
      subId: r.subId, subName: r.subName, material: r.material, date: r.date, slot: r.slot,
      gateName: (p.gates.find((g) => g.id === r.gateId) || { name: r.gateId }).name,
      zoneName: (p.zones.find((z) => z.id === r.zoneId) || { name: r.zoneId }).name,
      passCode: r.passCode, requestId: r.id, reasons: r.reasons || [],
    }, extra || {});
  }

  /** Turns rule-engine notices into emails for real people on this project. */
  private async route(p: Project, list: Notice[], r: DeliveryRequest | null) {
    const out: Omit<Mail, 'id' | 'ts'>[] = [];
    const access = await this.emailsFor(p.id, 'access');
    const admins = await this.emailsFor(p.id, 'admin');
    for (const n of list) {
      const to = n.to === 'contractor' ? (r && r.submitterEmail ? [r.submitterEmail] : []) : n.to === 'security' ? access : admins;
      const attachQr = n.to === 'contractor' && (n.event === 'approved' || n.event === 'emergency') ? n.passCode : null;
      for (const email of new Set(to)) out.push({ to: email, role: n.to, subject: n.subject, body: n.body, kind: 'delivery', event: n.event, projectId: p.id, requestId: n.requestId || null, attachQr });
    }
    await this.mail(out);
  }
  private async notify(p: Project, event: NoticeEvent, r: DeliveryRequest, extra?: Partial<NoticeData>, filter?: (n: Notice) => boolean) {
    let list = notices(event, this.noticeData(p, r, extra));
    if (filter) list = list.filter(filter);
    await this.route(p, list, r);
  }

  // ================================================================ accounts

  private async issueCode(user: User, purpose: 'signup' | 'reset'): Promise<string> {
    const code = sixDigitCode(secureRandom);
    const cred = await this.store.get('credentials', user.id);
    if (cred) {
      cred.verify = { codeHash: await sha256Hex(user.id + ':' + code), exp: new Date(this.now().getTime() + CODE_TTL_MIN * 60000).toISOString(), purpose, tries: 0 };
      await this.store.put('credentials', cred);
    }
    await this.mail([{
      to: user.email, kind: 'account',
      subject: 'Your Granted code: ' + code,
      body: `Enter ${code} in Granted to ${purpose === 'reset' ? 'reset your password' : 'confirm your email'}. The code expires in ${CODE_TTL_MIN} minutes. If you didn’t ask for it, ignore this email.`,
    }]);
    return code;
  }

  private async checkCode(user: User, code: string, purpose: 'signup' | 'reset'): Promise<Credential> {
    const cred = await this.store.get('credentials', user.id);
    const v = cred && cred.verify;
    if (!cred || !v || v.purpose !== purpose) throw bad('That code isn’t right or has expired. Send a new one.');
    if (this.now().getTime() > new Date(v.exp).getTime()) throw bad('That code has expired. Send a new one.');
    if (v.tries >= CODE_MAX_TRIES) throw bad('Too many wrong codes. Send a new one.');
    if ((await sha256Hex(user.id + ':' + String(code || '').trim())) !== v.codeHash) {
      v.tries += 1; await this.store.put('credentials', cred);
      throw bad('That code doesn’t match. Check the email and try again.');
    }
    cred.verify = null;
    return cred;
  }

  /** Is this the admin set-up code? Callers rate-limit tries per email. */
  private async isAdminCode(code: string): Promise<boolean> {
    if (!this.config.adminCodeHash || !code) return false;
    return matchesAdminCode(normalizeProjectCode(code), this.config.adminCodeHash);
  }

  private async projectByCode(code: string): Promise<Project | null> {
    const c = normalizeProjectCode(code); if (!c) return null;
    return (await this.store.find('projects', { code: c })).find((p) => !p.deleted) || null;
  }

  async signUp(form: SignUpForm & { code?: string }, ip = ''): Promise<{ email: string; devCode?: string }> {
    if (!this.config.localAuth) throw forbidden('Sign up with your Microsoft or email sign-in.');
    if (!(await this.throttle('signup:' + ip, 20, 60))) throw tooMany();
    const v = validateSignUp(form);
    const errs: Record<string, string> = Object.assign({}, v.errors as Record<string, string>);
    const email = normEmail(form.email);
    const existing = errs.email ? null : await this.userByEmail(email);
    if (existing && existing.verified) errs.email = 'An account with this email already exists. Sign in instead, or reset your password.';
    const code = normalizeProjectCode(form.code);
    let kind: 'none' | 'admin' | 'join' | 'invalid' = 'none';
    if (code) {
      if (!(await this.throttle('code:' + email, 5, 60))) throw tooMany('Too many project code attempts. Try again in an hour.');
      const adminMatch = await this.isAdminCode(code);
      const cls = classifyProjectCode({ code, email, adminCodeMatches: adminMatch, projectExists: !adminMatch && !!(await this.projectByCode(code)) });
      kind = cls.kind;
      if (cls.kind === 'invalid') errs.code = cls.message;
    }
    if (Object.keys(errs).length) throw bad('Check the highlighted fields.', errs);

    const pw = await hashPassword(String(form.password), this.config.passwordIterations);
    const id = existing ? existing.id : newId('u-');
    const user: User = {
      id, email, first: str(form.first, 60), last: str(form.last, 60), phone: formatPhone(form.phone), company: str(form.company, 100),
      isAjax: v.isAjax, isAdminAccount: kind === 'admin', verified: false, createdAt: this.nowIso(), pendingCode: kind === 'join' ? code : '',
    };
    await this.store.put('users', user);
    await this.store.put('credentials', { id, hash: pw.hash, salt: pw.salt, iter: pw.iter, failures: [], sessionVersion: 1, verify: null });
    await this.audit(id, 'account.signUp', { details: { isAjax: user.isAjax, adminCode: kind === 'admin' } });
    const devCode = await this.issueCode(user, 'signup');
    return { email, devCode: this.config.exposeCodes ? devCode : undefined };
  }

  async resendCode(emailRaw: string, purpose: 'signup' | 'reset'): Promise<{ devCode?: string }> {
    const email = normEmail(emailRaw);
    if (!(await this.throttle('resend:' + email, 5, 60))) throw tooMany();
    const u = await this.userByEmail(email);
    if (!u || (purpose === 'signup' && u.verified)) return {};
    const code = await this.issueCode(u, purpose);
    return { devCode: this.config.exposeCodes ? code : undefined };
  }

  /** Confirms the email, signs the person in, applies invites and the project code typed at sign-up. */
  async verifyEmail(emailRaw: string, code: string): Promise<{ userId: string; sessionVersion: number; message: string }> {
    const u = await this.userByEmail(emailRaw);
    if (!u) throw bad('That code isn’t right or has expired. Send a new one.');
    if (!(await this.throttle('verify:' + u.id, 10, 15))) throw tooMany();
    const cred = await this.checkCode(u, code, 'signup');
    await this.store.put('credentials', cred);
    const pending = u.pendingCode || '';
    u.verified = true; u.lastLoginAt = this.nowIso(); delete u.pendingCode;
    await this.store.put('users', u);
    await this.audit(u.id, 'account.verified');
    if (u.isAdminAccount) await this.audit(u.id, 'account.adminGranted', { details: { via: 'signup admin code' } });
    const applied = await this.applyInvites(u);
    let message = u.isAdminAccount ? 'Welcome. Your Ajax admin account is ready. Tap + to create a project.' : applied[0] || 'Welcome to Granted.';
    if (pending) message = (await this.enterCode({ userId: u.id }, pending)).message;
    return { userId: u.id, sessionVersion: cred.sessionVersion, message };
  }

  async signIn(emailRaw: string, password: string, ip = ''): Promise<{ userId: string; sessionVersion: number } | { needsVerification: true; email: string; devCode?: string }> {
    if (!this.config.localAuth) throw forbidden('Use your Microsoft or email sign-in.');
    const email = normEmail(emailRaw);
    if (!email || !password) throw bad('Enter your email and password.');
    if (!(await this.throttle('signin-ip:' + ip, 60, 15))) throw tooMany();
    const u = await this.userByEmail(email);
    const cred = u ? await this.store.get('credentials', u.id) : null;
    if (!u || !cred) {
      await hashPassword(password, Math.min(this.config.passwordIterations, 100000)); // similar timing for unknown emails
      throw new GrantedError(401, 'bad_credentials', 'Email or password is incorrect.');
    }
    const ls = lockState(cred.failures, this.now());
    if (ls.locked) throw locked(`Too many attempts. Try again in ${plural(ls.minutesLeft, 'minute')}, or reset your password.`);
    if (!(await checkPassword(password, cred))) {
      cred.failures = (cred.failures || []).concat(this.nowIso()).slice(-10);
      await this.store.put('credentials', cred);
      const left = lockState(cred.failures, this.now());
      if (left.locked) { await this.audit(u.id, 'account.locked'); throw locked(`Too many attempts. Try again in ${plural(left.minutesLeft, 'minute')}.`); }
      throw new GrantedError(401, 'bad_credentials', 'Email or password is incorrect.' + (left.remaining <= 2 ? ` ${plural(left.remaining, 'attempt')} left before a 15-minute lock.` : ''));
    }
    cred.failures = [];
    // Upgrade old hashes to the current work factor on a successful sign-in.
    if (cred.iter < this.config.passwordIterations) Object.assign(cred, await hashPassword(password, this.config.passwordIterations));
    await this.store.put('credentials', cred);
    if (!u.verified) {
      const code = await this.issueCode(u, 'signup');
      return { needsVerification: true, email: u.email, devCode: this.config.exposeCodes ? code : undefined };
    }
    u.lastLoginAt = this.nowIso(); await this.store.put('users', u);
    await this.applyInvites(u);
    return { userId: u.id, sessionVersion: cred.sessionVersion };
  }

  /** Always answers the same way, whether or not the email has an account. */
  async startPasswordReset(emailRaw: string): Promise<{ devCode?: string }> {
    const email = normEmail(emailRaw);
    if (!isValidEmail(email)) throw bad('Enter a valid email address.');
    if (!(await this.throttle('reset:' + email, 5, 60))) throw tooMany();
    const u = await this.userByEmail(email);
    if (!u || !(await this.store.get('credentials', u.id))) return {};
    const code = await this.issueCode(u, 'reset');
    return { devCode: this.config.exposeCodes ? code : undefined };
  }

  async resetPassword(emailRaw: string, code: string, password: string): Promise<void> {
    const u = await this.userByEmail(emailRaw);
    if (!u) throw bad('That code isn’t right or has expired.');
    if (!isValidPassword(password)) throw bad('Password needs at least 8 characters with an uppercase letter, a lowercase letter and a number.');
    const cred = await this.checkCode(u, code, 'reset');
    Object.assign(cred, await hashPassword(password, this.config.passwordIterations), { failures: [], sessionVersion: cred.sessionVersion + 1 });
    await this.store.put('credentials', cred);
    if (!u.verified) { u.verified = true; await this.store.put('users', u); } // the code proves the email
    await this.audit(u.id, 'account.passwordReset');
  }

  async changePassword(actor: Actor, current: string, next: string): Promise<{ sessionVersion: number }> {
    const u = await this.activeUser(actor.userId);
    const cred = await this.store.get('credentials', u.id);
    if (!cred) throw bad('This account signs in with Microsoft. Change the password there.');
    if (!(await checkPassword(String(current || ''), cred))) throw bad('Current password is incorrect.');
    if (!isValidPassword(next)) throw bad('New password needs at least 8 characters with an uppercase letter, a lowercase letter and a number.');
    Object.assign(cred, await hashPassword(next, this.config.passwordIterations), { sessionVersion: cred.sessionVersion + 1 });
    await this.store.put('credentials', cred);
    await this.audit(u.id, 'account.passwordChanged');
    return { sessionVersion: cred.sessionVersion };
  }

  /** Current session version for a user; the API rejects tokens from before a password change. */
  async sessionVersion(userId: string): Promise<number | null> {
    const u = await this.store.get('users', userId);
    if (!u || u.deleted || !u.verified) return null;
    const c = await this.store.get('credentials', userId);
    return c ? c.sessionVersion : 1;
  }

  async me(actor: Actor): Promise<PublicUser> { return publicUser(await this.activeUser(actor.userId)); }

  // ---------------- Entra External ID sign-in (AUTH_MODE=external) ----------------

  /** The Granted user linked to an External ID account, if the profile was completed. */
  async userIdForExternal(externalId: string): Promise<string | null> {
    const u = (await this.store.find('users', { externalId })).find((x) => !x.deleted && x.verified);
    return u ? u.id : null;
  }

  /**
   * First sign-in through External ID: the identity service has already confirmed the email
   * and holds the password. Granted stores the profile fields and handles the project code.
   */
  async createExternalProfile(externalId: string, emailRaw: string, f: { first: string; last: string; phone: string; company: string; code?: string }): Promise<{ userId: string; message: string }> {
    const email = normEmail(emailRaw);
    if (!isValidEmail(email)) throw bad('Your sign-in has no email address. Contact support.');
    if (await this.userIdForExternal(externalId)) throw conflict('Your profile is already set up.');
    const first = str(f.first, 60), last = str(f.last, 60), company = str(f.company, 100);
    if (!first || !last || !company || !isValidPhone(f.phone)) throw bad('Fill in every field with a 10-digit phone number.');
    const existing = await this.userByEmail(email);
    if (existing && existing.verified && existing.externalId && existing.externalId !== externalId) throw conflict('This email is linked to another sign-in.');
    const code = normalizeProjectCode(f.code);
    let isAdmin = existing ? existing.isAdminAccount : false;
    if (code) {
      if (!(await this.throttle('code:' + email, 5, 60))) throw tooMany('Too many project code attempts. Try again in an hour.');
      const adminMatch = await this.isAdminCode(code);
      const cls = classifyProjectCode({ code, email, adminCodeMatches: adminMatch, projectExists: !adminMatch && !!(await this.projectByCode(code)) });
      if (cls.kind === 'invalid') throw bad(cls.message, { code: cls.message });
      if (cls.kind === 'admin') isAdmin = true;
    }
    const u: User = {
      id: existing ? existing.id : newId('u-'), email, first, last, phone: formatPhone(f.phone), company, isAjax: isAjaxEmail(email),
      isAdminAccount: isAdmin, verified: true, createdAt: existing ? existing.createdAt : this.nowIso(), lastLoginAt: this.nowIso(), externalId,
    };
    await this.store.put('users', u);
    await this.audit(u.id, 'account.externalProfile', { details: { adminCode: isAdmin && !(existing && existing.isAdminAccount) } });
    const applied = await this.applyInvites(u);
    let message = isAdmin ? 'Welcome. Your Ajax admin account is ready. Tap + to create a project.' : applied[0] || 'Welcome to Granted.';
    if (code && !isAdmin) message = (await this.enterCode({ userId: u.id }, code)).message;
    return { userId: u.id, message };
  }

  async updateProfile(actor: Actor, f: { first: string; last: string; phone: string; company: string }): Promise<PublicUser> {
    const u = await this.activeUser(actor.userId);
    const first = str(f.first, 60), last = str(f.last, 60), company = str(f.company, 100);
    if (!first || !last || !company || !isValidPhone(f.phone)) throw bad('Fill in every field with a 10-digit phone number.');
    Object.assign(u, { first, last, company, phone: formatPhone(f.phone) });
    await this.store.put('users', u);
    return publicUser(u);
  }

  /**
   * Deletes the account (App Store guideline 5.1.1(v)). Profile and access are removed;
   * delivery records stay on the project for audit, without the person's name or contact details.
   */
  async deleteAccount(actor: Actor, password?: string): Promise<void> {
    const u = await this.activeUser(actor.userId);
    const cred = await this.store.get('credentials', u.id);
    if (cred && !(await checkPassword(String(password || ''), cred))) throw bad('Enter your current password to delete your account.');
    const mine = await this.store.find('members', { userId: u.id, status: 'active' });
    for (const m of mine) {
      if (m.role !== 'admin') continue;
      const admins = (await this.activeMembers(m.projectId)).filter((x) => x.role === 'admin');
      const p = await this.store.get('projects', m.projectId);
      if (admins.length < 2 && p && !p.deleted) throw conflict(`You’re the only admin on ${p.name}. Make someone else an admin first, or delete the project.`);
    }
    const at = this.nowIso();
    for (const m of mine) await this.store.put('members', Object.assign(m, { status: 'removed' as const, removedAt: at, removedBy: 'account deleted' }));
    for (const j of await this.store.find('joinreqs', { userId: u.id, status: 'pending' })) await this.store.put('joinreqs', Object.assign(j, { status: 'declined' as const, decidedAt: at, decidedBy: 'account deleted' }));
    for (const r of await this.store.find('requests', { userId: u.id })) {
      await this.store.put('requests', Object.assign(r, { submitterEmail: '', submittedBy: 'Deleted user', pocName: r.pocName === nameOf(u) ? 'Deleted user' : r.pocName, pocPhone: r.pocPhone === u.phone ? '' : r.pocPhone }));
    }
    for (const m of await this.store.find('mail', { to: u.email })) await this.store.remove('mail', m.id);
    await this.store.remove('credentials', u.id);
    await this.store.put('users', { id: u.id, email: 'deleted-' + u.id + '@invalid', first: 'Deleted', last: 'user', phone: '', company: u.company, isAjax: false, isAdminAccount: false, verified: false, createdAt: u.createdAt, deleted: true, deletedAt: at });
    await this.audit(u.id, 'account.deleted');
  }

  // ================================================================ projects and membership

  private async addMember(projectId: string, userId: string, role: Role, trade: string, via: Member['via'], by: string) {
    const id = projectId + '__' + userId;
    await this.store.put('members', { id, projectId, userId, role, trade: trade || '', status: 'active', addedAt: this.nowIso(), addedBy: by || '', via });
  }

  /** Applies pending invites addressed to this person's confirmed email. Returns messages to show. */
  async applyInvites(u: User): Promise<string[]> {
    const out: string[] = [];
    const pend = await this.store.find('invites', { email: u.email, status: 'pending' });
    for (const inv of pend) {
      if (new Date(inv.expiresAt).getTime() < this.now().getTime()) { await this.store.put('invites', Object.assign(inv, { status: 'expired' as const })); continue; }
      const p = await this.store.get('projects', inv.projectId);
      if (!p || p.deleted) continue;
      if (!(await this.membership(p.id, u.id))) await this.addMember(p.id, u.id, inv.role, inv.trade, 'invite', inv.by);
      await this.store.put('invites', Object.assign(inv, { status: 'accepted' as const, acceptedAt: this.nowIso(), userId: u.id }));
      for (const jr of await this.store.find('joinreqs', { projectId: p.id, userId: u.id, status: 'pending' })) {
        await this.store.put('joinreqs', Object.assign(jr, { status: 'approved' as const, role: inv.role, decidedAt: this.nowIso(), decidedBy: 'invite' }));
      }
      await this.audit(u.id, 'team.inviteAccepted', { projectId: p.id, target: inv.id, details: { role: inv.role } });
      await this.mailProjectAdmins(p, `${nameOf(u)} joined ${p.name} as ${roleLabel(inv.role)}`, `${nameOf(u)} (${u.company}, ${u.email}) accepted your invite and now has ${roleLabel(inv.role)} access to ${p.name}.`);
      out.push(`You now have ${roleLabel(inv.role)} access to ${p.name}.`);
    }
    return out;
  }

  async home(actor: Actor): Promise<HomeView> {
    const u = await this.activeUser(actor.userId);
    const notes = await this.applyInvites(u);
    const projects: HomeView['projects'] = [];
    for (const m of await this.store.find('members', { userId: u.id, status: 'active' })) {
      const p = await this.store.get('projects', m.projectId);
      if (p && !p.deleted) projects.push({ id: p.id, name: p.name, code: p.code, location: p.location, role: m.role });
    }
    projects.sort((a, b) => a.name.localeCompare(b.name));
    const pending: HomeView['pending'] = [];
    for (const j of await this.store.find('joinreqs', { userId: u.id, status: 'pending' })) {
      const p = await this.store.get('projects', j.projectId);
      if (p && !p.deleted) pending.push({ projectId: p.id, name: p.name });
    }
    return { me: publicUser(u), projects, pending, notices: notes };
  }

  /** A code typed in "Add a project": the admin set-up code, an invite, a join request, or already a member. */
  async enterCode(actor: Actor, raw: string): Promise<{ ok: boolean; message: string; projectId?: string }> {
    const u = await this.activeUser(actor.userId);
    const code = normalizeProjectCode(raw);
    if (!code) throw bad('Enter a project code.');
    if (!(await this.throttle('code:' + u.email, 10, 60))) throw tooMany('Too many project code attempts. Try again in an hour.');
    const adminMatch = await this.isAdminCode(code);
    const p = adminMatch ? null : await this.projectByCode(code);
    const cls = classifyProjectCode({ code, email: u.email, adminCodeMatches: adminMatch, projectExists: !!p, alreadyAdminAccount: u.isAdminAccount });
    if (cls.kind === 'invalid' || cls.kind === 'none') throw bad(cls.message || CODE_NOT_FOUND);
    if (cls.kind === 'admin') {
      if (!u.isAdminAccount) {
        u.isAdminAccount = true; await this.store.put('users', u);
        await this.audit(u.id, 'account.adminGranted', { details: { via: 'admin code' } });
      }
      return { ok: true, message: cls.message };
    }
    const proj = p as Project;
    if (await this.membership(proj.id, u.id)) return { ok: true, message: `You’re already on ${proj.name}.`, projectId: proj.id };
    const inv = (await this.store.find('invites', { projectId: proj.id, email: u.email, status: 'pending' }))[0];
    if (inv) { await this.applyInvites(u); return { ok: true, message: `Invite accepted. You have ${roleLabel(inv.role)} access to ${proj.name}.`, projectId: proj.id }; }
    const open = (await this.store.find('joinreqs', { projectId: proj.id, userId: u.id, status: 'pending' }))[0];
    if (open) return { ok: true, message: `Your request to join ${proj.name} is still waiting for an admin.` };
    const jr: JoinRequest = { id: newId('j-'), projectId: proj.id, userId: u.id, at: this.nowIso(), status: 'pending' };
    await this.store.put('joinreqs', jr);
    await this.audit(u.id, 'team.joinRequested', { projectId: proj.id, target: jr.id });
    await this.mailProjectAdmins(proj, `Join request: ${nameOf(u)} (${u.company}) for ${proj.name}`,
      `${nameOf(u)} from ${u.company} (${u.email}, ${u.phone}) asked to join ${proj.name} with project code ${proj.code}.\nOpen Granted → Approvals to approve them as Contractor, Access Control or Admin, or to decline.`);
    return { ok: true, message: `Request sent. The ${proj.name} admins will choose your access.` };
  }

  async createProject(actor: Actor, input: { name: string; location?: string; timeZone?: string; sampleLookahead?: boolean }): Promise<Project> {
    const u = await this.activeUser(actor.userId);
    if (!u.isAdminAccount || !isAjaxEmail(u.email)) throw forbidden('Only Ajax admin accounts can create projects.');
    const name = str(input.name, 80);
    if (!name) throw bad('Enter a project name.');
    const timeZone = input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : this.config.defaultTimeZone;
    let code = '';
    for (let i = 0; i < 20 && !code; i++) { const c = newProjectCode(name, [], secureRandom); if (!(await this.projectByCode(c))) code = c; }
    if (!code) throw conflict('Could not create a unique project code. Try again.');
    const settings: Settings = Object.assign({}, DEFAULT_SETTINGS, { project: name, timeZone, passPrefix: passPrefixFromCode(code), workDays: [...DEFAULT_SETTINGS.workDays], blackoutDates: [] });
    const p: Project = {
      id: newId('p-'), name, location: str(input.location, 120), code, createdBy: u.id, createdAt: this.nowIso(), deleted: false, suspended: {},
      gates: DEFAULT_GATES.map((g) => ({ ...g })), zones: DEFAULT_ZONES.map((z) => ({ ...z })), activities: [], settings,
    };
    if (input.sampleLookahead) p.activities = sampleActivities(nextWorkDay(siteToday(this.now(), timeZone), settings));
    await this.store.put('projects', p);
    await this.addMember(p.id, u.id, 'admin', '', 'creator', u.id);
    await this.audit(u.id, 'project.created', { projectId: p.id, details: { code } });
    await this.mail([{ to: u.email, subject: `Project created: ${p.name} (${p.code})`, body: `Your project ${p.name} is ready. Share project code ${p.code} with your team, or invite people from Team & Invites. Everyone who joins needs your approval.`, kind: 'team', projectId: p.id }]);
    return p;
  }

  async leaveProject(actor: Actor, projectId: string): Promise<void> {
    const u = await this.activeUser(actor.userId);
    const m = await this.membership(projectId, u.id);
    if (!m) return;
    if (m.role === 'admin' && (await this.activeMembers(projectId)).filter((x) => x.role === 'admin').length < 2) throw conflict('You’re the only admin. Make someone else an admin first.');
    await this.store.put('members', Object.assign(m, { status: 'removed' as const, removedAt: this.nowIso(), removedBy: u.id }));
    await this.audit(u.id, 'team.left', { projectId });
  }

  async saveProjectSettings(actor: Actor, projectId: string, patch: {
    name?: string; location?: string; timeZone?: string;
    settings?: Partial<Pick<Settings, 'minNoticeHours' | 'maxDaysBeforeInstall' | 'gateToleranceMinutes' | 'maxPalletsPerRequest' | 'gateOpen' | 'gateClose' | 'workDays' | 'blackoutDates' | 'slotMinutes' | 'noShowGraceMinutes' | 'duplicateWindowDays'>>;
    gates?: Gate[]; zones?: Zone[];
  }): Promise<void> {
    const c = await this.ctx(actor, projectId, 'project.settings');
    const p = c.project;
    const int = (v: unknown, min: number, max: number, cur: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : cur; };
    const hhmm = (v: unknown, cur: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : cur);
    if (patch.name !== undefined) { const n = str(patch.name, 80); if (!n) throw bad('Enter a project name.'); p.name = n; p.settings.project = n; }
    if (patch.location !== undefined) p.location = str(patch.location, 120);
    if (patch.timeZone !== undefined) { if (!isValidTimeZone(patch.timeZone)) throw bad('Choose a valid time zone.'); p.settings.timeZone = patch.timeZone; }
    const s = patch.settings || {}; const cur = p.settings;
    const next: Settings = Object.assign({}, cur, {
      minNoticeHours: s.minNoticeHours === undefined ? cur.minNoticeHours : int(s.minNoticeHours, 0, 336, cur.minNoticeHours),
      maxDaysBeforeInstall: s.maxDaysBeforeInstall === undefined ? cur.maxDaysBeforeInstall : int(s.maxDaysBeforeInstall, 0, 60, cur.maxDaysBeforeInstall),
      gateToleranceMinutes: s.gateToleranceMinutes === undefined ? cur.gateToleranceMinutes : int(s.gateToleranceMinutes, 0, 240, cur.gateToleranceMinutes),
      maxPalletsPerRequest: s.maxPalletsPerRequest === undefined ? cur.maxPalletsPerRequest : int(s.maxPalletsPerRequest, 1, 500, cur.maxPalletsPerRequest),
      noShowGraceMinutes: s.noShowGraceMinutes === undefined ? cur.noShowGraceMinutes : int(s.noShowGraceMinutes, 0, 480, cur.noShowGraceMinutes),
      duplicateWindowDays: s.duplicateWindowDays === undefined ? cur.duplicateWindowDays : int(s.duplicateWindowDays, 0, 60, cur.duplicateWindowDays),
      slotMinutes: s.slotMinutes === undefined ? cur.slotMinutes : ([15, 30, 60, 90, 120].includes(Number(s.slotMinutes)) ? Number(s.slotMinutes) : cur.slotMinutes),
      gateOpen: hhmm(s.gateOpen, cur.gateOpen), gateClose: hhmm(s.gateClose, cur.gateClose),
      workDays: Array.isArray(s.workDays) ? [...new Set(s.workDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : cur.workDays,
      blackoutDates: Array.isArray(s.blackoutDates) ? s.blackoutDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))).slice(0, 200) : cur.blackoutDates,
    });
    if (next.gateOpen >= next.gateClose) throw bad('Gate closing time must be after opening time.');
    if (!slotsForDay(next).length) throw bad('Gate hours are shorter than one time slot.');
    p.settings = next;
    if (patch.gates) {
      if (!patch.gates.length || patch.gates.length > 12) throw bad('A project needs 1 to 12 gates.');
      p.gates = patch.gates.map((g, i) => ({ id: str(g.id, 20) || 'G' + (i + 1), name: str(g.name, 60) || 'Gate ' + (i + 1), capacityPerSlot: int(g.capacityPerSlot, 0, 20, 1) }));
    }
    if (patch.zones) {
      if (!patch.zones.length || patch.zones.length > 40) throw bad('A project needs 1 to 40 staging zones.');
      p.zones = patch.zones.map((z, i) => ({ id: str(z.id, 20) || 'Z' + (i + 1), name: str(z.name, 60) || 'Zone ' + (i + 1), capacityPallets: int(z.capacityPallets, 0, 10000, 0) }));
    }
    await this.store.put('projects', p);
    await this.audit(c.user.id, 'project.settings', { projectId, maintenance: c.maintenance || undefined });
  }

  /** Replaces the 3-week look-ahead (the weekly upload). */
  async replaceLookahead(actor: Actor, projectId: string, activities: Activity[]): Promise<number> {
    const c = await this.ctx(actor, projectId, 'project.settings');
    const ok = /^\d{4}-\d{2}-\d{2}$/;
    const list = (activities || []).slice(0, 2000).map((a) => ({ id: str(a.id, 30), name: str(a.name, 120), trade: str(a.trade, 40), start: String(a.start), finish: String(a.finish) }))
      .filter((a) => a.id && a.name && ok.test(a.start) && ok.test(a.finish) && a.start <= a.finish);
    if (!list.length) throw bad('No valid activities found. Each row needs an ID, name, trade, start and finish date.');
    if (new Set(list.map((a) => a.id)).size !== list.length) throw bad('Activity IDs must be unique.');
    c.project.activities = list;
    await this.store.put('projects', c.project);
    await this.audit(c.user.id, 'project.lookahead', { projectId, details: { count: list.length } });
    return list.length;
  }

  async regenerateCode(actor: Actor, projectId: string): Promise<string> {
    const c = await this.ctx(actor, projectId, 'project.settings');
    if (!c.user.isAdminAccount) throw forbidden('Only Ajax admin accounts can replace a project code.');
    let code = '';
    for (let i = 0; i < 20 && !code; i++) { const x = newProjectCode(c.project.name, [c.project.code], secureRandom); if (!(await this.projectByCode(x))) code = x; }
    if (!code) throw conflict('Could not create a unique project code. Try again.');
    const old = c.project.code; c.project.code = code;
    await this.store.put('projects', c.project);
    await this.audit(c.user.id, 'project.codeReplaced', { projectId, details: { old, code } });
    return code;
  }

  async deleteProject(actor: Actor, projectId: string, confirmCode: string): Promise<void> {
    const c = await this.ctx(actor, projectId, 'project.delete');
    if (!c.user.isAdminAccount) throw forbidden('Only Ajax admin accounts can delete projects.');
    if (normalizeProjectCode(confirmCode) !== c.project.code) throw bad('The code doesn’t match.');
    Object.assign(c.project, { deleted: true, deletedAt: this.nowIso(), deletedBy: c.user.id });
    await this.store.put('projects', c.project);
    await this.audit(c.user.id, 'project.deleted', { projectId });
  }

  async setSuspended(actor: Actor, projectId: string, subId: string, suspended: boolean): Promise<void> {
    const c = await this.ctx(actor, projectId, 'project.settings');
    c.project.suspended = Object.assign({}, c.project.suspended, { [subId]: !!suspended });
    await this.store.put('projects', c.project);
    await this.audit(c.user.id, suspended ? 'project.companySuspended' : 'project.companyRestored', { projectId, target: subId });
  }

  // ================================================================ team

  async decideJoin(actor: Actor, joinId: string, approve: boolean, role: Role = 'contractor', trade = ''): Promise<void> {
    const j = await this.store.get('joinreqs', joinId);
    if (!j) throw notFound('That request no longer exists.');
    const c = await this.ctx(actor, j.projectId, 'team.approve');
    if (j.status !== 'pending') throw conflict('Someone already handled this request.');
    if (approve && !isRole(role)) throw bad('Choose an access level.');
    if (trade && !TRADES.includes(trade)) throw bad('Choose a trade from the list.');
    const u = await this.store.get('users', j.userId);
    if (!u || u.deleted) throw notFound('That person’s account no longer exists.');
    if (approve) await this.addMember(c.project.id, u.id, role, trade, 'request', c.user.id);
    await this.store.put('joinreqs', Object.assign(j, { status: approve ? 'approved' as const : 'declined' as const, role: approve ? role : null, decidedBy: c.user.id, decidedAt: this.nowIso() }));
    await this.audit(c.user.id, approve ? 'team.joinApproved' : 'team.joinDeclined', { projectId: c.project.id, target: u.id, details: { role: approve ? role : null }, maintenance: c.maintenance || undefined });
    await this.mail([{ to: u.email, kind: 'team', projectId: c.project.id,
      subject: approve ? `You’re on ${c.project.name}` : `Request to join ${c.project.name}`,
      body: approve ? `A project admin approved you for ${c.project.name} with ${roleLabel(role)} access. Open Granted to get started.` : `A project admin declined your request to join ${c.project.name}. If you think this is a mistake, contact the project admin.` }]);
  }

  async invite(actor: Actor, projectId: string, input: { email: string; role: Role; trade?: string }): Promise<Invite> {
    const c = await this.ctx(actor, projectId, 'team.invite');
    const email = normEmail(input.email);
    if (!isValidEmail(email)) throw bad('Enter a valid email address.');
    if (!isRole(input.role)) throw bad('Choose an access level.');
    const trade = input.trade || '';
    if (trade && !TRADES.includes(trade)) throw bad('Choose a trade from the list.');
    if (!(await this.throttle('invite:' + c.user.id, 100, 60 * 24))) throw tooMany('Too many invites today.');
    const existing = await this.userByEmail(email);
    if (existing && (await this.membership(projectId, existing.id))) throw conflict('That person is already on this project.');
    if ((await this.store.find('invites', { projectId, email, status: 'pending' })).length) throw conflict('An invite to that email is already pending.');
    const p = c.project;
    const inv: Invite = { id: newId('i-'), projectId, email, role: input.role, trade, by: c.user.id, at: this.nowIso(), expiresAt: new Date(this.now().getTime() + this.config.inviteDays * 86400000).toISOString(), status: 'pending' };
    await this.store.put('invites', inv);
    await this.audit(c.user.id, 'team.invited', { projectId, target: email, details: { role: input.role }, maintenance: c.maintenance || undefined });
    await this.mail([{ to: email, kind: 'team', projectId,
      subject: `${nameOf(c.user)} invited you to ${p.name} on Granted`,
      body: `You’ve been invited to ${p.name} with ${roleLabel(input.role)} access.\n${existing ? 'Sign in to Granted' : 'Get Granted and create an account'} with this email (${email}). Your access is set up automatically. The invite expires in ${this.config.inviteDays} days.\n${this.config.appUrl}` }]);
    if (existing && existing.verified) await this.applyInvites(existing);
    return inv;
  }

  async revokeInvite(actor: Actor, inviteId: string): Promise<void> {
    const inv = await this.store.get('invites', inviteId);
    if (!inv) throw notFound('That invite no longer exists.');
    const c = await this.ctx(actor, inv.projectId, 'team.invite');
    if (inv.status !== 'pending') throw conflict('That invite was already used or revoked.');
    await this.store.put('invites', Object.assign(inv, { status: 'revoked' as const }));
    await this.audit(c.user.id, 'team.inviteRevoked', { projectId: inv.projectId, target: inv.email });
  }

  async changeRole(actor: Actor, memberId: string, role: Role, trade?: string): Promise<void> {
    const m = await this.store.get('members', memberId);
    if (!m || m.status !== 'active') throw notFound('That person is no longer on this project.');
    const c = await this.ctx(actor, m.projectId, 'team.changeRole');
    if (!isRole(role)) throw bad('Choose an access level.');
    if (m.userId === c.user.id) throw forbidden('Ask another admin to change your own access.');
    if (trade !== undefined && trade && !TRADES.includes(trade)) throw bad('Choose a trade from the list.');
    if (m.role === 'admin' && role !== 'admin' && (await this.activeMembers(m.projectId)).filter((x) => x.role === 'admin').length < 2) throw conflict('A project needs at least one admin.');
    const before = m.role;
    m.role = role; if (trade !== undefined) m.trade = trade;
    await this.store.put('members', m);
    await this.audit(c.user.id, 'team.roleChanged', { projectId: m.projectId, target: m.userId, details: { from: before, to: role }, maintenance: c.maintenance || undefined });
    const u = await this.store.get('users', m.userId);
    if (u && before !== role) {
      await this.mail([{ to: u.email, kind: 'team', projectId: m.projectId, subject: `Your access on ${c.project.name} changed`, body: `You now have ${roleLabel(role)} access on ${c.project.name}.` }]);
      if (role === 'admin' || before === 'admin') {
        await this.mailProjectAdmins(c.project, `Admin change on ${c.project.name}`, `${nameOf(c.user)} changed ${nameOf(u)} from ${roleLabel(before)} to ${roleLabel(role)} on ${c.project.name}.`);
      }
    }
  }

  async removeMember(actor: Actor, memberId: string): Promise<void> {
    const m = await this.store.get('members', memberId);
    if (!m || m.status !== 'active') throw notFound('That person is no longer on this project.');
    const c = await this.ctx(actor, m.projectId, 'team.remove');
    if (m.userId === c.user.id) throw forbidden('Use Settings → My projects → Leave to remove yourself.');
    if (m.role === 'admin' && (await this.activeMembers(m.projectId)).filter((x) => x.role === 'admin').length < 2) throw conflict('A project needs at least one admin.');
    await this.store.put('members', Object.assign(m, { status: 'removed' as const, removedAt: this.nowIso(), removedBy: c.user.id }));
    await this.audit(c.user.id, 'team.removed', { projectId: m.projectId, target: m.userId, maintenance: c.maintenance || undefined });
    const u = await this.store.get('users', m.userId);
    if (u) await this.mail([{ to: u.email, kind: 'team', projectId: m.projectId, subject: `Removed from ${c.project.name}`, body: `A project admin removed your access to ${c.project.name}. Your past deliveries stay on record.` }]);
  }

  // ================================================================ the project view

  async projectView(actor: Actor, projectId: string): Promise<ProjectView> {
    const c = await this.ctx(actor, projectId);
    const p = c.project; const role = c.role; const today = this.siteToday(p);
    const subs = await this.subsForProject(p);
    const myKey = companyKey(c.user.company);
    const mySub = subs.find((s) => s.id === myKey) || { id: myKey, name: c.user.company, trade: '', suspended: !!p.suspended[myKey] };
    const all = await this.store.find('requests', { projectId });
    const allPasses = await this.store.find('passes', { projectId });
    let requests: DeliveryRequest[] = [];
    if (can(role, 'delivery.viewAll')) requests = all;
    else {
      if (can(role, 'delivery.viewOwn')) requests = all.filter((r) => r.subId === myKey);
      if (can(role, 'gate.viewToday')) {
        const ids = new Set(requests.map((r) => r.id));
        for (const r of all) if (r.date === today && (r.status === 'approved' || r.status === 'cancelled') && !ids.has(r.id)) requests.push(r);
      }
    }
    const visible = new Set(requests.map((r) => r.id));
    const occupancy: Occupancy[] = can(role, 'delivery.request')
      ? all.filter((r) => !visible.has(r.id) && (r.status === 'approved' || r.status === 'review')).map((r) => ({
        id: r.id, gateId: r.gateId, date: r.date, slot: r.slot, zoneId: r.zoneId, pallets: r.pallets, stagedUntil: r.stagedUntil, status: r.status, subId: 'other', activityId: '',
      }))
      : [];
    const passes = allPasses.filter((x) => visible.has(x.requestId));
    const gatelog = can(role, 'gate.viewLog') ? await this.store.find('gatelog', { projectId }) : [];
    let members: MemberView[] = []; let joinreqs: JoinView[] = []; let invites: Invite[] = [];
    if (can(role, 'team.approve')) {
      for (const m of await this.activeMembers(projectId)) {
        const u = await this.store.get('users', m.userId); if (!u || u.deleted) continue;
        members.push({ id: m.id, userId: u.id, role: m.role, trade: m.trade, via: m.via, addedAt: m.addedAt, name: nameOf(u), email: u.email, company: u.company, phone: u.phone, isAjax: u.isAjax });
      }
      for (const j of await this.store.find('joinreqs', { projectId, status: 'pending' })) {
        const u = await this.store.get('users', j.userId); if (!u || u.deleted) continue;
        joinreqs.push(Object.assign({}, j, { name: nameOf(u), email: u.email, company: u.company, phone: u.phone, isAjax: u.isAjax }));
      }
      invites = await this.store.find('invites', { projectId, status: 'pending' });
    }
    const mail = can(role, 'delivery.viewAll')
      ? (await this.store.find('mail', { projectId })).filter((m) => m.kind !== 'account')
      : (await this.store.find('mail', { to: c.user.email })).filter((m) => m.projectId === projectId);
    mail.sort((a, b) => b.ts.localeCompare(a.ts));
    return {
      project: { id: p.id, name: p.name, location: p.location, code: p.code, timeZone: this.tz(p), settings: p.settings, gates: p.gates, zones: p.zones, activities: p.activities, demoAnchor: p.demoAnchor },
      role, realRole: c.realRole, maintenance: c.maintenance, canMaintain: c.user.isAdminAccount && c.realRole === 'admin',
      mySub, subs: can(role, 'delivery.viewAll') ? subs : [mySub],
      requests, occupancy, passes, gatelog, members, joinreqs, invites, mail: mail.slice(0, 200), serverTime: this.nowIso(),
    };
  }

  // ================================================================ deliveries

  private async rulesCtx(p: Project) {
    return {
      now: this.siteNow(p), settings: p.settings, gates: p.gates, zones: p.zones, activities: p.activities || [],
      subs: await this.subsForProject(p),
      requests: await this.store.find('requests', { projectId: p.id }),
    };
  }

  private async issuePass(p: Project, requestId: string, override: boolean): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = newPassCode([], p.settings, secureRandom);
      if (!(await this.store.get('passes', code))) {
        await this.store.put('passes', { id: code, code, projectId: p.id, requestId, status: 'active', issuedAt: this.nowIso(), override });
        return code;
      }
    }
    throw conflict('Could not create a unique gate pass. Try again.');
  }

  /** Submits a new request, or reschedules one (input.id). Runs every rule on the server under a project lock. */
  async submitRequest(actor: Actor, projectId: string, input: DeliveryInput): Promise<{ request: DeliveryRequest; nextOpen: { date: string; slot: string; label: string } | null }> {
    const c = await this.ctx(actor, projectId, 'delivery.request');
    if (!(await this.throttle('request:' + c.user.id, 60, 60))) throw tooMany('Too many requests in an hour. Try again later.');
    return this.store.withLock('project:' + projectId, async () => {
      const p = await this.liveProject(projectId);
      const myKey = companyKey(c.user.company);
      const existing = input.id ? await this.store.get('requests', String(input.id)) : null;
      if (input.id) {
        if (!existing || existing.projectId !== projectId) throw notFound('That delivery no longer exists.');
        if (existing.subId !== myKey && !can(c.role, 'delivery.viewAll')) throw forbidden('You can only change your own company’s deliveries.');
        if (!['approved', 'review', 'rejected'].includes(existing.status)) throw conflict('That delivery was cancelled. Book a new one.');
      }
      const subId = existing ? existing.subId : myKey;
      const subName = existing ? existing.subName : c.user.company;
      const clean = {
        id: existing ? existing.id : newId('r-'),
        subId, activityId: str(input.activityId, 30), gateId: str(input.gateId, 20), date: str(input.date, 10), slot: str(input.slot, 5), zoneId: str(input.zoneId, 20),
        material: str(input.material, 120), quantity: input.quantity === '' ? '' : Number(input.quantity), unit: str(input.unit, 20),
        pallets: input.pallets === '' ? '' : Number(input.pallets), pocName: str(input.pocName, 80), pocPhone: str(input.pocPhone, 20), justification: str(input.justification, 500),
      };
      if (clean.unit && !UNITS.includes(clean.unit)) throw bad('Choose a unit from the list.');
      const ctx = await this.rulesCtx(p);
      const ev = evaluateRequest(clean, ctx);
      const missing = ev.checks.find((k) => k.reason === 'R01');
      if (missing) throw bad(missing.title + '. ' + missing.remedy);
      const wl = input.weightLbs === '' || input.weightLbs === null || input.weightLbs === undefined ? null : Math.max(0, Math.round(Number(input.weightLbs)) || 0);
      const r: DeliveryRequest = Object.assign({}, existing || {}, {
        id: clean.id, projectId, subId, subName, userId: existing ? existing.userId : c.user.id,
        submitterEmail: existing ? existing.submitterEmail : c.user.email, submittedBy: existing ? existing.submittedBy : nameOf(c.user),
        activityId: clean.activityId, gateId: clean.gateId, date: clean.date, slot: clean.slot, zoneId: clean.zoneId, material: clean.material,
        quantity: Number(clean.quantity), unit: clean.unit, pallets: Number(clean.pallets), weightLbs: wl, carrier: str(input.carrier, 80), truck: str(input.truck, 40),
        pocName: clean.pocName, pocPhone: formatPhone(clean.pocPhone), justification: clean.justification,
        status: ev.outcome, stagedUntil: ev.stagedUntil, reasons: ev.checks.filter((k) => k.reason).map((k) => ({ code: k.reason as string, title: k.title as string, remedy: k.remedy as string })),
        submittedAt: this.nowIso(), decidedAt: this.nowIso(), decidedBy: 'Rules engine', passCode: null,
      });
      delete r.cancelledAt; delete r.reviewNote; delete r.noshowNotified;
      if (c.maintenance) r.maintenance = true;
      if (existing && existing.passCode) {
        const old = await this.store.get('passes', existing.passCode);
        if (old && old.status === 'active') await this.store.put('passes', Object.assign(old, { status: 'void' as const, voidedAt: this.nowIso(), voidReason: 'Rescheduled' }));
      }
      if (ev.outcome === 'approved') r.passCode = await this.issuePass(p, r.id, false);
      await this.store.put('requests', r);
      await this.audit(c.user.id, existing ? 'delivery.rescheduled' : 'delivery.submitted', { projectId, target: r.id, details: { outcome: ev.outcome, reasons: ev.reasons }, maintenance: c.maintenance || undefined });
      await this.notify(p, ev.outcome, r);
      return { request: r, nextOpen: ev.nextOpen };
    });
  }

  async cancelRequest(actor: Actor, requestId: string): Promise<void> {
    const r = await this.store.get('requests', requestId);
    if (!r) throw notFound('That delivery no longer exists.');
    const c = await this.ctx(actor, r.projectId, 'delivery.viewOwn');
    if (r.subId !== companyKey(c.user.company) && !can(c.role, 'delivery.viewAll')) throw forbidden('You can only cancel your own company’s deliveries.');
    if (!['approved', 'review'].includes(r.status)) throw conflict('Only booked deliveries can be cancelled.');
    if (r.passCode) {
      const p = await this.store.get('passes', r.passCode);
      if (p && p.status === 'used') throw conflict('This truck was already admitted.');
      if (p && p.status === 'active') await this.store.put('passes', Object.assign(p, { status: 'void' as const, voidedAt: this.nowIso(), voidReason: 'Cancelled' }));
    }
    r.status = 'cancelled'; r.cancelledAt = this.nowIso();
    await this.store.put('requests', r);
    await this.audit(c.user.id, 'delivery.cancelled', { projectId: r.projectId, target: r.id, maintenance: c.maintenance || undefined });
    await this.notify(c.project, 'cancelled', r);
  }

  async decideRequest(actor: Actor, requestId: string, approve: boolean, note = ''): Promise<DeliveryRequest> {
    const pre = await this.store.get('requests', requestId);
    if (!pre) throw notFound('That delivery no longer exists.');
    const c = await this.ctx(actor, pre.projectId, 'delivery.review');
    return this.store.withLock('project:' + pre.projectId, async () => {
      const r = await this.store.get('requests', requestId) as DeliveryRequest;
      if (r.status !== 'review') throw conflict('Someone already decided this request.');
      const msg = str(note, 500);
      r.decidedAt = this.nowIso(); r.decidedBy = nameOf(c.user) + (c.maintenance ? ' (maintenance)' : '');
      if (approve) {
        // The admin approves the flagged items; the hard rules must still pass (slot and zone may have filled since).
        const ev = evaluateRequest(r, Object.assign(await this.rulesCtx(c.project), { now: this.siteNow(c.project) }));
        const hard = ev.checks.filter((k) => k.status === 'fail' && k.reason !== 'R05');
        if (hard.length) throw conflict('Can’t approve: ' + hard.map((k) => k.title).join('; ') + '. Reject it so the contractor can pick another time.');
        r.status = 'approved'; if (msg) r.reviewNote = msg;
        r.passCode = await this.issuePass(c.project, r.id, false);
        await this.store.put('requests', r);
        await this.notify(c.project, 'approved', r);
      } else {
        r.status = 'rejected';
        r.reasons = [{ code: 'GC', title: 'Not approved by the project admin', remedy: msg || 'Contact the project admin for details, then submit a new request.' }];
        await this.store.put('requests', r);
        await this.notify(c.project, 'rejected', r);
      }
      await this.audit(c.user.id, approve ? 'delivery.approved' : 'delivery.rejected', { projectId: r.projectId, target: r.id, maintenance: c.maintenance || undefined });
      return r;
    });
  }

  /** A same-day pass that skips the rules. Logged as an override against the company. */
  async emergencyPass(actor: Actor, projectId: string, input: { subId: string; material: string; gateId: string; slot: string; zoneId: string; pallets: number }): Promise<DeliveryRequest> {
    const c = await this.ctx(actor, projectId, 'delivery.emergencyPass');
    const p = c.project;
    const subs = await this.subsForProject(p);
    const sub = subs.find((s) => s.id === input.subId);
    if (!sub) throw bad('Choose a company on this project.');
    const material = str(input.material, 120);
    if (!material) throw bad('Enter what the truck is carrying.');
    if (!p.gates.find((g) => g.id === input.gateId)) throw bad('Choose a gate.');
    if (!p.zones.find((z) => z.id === input.zoneId)) throw bad('Choose a staging zone.');
    if (!slotsForDay(p.settings).includes(input.slot)) throw bad('Choose a time during gate hours.');
    const pallets = Math.max(0, Math.min(500, Math.round(Number(input.pallets)) || 0));
    let contact: User = c.user;
    for (const m of await this.activeMembers(projectId)) { const u = await this.store.get('users', m.userId); if (u && !u.deleted && m.role !== 'access' && companyKey(u.company) === sub.id) { contact = u; break; } }
    return this.store.withLock('project:' + projectId, async () => {
      const id = newId('r-'); const today = this.siteToday(p); const by = nameOf(c.user) + (c.maintenance ? ' (maintenance)' : '');
      const code = await this.issuePass(p, id, true);
      const r: DeliveryRequest = {
        id, projectId, subId: sub.id, subName: sub.name, userId: contact.id, submitterEmail: contact.email, submittedBy: by + ' (emergency)',
        activityId: '', gateId: input.gateId, date: today, slot: input.slot, zoneId: input.zoneId, material, quantity: 1, unit: 'load', pallets, weightLbs: null,
        carrier: '', truck: '', pocName: nameOf(contact), pocPhone: contact.phone, justification: '', status: 'approved', stagedUntil: today,
        reasons: [{ code: 'EM', title: 'Emergency pass issued by ' + by, remedy: 'Logged as an override against ' + sub.name + '.' }],
        submittedAt: this.nowIso(), decidedAt: this.nowIso(), decidedBy: by + ' (emergency)', passCode: code, override: true,
      };
      if (c.maintenance) r.maintenance = true;
      await this.store.put('requests', r);
      await this.audit(c.user.id, 'delivery.emergencyPass', { projectId, target: id, details: { subId: sub.id, code }, maintenance: c.maintenance || undefined });
      await this.notify(p, 'emergency', r, { by });
      return r;
    });
  }

  /** Marks approved deliveries that missed their window and tells the contractor and admins. Runs hourly on the server. */
  async noShowSweep(projectId: string, actor?: Actor): Promise<number> {
    const p = actor ? (await this.ctx(actor, projectId, 'delivery.viewAll')).project : await this.liveProject(projectId);
    const now = this.siteNow(p); let n = 0;
    for (const r of await this.store.find('requests', { projectId, status: 'approved' })) {
      if (r.noshowNotified || !r.passCode) continue;
      const pass = await this.store.get('passes', r.passCode);
      if (deliveryStatus(r, pass, now, p.settings) !== 'noshow') continue;
      r.noshowNotified = this.nowIso(); await this.store.put('requests', r);
      await this.notify(p, 'noshow', r); n++;
    }
    return n;
  }

  async noShowSweepAll(): Promise<number> {
    let n = 0;
    for (const p of await this.store.find('projects', { deleted: false })) n += await this.noShowSweep(p.id);
    return n;
  }

  // ================================================================ gate

  private async gateCheck(c: Ctx, raw: string): Promise<{ view: GateCheckView; pass?: PassRecord; request?: DeliveryRequest }> {
    const p = c.project;
    const code = String(raw || '').slice(0, 64);
    const passes = await this.store.find('passes', { projectId: p.id });
    const requests = await this.store.find('requests', { projectId: p.id });
    const res = checkPass(code, {
      now: this.siteNow(p), settings: p.settings, passes, requests, subs: await this.subsForProject(p), zones: p.zones,
      formatInstant: (iso) => this.siteClock(p, iso),
    });
    const r = res.request as DeliveryRequest | undefined;
    let request: GateCheckView['request'] = null;
    if (r) {
      const w = passWindow({ date: r.date, slot: r.slot }, p.settings);
      request = { id: r.id, subName: r.subName, material: r.material, quantity: r.quantity, unit: r.unit, pallets: r.pallets, date: r.date, slot: r.slot, gateId: r.gateId, zoneId: r.zoneId, pocName: r.pocName, pocPhone: r.pocPhone, windowOpen: fmtClock(w.open), windowClose: fmtClock(w.close) };
    }
    return { view: { color: res.color, reason: res.reason, title: res.title, remedy: res.remedy, code: res.code, at: this.nowIso(), request }, pass: res.pass as PassRecord | undefined, request: r };
  }

  /** Checks a scanned or typed code. Changes nothing. */
  async checkGatePass(actor: Actor, projectId: string, raw: string): Promise<GateCheckView> {
    const c = await this.ctx(actor, projectId, 'gate.scan');
    if (!(await this.throttle('scan:' + c.user.id, 240, 60))) throw tooMany();
    return (await this.gateCheck(c, raw)).view;
  }

  /** Admits the truck: re-checks under the project lock and marks the pass used (single use). */
  async admit(actor: Actor, projectId: string, raw: string): Promise<{ check: GateCheckView; message: string }> {
    const c = await this.ctx(actor, projectId, 'gate.scan');
    return this.store.withLock('project:' + projectId, async () => {
      const { view, pass, request } = await this.gateCheck(c, raw);
      if (view.color !== 'green' || !pass || !request) throw conflict(view.title + '. ' + view.remedy);
      const guard = nameOf(c.user) + (c.maintenance ? ' (maintenance)' : '');
      await this.store.put('passes', Object.assign(pass, { status: 'used' as const, usedAt: this.nowIso(), usedBy: guard }));
      const ev: GateEvent = { id: newId('l-'), projectId, ts: this.nowIso(), code: pass.code, color: 'green', reason: 'G00', title: view.title, action: 'admitted', guard, guardUserId: c.user.id, requestId: request.id, subId: request.subId };
      if (c.maintenance) ev.maintenance = true;
      await this.store.put('gatelog', ev);
      const zone = c.project.zones.find((z) => z.id === request.zoneId);
      return { check: view, message: `Admitted ${fmtClock(this.siteNow(c.project))}. Direct the truck to ${zone ? zone.name : request.zoneId}.` };
    });
  }

  /** Logs a turn-away and emails the reason and the fix (contractor, Access Control, the project's admins). */
  async turnAway(actor: Actor, projectId: string, raw: string): Promise<{ check: GateCheckView; message: string }> {
    const c = await this.ctx(actor, projectId, 'gate.scan');
    const { view, request } = await this.gateCheck(c, raw);
    if (view.color === 'green') throw conflict('This pass is valid. Admit the truck, or clear the result.');
    const guard = nameOf(c.user) + (c.maintenance ? ' (maintenance)' : '');
    const ev: GateEvent = { id: newId('l-'), projectId, ts: this.nowIso(), code: view.code, color: 'red', reason: view.reason, title: view.title, action: 'turned away', guard, guardUserId: c.user.id, requestId: request ? request.id : null, subId: request ? request.subId : null };
    if (c.maintenance) ev.maintenance = true;
    await this.store.put('gatelog', ev);
    if (request) await this.notify(c.project, 'turnedAway', request, { reasonTitle: view.title, remedy: view.remedy, guard: nameOf(c.user) });
    else {
      const list = notices('turnedAway', { subName: 'Unknown carrier', material: 'load with no approved pass', reasonTitle: view.title, remedy: view.remedy, scannedCode: view.code, guard: nameOf(c.user) }).filter((n) => n.to !== 'contractor');
      await this.route(c.project, list, null);
    }
    return { check: view, message: `Logged ${fmtClock(this.siteNow(c.project))}. ${request ? 'Contractor, Access Control and admins' : 'Access Control and admins'} were emailed the reason and what has to happen.` };
  }
}

// ================================================================ look-ahead samples (demo and new projects)

export const ACTIVITY_DEFS = [
  { id: 'A1200', name: 'Hall A busway install', trade: 'Electrical', s: 1, f: 12 },
  { id: 'A1215', name: 'Hall B switchgear set', trade: 'Electrical', s: 16, f: 24 },
  { id: 'A1230', name: 'Hall A L1 cable pull', trade: 'Electrical', s: -3, f: 9 },
  { id: 'A1240', name: 'Hall B grounding and bonding', trade: 'Electrical', s: 3, f: 11 },
  { id: 'A1320', name: 'Hall A CRAH units set', trade: 'Mechanical', s: 1, f: 6 },
  { id: 'A1335', name: 'Level 2 chilled water piping', trade: 'Mechanical', s: -2, f: 15 },
  { id: 'A1340', name: 'Hall B CRAH piping connections', trade: 'Mechanical', s: 4, f: 12 },
  { id: 'A1410', name: 'Hall B sprinkler mains', trade: 'Fire protection', s: 2, f: 14 },
  { id: 'A1420', name: 'Hall A preaction valves', trade: 'Fire protection', s: 3, f: 10 },
  { id: 'A1520', name: 'Hall A BMS panels', trade: 'Controls', s: 2, f: 10 },
  { id: 'A1530', name: 'Hall B controls cabling', trade: 'Controls', s: 9, f: 18 },
  { id: 'A1610', name: 'Office curtain wall', trade: 'Glazing', s: 5, f: 20 },
  { id: 'A1900', name: 'Site logistics and general', trade: 'General', s: -5, f: 20 },
];
export function sampleActivities(anchor: string): Activity[] {
  return ACTIVITY_DEFS.map((a) => ({ id: a.id, name: a.name, trade: a.trade, start: addDays(anchor, a.s), finish: addDays(anchor, a.f) }));
}
export function nextWorkDay(date: string, settings?: Partial<Settings>): string {
  let d = date; for (let i = 0; i < 8 && !isWorkDay(d, settings); i++) d = addDays(d, 1); return d;
}

// Re-exported for the app and the demo seeder.
export { AJAX_DOMAIN, REASONS, at, fill, fmtTime, fromWallClock };
