// @ts-nocheck -- scenario data is deliberately loose (partial records), as in the original suite
// Scenario tests for the delivery and gate rules. Same cases as the prototype's rules/test-cases.csv.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as R from '../src/rules';

const NOW = new Date(2026, 9, 12, 8, 0); // Mon 10/12/2026 08:00 site time
const subs = [
  { id: 'S01', name: 'North Field Electrical', trade: 'Electrical' },
  { id: 'S02', name: 'Caliche Mechanical', trade: 'Mechanical' },
  { id: 'S03', name: 'Redbud Fire Protection', trade: 'Fire protection', suspended: true },
];
const gates = [{ id: 'G1', name: 'Gate 1 North', capacityPerSlot: 2 }, { id: 'G2', name: 'Gate 2 South', capacityPerSlot: 1 }];
const zones = [{ id: 'Z1', name: 'South laydown yard', capacityPallets: 60 }, { id: 'Z2', name: 'Hall A staging', capacityPallets: 12 }];
const activities = [
  { id: 'A1', name: 'Hall A busway', trade: 'Electrical', start: '2026-10-16', finish: '2026-10-30' },
  { id: 'A2', name: 'Hall A CRAH set', trade: 'Mechanical', start: '2026-10-14', finish: '2026-10-20' },
  { id: 'A3', name: 'Hall B switchgear', trade: 'Electrical', start: '2026-10-30', finish: '2026-11-10' },
  { id: 'A4', name: 'Hall B sprinkler mains', trade: 'Fire protection', start: '2026-10-15', finish: '2026-10-30' },
];
const base = {
  id: 'NEW', subId: 'S01', activityId: 'A1', gateId: 'G1', date: '2026-10-15', slot: '07:00', zoneId: 'Z1',
  material: 'Busway sections', quantity: 12, unit: 'sections', pallets: 4, pocName: 'J. Smith', pocPhone: '214-555-0100',
};
const ctx = (requests = [], extra = {}) => Object.assign({ now: NOW, settings: {}, subs, gates, zones, activities, requests }, extra);
const req = (over) => Object.assign({}, base, over);
const booked = (over) => Object.assign({}, base, { status: 'approved', stagedUntil: '2026-10-16' }, over);
const failed = (res) => res.checks.filter((c) => c.status === 'fail').map((c) => c.reason);
const flagged = (res) => res.checks.filter((c) => c.status === 'flag').map((c) => c.reason);

