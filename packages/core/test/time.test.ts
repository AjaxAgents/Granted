// Site time: converting real instants to the jobsite wall clock and back, across daylight saving.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { toWallClock, fromWallClock, siteToday, isValidTimeZone } from '../src/time';
import { checkPass, fmtClock, ymd } from '../src/rules';

const TZ = 'America/Chicago';

test('TZ01 an instant shows as the Chicago wall clock (CDT, UTC-5)', () => {
  const w = toWallClock(new Date('2026-10-15T12:20:00Z'), TZ);
  assert.equal(ymd(w), '2026-10-15'); assert.equal(fmtClock(w), '7:20 AM');
});
test('TZ02 winter time is UTC-6 (CST)', () => {
  const w = toWallClock(new Date('2026-12-15T12:20:00Z'), TZ);
  assert.equal(fmtClock(w), '6:20 AM');
});
test('TZ03 wall clock converts back to the same instant', () => {
  for (const iso of ['2026-10-15T12:20:00.000Z', '2026-12-15T23:59:00.000Z', '2026-03-08T09:00:00.000Z', '2026-11-01T05:30:00.000Z']) {
    assert.equal(fromWallClock(toWallClock(new Date(iso), TZ), TZ).toISOString(), iso);
  }
});
test('TZ04 the site date can differ from the UTC date in the evening', () => {
  assert.equal(siteToday(new Date('2026-10-16T03:00:00Z'), TZ), '2026-10-15');
});
test('TZ05 unknown time zones are refused', () => {
  assert.equal(isValidTimeZone(TZ), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
});
test('TZ06 the gate check uses site time when the server clock is UTC', () => {
  const now = toWallClock(new Date('2026-10-15T12:20:00Z'), TZ); // 7:20 AM at the site
  const ctx = {
    now, settings: { passPrefix: 'DDC2' }, subs: [{ id: 's', name: 'North Field Electrical' }], zones: [],
    passes: [{ code: 'DDC2-7KQX9M', requestId: 'q', status: 'used' as const, usedAt: '2026-10-15T12:05:00Z' }],
    requests: [{ id: 'q', subId: 's', date: '2026-10-15', slot: '07:00', zoneId: 'z', status: 'approved' as const }],
    formatInstant: (iso: string) => fmtClock(toWallClock(new Date(iso), TZ)),
  };
  const r = checkPass('DDC2-7KQX9M', ctx);
  assert.equal(r.reason, 'G03'); assert.match(r.title, /7:05 AM/);
  ctx.passes[0].status = 'active' as never;
  assert.equal(checkPass('DDC2-7KQX9M', ctx).reason, 'G00');
});
