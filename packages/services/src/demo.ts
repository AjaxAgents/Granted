/*
 * The demo project: one jobsite with members of every role, a pending join
 * request, a pending invite and a day of deliveries around `anchor`.
 * Every person, company and phone number is invented. Demo emails use
 * example.com, except the sample Ajax admin, which needs an Ajax address.
 * Used by the offline web demo and by `npm run seed` for a dev database.
 */
import {
  DEFAULT_SETTINGS, REASONS, addDays, at, companyKey, evaluateRequest, fill, fromWallClock, isAjaxEmail, isWorkDay, newPassCode, notices,
  passPrefixFromCode, type BookedRequest, type Role, type Settings,
} from '@granted/core';
import { hashPassword, newId, secureRandom } from './crypto';
import type { Store } from './store';
import { DEFAULT_GATES, DEFAULT_ZONES, sampleActivities } from './service';
import type { DeliveryRequest, GateEvent, Mail, Member, PassRecord, Project, User } from './types';

export const DEMO_PASSWORD = 'Granted2026';
export const DEMO_PROJECT_ID = 'p-dfw2dc2';
export const DEMO_TZ = 'America/Chicago';

interface DemoPerson { key: string; first: string; last: string; email: string; phone: string; company: string; isAdminAccount?: boolean; role?: Role; trade?: string; pending?: boolean }
export const DEMO_USERS: DemoPerson[] = [
  { key: 'admin', first: 'Alex', last: 'Morgan', email: 'alex.morgan@ajaxbuilding.com', phone: '214-555-0110', company: 'Ajax Building Company', isAdminAccount: true, role: 'admin' },
  { key: 'gate', first: 'Riley', last: 'Alvarez', email: 'riley.alvarez@gate.example.com', phone: '214-555-0122', company: 'SiteMetric', role: 'access' },
  { key: 'dana', first: 'Dana', last: 'Ruiz', email: 'dana.ruiz@northfield.example.com', phone: '214-555-0141', company: 'North Field Electrical', role: 'contractor', trade: 'Electrical' },
  { key: 'marcus', first: 'Marcus', last: 'Hale', email: 'marcus.hale@caliche.example.com', phone: '972-555-0188', company: 'Caliche Mechanical', role: 'contractor', trade: 'Mechanical' },
  { key: 'tess', first: 'Tess', last: 'Okafor', email: 'tess.okafor@redbud.example.com', phone: '817-555-0123', company: 'Redbud Fire Protection', role: 'contractor', trade: 'Fire protection' },
  { key: 'lee', first: 'Lee', last: 'Park', email: 'lee.park@mesquite.example.com', phone: '469-555-0177', company: 'Mesquite Controls', role: 'contractor', trade: 'Controls' },
  { key: 'sam', first: 'Sam', last: 'Ortiz', email: 'sam.ortiz@prairieglass.example.com', phone: '214-555-0160', company: 'Prairie Glass', pending: true },
];

/** First working day on or after today at the site. */
export function demoAnchor(now: Date, settings: Partial<Settings> = DEFAULT_SETTINGS): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: DEMO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  let d = p; for (let i = 0; i < 8 && !isWorkDay(d, settings); i++) d = addDays(d, 1);
  return d;
}

