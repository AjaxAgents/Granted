// End-to-end flows through the services, on an in-memory store. Each test is one real-life situation.
import { beforeEach, describe, expect, test } from 'vitest';
import { GrantedService, MemoryMailer, MemoryStore, makeAdminCodeHash, seedDemo, DEMO_PASSWORD, DEMO_PROJECT_ID, type Actor } from '../src';

const TEST_ADMIN_CODE = 'TEST-ADMIN-CODE'; // test value only; the real code is never in the repository
let adminHash = '';
let store: MemoryStore; let mailer: MemoryMailer; let svc: GrantedService; let clock: Date;
const setClock = (iso: string) => { clock = new Date(iso); };

async function make() {
  if (!adminHash) adminHash = await makeAdminCodeHash(TEST_ADMIN_CODE, 1000);
  store = new MemoryStore(); mailer = new MemoryMailer();
  setClock('2026-10-12T13:00:00Z'); // Mon 10/12/2026 8:00 AM in Chicago
  svc = new GrantedService({ store, mailer, clock: () => clock, config: { adminCodeHash: adminHash, passwordIterations: 1000, exposeCodes: true } });
}

const form = (over: Record<string, unknown> = {}) => Object.assign({
  first: 'Dana', last: 'Ruiz', phone: '214-555-0141', email: 'dana@northfield.example.com', password: 'Delivery2026',
  company: 'North Field Electrical', declaredAjax: 'no' as const,
}, over);

/** Signs up and confirms; returns the actor. */
async function person(over: Record<string, unknown> = {}): Promise<Actor> {
  const f = form(over);
  const r = await svc.signUp(f);
  const v = await svc.verifyEmail(r.email, r.devCode as string);
  return { userId: v.userId };
}
async function adminWithProject(email = 'alex@ajaxbuilding.com', name = 'DFW2 Data Center 2') {
  const admin = await person({ first: 'Alex', last: 'Morgan', email, company: 'Ajax Building Company', declaredAjax: 'yes', code: TEST_ADMIN_CODE });
  const p = await svc.createProject(admin, { name, location: 'Dallas, TX', sampleLookahead: true });
  return { admin, p };
}
async function memberOf(projectId: string, admin: Actor, who: Actor, role: 'contractor' | 'access' | 'admin', trade = '') {
  const p = await store.get('projects', projectId);
  await svc.enterCode(who, p!.code);
  const j = (await store.find('joinreqs', { projectId, userId: who.userId, status: 'pending' }))[0];
  await svc.decideJoin(admin, j.id, true, role, trade);
}
const mailTo = (email: string) => mailer.sent.filter((m) => m.to === email);

beforeEach(make);

