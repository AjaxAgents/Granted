/*
 * Site time. The rules work in "site wall-clock" Dates (see rules.ts). These
 * helpers convert between real instants and a project's wall clock using the
 * built-in Intl time-zone data, so daylight saving is handled by the platform.
 */

interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number }

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

function partsIn(instant: Date, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour === 24 ? 0 : out.hour, minute: out.minute, second: out.second };
}

/** True if the platform knows this IANA time zone (e.g. "America/Chicago"). */
export function isValidTimeZone(timeZone: string): boolean {
  try { formatter(timeZone); return true; } catch { return false; }
}

/** The wall clock at the site for a real instant, as a Date whose local fields show that time. */
export function toWallClock(instant: Date, timeZone: string): Date {
  const p = partsIn(instant, timeZone);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, instant.getMilliseconds());
}

/**
 * The real instant for a site wall-clock Date. For a time that does not exist
 * (the hour skipped when clocks go forward) the result is the next valid time;
 * for an hour that happens twice, the first one.
 */
export function fromWallClock(wall: Date, timeZone: string): Date {
  const target = Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes(), wall.getSeconds(), wall.getMilliseconds());
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, wall.getMilliseconds());
    const diff = target - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Today's date (YYYY-MM-DD) at the site. */
export function siteToday(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
}