/** Writes the demo into an empty store. passwordIterations keeps the browser demo quick. */
export async function seedDemo(store: Store, anchor: string, passwordIterations = 100000): Promise<void> {
  const inst = (date: string, hhmm: string) => fromWallClock(at(date, hhmm), DEMO_TZ).toISOString();
  const createdAt = inst(addDays(anchor, -20), '08:00');
  const code = 'DDC2-7HKQ';
  const settings: Settings = Object.assign({}, DEFAULT_SETTINGS, { project: 'DFW2 Data Center 2', timeZone: DEMO_TZ, passPrefix: passPrefixFromCode(code), workDays: [...DEFAULT_SETTINGS.workDays], blackoutDates: [] });
  const project: Project = {
    id: DEMO_PROJECT_ID, name: 'DFW2 Data Center 2', location: 'Dallas–Fort Worth, TX', code, createdBy: '', createdAt, deleted: false, suspended: {},
    gates: DEFAULT_GATES.map((g) => ({ ...g })), zones: DEFAULT_ZONES.map((z) => ({ ...z })), activities: sampleActivities(anchor), settings, demoAnchor: anchor,
  };
  const pw = await hashPassword(DEMO_PASSWORD, passwordIterations);
  const users: (User & { key: string })[] = []; const members: Member[] = [];
  for (const d of DEMO_USERS) {
    const u = { id: newId('u-'), key: d.key, email: d.email, first: d.first, last: d.last, phone: d.phone, company: d.company, isAjax: isAjaxEmail(d.email), isAdminAccount: !!d.isAdminAccount, verified: true, createdAt };
    users.push(u);
    await store.put('credentials', { id: u.id, hash: pw.hash, salt: pw.salt, iter: pw.iter, failures: [], sessionVersion: 1, verify: null });
    if (d.role) members.push({ id: project.id + '__' + u.id, projectId: project.id, userId: u.id, role: d.role, trade: d.trade || '', status: 'active', addedAt: createdAt, addedBy: d.isAdminAccount ? 'creator' : 'demo', via: d.isAdminAccount ? 'creator' : 'demo' });
  }
  const by = (k: string) => users.find((u) => u.key === k) as User & { key: string };
  const admin = by('admin'); project.createdBy = admin.id;
  for (const u of users) { const { key, ...rec } = u; void key; await store.put('users', rec); }
  for (const m of members) await store.put('members', m);
  const mail: Mail[] = [];
  const sam = by('sam'); const reqAt = inst(anchor, '06:20');
  await store.put('joinreqs', { id: 'j-' + sam.id, projectId: project.id, userId: sam.id, at: reqAt, status: 'pending' });
  mail.push({ id: newId('m-'), to: admin.email, ts: reqAt, kind: 'team', projectId: project.id, subject: 'Join request: Sam Ortiz (Prairie Glass) for DFW2 Data Center 2', body: 'Sam Ortiz from Prairie Glass (sam.ortiz@prairieglass.example.com, 214-555-0160) asked to join DFW2 Data Center 2 with project code DDC2-7HKQ.\nOpen Granted → Approvals to approve them as Contractor, Access Control or Admin, or to decline.' });
  const invAt = inst(addDays(anchor, -1), '15:10');
  await store.put('invites', { id: newId('i-'), projectId: project.id, email: 'jordan.lee@hilltop.example.com', role: 'contractor', trade: 'General', by: admin.id, at: invAt, expiresAt: new Date(new Date(invAt).getTime() + 7 * 86400000).toISOString(), status: 'pending' });

  // ---- deliveries ----
  const subs = new Map<string, { id: string; name: string; trade: string }>();
  for (const m of members) { if (m.role === 'access') continue; const u = users.find((x) => x.id === m.userId) as User; const k = companyKey(u.company); if (!subs.has(k)) subs.set(k, { id: k, name: u.company, trade: m.trade }); }
  const subList = [...subs.values()];
  const D = (n: number) => { let d = anchor; let k = 0; const step = n < 0 ? -1 : 1; while (k < Math.abs(n)) { d = addDays(d, step); if (step < 0 || isWorkDay(d, settings)) k++; } return d; };
  const specs = [
    { who: 'dana', activityId: 'A1230', gateId: 'G1', date: D(0), slot: '06:00', zoneId: 'Z-NLY', material: 'Cable reels, 500 kcmil', quantity: 6, unit: 'reels', pallets: 6, weightLbs: 9000, carrier: 'Southwire freight', truck: 'TX 4471', used: '06:12' },
    { who: 'dana', activityId: 'A1200', gateId: 'G1', date: D(0), slot: '07:00', zoneId: 'Z-HA', material: 'Busway sections, 4000A', quantity: 12, unit: 'sections', pallets: 6, weightLbs: 7200, carrier: 'Lone Oak Trucking', truck: '118' },
    { who: 'marcus', activityId: 'A1320', gateId: 'G2', date: D(0), slot: '08:00', zoneId: 'Z-SLY', material: 'CRAH units', quantity: 4, unit: 'units', pallets: 4, weightLbs: 14800, carrier: 'Big Sky Heavy Haul', truck: 'Lowboy 7' },
    { who: 'tess', activityId: 'A1410', gateId: 'G1', date: D(0), slot: '10:00', zoneId: 'Z-HB', material: 'Sprinkler pipe, 4 in. Sch 10', quantity: 1200, unit: 'LF', pallets: 8, weightLbs: 6100, carrier: 'Redbud fleet', truck: 'RB-12' },
    { who: 'lee', activityId: 'A1520', gateId: 'G1', date: D(0), slot: '13:00', zoneId: 'Z-HB', material: 'BMS sensors and wiring', quantity: 40, unit: 'boxes', pallets: 2, weightLbs: 900, carrier: 'UPS Freight', truck: '', cancelled: true },
    { who: 'lee', activityId: 'A1520', gateId: 'G1', date: D(1), slot: '09:00', zoneId: 'Z-HA', material: 'BMS controller panels', quantity: 6, unit: 'crates', pallets: 3, weightLbs: 1400, carrier: 'Mesquite van', truck: 'MC-3' },
    { who: 'marcus', activityId: 'A1335', gateId: 'G2', date: D(2), slot: '07:00', zoneId: 'Z-SLY', material: 'Chilled water pipe and fittings', quantity: 1800, unit: 'LF', pallets: 26, weightLbs: 21000, carrier: 'Big Sky Heavy Haul', truck: 'Flatbed 3' },
    { who: 'dana', activityId: 'A1215', gateId: 'G2', date: D(3), slot: '10:00', zoneId: 'Z-EY', material: 'Switchgear lineup sections', quantity: 5, unit: 'sections', pallets: 5, weightLbs: 18500, carrier: 'OEM direct', truck: 'Air-ride 22', justification: 'Factory ships once; crane booked for this week' },
    { who: 'lee', activityId: 'A1530', gateId: 'G1', date: D(3), slot: '08:00', zoneId: 'Z-HB', material: 'Plenum Cat 6A cable', quantity: 60, unit: 'boxes', pallets: 3, weightLbs: 1500, carrier: 'Mesquite van', truck: 'MC-3' },
    { who: 'tess', activityId: 'A1410', gateId: 'G1', date: D(1), slot: '13:00', zoneId: 'Z-HB', material: 'Sprinkler heads and fittings', quantity: 30, unit: 'boxes', pallets: 2, weightLbs: 800, carrier: 'UPS Freight', truck: '', late: true },
  ];
  const requests: DeliveryRequest[] = []; const codes: string[] = [];
  const emailsFor = (role: Role) => members.filter((m) => m.role === role).map((m) => (users.find((u) => u.id === m.userId) as User).email);
  const route = (event: Parameters<typeof notices>[0], r: DeliveryRequest | null, ts: string, extra?: Record<string, unknown>) => {
    const d = Object.assign(r ? {
      subId: r.subId, subName: r.subName, material: r.material, date: r.date, slot: r.slot,
      gateName: (project.gates.find((g) => g.id === r.gateId) as { name: string }).name, zoneName: (project.zones.find((z) => z.id === r.zoneId) as { name: string }).name,
      passCode: r.passCode, requestId: r.id, reasons: r.reasons,
    } : { subName: '', material: '' }, extra || {});
    for (const n of notices(event, d)) {
      const to = n.to === 'contractor' ? (r ? [r.submitterEmail] : []) : n.to === 'security' ? emailsFor('access') : emailsFor('admin');
      for (const e of new Set(to)) mail.push({ id: newId('m-'), ts, to: e, role: n.to, subject: n.subject, body: n.body, kind: 'delivery', event: n.event, projectId: project.id, requestId: n.requestId });
    }
  };
  for (const sp of specs) {
    const u = by(sp.who);
    const submittedWall = sp.late ? new Date(at(sp.date, sp.slot).getTime() - 30 * 3600000) : at(D(sp.date === D(0) ? -3 : -2), '15:30');
    const submittedAt = fromWallClock(submittedWall, DEMO_TZ).toISOString();
    const r: DeliveryRequest = {
      id: newId('r-'), projectId: project.id, subId: companyKey(u.company), subName: u.company, userId: u.id, submitterEmail: u.email, submittedBy: u.first + ' ' + u.last,
      activityId: sp.activityId, gateId: sp.gateId, date: sp.date, slot: sp.slot, zoneId: sp.zoneId, material: sp.material, quantity: sp.quantity, unit: sp.unit, pallets: sp.pallets,
      weightLbs: sp.weightLbs, carrier: sp.carrier, truck: sp.truck, pocName: u.first + ' ' + u.last, pocPhone: u.phone, justification: sp.justification || '',
      status: 'approved', stagedUntil: null, reasons: [], submittedAt, decidedAt: submittedAt, decidedBy: 'Rules engine', passCode: null, demo: true,
    };
    const ev = evaluateRequest(r, { now: submittedWall, settings, gates: project.gates, zones: project.zones, subs: subList, activities: project.activities, requests: requests as BookedRequest[] });
    r.status = ev.outcome; r.stagedUntil = ev.stagedUntil;
    r.reasons = ev.checks.filter((c) => c.reason).map((c) => ({ code: c.reason as string, title: c.title as string, remedy: c.remedy as string }));
    if (r.status === 'approved') {
      r.passCode = newPassCode(codes, settings, secureRandom); codes.push(r.passCode);
      const p: PassRecord = { id: r.passCode, code: r.passCode, projectId: project.id, requestId: r.id, status: 'active', issuedAt: submittedAt, override: false, demo: true };
      if (sp.used) { p.status = 'used'; p.usedAt = inst(sp.date, sp.used); p.usedBy = 'Riley Alvarez'; }
      if (sp.cancelled) { p.status = 'void'; r.status = 'cancelled'; r.cancelledAt = inst(D(-1), '16:05'); }
      await store.put('passes', p);
      route('approved', r, submittedAt);
      if (sp.cancelled) route('cancelled', r, r.cancelledAt as string);
      if (sp.used) {
        const ev2: GateEvent = { id: newId('l-'), projectId: project.id, ts: p.usedAt as string, code: r.passCode, color: 'green', reason: 'G00', title: 'Approved delivery', action: 'admitted', guard: 'Riley Alvarez', requestId: r.id, subId: r.subId, demo: true };
        await store.put('gatelog', ev2);
      }
    } else route(r.status as 'review' | 'rejected', r, submittedAt);
    requests.push(r);
    await store.put('requests', r);
  }
  const strayTs = inst(D(0), '06:40'); const strayCode = settings.passPrefix + '-HKT4WA';
  await store.put('gatelog', { id: newId('l-'), projectId: project.id, ts: strayTs, code: strayCode, color: 'red', reason: 'G01', title: 'No approved delivery for this code', action: 'turned away', guard: 'Riley Alvarez', requestId: null, subId: null, demo: true });
  const strayNotices = notices('turnedAway', { subName: 'Unknown carrier', material: 'load with no approved pass', reasonTitle: REASONS.G01.title, remedy: fill(REASONS.G01.remedy, settings as unknown as Record<string, unknown>), scannedCode: strayCode, guard: 'Riley Alvarez' }).filter((n) => n.to !== 'contractor');
  for (const n of strayNotices) for (const e of n.to === 'security' ? emailsFor('access') : emailsFor('admin')) mail.push({ id: newId('m-'), ts: strayTs, to: e, role: n.to, subject: n.subject, body: n.body, kind: 'delivery', event: n.event, projectId: project.id, requestId: null });
  await store.put('projects', project);
  for (const m of mail) await store.put('mail', m);
}