describe('accounts', () => {
  test('S01 sign up, confirm the email, sign in', async () => {
    const r = await svc.signUp(form());
    expect(r.devCode).toMatch(/^\d{6}$/);
    expect(mailTo('dana@northfield.example.com')[0].subject).toContain(r.devCode);
    await expect(svc.verifyEmail(r.email, '000000')).rejects.toThrow(/doesn’t match/);
    const v = await svc.verifyEmail(r.email, r.devCode as string);
    const s = await svc.signIn('DANA@northfield.example.com ', 'Delivery2026');
    expect('userId' in s && s.userId).toBe(v.userId);
    const me = await svc.me({ userId: v.userId });
    expect(me).toMatchObject({ phone: '214-555-0141', isAjax: false, isAdminAccount: false });
    expect(JSON.stringify(me)).not.toMatch(/hash|salt/);
  });

  test('S02 weak passwords and duplicate emails are refused', async () => {
    await expect(svc.signUp(form({ password: 'delivery2026' }))).rejects.toMatchObject({ fields: { password: expect.any(String) } });
    await person();
    await expect(svc.signUp(form())).rejects.toMatchObject({ fields: { email: expect.stringMatching(/already exists/) } });
  });

  test('S03 five wrong passwords lock the account; unknown emails get the same message', async () => {
    await person();
    const bad = () => svc.signIn('dana@northfield.example.com', 'Wrong2026x');
    const unknown = await svc.signIn('nobody@example.com', 'Wrong2026x').catch((e) => e.message);
    const first = await bad().catch((e) => e.message);
    expect(first).toBe(unknown);
    for (let i = 0; i < 3; i++) await bad().catch(() => null);
    await expect(bad()).rejects.toMatchObject({ status: 423 });
    await expect(svc.signIn('dana@northfield.example.com', 'Delivery2026')).rejects.toMatchObject({ status: 423 });
    clock = new Date(clock.getTime() + 16 * 60000);
    await expect(svc.signIn('dana@northfield.example.com', 'Delivery2026')).resolves.toHaveProperty('userId');
  });

  test('S04 the admin code makes an Ajax admin account only for an Ajax email, and fails exactly like a typo otherwise', async () => {
    const outsider = await svc.signUp(form({ code: TEST_ADMIN_CODE })).catch((e) => e.fields.code);
    const typo = await svc.signUp(form({ code: 'NOPE-1234' })).catch((e) => e.fields.code);
    expect(outsider).toBe(typo);
    const { admin } = await adminWithProject();
    expect((await svc.me(admin)).isAdminAccount).toBe(true);
    const ajaxNoCode = await person({ email: 'pat@ajaxbuilding.com', declaredAjax: 'yes' });
    expect((await svc.me(ajaxNoCode)).isAdminAccount).toBe(false);
    await expect(svc.createProject(ajaxNoCode, { name: 'X' })).rejects.toMatchObject({ status: 403 });
    const later = await svc.enterCode(ajaxNoCode, TEST_ADMIN_CODE.toLowerCase());
    expect(later.message).toMatch(/Admin access/);
    expect((await svc.me(ajaxNoCode)).isAdminAccount).toBe(true);
  });

  test('S05 with no admin code configured, nothing is an admin code', async () => {
    const s2 = new GrantedService({ store, mailer, clock: () => clock, config: { passwordIterations: 1000, exposeCodes: true } });
    await expect(s2.signUp(form({ email: 'z@ajaxbuilding.com', code: TEST_ADMIN_CODE }))).rejects.toMatchObject({ fields: { code: expect.stringMatching(/not found/) } });
  });

  test('S06 password reset answers the same for unknown emails and limits wrong codes', async () => {
    await person();
    await expect(svc.startPasswordReset('nobody@example.com')).resolves.toEqual({});
    const r = await svc.startPasswordReset('dana@northfield.example.com');
    for (let i = 0; i < 5; i++) await svc.resetPassword('dana@northfield.example.com', '111111', 'NewPass2026').catch(() => null);
    await expect(svc.resetPassword('dana@northfield.example.com', r.devCode as string, 'NewPass2026')).rejects.toThrow(/Too many wrong codes/);
    const r2 = await svc.startPasswordReset('dana@northfield.example.com');
    await svc.resetPassword('dana@northfield.example.com', r2.devCode as string, 'NewPass2026');
    await expect(svc.signIn('dana@northfield.example.com', 'NewPass2026')).resolves.toHaveProperty('userId');
  });

  test('S07 password change ends other sessions (session version goes up)', async () => {
    const a = await person();
    const before = await svc.sessionVersion(a.userId);
    await svc.changePassword(a, 'Delivery2026', 'Another2026');
    expect(await svc.sessionVersion(a.userId)).toBe((before as number) + 1);
  });

  test('S08 deleting an account removes access and personal details but keeps delivery records', async () => {
    const { admin, p } = await adminWithProject();
    const dana = await person();
    await memberOf(p.id, admin, dana, 'contractor', 'Electrical');
    const res = await svc.submitRequest(dana, p.id, booking(p.activities, 'A1200'));
    await expect(svc.deleteAccount(admin, 'Delivery2026')).rejects.toMatchObject({ status: 409 }); // only admin
    await svc.deleteAccount(dana, 'Delivery2026');
    expect(await svc.sessionVersion(dana.userId)).toBeNull();
    const r = await store.get('requests', res.request.id);
    expect(r).toMatchObject({ submittedBy: 'Deleted user', submitterEmail: '' });
    const u = await store.get('users', dana.userId);
    expect(u!.email).toMatch(/^deleted-/);
    await expect(svc.signIn('dana@northfield.example.com', 'Delivery2026')).rejects.toMatchObject({ status: 401 });
    expect(await store.get('credentials', dana.userId)).toBeNull();
  });
});

