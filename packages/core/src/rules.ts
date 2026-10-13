/*
 * Granted — delivery and gate rules.
 *
 * The single source of truth for every yes/no decision. Pure TypeScript, no
 * dependencies, no AI. The API runs these to make decisions; the app runs the
 * same file to give instant feedback while someone fills in a form.
 *
 * All Dates passed in are "site wall-clock" Dates: their local fields
 * (getFullYear, getHours...) are the time at the jobsite. Use
 * `toWallClock(instant, project.timeZone)` from ./time to get one. The API
 * runs with TZ=UTC so wall-clock Dates never fall in a DST gap.
 *
 * Ported line-for-line from the prototype's rules.js; the tests in
 * test/rules.test.ts are the same scenarios.
 */

export interface Settings {
  project: string;
  timeZone: string;
  passPrefix: string;
  minNoticeHours: number;
  maxDaysBeforeInstall: number;
  gateToleranceMinutes: number;
  noShowGraceMinutes: number;
  maxPalletsPerRequest: number;
  duplicateWindowDays: number;
  slotMinutes: number;
  gateOpen: string;
  gateClose: string;
  workDays: number[];
  blackoutDates: string[];
  searchDaysForNextSlot: number;
  reviewEscalationHours: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  project: 'Sample project',
  timeZone: 'America/Chicago',
  passPrefix: 'DC2',
  minNoticeHours: 48,
  maxDaysBeforeInstall: 7,
  gateToleranceMinutes: 60,
  noShowGraceMinutes: 60,
  maxPalletsPerRequest: 20,
  duplicateWindowDays: 7,
  slotMinutes: 60,
  gateOpen: '06:00',
  gateClose: '16:00',
  workDays: [1, 2, 3, 4, 5, 6],
  blackoutDates: [],
  searchDaysForNextSlot: 21,
  reviewEscalationHours: 4,
});

export type ReasonCode =
  | 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06' | 'R07' | 'R08' | 'R09' | 'R10'
  | 'F01' | 'F02' | 'F03'
  | 'G00' | 'G01' | 'G02' | 'G03' | 'G04' | 'G05' | 'G06' | 'G07';

export interface Reason { key: string; outcome: 'reject' | 'review' | 'green' | 'red'; title: string; remedy: string }