test('T01 clean request is approved automatically', () => {
  const r = R.evaluateRequest(req(), ctx());
  assert.equal(r.outcome, 'approved');
  assert.equal(r.stagedUntil, '2026-10-16');
});
test('T02 less than 48 hours notice is rejected with the next open slot', () => {
  const r = R.evaluateRequest(req({ date: '2026-10-13', slot: '09:00' }), ctx());
  assert.equal(r.outcome, 'rejected'); assert.deepEqual(failed(r), ['R05']);
  assert.equal(r.nextOpen.label, 'Wed 10/14 8:00 AM'); // exactly 48 hours counts
  assert.match(r.checks.find((c) => c.reason === 'R05').remedy, /Wed 10\/14 8:00 AM/);
});
test('T03 Sunday delivery is rejected (gate closed)', () => {
  const r = R.evaluateRequest(req({ date: '2026-10-18' }), ctx());
  assert.deepEqual(failed(r), ['R06']);
});
test('T04 slot outside gate hours is rejected', () => {
  const r = R.evaluateRequest(req({ slot: '16:00' }), ctx());
  assert.ok(failed(r).includes('R06'));
});
test('T05 full time slot is rejected and the next open slot is offered', () => {
  const r = R.evaluateRequest(req(), ctx([booked({ id: 'X1', subId: 'S02', activityId: 'A2' }), booked({ id: 'X2', subId: 'S02', activityId: 'A2' })]));
  assert.deepEqual(failed(r), ['R07']);
  assert.equal(r.nextOpen.label, 'Wed 10/14 8:00 AM');
});
test('T06 cancelled and rejected bookings do not take up a slot', () => {
  const r = R.evaluateRequest(req(), ctx([booked({ id: 'X1', status: 'cancelled', subId: 'S02' }), booked({ id: 'X2', status: 'rejected', subId: 'S02' })]));
  assert.equal(r.outcome, 'approved');
});
test('T07 staging zone over capacity is rejected with room left', () => {
  const r = R.evaluateRequest(req({ zoneId: 'Z2', pallets: 5 }), ctx([booked({ id: 'X1', subId: 'S02', activityId: 'A2', zoneId: 'Z2', pallets: 10, slot: '09:00' })]));
  assert.deepEqual(failed(r), ['R08']);
  assert.match(r.checks.find((c) => c.reason === 'R08').remedy, /2 pallets/);
});
test('T08 activity from another trade is rejected', () => {
  const r = R.evaluateRequest(req({ subId: 'S02' }), ctx());
  assert.ok(failed(r).includes('R04'));
});
test('T08b trade is not checked when the company has no trade set', () => {
  const noTrade = subs.map((x) => (x.id === 'S02' ? Object.assign({}, x, { trade: '' }) : x));
  const r = R.evaluateRequest(req({ subId: 'S02' }), Object.assign(ctx(), { subs: noTrade }));
  assert.equal(r.outcome, 'approved');
});
test('T09 activity not in the look-ahead is rejected', () => {
  const r = R.evaluateRequest(req({ activityId: 'A999' }), ctx());
  assert.ok(failed(r).includes('R03'));
});
test('T10 delivery after the activity finishes is rejected', () => {
  const r = R.evaluateRequest(req({ subId: 'S02', activityId: 'A2', date: '2026-10-21' }), ctx());
  assert.ok(failed(r).includes('R09'));
});
test('T11 more than 7 days early with no justification is rejected', () => {
  const r = R.evaluateRequest(req({ activityId: 'A3' }), ctx());
  assert.deepEqual(failed(r), ['R10']);
  assert.match(r.checks.find((c) => c.reason === 'R10').remedy, /Fri 10\/23/);
});
test('T12 more than 7 days early with a justification goes to review', () => {
  const r = R.evaluateRequest(req({ activityId: 'A3', justification: 'Long-lead switchgear, factory ships once' }), ctx());
  assert.equal(r.outcome, 'review'); assert.deepEqual(flagged(r), ['F01']);
});
test('T13 exactly 7 days early is allowed', () => {
  const r = R.evaluateRequest(req({ activityId: 'A3', date: '2026-10-23' }), ctx());
  assert.equal(r.outcome, 'approved');
});
test('T14 more pallets than the limit goes to review', () => {
  const r = R.evaluateRequest(req({ pallets: 25 }), ctx());
  assert.equal(r.outcome, 'review'); assert.deepEqual(flagged(r), ['F02']);
});
test('T15 same contractor and activity within 7 days goes to review', () => {
  const r = R.evaluateRequest(req(), ctx([booked({ id: 'X1', date: '2026-10-16', slot: '10:00', passCode: 'DC2-AAAAAA' })]));
  assert.equal(r.outcome, 'review'); assert.deepEqual(flagged(r), ['F03']);
  assert.match(r.checks.find((c) => c.reason === 'F03').title, /DC2-AAAAAA/);
});
test('T16 suspended contractor is rejected', () => {
  const r = R.evaluateRequest(req({ subId: 'S03', activityId: 'A4' }), ctx());
  assert.deepEqual(failed(r), ['R02']);
});
test('T17 missing contact phone is rejected', () => {
  const r = R.evaluateRequest(req({ pocPhone: '' }), ctx());
  assert.deepEqual(failed(r), ['R01']);
  assert.match(r.checks[0].remedy, /onsite contact phone/);
});
test('T18 a 9-digit phone number is rejected', () => {
  const r = R.evaluateRequest(req({ pocPhone: '214-555-010' }), ctx());
  assert.deepEqual(failed(r), ['R01']);
});
test('T19 rescheduling a request does not count against its own slot', () => {
  const mine = booked({ id: 'MINE' }); const other = booked({ id: 'X1', subId: 'S02', activityId: 'A2' });
  const r = R.evaluateRequest(req({ id: 'MINE' }), ctx([mine, other]));
  assert.equal(r.outcome, 'approved');
});
test('T20 a rejection lists every failed rule, not just the first', () => {
  const r = R.evaluateRequest(req({ subId: 'S02', date: '2026-10-13', slot: '09:00' }), ctx());
  assert.deepEqual(failed(r), ['R04', 'R05']);
});

// ---- Gate checks ----
const gateReq = { id: 'Q1', subId: 'S01', date: '2026-10-15', slot: '07:00', zoneId: 'Z1', status: 'approved' };
const gctx = (now, passOver = {}, reqOver = {}, extra = {}) => Object.assign({
  now, settings: {}, subs, zones,
  passes: [Object.assign({ code: 'DC2-7KQX9M', requestId: 'Q1', status: 'active' }, passOver)],
  requests: [Object.assign({}, gateReq, reqOver)],
}, extra);
const at = (h, m) => new Date(2026, 9, 15, h, m);