describe('projects and team', () => {
  test('S10 join requests email only the admins of that project', async () => {
    const { admin, p } = await adminWithProject();
    const other = await adminWithProject('casey@ajaxbuilding.com', 'Austin Campus');
    void other;
    const dana = await person();
    mailer.sent = [];
    const r = await svc.enterCode(dana, p.code.toLowerCase());
    expect(r.message).toMatch(/Request sent/);
    const to = mailer.sent.map((m) => m.to);
    expect(to).toEqual(['alex@ajaxbuilding.com']);
    expect((await svc.home(dana)).pending).toHaveLength(1);
    const j = (await store.find('joinreqs', { projectId: p.id }))[0];
    await expect(svc.decideJoin(dana, j.id, true, 'admin')).rejects.toMatchObject({ status: 403 });
    await svc.decideJoin(admin, j.id, true, 'contractor', 'Electrical');
    expect((await svc.home(dana)).projects[0]).toMatchObject({ id: p.id, role: 'contractor' });
    await expect(svc.decideJoin(admin, j.id, false)).rejects.toMatchObject({ status: 409 });
  });

  test('S11 an invite gives access automatically when that email signs up', async () => {
    const { admin, p } = await adminWithProject();
    await svc.invite(admin, p.id, { email: 'Riley@Gate.example.com', role: 'access' });
    await expect(svc.invite(admin, p.id, { email: 'riley@gate.example.com', role: 'access' })).rejects.toMatchObject({ status: 409 });
    const riley = await person({ first: 'Riley', email: 'riley@gate.example.com', company: 'SiteMetric' });
    expect((await svc.home(riley)).projects[0]).toMatchObject({ id: p.id, role: 'access' });
    expect(mailTo('alex@ajaxbuilding.com').some((m) => /joined/.test(m.subject))).toBe(true);
  });

  test('S12 expired and revoked invites do nothing', async () => {
    const { admin, p } = await adminWithProject();
    const inv = await svc.invite(admin, p.id, { email: 'a@x.example.com', role: 'contractor' });
    await svc.revokeInvite(admin, inv.id);
    await svc.invite(admin, p.id, { email: 'b@x.example.com', role: 'contractor' });
    clock = new Date(clock.getTime() + 8 * 86400000);
    const a = await person({ email: 'a@x.example.com' }); const b = await person({ email: 'b@x.example.com' });
    expect((await svc.home(a)).projects).toHaveLength(0);
    expect((await svc.home(b)).projects).toHaveLength(0);
  });

  test('S13 a project always keeps an admin; admins cannot demote themselves', async () => {
    const { admin, p } = await adminWithProject();
    const me = (await store.find('members', { projectId: p.id, userId: admin.userId }))[0];
    await expect(svc.changeRole(admin, me.id, 'contractor')).rejects.toMatchObject({ status: 403 });
    await expect(svc.leaveProject(admin, p.id)).rejects.toMatchObject({ status: 409 });
    const dana = await person();
    await memberOf(p.id, admin, dana, 'admin');
    await svc.leaveProject(admin, p.id);
    expect((await svc.home(admin)).projects).toHaveLength(0);
  });

  test('S14 only Ajax admin accounts replace codes or delete projects; deleted projects disappear', async () => {
    const { admin, p } = await adminWithProject();
    const dana = await person();
    await memberOf(p.id, admin, dana, 'admin');
    await expect(svc.regenerateCode(dana, p.id)).rejects.toMatchObject({ status: 403 });
    const code = await svc.regenerateCode(admin, p.id);
    expect(code).not.toBe(p.code);
    await expect(svc.enterCode(await person({ email: 'q@q.example.com' }), p.code)).rejects.toThrow(/not found/);
    await expect(svc.deleteProject(admin, p.id, 'WRONG')).rejects.toThrow(/doesn’t match/);
    await svc.deleteProject(admin, p.id, code);
    expect((await svc.home(dana)).projects).toHaveLength(0);
    await expect(svc.projectView(dana, p.id)).rejects.toMatchObject({ status: 404 });
  });
});

function booking(acts: { id: string; start: string }[], activityId: string, over: Record<string, unknown> = {}) {
  const a = acts.find((x) => x.id === activityId)!;
  return Object.assign({ activityId, gateId: 'G1', date: a.start, slot: '09:00', zoneId: 'Z-SLY', material: 'Busway sections', quantity: 12, unit: 'sections', pallets: 4, pocName: 'Dana Ruiz', pocPhone: '214-555-0141', carrier: 'Lone Oak' }, over);
}