export const REASONS: Readonly<Record<ReasonCode, Reason>> = Object.freeze({
  R01: { key: 'REQUIRED_FIELDS', outcome: 'reject', title: 'Required information missing', remedy: 'Fill in: {missing}.' },
  R02: { key: 'SUB_SUSPENDED', outcome: 'reject', title: 'Booking privileges suspended', remedy: 'Contact the GC project manager to restore booking privileges.' },
  R03: { key: 'ACTIVITY_NOT_IN_LOOKAHEAD', outcome: 'reject', title: 'Activity is not in the current 3-week look-ahead', remedy: 'Pick an activity from the look-ahead list. If your work is missing, ask the GC scheduler to add it.' },
  R04: { key: 'ACTIVITY_WRONG_TRADE', outcome: 'reject', title: 'Activity belongs to another trade', remedy: 'Pick one of your own activities ({trade}).' },
  R05: { key: 'NOTICE_TOO_SHORT', outcome: 'reject', title: 'Less than {minNoticeHours} hours’ notice', remedy: 'Pick a time at least {minNoticeHours} hours from now. Next open slot: {nextOpen}.' },
  R06: { key: 'GATE_CLOSED', outcome: 'reject', title: 'The gate is closed at that time', remedy: 'Deliveries run {gateOpen}–{gateClose}, {workDays}. Next open slot: {nextOpen}.' },
  R07: { key: 'SLOT_FULL', outcome: 'reject', title: 'That time slot is full at {gateName}', remedy: 'Next open slot at {gateName}: {nextOpen}.' },
  R08: { key: 'ZONE_FULL', outcome: 'reject', title: '{zoneName} has no room for {pallets} pallets', remedy: 'Room left in {zoneName} on those days: {zoneLeft} pallets. Pick another zone or split the delivery.' },
  R09: { key: 'AFTER_ACTIVITY_FINISH', outcome: 'reject', title: 'Delivery is after the activity finishes ({activityFinish})', remedy: 'Pick a date on or before {activityFinish}, or ask the scheduler to update the look-ahead.' },
  R10: { key: 'EARLY_NO_JUSTIFICATION', outcome: 'reject', title: 'More than {maxDaysBeforeInstall} days before install, with no justification', remedy: 'Deliver on or after {earliestDate}, or add a justification for early delivery so the GC can review it.' },
  F01: { key: 'EARLY_DELIVERY', outcome: 'review', title: 'Early delivery ({daysEarly} days before install)', remedy: 'A GC reviewer will approve or reject. Justification given: “{justification}”' },
  F02: { key: 'LARGE_DELIVERY', outcome: 'review', title: 'Large delivery ({pallets} pallets)', remedy: 'A GC reviewer will confirm the staging plan for more than {maxPalletsPerRequest} pallets.' },
  F03: { key: 'POSSIBLE_DUPLICATE', outcome: 'review', title: 'Possible duplicate of {otherCode}', remedy: 'A GC reviewer will check whether this material is already onsite or booked.' },
  G00: { key: 'ADMIT', outcome: 'green', title: 'Approved delivery', remedy: 'Admit the truck and direct it to {zoneName}.' },
  G01: { key: 'NO_PASS', outcome: 'red', title: 'No approved delivery for this code', remedy: 'The contractor must submit a delivery request with {minNoticeHours} hours’ notice, or the GC superintendent can issue an emergency pass.' },
  G02: { key: 'PASS_CANCELLED', outcome: 'red', title: 'This delivery was cancelled', remedy: 'The contractor must submit a new delivery request.' },
  G03: { key: 'PASS_USED', outcome: 'red', title: 'Pass already used at {usedAt}', remedy: 'Each pass admits one truck. A second truck needs its own approved request.' },
  G04: { key: 'WRONG_DAY', outcome: 'red', title: 'Approved for {deliveryDate}, not today', remedy: 'Return on {deliveryDate} between {windowOpen} and {windowClose}, or reschedule in the app.' },
  G05: { key: 'TOO_EARLY', outcome: 'red', title: 'Too early: window opens at {windowOpen}', remedy: 'Wait off-site until {windowOpen}, or the GC superintendent can approve early entry.' },
  G06: { key: 'TOO_LATE', outcome: 'red', title: 'Too late: window closed at {windowClose}', remedy: 'Reschedule in the app, or the GC superintendent can issue an emergency pass.' },
  G07: { key: 'GATE_SUB_SUSPENDED', outcome: 'red', title: 'Contractor’s booking privileges are suspended', remedy: 'Contact the GC project manager.' },
});

// ---------------------------------------------------------------- entities

export interface Gate { id: string; name: string; capacityPerSlot: number; active?: boolean }
export interface Zone { id: string; name: string; capacityPallets: number; active?: boolean }
export interface Activity { id: string; name: string; trade: string; start: string; finish: string }
/** A company on a project (the rules call it a "sub"). */
export interface Sub { id: string; name: string; trade?: string; suspended?: boolean }

export type RequestStatus = 'approved' | 'review' | 'rejected' | 'cancelled';

export interface DeliveryInput {
  id?: string;
  subId?: string;
  activityId?: string;
  gateId?: string;
  date?: string;
  slot?: string;
  zoneId?: string;
  material?: string;
  quantity?: number | string;
  unit?: string;
  pallets?: number | string;
  pocName?: string;
  pocPhone?: string;
  justification?: string;
}

export interface BookedRequest extends DeliveryInput {
  id: string;
  status: RequestStatus;
  stagedUntil?: string | null;
  passCode?: string | null;
  arrived?: boolean;
}

export interface Pass {
  code: string;
  requestId: string;
  status: 'active' | 'used' | 'void';
  usedAt?: string | null;
  override?: boolean;
}