test('G-T01 valid pass inside its window is green', () => {
  const r = R.checkPass('DC2-7KQX9M', gctx(at(7, 20)));
  assert.equal(r.color, 'green'); assert.equal(r.reason, 'G00'); assert.match(r.remedy, /South laydown yard/);
});
test('G-T02 window opens 60 minutes before the slot (boundary is green)', () => {
  assert.equal(R.checkPass('DC2-7KQX9M', gctx(at(6, 0))).reason, 'G00');
  assert.equal(R.checkPass('DC2-7KQX9M', gctx(at(5, 59))).reason, 'G05');
});
test('G-T03 window closes 60 minutes after the slot ends', () => {
  assert.equal(R.checkPass('DC2-7KQX9M', gctx(at(9, 0))).reason, 'G00');
  const late = R.checkPass('DC2-7KQX9M', gctx(at(9, 1)));
  assert.equal(late.reason, 'G06'); assert.match(late.title, /9:00 AM/);
});
test('G-T03b the arrival window never extends outside gate hours', () => {
  const early = R.passWindow({ date: '2026-10-15', slot: '06:00' });
  assert.equal(R.fmtClock(early.open), '6:00 AM'); assert.equal(R.fmtClock(early.close), '8:00 AM');
  const late = R.passWindow({ date: '2026-10-15', slot: '15:00' });
  assert.equal(R.fmtClock(late.open), '2:00 PM'); assert.equal(R.fmtClock(late.close), '4:00 PM');
  assert.equal(R.checkPass('DC2-7KQX9M', gctx(at(5, 30), {}, { slot: '06:00' })).reason, 'G05');
});
test('G-T04 wrong day is red', () => {
  const r = R.checkPass('DC2-7KQX9M', gctx(new Date(2026, 9, 14, 7, 0)));
  assert.equal(r.reason, 'G04'); assert.match(r.title, /Thu 10\/15/);
});
test('G-T05 used, cancelled, unknown and suspended passes are red', () => {
  assert.equal(R.checkPass('DC2-7KQX9M', gctx(at(7, 0), { status: 'used', usedAt: at(6, 50).toISOString() })).reason, 'G03');
  assert.equal(R.checkPass('DC2-7KQX9M', gctx(at(7, 0), { status: 'void' })).reason, 'G02');
  assert.equal(R.checkPass('DC2-XXXXXX', gctx(at(7, 0))).reason, 'G01');
  const susp = Object.assign({}, gctx(at(7, 0)), { subs: [Object.assign({}, subs[0], { suspended: true })] });
  assert.equal(R.checkPass('DC2-7KQX9M', susp).reason, 'G07');
});
test('G-T06 an emergency (override) pass still admits a suspended contractor', () => {
  const c = Object.assign({}, gctx(at(7, 0), { override: true }), { subs: [Object.assign({}, subs[0], { suspended: true })] });
  assert.equal(R.checkPass('DC2-7KQX9M', c).reason, 'G00');
});
test('G-T07 typed codes are normalized', () => {
  assert.equal(R.normalizeCode(' 7kqx9m '), 'DC2-7KQX9M');
  assert.equal(R.normalizeCode('dc27kqx9m'), 'DC2-7KQX9M');
  assert.equal(R.checkPass('7kqx9m', gctx(at(7, 0))).color, 'green');
});

// ---- Status, codes, notifications ----
test('S-T01 an approved delivery becomes a no-show after slot end + grace', () => {
  const p = { status: 'active' };
  assert.equal(R.deliveryStatus(gateReq, p, at(9, 0)), 'approved');
  assert.equal(R.deliveryStatus(gateReq, p, at(9, 1)), 'noshow');
  assert.equal(R.deliveryStatus(gateReq, { status: 'used' }, at(9, 1)), 'arrived');
});
test('S-T02 pass codes avoid look-alike characters and never repeat', () => {
  let i = 0; const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const rand = () => seq[i++ % seq.length];
  const first = R.newPassCode([], {}, rand);
  assert.match(first, /^DC2-[ACDEFGHJKMNPQRTUVWXY34679]{6}$/);
  const second = R.newPassCode([first], {}, rand);
  assert.notEqual(first, second);
});
test('S-T03 a turn-away notifies all three parties with the reason and fix', () => {
  const n = R.notices('turnedAway', { subName: 'North Field Electrical', material: 'Busway', reasonTitle: 'Too early', remedy: 'Wait', passCode: 'DC2-7KQX9M', guard: 'Guard 1' });
  assert.deepEqual(n.map((x) => x.to), ['contractor', 'security', 'gc']);
  assert.ok(n.every((x) => /Too early/.test(x.body) && /Wait/.test(x.body)));
});
test('S-T04 slot board marks full and too-soon slots', () => {
  const b = R.slotBoard(ctx([booked({ id: 'X1', gateId: 'G2', slot: '07:00' })]), 'G2', '2026-10-15');
  assert.equal(b.find((s) => s.slot === '07:00').open, false);
  assert.equal(b.find((s) => s.slot === '08:00').open, true);
  const soon = R.slotBoard(ctx(), 'G1', '2026-10-13');
  assert.ok(soon.every((s) => !s.open && s.tooSoon));
});