describe('deliveries and the gate', () => {
  let admin: Actor, dana: Actor, riley: Actor, marcus: Actor, pid: string, acts: { id: string; start: string; trade: string }[];
  beforeEach(async () => {
    const x = await adminWithProject(); admin = x.admin; pid = x.p.id;
    // Start install dates far enough out that 48 hours' notice is easy to meet.
    acts = x.p.activities;
    dana = await person(); await memberOf(pid, admin, dana, 'contractor', 'Electrical');
    marcus = await person({ first: 'Marcus', email: 'marcus@caliche.example.com', company: 'Caliche Mechanical' }); await memberOf(pid, admin, marcus, 'contractor', 'Mechanical');
    riley = await person({ first: 'Riley', email: 'riley@gate.example.com', company: 'SiteMetric' }); await memberOf(pid, admin, riley, 'access');
  });
  const book = (who: Actor, activityId: string, over: Record<string, unknown> = {}) => svc.submitRequest(who, pid, booking(acts, activityId, over));

  test('S20 a clean request is approved with a pass; the guard admits it once', async () => {
    const { request } = await book(dana, 'A1240', { date: '2026-10-15' });
    expect(request.status).toBe('approved');
    expect(request.passCode).toMatch(/^DDC2-[A-Z0-9]{6}$/);
    expect(mailTo('dana@northfield.example.com').find((m) => m.subject.startsWith('Approved:'))?.attachQr).toBe(request.passCode); // QR attached for the contractor
    expect(mailTo('riley@gate.example.com').every((m) => !m.attachQr)).toBe(true);
    expect(mailTo('riley@gate.example.com').some((m) => m.subject.startsWith('New approved delivery'))).toBe(true);
    await expect(svc.checkGatePass(dana, pid, request.passCode!)).rejects.toMatchObject({ status: 403 });
    setClock('2026-10-15T13:20:00Z'); // 8:20 AM site time on the delivery day: inside 8:00-11:00
    const chk = await svc.checkGatePass(riley, pid, request.passCode!.slice(5).toLowerCase());
    expect(chk).toMatchObject({ color: 'green', reason: 'G00' });
    expect(chk.request).toMatchObject({ windowOpen: '8:00 AM', windowClose: '11:00 AM' });
    await svc.admit(riley, pid, request.passCode!);
    const again = await svc.checkGatePass(riley, pid, request.passCode!);
    expect(again.reason).toBe('G03');
    expect(again.title).toMatch(/8:20 AM/); // used time shown in site time, not server UTC
    await expect(svc.admit(riley, pid, request.passCode!)).rejects.toMatchObject({ status: 409 });
  });

  test('S21 too early at the gate is red; turning away emails contractor, gate and admins', async () => {
    const { request } = await book(dana, 'A1240', { date: '2026-10-15' });
    setClock('2026-10-15T12:30:00Z'); // 7:30 AM: window opens 8:00
    const chk = await svc.checkGatePass(riley, pid, request.passCode!);
    expect(chk.reason).toBe('G05');
    await expect(svc.admit(riley, pid, request.passCode!)).rejects.toMatchObject({ status: 409 });
    mailer.sent = [];
    await svc.turnAway(riley, pid, request.passCode!);
    expect(new Set(mailer.sent.map((m) => m.to))).toEqual(new Set(['dana@northfield.example.com', 'riley@gate.example.com', 'alex@ajaxbuilding.com']));
    const v = await svc.projectView(riley, pid);
    expect(v.gatelog[0]).toMatchObject({ color: 'red', reason: 'G05', action: 'turned away' });
  });

  test('S22 contractors see only their company; others’ bookings show as anonymous capacity', async () => {
    await book(dana, 'A1240', { date: '2026-10-15' });
    await book(marcus, 'A1340', { date: '2026-10-16', zoneId: 'Z-NLY' });
    const v = await svc.projectView(marcus, pid);
    expect(v.requests.every((r) => r.subName === 'Caliche Mechanical')).toBe(true);
    expect(v.occupancy).toHaveLength(1);
    expect(JSON.stringify(v.occupancy)).not.toMatch(/North Field|Busway|dana/i);
    expect(v.members).toHaveLength(0);
    expect(v.subs).toHaveLength(1);
    const g = await svc.projectView(riley, pid);
    expect(g.requests).toHaveLength(0); // nothing booked for today
    expect(g.occupancy).toHaveLength(0);
  });

  test('S23 two contractors racing for the last truck slot: only one gets it', async () => {
    const gate2 = { gateId: 'G2', date: '2026-10-16', slot: '10:00' }; // Gate 2 takes one truck per slot
    const [a, b] = await Promise.all([book(dana, 'A1240', gate2), book(marcus, 'A1340', Object.assign({ zoneId: 'Z-NLY' }, gate2))]);
    const statuses = [a.request.status, b.request.status].sort();
    expect(statuses).toEqual(['approved', 'rejected']);
    const loser = a.request.status === 'rejected' ? a : b;
    expect(loser.request.reasons.map((r) => r.code)).toContain('R07');
    expect(loser.nextOpen).not.toBeNull();
  });

  test('S24 a large delivery goes to review; the project admin approves it and a pass is issued', async () => {
    mailer.sent = [];
    const { request } = await book(dana, 'A1240', { date: '2026-10-15', pallets: 25 });
    expect(request.status).toBe('review');
    expect(mailer.sent.filter((m) => /Review needed/.test(m.subject)).map((m) => m.to)).toEqual(['alex@ajaxbuilding.com']);
    await expect(svc.decideRequest(dana, request.id, true)).rejects.toMatchObject({ status: 403 });
    const r = await svc.decideRequest(admin, request.id, true, 'Use the south yard');
    expect(r).toMatchObject({ status: 'approved', reviewNote: 'Use the south yard' });
    expect(r.passCode).toBeTruthy();
  });

  test('S25 rescheduling voids the old pass; cancelling tells the gate', async () => {
    const { request } = await book(dana, 'A1240', { date: '2026-10-15' });
    const old = request.passCode!;
    const res = await svc.submitRequest(dana, pid, Object.assign(booking(acts, 'A1240', { date: '2026-10-16' }), { id: request.id }));
    expect(res.request.passCode).not.toBe(old);
    expect((await store.get('passes', old))!.status).toBe('void');
    await expect(svc.cancelRequest(marcus, request.id)).rejects.toMatchObject({ status: 403 });
    mailer.sent = [];
    await svc.cancelRequest(dana, request.id);
    expect(mailer.sent.some((m) => m.to === 'riley@gate.example.com' && /Cancelled/.test(m.subject))).toBe(true);
  });

  test('S26 a suspended company is rejected and red at the gate, except with an emergency pass', async () => {
    const { request } = await book(dana, 'A1240', { date: '2026-10-15' });
    await svc.setSuspended(admin, pid, 'north-field-electrical', true);
    const again = await book(dana, 'A1240', { date: '2026-10-16' });
    expect(again.request.reasons.map((r) => r.code)).toContain('R02');
    setClock('2026-10-15T14:00:00Z');
    expect((await svc.checkGatePass(riley, pid, request.passCode!)).reason).toBe('G07');
    const em = await svc.emergencyPass(admin, pid, { subId: 'north-field-electrical', material: 'Replacement breaker', gateId: 'G1', slot: '10:00', zoneId: 'Z-EY', pallets: 1 });
    expect((await svc.checkGatePass(riley, pid, em.passCode!)).color).toBe('green');
  });

  test('S27 the no-show check flags missed windows once', async () => {
    await book(dana, 'A1240', { date: '2026-10-15', slot: '07:00' });
    setClock('2026-10-15T14:01:00Z'); // 9:01 AM: slot 7-8 plus 60 min grace has passed
    expect(await svc.noShowSweepAll()).toBe(1);
    expect(await svc.noShowSweepAll()).toBe(0);
  });

  test('S28 maintenance mode: an Ajax admin account sees the project as each role, and actions are labelled', async () => {
    const asContractor = await svc.projectView({ userId: admin.userId, viewAs: 'contractor' }, pid);
    expect(asContractor).toMatchObject({ role: 'contractor', realRole: 'admin', maintenance: true });
    expect(asContractor.members).toHaveLength(0);
    const asGate = { userId: admin.userId, viewAs: 'access' as const };
    await expect(svc.submitRequest(asGate, pid, booking(acts, 'A1240'))).rejects.toMatchObject({ status: 403 });
    const { request } = await svc.submitRequest({ userId: admin.userId, viewAs: 'contractor' }, pid, booking(acts, 'A1900', { date: '2026-10-15' }));
    expect(request.maintenance).toBe(true);
    // A project admin without an Ajax admin account cannot use maintenance mode.
    await memberOf(pid, admin, await person({ email: 'kim@x.example.com' }), 'admin');
    const kim = (await store.find('users', { email: 'kim@x.example.com' }))[0];
    const v = await svc.projectView({ userId: kim.id, viewAs: 'contractor' }, pid);
    expect(v).toMatchObject({ role: 'admin', maintenance: false, canMaintain: false });
    // A contractor asking to view as admin gets nothing extra.
    const d = await svc.projectView({ userId: dana.userId, viewAs: 'admin' }, pid);
    expect(d.role).toBe('contractor');
  });
});

describe('demo data', () => {
  test('S30 the demo seeds a consistent project that the demo accounts can use', async () => {
    await seedDemo(store, '2026-10-12', 1000);
    const s = await svc.signIn('alex.morgan@ajaxbuilding.com', DEMO_PASSWORD);
    const admin = { userId: (s as { userId: string }).userId };
    const v = await svc.projectView(admin, DEMO_PROJECT_ID);
    expect(v.requests).toHaveLength(10);
    expect(v.requests.filter((r) => r.status === 'review').length).toBeGreaterThanOrEqual(2);
    expect(v.joinreqs).toHaveLength(1);
    expect(v.invites).toHaveLength(1);
    expect(v.gatelog).toHaveLength(2);
  });
});