export interface RequestContext {
  now: Date;
  settings?: Partial<Settings>;
  gates: Gate[];
  zones: Zone[];
  subs: Sub[];
  activities: Activity[];
  requests: BookedRequest[];
}

export interface GateContext {
  now: Date;
  settings?: Partial<Settings>;
  passes: Pass[];
  requests: BookedRequest[];
  subs: Sub[];
  zones?: Zone[];
  /** Formats a stored instant (ISO string) as a site clock time. Defaults to the process clock. */
  formatInstant?: (iso: string) => string;
}

export type CheckStatus = 'pass' | 'fail' | 'flag' | 'skip';
export interface Check { id: string; label: string; status: CheckStatus; reason?: ReasonCode; title?: string; remedy?: string }
export interface OpenSlot { date: string; slot: string; label: string }
export interface Evaluation {
  outcome: 'approved' | 'review' | 'rejected';
  checks: Check[];
  ready: boolean;
  reasons: ReasonCode[];
  stagedUntil: string | null;
  nextOpen: OpenSlot | null;
}

// ---------------------------------------------------------------- dates (site local)

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
export function ymd(d: Date): string { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function parseYmd(s: string): Date { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
export function toMinutes(hhmm: string): number { const p = String(hhmm).split(':').map(Number); return p[0] * 60 + p[1]; }
function fromMinutes(m: number): string { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
export function at(dateStr: string, hhmm: string): Date { const d = parseYmd(dateStr); const m = toMinutes(hhmm); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d; }
export function addDays(dateStr: string, n: number): string { const d = parseYmd(dateStr); d.setDate(d.getDate() + n); return ymd(d); }
export function daysBetween(a: string, b: string): number { return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000); }
export function fmtTime(hhmm: string): string {
  const m = toMinutes(hhmm); let h = Math.floor(m / 60); const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12; return h + ':' + pad(m % 60) + ' ' + ap;
}
export function fmtClock(d: Date): string { return fmtTime(pad(d.getHours()) + ':' + pad(d.getMinutes())); }
export function fmtDate(dateStr: string): string { const d = parseYmd(dateStr); return DAY_NAMES[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate(); }
export function fmtWorkDays(days: number[]): string {
  const s = [...days].sort((a, b) => a - b);
  const contiguous = s.every((v, i) => i === 0 || v === s[i - 1] + 1);
  return contiguous && s.length > 1 ? DAY_NAMES[s[0]] + '–' + DAY_NAMES[s[s.length - 1]] : s.map((d) => DAY_NAMES[d]).join(', ');
}
export function fill(template: string, vars: Record<string, unknown>): string {
  return String(template).replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

// ---------------------------------------------------------------- calendar and capacity

export function settingsOf(ctx?: { settings?: Partial<Settings> } | null): Settings {
  return Object.assign({}, DEFAULT_SETTINGS, (ctx && ctx.settings) || {}) as Settings;
}
const merged = (settings?: Partial<Settings>): Settings => Object.assign({}, DEFAULT_SETTINGS, settings || {}) as Settings;

export function slotsForDay(settings: Partial<Settings>): string[] {
  const s = merged(settings); const out: string[] = [];
  for (let m = toMinutes(s.gateOpen); m + s.slotMinutes <= toMinutes(s.gateClose); m += s.slotMinutes) out.push(fromMinutes(m));
  return out;
}
export function isWorkDay(dateStr: string, settings?: Partial<Settings>): boolean {
  const s = merged(settings);
  return s.workDays.includes(parseYmd(dateStr).getDay()) && !s.blackoutDates.includes(dateStr);
}
function isActive(r: BookedRequest | undefined | null): boolean { return !!r && (r.status === 'approved' || r.status === 'review'); }

export function slotLoad(requests: BookedRequest[], gateId: string, date: string, slot: string, excludeId?: string): number {
  return requests.filter((r) => isActive(r) && r.id !== excludeId && r.gateId === gateId && r.date === date && r.slot === slot).length;
}

/** The days a delivery occupies its staging zone: delivery day through the day install starts. */
export function stagingDays(date: string, activity?: Activity | null): { from: string; until: string; days: string[] } {
  const until = activity && activity.start > date ? activity.start : date;
  const days: string[] = []; for (let d = date; d <= until; d = addDays(d, 1)) days.push(d);
  return { from: date, until, days };
}

/** Highest pallet count already booked in a zone on any of the given days. */
export function zonePeak(requests: BookedRequest[], zoneId: string, days: string[], excludeId?: string): number {
  let peak = 0;
  for (const day of days) {
    let sum = 0;
    for (const r of requests) {
      if (!isActive(r) || r.id === excludeId || r.zoneId !== zoneId || !r.date) continue;
      if (r.date <= day && day <= (r.stagedUntil || r.date)) sum += Number(r.pallets) || 0;
    }
    peak = Math.max(peak, sum);
  }
  return peak;
}

function earliestAllowed(now: Date, s: Settings): Date { return new Date(now.getTime() + s.minNoticeHours * 3600000); }

/** First slot at a gate that is open, has room and meets the notice rule. */
export function nextOpenSlot(ctx: Pick<RequestContext, 'now' | 'settings' | 'gates' | 'requests'>, gateId: string, excludeId?: string): OpenSlot | null {
  const s = settingsOf(ctx); const gate = ctx.gates.find((g) => g.id === gateId); if (!gate) return null;
  const earliest = earliestAllowed(ctx.now, s); let day = ymd(earliest);
  for (let i = 0; i < s.searchDaysForNextSlot; i++, day = addDays(day, 1)) {
    if (!isWorkDay(day, s)) continue;
    for (const slot of slotsForDay(s)) {
      if (at(day, slot) < earliest) continue;
      if (slotLoad(ctx.requests, gateId, day, slot, excludeId) < gate.capacityPerSlot) return { date: day, slot, label: fmtDate(day) + ' ' + fmtTime(slot) };
    }
  }
  return null;
}

export interface SlotCell { slot: string; label: string; left: number; capacity: number; open: boolean; tooSoon: boolean; closedDay: boolean }
/** Every slot for one gate and day, with how many trucks it can still take. */
export function slotBoard(ctx: Pick<RequestContext, 'now' | 'settings' | 'gates' | 'requests'>, gateId: string, date: string, excludeId?: string): SlotCell[] {
  const s = settingsOf(ctx); const gate = ctx.gates.find((g) => g.id === gateId); if (!gate || !date) return [];
  const earliest = earliestAllowed(ctx.now, s); const work = isWorkDay(date, s);
  return slotsForDay(s).map((slot) => {
    const used = slotLoad(ctx.requests, gateId, date, slot, excludeId);
    const left = Math.max(0, gate.capacityPerSlot - used);
    const tooSoon = at(date, slot) < earliest;
    return { slot, label: fmtTime(slot), left, capacity: gate.capacityPerSlot, open: work && !tooSoon && left > 0, tooSoon, closedDay: !work };
  });
}

// ---------------------------------------------------------------- request evaluation

const REQUIRED: [keyof DeliveryInput, string][] = [
  ['subId', 'company'], ['activityId', 'look-ahead activity'], ['gateId', 'gate'], ['date', 'delivery date'],
  ['slot', 'time slot'], ['zoneId', 'staging zone'], ['material', 'material description'],
  ['quantity', 'quantity'], ['unit', 'unit'], ['pallets', 'pallet count'], ['pocName', 'onsite contact name'], ['pocPhone', 'onsite contact phone'],
];

export function missingFields(req: DeliveryInput): string[] {
  const miss: string[] = [];
  for (const [k, label] of REQUIRED) {
    const v = req[k];
    if (v === undefined || v === null || String(v).trim() === '') miss.push(label);
  }
  if (req.quantity !== undefined && req.quantity !== '' && !(Number(req.quantity) > 0)) miss.push('quantity above zero');
  if (req.pallets !== undefined && req.pallets !== '' && !(Number.isInteger(Number(req.pallets)) && Number(req.pallets) >= 0)) miss.push('whole number of pallets');
  if (req.pocPhone && String(req.pocPhone).replace(/\D/g, '').length !== 10) miss.push('10-digit phone number');
  return [...new Set(miss)];
}

/** Run every check on a request, in a fixed order. */
export function evaluateRequest(req: DeliveryInput, inCtx: RequestContext): Evaluation {
  const s = settingsOf(inCtx);
  const ctx: RequestContext = Object.assign({}, inCtx, { settings: s });
  const checks: Check[] = [];
  const vars: Record<string, unknown> = Object.assign({} as Record<string, unknown>, s, { workDays: fmtWorkDays(s.workDays), gateOpen: fmtTime(s.gateOpen), gateClose: fmtTime(s.gateClose) });
  const sub = ctx.subs.find((x) => x.id === req.subId);
  const gate = ctx.gates.find((x) => x.id === req.gateId);
  const zone = ctx.zones.find((x) => x.id === req.zoneId);
  const act = ctx.activities.find((x) => x.id === req.activityId);
  Object.assign(vars, {
    pallets: req.pallets, justification: (req.justification || '').trim(),
    gateName: gate ? gate.name : 'that gate', zoneName: zone ? zone.name : 'that zone', trade: sub ? sub.trade : '',
    activityFinish: act ? fmtDate(act.finish) : '',
  });
  const add = (id: string, label: string, status: CheckStatus, code?: ReasonCode | null): Check => {
    const c: Check = { id, label, status };
    if (code) { c.reason = code; c.title = fill(REASONS[code].title, vars); c.remedy = fill(REASONS[code].remedy, vars); }
    checks.push(c); return c;
  };
  let next: OpenSlot | null = null;
  const needNext = () => {
    if (vars.nextOpen === undefined) { next = gate ? nextOpenSlot(ctx, gate.id, req.id) : null; vars.nextOpen = next ? next.label : 'none in the next 3 weeks'; }
  };

  // 1. Required information
  const miss = missingFields(req); vars.missing = miss.join(', ');
  add('required', 'Required information', miss.length ? 'fail' : 'pass', miss.length ? 'R01' : null);
  const basicsOk = !miss.length && !!sub && !!gate && !!zone;

  // 2. Contractor active
  add('subActive', 'Contractor can book', sub && sub.suspended ? 'fail' : (sub ? 'pass' : 'skip'), sub && sub.suspended ? 'R02' : null);

  // 3-4. Look-ahead activity
  if (!req.activityId) { add('lookahead', 'Activity is in the look-ahead', 'skip'); add('trade', 'Activity matches your trade', 'skip'); }
  else {
    add('lookahead', 'Activity is in the look-ahead', act ? 'pass' : 'fail', act ? null : 'R03');
    // Trade is checked only when the project admin has set a trade for the company.
    if (act && sub && sub.trade) add('trade', 'Activity matches your trade', act.trade === sub.trade ? 'pass' : 'fail', act.trade === sub.trade ? null : 'R04');
    else add('trade', 'Activity matches your trade', act && sub ? 'pass' : 'skip');
  }

  // 5. Notice
  if (req.date && req.slot) {
    const ok = at(req.date, req.slot) >= earliestAllowed(ctx.now, s);
    if (!ok) needNext();
    add('notice', s.minNoticeHours + '-hour notice', ok ? 'pass' : 'fail', ok ? null : 'R05');
  } else add('notice', s.minNoticeHours + '-hour notice', 'skip');

  // 6. Gate hours
  if (req.date && req.slot) {
    const ok = isWorkDay(req.date, s) && slotsForDay(s).includes(req.slot);
    if (!ok) needNext();
    add('hours', 'Gate open at that time', ok ? 'pass' : 'fail', ok ? null : 'R06');
  } else add('hours', 'Gate open at that time', 'skip');

  // 7. Slot capacity
  if (gate && req.date && req.slot) {
    const ok = slotLoad(ctx.requests, gate.id, req.date, req.slot, req.id) < gate.capacityPerSlot;
    if (!ok) needNext();
    add('slot', 'Time slot has room', ok ? 'pass' : 'fail', ok ? null : 'R07');
  } else add('slot', 'Time slot has room', 'skip');

  // 8. Staging zone capacity
  const staging = req.date ? stagingDays(req.date, act) : null;
  if (zone && staging && req.pallets !== '' && req.pallets !== undefined) {
    const peak = zonePeak(ctx.requests, zone.id, staging.days, req.id);
    const left = Math.max(0, zone.capacityPallets - peak); vars.zoneLeft = left;
    const ok = Number(req.pallets) <= left;
    add('zone', 'Staging zone has room', ok ? 'pass' : 'fail', ok ? null : 'R08');
  } else add('zone', 'Staging zone has room', 'skip');

  // 9. Not after the activity finishes
  if (act && req.date) {
    const ok = req.date <= act.finish;
    add('finish', 'Delivery before activity finishes', ok ? 'pass' : 'fail', ok ? null : 'R09');
  } else add('finish', 'Delivery before activity finishes', 'skip');

  // 10. Within N days of install (soft, with justification)
  const earlyLabel = 'Within ' + s.maxDaysBeforeInstall + ' days of install';
  if (act && req.date) {
    const daysEarly = daysBetween(req.date, act.start); vars.daysEarly = daysEarly;
    vars.earliestDate = fmtDate(addDays(act.start, -s.maxDaysBeforeInstall));
    if (daysEarly <= s.maxDaysBeforeInstall) add('early', earlyLabel, 'pass');
    else if (!vars.justification) add('early', earlyLabel, 'fail', 'R10');
    else add('early', earlyLabel, 'flag', 'F01');
  } else add('early', earlyLabel, 'skip');

  // 11. Pallet limit (soft)
  const sizeLabel = 'Normal size (' + s.maxPalletsPerRequest + ' pallets or fewer)';
  if (req.pallets !== '' && req.pallets !== undefined && !isNaN(Number(req.pallets))) {
    const ok = Number(req.pallets) <= s.maxPalletsPerRequest;
    add('size', sizeLabel, ok ? 'pass' : 'flag', ok ? null : 'F02');
  } else add('size', sizeLabel, 'skip');

  // 12. Possible duplicate (soft)
  if (req.subId && req.activityId && req.date) {
    const date = req.date;
    const other = ctx.requests.find((r) => r.id !== req.id && (isActive(r) || r.arrived) && r.subId === req.subId && r.activityId === req.activityId &&
      !!r.date && Math.abs(daysBetween(r.date, date)) <= s.duplicateWindowDays);
    vars.otherCode = other ? (other.passCode || other.id) : '';
    add('duplicate', 'Not a repeat of another delivery', other ? 'flag' : 'pass', other ? 'F03' : null);
  } else add('duplicate', 'Not a repeat of another delivery', 'skip');

  const fails = checks.filter((c) => c.status === 'fail');
  const flags = checks.filter((c) => c.status === 'flag');
  const outcome = fails.length ? 'rejected' : flags.length ? 'review' : 'approved';
  return {
    outcome, checks, ready: basicsOk,
    reasons: fails.concat(flags).map((c) => c.reason as ReasonCode),
    stagedUntil: staging ? staging.until : null,
    nextOpen: next,
  };
}

// ---------------------------------------------------------------- gate check

export function normalizeCode(raw: string, settings?: Partial<Settings>): string {
  const s = merged(settings);
  let c = String(raw || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!c.includes('-') && c.length === 6) c = s.passPrefix + '-' + c;
  if (c.startsWith(s.passPrefix) && !c.startsWith(s.passPrefix + '-')) c = s.passPrefix + '-' + c.slice(s.passPrefix.length);
  return c;
}

export interface PassWindow { start: Date; end: Date; open: Date; close: Date }
export function passWindow(req: { date: string; slot: string }, settings?: Partial<Settings>): PassWindow {
  const s = merged(settings);
  const start = at(req.date, req.slot); const end = new Date(start.getTime() + s.slotMinutes * 60000);
  // Arrival window: the slot plus the tolerance either side, but never outside gate hours.
  const gateOpen = at(req.date, s.gateOpen); const gateClose = at(req.date, s.gateClose);
  return {
    start, end,
    open: new Date(Math.max(start.getTime() - s.gateToleranceMinutes * 60000, gateOpen.getTime())),
    close: new Date(Math.min(end.getTime() + s.gateToleranceMinutes * 60000, gateClose.getTime())),
  };
}

export interface GateResult {
  color: 'green' | 'red';
  reason: ReasonCode;
  code: string;
  title: string;
  remedy: string;
  pass?: Pass;
  request?: BookedRequest;
}

export function checkPass(rawCode: string, ctx: GateContext): GateResult {
  const s = settingsOf(ctx);
  const code = normalizeCode(rawCode, s);
  const pass = ctx.passes.find((p) => p.code === code);
  const req = pass ? ctx.requests.find((r) => r.id === pass.requestId) : undefined;
  const vars: Record<string, unknown> = Object.assign({} as Record<string, unknown>, s);
  const out = (reason: ReasonCode): GateResult => ({
    color: REASONS[reason].outcome === 'green' ? 'green' : 'red', reason, code,
    title: fill(REASONS[reason].title, vars), remedy: fill(REASONS[reason].remedy, vars), pass, request: req,
  });
  if (!pass || !req || !req.date || !req.slot) return out('G01');
  const zone = (ctx.zones || []).find((z) => z.id === req.zoneId);
  const sub = ctx.subs.find((x) => x.id === req.subId);
  const w = passWindow({ date: req.date, slot: req.slot }, s);
  const fmtInstant = ctx.formatInstant || ((iso: string) => fmtClock(new Date(iso)));
  Object.assign(vars, {
    zoneName: zone ? zone.name : req.zoneId, deliveryDate: fmtDate(req.date),
    windowOpen: fmtClock(w.open), windowClose: fmtClock(w.close),
    usedAt: pass.usedAt ? fmtInstant(pass.usedAt) : '',
  });
  if (pass.status === 'void' || req.status === 'cancelled') return out('G02');
  if (pass.status === 'used') return out('G03');
  if (sub && sub.suspended && !pass.override) return out('G07');
  if (req.date !== ymd(ctx.now)) return out('G04');
  if (ctx.now < w.open) return out('G05');
  if (ctx.now > w.close) return out('G06');
  return out('G00');
}

// ---------------------------------------------------------------- display status

export type DeliveryState = 'cancelled' | 'rejected' | 'review' | 'arrived' | 'noshow' | 'approved';
export function deliveryStatus(req: BookedRequest, pass: Pass | null | undefined, now: Date, settings?: Partial<Settings>): DeliveryState {
  const s = merged(settings);
  if (req.status === 'cancelled') return 'cancelled';
  if (req.status === 'rejected') return 'rejected';
  if (req.status === 'review') return 'review';
  if (pass && pass.status === 'used') return 'arrived';
  if (pass && req.status === 'approved' && req.date && req.slot) {
    const w = passWindow({ date: req.date, slot: req.slot }, s);
    if (now.getTime() > w.end.getTime() + s.noShowGraceMinutes * 60000) return 'noshow';
  }
  return 'approved';
}

export const PASS_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679'; // no 0/O, 1/I/L, 2/Z, 5/S, 8/B
export type Rand = () => number;
export function newPassCode(existing: Iterable<string> | null | undefined, settings?: Partial<Settings>, rand?: Rand): string {
  const s = merged(settings);
  const r = rand || Math.random; const taken = new Set(existing || []);
  for (let tries = 0; tries < 1000; tries++) {
    let c = ''; for (let i = 0; i < 6; i++) c += PASS_ALPHABET[Math.floor(r() * PASS_ALPHABET.length)];
    const code = s.passPrefix + '-' + c; if (!taken.has(code)) return code;
  }
  throw new Error('Could not create a unique pass code');
}

// ---------------------------------------------------------------- notification templates (fixed text)

export type Audience = 'contractor' | 'security' | 'gc';
export type NoticeEvent = 'approved' | 'review' | 'rejected' | 'cancelled' | 'emergency' | 'turnedAway' | 'noshow';
export const CHANNELS: Readonly<Record<Audience, string[]>> = { contractor: ['email', 'app'], security: ['email', 'app'], gc: ['email', 'app'] };

export interface NoticeData {
  subId?: string; subName: string; material: string; date?: string; slot?: string;
  gateName?: string; zoneName?: string; passCode?: string | null; requestId?: string | null;
  reasons?: { title?: string; remedy?: string }[]; by?: string; reasonTitle?: string; remedy?: string; scannedCode?: string; guard?: string;
}
export interface Notice { to: Audience; channels: string[]; subject: string; body: string; event: NoticeEvent; subId?: string; requestId: string | null; passCode: string | null }

export function notices(event: NoticeEvent, d: NoticeData): Notice[] {
  const when = d.date && d.slot ? fmtDate(d.date) + ' ' + fmtTime(d.slot) : '';
  const head = d.subName + ' – ' + d.material;
  const reasonsText = (d.reasons || []).map((r) => '• ' + r.title + '. ' + r.remedy).join('\n');
  const list: Notice[] = [];
  const to = (who: Audience, subject: string, body: string) => list.push({ to: who, channels: CHANNELS[who], subject, body, event, subId: d.subId, requestId: d.requestId || null, passCode: d.passCode || null });
  switch (event) {
    case 'approved':
      to('contractor', 'Approved: ' + d.passCode + ' for ' + when, head + '\nGate: ' + d.gateName + '\nStaging: ' + d.zoneName + '\nShow gate pass ' + d.passCode + ' (QR attached) to security on arrival.');
      to('security', 'New approved delivery ' + when, head + '\nPass: ' + d.passCode + '\nGate: ' + d.gateName);
      break;
    case 'review':
      to('contractor', 'Under review: ' + head, 'Your request is waiting for a GC reviewer.\n' + reasonsText);
      to('gc', 'Review needed: ' + head + ' (' + when + ')', reasonsText);
      break;
    case 'rejected':
      to('contractor', 'Not approved: ' + head, 'Your request was not approved.\n' + reasonsText);
      break;
    case 'cancelled':
      to('contractor', 'Cancelled: ' + d.passCode + ' (' + when + ')', head + ' was cancelled.');
      to('security', 'Cancelled delivery ' + d.passCode, head + ' (' + when + ') is cancelled. Do not admit.');
      break;
    case 'emergency':
      to('contractor', 'Emergency pass issued: ' + d.passCode, head + ' may enter today ' + when + ' at ' + d.gateName + '. Issued by ' + (d.by || 'GC') + '.');
      to('security', 'Emergency pass ' + d.passCode + ' (today ' + (d.slot ? fmtTime(d.slot) : '') + ')', head + '\nIssued by ' + (d.by || 'GC') + '.');
      to('gc', 'Emergency pass logged: ' + d.passCode, head + ' – counts as an override against ' + d.subName + '.');
      break;
    case 'turnedAway':
      for (const who of ['contractor', 'security', 'gc'] as Audience[]) to(who, 'Turned away at gate: ' + head, d.reasonTitle + '.\nWhat to do: ' + d.remedy + '\nCode: ' + (d.passCode || d.scannedCode || 'none') + ' • Logged by ' + (d.guard || 'security'));
      break;
    case 'noshow':
      to('contractor', 'No-show: ' + d.passCode, head + ' did not arrive in its window (' + when + '). Repeated no-shows can suspend booking.');
      to('gc', 'No-show: ' + head, 'Pass ' + d.passCode + ', window ' + when + '.');
      break;
    default: break;
  }
  return list;
}
